import { NextResponse } from "next/server";
import webpush from "web-push";
import { getPushSubscriptions } from "@/lib/store";

// Temporary diagnostic: sends a real push to every subscriber and reports
// exactly what each push service returned, instead of swallowing the error.
export async function POST() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const subs = await getPushSubscriptions();
  const payload = JSON.stringify({ title: "SpotSeer test", body: "Diagnostic ping", url: "/" });

  const results = [];
  for (const sub of subs) {
    try {
      const res = await webpush.sendNotification(sub, payload);
      results.push({ endpoint: sub.endpoint.slice(0, 60), ok: true, statusCode: res.statusCode });
    } catch (err) {
      results.push({
        endpoint: sub.endpoint.slice(0, 60),
        ok: false,
        statusCode: err.statusCode,
        message: err.message,
        body: err.body,
      });
    }
  }

  return NextResponse.json({
    vapidSubjectSet: Boolean(process.env.VAPID_SUBJECT),
    vapidPublicKeySet: Boolean(process.env.VAPID_PUBLIC_KEY),
    vapidPrivateKeySet: Boolean(process.env.VAPID_PRIVATE_KEY),
    subscriberCount: subs.length,
    results,
  });
}
