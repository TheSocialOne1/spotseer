import crypto from "crypto";
import { query } from "@/lib/db";
import { EVENT_TYPES } from "@/lib/signal";
import { distanceMeters, geohash } from "@/lib/geo";
import { inPilotZone } from "@/lib/pilot";
import { streetName } from "@/lib/reverseGeocode";

const MAX_ACCURACY_M = 75;
const DUPLICATE_WINDOW_MS = 90 * 1000;
const DUPLICATE_RADIUS_M = 60;
const CORROBORATE_RADIUS_M = { leaving: 35, open: 35, full: 120 };
const CLAIM_RADIUS_M = 50;
const CLAIM_GRACE_MS = 2 * 60 * 1000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_DEVICE = 6;
const RATE_LIMIT_IP = 15;
export const SESSION_MAX_MS = 60 * 60 * 1000;
export const ALERT_RADIUS_M = 800;
const ALERT_COOLDOWN_MS = 60 * 1000;

const num = (v) => (v === null || v === undefined ? null : Number(v));

// ~0.002° lat ≈ 220 m — a cheap bounding box before exact distance checks.
function nearbyBox(lat, lng) {
  return [lat - 0.002, lat + 0.002, lng - 0.0025, lng + 0.0025];
}

function rowToEvent(r) {
  return {
    id: r.id,
    type: r.type,
    lat: num(r.lat),
    lng: num(r.lng),
    street: r.street,
    createdAt: num(r.created_at),
    expiresAt: num(r.expires_at),
    corroborations: num(r.corroborations) ?? 0,
    reporterReports: num(r.reports) ?? 0,
    reporterClaimed: num(r.claimed) ?? 0,
  };
}

export function isValidDeviceId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9-]{16,64}$/.test(id);
}

// Rate limiting needs *some* signal a spoofed device id can't dodge. The IP is
// hashed with a daily salt so it can't be used to track anyone over time.
export function hashIp(ip) {
  if (!ip) return null;
  const day = new Date().toISOString().slice(0, 10);
  return crypto.createHash("sha256").update(`${day}:${ip}`).digest("hex").slice(0, 16);
}

async function touchDevice(deviceId, now) {
  await query(
    `INSERT INTO devices (id, first_seen_at, last_seen_at) VALUES ($1, $2, $2)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
    [deviceId, now]
  );
}

function validateLocation(lat, lng, accuracy) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "location_required", status: 422 };
  if (!inPilotZone(lat, lng)) return { error: "outside_zone", status: 422 };
  if (!Number.isFinite(accuracy) || accuracy > MAX_ACCURACY_M) {
    return { error: "low_accuracy", status: 422, accuracy: Math.round(accuracy) || null };
  }
  return null;
}

export async function getLiveEvents(now = Date.now()) {
  const rows = await query(
    `SELECT e.*, d.reports, d.claimed
     FROM events e LEFT JOIN devices d ON d.id = e.device_id
     WHERE e.expires_at > $1 AND e.claimed_at IS NULL AND e.corroborates IS NULL AND e.source = 'user'
     ORDER BY e.created_at DESC
     LIMIT 200`,
    [now]
  );
  return rows.map(rowToEvent);
}

export async function createEvent({ deviceId, type, lat, lng, accuracy, ipHash }) {
  const spec = EVENT_TYPES[type];
  if (!spec) return { error: "invalid_type", status: 400 };
  const locationError = validateLocation(lat, lng, accuracy);
  if (locationError) return locationError;

  const now = Date.now();
  await touchDevice(deviceId, now);

  const [limits] = await query(
    `SELECT count(*) FILTER (WHERE device_id = $1)::int AS by_device,
            count(*) FILTER (WHERE ip_hash = $2)::int AS by_ip
     FROM events WHERE source = 'user' AND created_at > $3`,
    [deviceId, ipHash, now - RATE_WINDOW_MS]
  );
  if (limits.by_device >= RATE_LIMIT_DEVICE || (ipHash && limits.by_ip >= RATE_LIMIT_IP)) {
    return { error: "rate_limited", status: 429 };
  }

  const own = await query(
    `SELECT lat, lng FROM events WHERE device_id = $1 AND type = $2 AND created_at > $3`,
    [deviceId, type, now - DUPLICATE_WINDOW_MS]
  );
  if (own.some((e) => distanceMeters(lat, lng, num(e.lat), num(e.lng)) <= DUPLICATE_RADIUS_M)) {
    return { error: "duplicate", status: 409 };
  }

  // A second, independent device reporting the same thing nearby confirms the
  // original instead of stacking another pin on the map. "Open" and "leaving"
  // count as the same family: a passerby seeing it open confirms a departure.
  const family = spec.claimable ? ["leaving", "open"] : [type];
  const [minLat, maxLat, minLng, maxLng] = nearbyBox(lat, lng);
  const candidates = await query(
    `SELECT * FROM events
     WHERE type = ANY($1) AND source = 'user' AND corroborates IS NULL AND claimed_at IS NULL
       AND expires_at > $2 AND device_id <> $3
       AND lat BETWEEN $4 AND $5 AND lng BETWEEN $6 AND $7`,
    [family, now, deviceId, minLat, maxLat, minLng, maxLng]
  );
  const original = candidates
    .map((e) => ({ e, d: distanceMeters(lat, lng, num(e.lat), num(e.lng)) }))
    .filter((x) => x.d <= CORROBORATE_RADIUS_M[type])
    .sort((a, b) => a.d - b.d)[0]?.e;

  const id = crypto.randomUUID();
  const street = original?.street ?? (await streetName(lat, lng));
  await query(
    `INSERT INTO events (id, device_id, type, lat, lng, accuracy_m, geohash, street, created_at, expires_at, corroborates, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, deviceId, type, lat, lng, accuracy, geohash(lat, lng), street, now, now + spec.ttlMs, original?.id ?? null, ipHash]
  );

  if (original) {
    await query(
      `UPDATE events SET corroborations = corroborations + 1, expires_at = GREATEST(expires_at, $2) WHERE id = $1`,
      [original.id, now + spec.ttlMs]
    );
    return { corroborated: true, event: { id: original.id, type: original.type, street } };
  }

  if (spec.claimable) {
    await query(`UPDATE devices SET reports = reports + 1 WHERE id = $1`, [deviceId]);
  }
  return { corroborated: false, event: { id, type, lat, lng, street, deviceId, createdAt: now } };
}

async function closeStaleSessions(now) {
  await query(
    `UPDATE search_sessions SET ended_at = started_at + $2, outcome = 'timeout'
     WHERE ended_at IS NULL AND started_at < $1`,
    [now - SESSION_MAX_MS, SESSION_MAX_MS]
  );
}

export async function startSession({ deviceId, lat, lng }) {
  const now = Date.now();
  await touchDevice(deviceId, now);
  await closeStaleSessions(now);
  await query(
    `UPDATE search_sessions SET ended_at = $2, outcome = 'abandoned' WHERE device_id = $1 AND ended_at IS NULL`,
    [deviceId, now]
  );

  const id = crypto.randomUUID();
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
  await query(
    `INSERT INTO search_sessions (id, device_id, started_at, start_lat, start_lng, last_lat, last_lng, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $4, $5, $3)`,
    [id, deviceId, now, hasLocation ? lat : null, hasLocation ? lng : null]
  );
  return { id, startedAt: now };
}

async function ownedOpenSession(id, deviceId) {
  const [session] = await query(`SELECT * FROM search_sessions WHERE id = $1 AND device_id = $2`, [id, deviceId]);
  if (!session) return { error: "not_found", status: 404 };
  if (session.ended_at !== null) return { error: "already_ended", status: 409, session };
  return { session };
}

export async function heartbeat({ id, deviceId, lat, lng }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "location_required", status: 422 };
  const { error, status } = await ownedOpenSession(id, deviceId);
  if (error) return { error, status };
  await query(
    `UPDATE search_sessions SET last_lat = $2, last_lng = $3, last_seen_at = $4 WHERE id = $1`,
    [id, lat, lng, Date.now()]
  );
  return { ok: true };
}

export async function endSession({ id, deviceId, outcome, lat, lng }) {
  if (outcome !== "parked" && outcome !== "gave_up") return { error: "invalid_outcome", status: 400 };
  const { session, error, status } = await ownedOpenSession(id, deviceId);
  if (error) return { error, status };

  const now = Date.now();
  const startedAt = num(session.started_at);
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
  let claimed = null;

  if (outcome === "parked" && hasLocation && inPilotZone(lat, lng)) {
    // Did this driver park where someone else reported an opening? If so the
    // report is validated: it counts toward the reporter's reputation, drops
    // off the map as taken, and becomes a labeled outcome for future models.
    const [minLat, maxLat, minLng, maxLng] = nearbyBox(lat, lng);
    const candidates = await query(
      `SELECT * FROM events
       WHERE type IN ('leaving', 'open') AND source = 'user' AND corroborates IS NULL AND claimed_at IS NULL
         AND device_id <> $1 AND created_at >= $2 AND expires_at > $3
         AND lat BETWEEN $4 AND $5 AND lng BETWEEN $6 AND $7`,
      [deviceId, startedAt - 10 * 60 * 1000, now - CLAIM_GRACE_MS, minLat, maxLat, minLng, maxLng]
    );
    claimed = candidates
      .map((e) => ({ e, d: distanceMeters(lat, lng, num(e.lat), num(e.lng)) }))
      .filter((x) => x.d <= CLAIM_RADIUS_M)
      .sort((a, b) => a.d - b.d)[0]?.e ?? null;

    if (claimed) {
      await query(`UPDATE events SET claimed_at = $2, claimed_by_session = $3 WHERE id = $1 AND claimed_at IS NULL`, [
        claimed.id,
        now,
        id,
      ]);
      await query(`UPDATE devices SET claimed = claimed + 1 WHERE id = $1`, [claimed.device_id]);
    }

    // Where and when a car parked — raw material for occupancy/turnover later.
    await query(
      `INSERT INTO events (id, device_id, type, source, lat, lng, geohash, created_at, expires_at)
       VALUES ($1, $2, 'parked', 'session', $3, $4, $5, $6, $6)`,
      [crypto.randomUUID(), deviceId, lat, lng, geohash(lat, lng), now]
    );
  }

  await query(
    `UPDATE search_sessions SET ended_at = $2, end_lat = $3, end_lng = $4, outcome = $5, used_event_id = $6 WHERE id = $1`,
    [id, now, hasLocation ? lat : null, hasLocation ? lng : null, outcome, claimed?.id ?? null]
  );

  return {
    durationMs: now - startedAt,
    usedReport: claimed ? { type: claimed.type, street: claimed.street, ageMs: now - num(claimed.created_at) } : null,
    // Internal: who to thank. Stripped before the response leaves the server.
    reporterDeviceId: claimed?.device_id ?? null,
  };
}

export async function getDeviceSubscriptions(deviceId) {
  const rows = await query(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE device_id = $1`, [deviceId]);
  return rows.map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
}

export async function setBaseline({ id, deviceId, minutes }) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) return { error: "invalid_minutes", status: 400 };
  await query(`UPDATE search_sessions SET baseline_minutes = $3 WHERE id = $1 AND device_id = $2 AND outcome = 'parked'`, [
    id,
    deviceId,
    minutes,
  ]);
  return { ok: true };
}

// Active searchers near a new opening who can receive a push right now.
export async function findAlertTargets(event, now = Date.now()) {
  const rows = await query(
    `SELECT s.id AS session_id, COALESCE(s.last_lat, s.start_lat) AS lat, COALESCE(s.last_lng, s.start_lng) AS lng,
            p.endpoint, p.p256dh, p.auth
     FROM search_sessions s
     JOIN push_subscriptions p ON p.device_id = s.device_id
     WHERE s.ended_at IS NULL AND s.started_at > $1 AND s.device_id <> $2
       AND (s.last_alert_at IS NULL OR s.last_alert_at < $3)`,
    [now - SESSION_MAX_MS, event.deviceId, now - ALERT_COOLDOWN_MS]
  );

  const bySession = new Map();
  for (const r of rows) {
    if (r.lat === null) continue;
    const distance = distanceMeters(event.lat, event.lng, num(r.lat), num(r.lng));
    if (distance > ALERT_RADIUS_M) continue;
    const target = bySession.get(r.session_id) ?? { sessionId: r.session_id, distance, subscriptions: [] };
    target.subscriptions.push({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } });
    bySession.set(r.session_id, target);
  }
  return [...bySession.values()];
}

export async function markAlerted(sessionIds, now = Date.now()) {
  if (sessionIds.length === 0) return;
  await query(
    `UPDATE search_sessions SET alerts_sent = alerts_sent + 1, last_alert_at = $2 WHERE id = ANY($1)`,
    [sessionIds, now]
  );
}

export async function savePushSubscription({ deviceId, subscription }) {
  await touchDevice(deviceId, Date.now());
  await query(
    `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, created_at, device_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE SET device_id = EXCLUDED.device_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [crypto.randomUUID(), subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, Date.now(), deviceId]
  );
}

export async function removePushSubscription(endpoint) {
  await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

const LA_HOUR = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hour12: false });

export async function getStats(now = Date.now()) {
  await closeStaleSessions(now);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const [search] = await query(
    `SELECT
       count(*)::int AS started,
       count(*) FILTER (WHERE outcome = 'parked')::int AS parked,
       count(*) FILTER (WHERE outcome = 'gave_up')::int AS gave_up,
       count(*) FILTER (WHERE outcome IN ('timeout', 'abandoned'))::int AS unfinished,
       count(*) FILTER (WHERE outcome = 'parked' AND used_event_id IS NOT NULL)::int AS parked_with_report,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY ended_at - started_at) FILTER (WHERE outcome = 'parked') AS median_ms,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY ended_at - started_at)
         FILTER (WHERE outcome = 'parked' AND used_event_id IS NOT NULL) AS median_with_report_ms,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY ended_at - started_at)
         FILTER (WHERE outcome = 'parked' AND used_event_id IS NULL) AS median_without_report_ms,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY baseline_minutes) FILTER (WHERE baseline_minutes IS NOT NULL) AS median_baseline_min,
       count(baseline_minutes)::int AS baseline_answers,
       sum(alerts_sent)::int AS alerts_sent
     FROM search_sessions`
  );

  const reports = await query(
    `SELECT type,
       count(*)::int AS total,
       count(*) FILTER (WHERE claimed_at IS NOT NULL)::int AS claimed,
       count(*) FILTER (WHERE corroborations > 0)::int AS corroborated,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY claimed_at - created_at) FILTER (WHERE claimed_at IS NOT NULL) AS median_claim_ms
     FROM events
     WHERE source = 'user' AND corroborates IS NULL AND created_at > $1
     GROUP BY type`,
    [weekAgo]
  );

  const [devices] = await query(
    `SELECT
       (SELECT count(*)::int FROM devices WHERE last_seen_at > $1) AS active_7d,
       (SELECT count(*)::int FROM devices) AS total,
       (SELECT count(*)::int FROM (
          SELECT device_id FROM (
            SELECT device_id, created_at AS t FROM events WHERE source = 'user'
            UNION ALL
            SELECT device_id, started_at AS t FROM search_sessions
          ) activity
          GROUP BY device_id
          HAVING count(DISTINCT floor(t / 86400000)) >= 2
        ) returning_devices) AS returning`,
    [weekAgo]
  );

  // Hour-of-day departures: the first building block of the historical layer.
  const departures = await query(
    `SELECT created_at FROM events WHERE source = 'user' AND type IN ('leaving', 'open') AND corroborates IS NULL
     ORDER BY created_at DESC LIMIT 5000`
  );
  const byHour = Array(24).fill(0);
  for (const d of departures) byHour[Number(LA_HOUR.format(new Date(num(d.created_at)))) % 24] += 1;

  return {
    search: Object.fromEntries(Object.entries(search).map(([k, v]) => [k, num(v)])),
    reports: reports.map((r) => ({ ...r, median_claim_ms: num(r.median_claim_ms) })),
    devices,
    departuresByHour: byHour,
  };
}
