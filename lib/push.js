import webpush from "web-push";
import { findAlertTargets, getDeviceSubscriptions, markAlerted, removePushSubscription } from "@/lib/network";
import { formatDistance } from "@/lib/geo";

let vapidReady = false;
function ensureVapid() {
  if (vapidReady) return true;
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidReady = true;
  return true;
}

async function sendAll(subscriptions, payload) {
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload, { TTL: 120, urgency: "high" });
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await removePushSubscription(sub.endpoint);
        }
      }
    })
  );
}

// Closes the loop for the person who reported: seeing that a tap actually got
// a neighbor parked is the cheapest, most honest incentive to keep reporting.
export async function thankReporter(deviceId, usedReport) {
  if (!deviceId || !ensureVapid()) return;
  const subscriptions = await getDeviceSubscriptions(deviceId);
  if (subscriptions.length === 0) return;
  const minutes = Math.max(1, Math.round(usedReport.ageMs / 60000));
  const where = usedReport.street ? ` on ${usedReport.street}` : "";
  await sendAll(
    subscriptions,
    JSON.stringify({
      title: "Your report got someone parked",
      body: `A driver took the space${where} ${minutes} min after you reported it. Thank you.`,
      url: "/",
      tag: "spotseer-thanks",
    })
  );
}

// Alerts only go to people who are *actively searching* within ~0.5 mi, at
// most once a minute each. Everyone else is never pinged — an alert that isn't
// actionable right now trains people to ignore (or revoke) notifications.
export async function alertNearbySearchers(event) {
  if (!ensureVapid()) return 0;
  const now = Date.now();
  const targets = await findAlertTargets(event, now);
  if (targets.length === 0) return 0;

  const where = event.street ?? "Near you";
  await Promise.all(
    targets.map((target) =>
      sendAll(
        target.subscriptions,
        JSON.stringify({
          title:
            event.type === "leaving"
              ? `Space opening ${formatDistance(target.distance)} away`
              : `Open space ${formatDistance(target.distance)} away`,
          body: `${where} · just reported · tap to see it`,
          url: `/?event=${event.id}`,
          tag: "spotseer-alert",
        })
      )
    )
  );

  await markAlerted(
    targets.map((t) => t.sessionId),
    now
  );
  return targets.length;
}
