// Shared (client + server) rules for how much to trust a report. Kept pure so
// the client can re-score every second as reports age, without refetching.

export const EVENT_TYPES = {
  // Reported by the driver at their own car — best source, but "soon" is fuzzy.
  leaving: { ttlMs: 6 * 60 * 1000, base: 0.8, title: "Leaving soon", tone: "amber", claimable: true },
  // Seen by a passerby — could turn out to be a driveway or red curb.
  open: { ttlMs: 4 * 60 * 1000, base: 0.6, title: "Open space", tone: "green", claimable: true },
  // Negative signal for an area rather than a single space.
  full: { ttlMs: 12 * 60 * 1000, base: 0.7, title: "Block full", tone: "red", claimable: false },
};

export const REPORTABLE_TYPES = Object.keys(EVENT_TYPES);

// Beta(1,1) prior: a brand-new device starts at 0.5 and moves toward its real
// hit rate (reports that another driver actually parked in) as history grows.
export function reputation(reports = 0, claimed = 0) {
  return (claimed + 1) / (reports + 2);
}

export function scoreEvent(event, now) {
  const spec = EVENT_TYPES[event.type];
  if (!spec) return { score: 0, level: "low", confirmed: false, ageMs: 0, remainingMs: 0 };

  const ageMs = Math.max(0, now - event.createdAt);
  const remainingMs = Math.max(0, event.expiresAt - now);
  const freshness = Math.max(0, 1 - ageMs / spec.ttlMs);
  const rep = reputation(event.reporterReports, event.reporterClaimed);
  const corroboration = Math.min(event.corroborations ?? 0, 2) * 0.15;
  const score = Math.min(1, spec.base * (0.7 + 0.6 * rep) + corroboration) * freshness;

  return {
    score,
    level: score >= 0.55 ? "high" : score >= 0.3 ? "medium" : "low",
    confirmed: (event.corroborations ?? 0) > 0,
    ageMs,
    remainingMs,
  };
}

export function formatAge(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}
