const KEY = "spotseer.deviceId";

// Anonymous, per-browser identity. No account, no personal data — just enough
// to build reputation, dedupe reports, and measure whether people come back.
export function getDeviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    globalThis.__spotseerDeviceId ??= crypto.randomUUID();
    return globalThis.__spotseerDeviceId;
  }
}

export function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

export function writeJson(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode) — the session just won't survive a reload.
  }
}
