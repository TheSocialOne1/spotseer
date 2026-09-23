import { removePushSubscription, savePushSubscription } from "@/lib/network";
import { badDevice, readBody, respond } from "@/lib/request";

export async function POST(request) {
  const body = await readBody(request);
  const invalid = badDevice(body.deviceId);
  if (invalid) return invalid;

  const sub = body.subscription;
  if (typeof sub?.endpoint !== "string" || !sub.keys?.p256dh || !sub.keys?.auth) {
    return respond({ error: "invalid_subscription", status: 400 });
  }

  await savePushSubscription({ deviceId: body.deviceId, subscription: sub });
  return respond({ ok: true });
}

export async function DELETE(request) {
  const body = await readBody(request);
  if (typeof body.endpoint !== "string") return respond({ error: "invalid_request", status: 400 });
  await removePushSubscription(body.endpoint);
  return respond({ ok: true });
}
