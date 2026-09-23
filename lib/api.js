import { getDeviceId } from "@/lib/device";

async function send(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: getDeviceId(), ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? `http_${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  live: () => fetch("/api/live", { cache: "no-store" }).then((r) => r.json()),
  report: (type, fix) => send("POST", "/api/events", { type, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }),
  startSearch: (fix) => send("POST", "/api/sessions", { lat: fix?.lat, lng: fix?.lng }),
  heartbeat: (id, fix) => send("PATCH", `/api/sessions/${id}`, { action: "heartbeat", lat: fix.lat, lng: fix.lng }),
  endSearch: (id, action, fix) => send("PATCH", `/api/sessions/${id}`, { action, lat: fix?.lat, lng: fix?.lng }),
  baseline: (id, minutes) => send("PATCH", `/api/sessions/${id}`, { action: "baseline", minutes }),
  subscribe: (subscription) => send("POST", "/api/push/subscribe", { subscription }),
  unsubscribe: (endpoint) => send("DELETE", "/api/push/subscribe", { endpoint }),
};

export const REPORT_ERRORS = {
  outside_zone: "SpotSeer is only live in the Alamitos Beach pilot zone for now.",
  low_accuracy: "GPS is too fuzzy to pin this down. Give it a few seconds and try again.",
  location_required: "Need your location to place the report.",
  rate_limited: "That's a lot of reports in a few minutes — give it a bit.",
  duplicate: "Already got that one — thanks.",
};
