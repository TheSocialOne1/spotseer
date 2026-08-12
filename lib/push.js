import webpush from "web-push";
import { getPushSubscriptions, removePushSubscription } from "@/lib/store";

function isConfigured() {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT
  );
}

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  vapidConfigured = true;
}

// Notifies every subscribed device that a spot just opened up. Best-effort:
// a failed push for one device never blocks the others, and subscriptions
// the push service reports as gone (410/404 — user revoked, browser data
// cleared) are pruned automatically.
export async function notifySpotOpened(spot) {
  if (!isConfigured()) return;
  ensureVapid();

  const subscriptions = await getPushSubscriptions();
  if (subscriptions.length === 0) return;

  const payload = JSON.stringify({
    title: "SpotSeer: a spot just opened",
    body: `${spot.name} — ${spot.cross}`,
    url: "/",
  });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await removePushSubscription(sub.endpoint);
        }
      }
    })
  );
}
