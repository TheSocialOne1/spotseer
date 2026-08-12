import { NextResponse } from "next/server";
import { addPushSubscription, removePushSubscription, getPushSubscriptions } from "@/lib/store";

// Subscriber count only — never exposes endpoints/keys.
export async function GET() {
  const subs = await getPushSubscriptions();
  return NextResponse.json({ count: subs.length });
}

export async function POST(request) {
  const sub = await request.json().catch(() => null);

  if (!sub || typeof sub.endpoint !== "string" || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  await addPushSubscription(sub);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  const body = await request.json().catch(() => null);
  if (!body?.endpoint) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  await removePushSubscription(body.endpoint);
  return NextResponse.json({ ok: true });
}
