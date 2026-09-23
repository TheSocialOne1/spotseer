import { geohash } from "@/lib/geo";

const cache = new Map();

// Street name for a report ("Bonito Ave") so a driver can read a situation in
// a glance instead of decoding pins. Uses OpenStreetMap's free Nominatim,
// which is fine at pilot volume (policy: ≤1 req/s) — swap for a paid
// geocoder before real scale. Never blocks a report for more than ~1.5 s.
export async function streetName(lat, lng) {
  const key = geohash(lat, lng, 8);
  if (cache.has(key)) return cache.get(key);

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "SpotSeer/0.2 (parking pilot, Long Beach CA)" },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const road = data?.address?.road ?? null;
    const short = road
      ?.replace(/\bAvenue\b/, "Ave")
      .replace(/\bStreet\b/, "St")
      .replace(/\bBoulevard\b/, "Blvd")
      .replace(/^(East|West|North|South) /, "");
    cache.set(key, short ?? null);
    return short ?? null;
  } catch {
    return null;
  }
}
