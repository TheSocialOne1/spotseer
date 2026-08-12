import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ensureSchema, getSql, isDatabaseConfigured } from "@/lib/db";

const DATA_DIR = path.join(process.cwd(), "data");
const SPOTS_FILE = path.join(DATA_DIR, "spots.json");
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");
const PUSH_SUBS_FILE = path.join(DATA_DIR, "push-subscriptions.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function rowToSpot(row) {
  return {
    id: row.id,
    name: row.name,
    cross: row.cross_streets,
    area: row.area,
    featured: row.featured,
    lat: row.lat,
    lng: row.lng,
  };
}

function rowToReport(row) {
  return {
    id: row.id,
    spotId: row.spot_id,
    type: row.type,
    createdAt: Number(row.created_at),
    reporterLat: row.reporter_lat,
    reporterLng: row.reporter_lng,
    distanceMeters: row.distance_meters,
  };
}

// Storage backend: a hosted Postgres database (Neon, via DATABASE_URL) when
// configured, otherwise local JSON files — lets local dev keep working while
// a production database is being set up.
export async function getSpots() {
  if (isDatabaseConfigured()) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT * FROM spots ORDER BY featured DESC, name`;
    return rows.map(rowToSpot);
  }
  return readJson(SPOTS_FILE, []);
}

export async function getReports() {
  if (isDatabaseConfigured()) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT * FROM reports ORDER BY created_at DESC LIMIT 500`;
    return rows.map(rowToReport);
  }
  return readJson(REPORTS_FILE, []);
}

export async function updateSpotLocation(spotId, lat, lng) {
  if (isDatabaseConfigured()) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`
      UPDATE spots SET lat = ${lat}, lng = ${lng} WHERE id = ${spotId} RETURNING *
    `;
    return rows[0] ? rowToSpot(rows[0]) : null;
  }

  const spots = readJson(SPOTS_FILE, []);
  const spot = spots.find((s) => s.id === spotId);
  if (!spot) return null;
  spot.lat = lat;
  spot.lng = lng;
  writeJson(SPOTS_FILE, spots);
  return spot;
}

// Reports double as the MVP's analytics log (section 14 of the product brief).
export async function addReport(report) {
  if (isDatabaseConfigured()) {
    await ensureSchema();
    const sql = getSql();
    await sql`
      INSERT INTO reports (id, spot_id, type, created_at, reporter_lat, reporter_lng, distance_meters)
      VALUES (${report.id}, ${report.spotId}, ${report.type}, ${report.createdAt}, ${report.reporterLat}, ${report.reporterLng}, ${report.distanceMeters})
    `;
    return report;
  }

  const reports = readJson(REPORTS_FILE, []);
  reports.push(report);
  const trimmed = reports.slice(-500);
  writeJson(REPORTS_FILE, trimmed);
  return report;
}

// Web Push subscriptions — one per device that opts in to "space opened" alerts.
export async function addPushSubscription(sub) {
  if (isDatabaseConfigured()) {
    await ensureSchema();
    const sql = getSql();
    await sql`
      INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, created_at)
      VALUES (${crypto.randomUUID()}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth}, ${Date.now()})
      ON CONFLICT (endpoint) DO NOTHING
    `;
    return;
  }

  const subs = readJson(PUSH_SUBS_FILE, []);
  if (!subs.some((s) => s.endpoint === sub.endpoint)) {
    subs.push({ endpoint: sub.endpoint, keys: sub.keys, createdAt: Date.now() });
    writeJson(PUSH_SUBS_FILE, subs);
  }
}

export async function removePushSubscription(endpoint) {
  if (isDatabaseConfigured()) {
    await ensureSchema();
    const sql = getSql();
    await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
    return;
  }

  const subs = readJson(PUSH_SUBS_FILE, []);
  writeJson(PUSH_SUBS_FILE, subs.filter((s) => s.endpoint !== endpoint));
}

export async function getPushSubscriptions() {
  if (isDatabaseConfigured()) {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`SELECT * FROM push_subscriptions`;
    return rows.map((row) => ({
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }));
  }
  return readJson(PUSH_SUBS_FILE, []);
}

export const REPORT_LABELS = {
  leaving: "I'm Leaving",
  opened: "Space Opened",
  found: "I Found Parking",
  full: "Area Full",
};

// How long a report stays "fresh" before a spot reverts to unknown status.
const RECENT_WINDOW_MS = {
  leaving: 5 * 60 * 1000,
  opened: 12 * 60 * 1000,
  found: 20 * 60 * 1000,
  full: 10 * 60 * 1000,
};

// leaving -> "opening soon", opened -> "available now", found -> "taken again", full -> "full"
export function computeStatus(spotId, reports, now = Date.now()) {
  const spotReports = reports
    .filter((r) => r.spotId === spotId)
    .sort((a, b) => b.createdAt - a.createdAt);

  const lastReport = spotReports[0] ?? null;

  if (lastReport) {
    const age = now - lastReport.createdAt;
    const window = RECENT_WINDOW_MS[lastReport.type] ?? 10 * 60 * 1000;
    if (age <= window) {
      if (lastReport.type === "leaving") {
        return { level: "amber", label: "Opening soon", lastReport };
      }
      if (lastReport.type === "opened") {
        return { level: "green", label: "Available now", lastReport };
      }
      if (lastReport.type === "found") {
        return { level: "taken", label: "Just parked here", lastReport };
      }
      if (lastReport.type === "full") {
        return { level: "red", label: "Area full", lastReport };
      }
    }
  }

  return { level: "gray", label: "No recent reports", lastReport };
}
