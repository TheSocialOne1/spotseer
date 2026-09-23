import { startSession } from "@/lib/network";
import { badDevice, readBody, respond } from "@/lib/request";

export async function POST(request) {
  const body = await readBody(request);
  const invalid = badDevice(body.deviceId);
  if (invalid) return invalid;

  return respond(
    await startSession({ deviceId: body.deviceId, lat: Number(body.lat), lng: Number(body.lng) })
  );
}
