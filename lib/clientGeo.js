export const LOCATION_ERROR_MESSAGES = {
  1: "Location is off for SpotSeer. Turn it on in your browser or phone settings — reports and distances need it.",
  2: "Couldn't get a GPS fix. Give it a few seconds, ideally away from tall buildings.",
  3: "GPS is taking too long. Try again in a moment.",
  unsupported: "This browser doesn't share location.",
};

function toFix(position) {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
    at: position.timestamp,
  };
}

export function getCurrentLocation({ maxAgeMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(toFix(position)),
      (err) => reject(new Error(String(err.code))),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: maxAgeMs }
    );
  });
}

export function watchLocation(onFix, onError) {
  if (!navigator.geolocation) return () => {};
  const id = navigator.geolocation.watchPosition(
    (position) => onFix(toFix(position)),
    (err) => onError?.(String(err.code)),
    { enableHighAccuracy: true, maximumAge: 10000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}

export async function locationAlreadyGranted() {
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state === "granted";
  } catch {
    return false;
  }
}

export function navigationUrl(lat, lng) {
  const isApple = /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent) && "ontouchend" in document;
  return isApple
    ? `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}
