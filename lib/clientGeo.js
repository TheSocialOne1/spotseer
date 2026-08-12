export const LOCATION_ERROR_MESSAGES = {
  1: "Location access was denied. Enable location for this site in your browser settings.",
  2: "Couldn't get a GPS fix. Move somewhere with a clearer sky view and try again.",
  3: "Getting your location took too long. Try again.",
  unsupported: "This browser doesn't support location.",
};

export function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (err) => reject(new Error(String(err.code))),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}
