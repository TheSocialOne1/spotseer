// The only area where reports are accepted. Deliberately small: a useful
// network needs report density, and density comes from a few blocks of
// committed residents, not from a large empty map. Expand by adding zones.
export const PILOT_ZONE = {
  id: "alamitos-beach",
  name: "Alamitos Beach pilot",
  // Roughly Ocean Blvd → 4th St, Alamitos Ave → Junipero Ave.
  bounds: { south: 33.7638, north: 33.7724, west: -118.1862, east: -118.1733 },
  center: [33.7684, -118.1802],
};

export function inPilotZone(lat, lng) {
  const b = PILOT_ZONE.bounds;
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}
