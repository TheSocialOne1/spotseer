import { createEvent } from "@/lib/network";
import { alertNearbySearchers } from "@/lib/push";
import { badDevice, clientIpHash, readBody, respond } from "@/lib/request";

export async function POST(request) {
  const body = await readBody(request);
  const invalid = badDevice(body.deviceId);
  if (invalid) return invalid;

  const result = await createEvent({
    deviceId: body.deviceId,
    type: body.type,
    lat: Number(body.lat),
    lng: Number(body.lng),
    accuracy: Number(body.accuracy),
    ipHash: clientIpHash(request),
  });

  // Corroborations don't re-alert: searchers already heard about that opening.
  if (!result.error && !result.corroborated && result.event.type !== "full") {
    try {
      await alertNearbySearchers(result.event);
    } catch {
      // A failed push must never fail the report itself.
    }
  }

  if (result.error) return respond(result);
  return respond({ corroborated: result.corroborated, event: { id: result.event.id, type: result.event.type, street: result.event.street } });
}
