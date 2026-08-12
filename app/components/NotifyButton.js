"use client";

import { useEffect, useState } from "react";
import { urlBase64ToUint8Array, isIos, isStandalone, pushSupported } from "@/lib/pushClient";

export default function NotifyButton() {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    async function check() {
      if (isIos() && !isStandalone()) {
        setStatus("ios-needs-install");
        return;
      }
      if (!pushSupported()) {
        setStatus("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const existing = await reg.pushManager.getSubscription();
        setStatus(existing ? "subscribed" : "not-subscribed");
      } catch {
        setStatus("unsupported");
      }
    }
    check();
  }, []);

  async function subscribe() {
    setStatus("subscribing");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setStatus("subscribed");
    } catch {
      setStatus("not-subscribed");
    }
  }

  async function unsubscribe() {
    setStatus("subscribing");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("not-subscribed");
    } catch {
      setStatus("subscribed");
    }
  }

  if (status === "checking") return null;

  if (status === "ios-needs-install") {
    return (
      <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs leading-relaxed text-sky-800">
        📲 To get notified when a spot opens, add SpotSeer to your Home Screen first: tap the
        Share icon, then <span className="font-medium">Add to Home Screen</span>.
      </div>
    );
  }

  if (status === "unsupported") {
    return <p className="mt-3 text-xs text-zinc-400">Notifications aren&rsquo;t supported in this browser.</p>;
  }

  if (status === "denied") {
    return (
      <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
        Notifications are blocked. Enable them for SpotSeer in your phone/browser settings to get
        alerts.
      </p>
    );
  }

  if (status === "subscribed") {
    return (
      <button
        onClick={unsubscribe}
        className="mt-3 w-full rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-700 shadow-sm transition active:scale-95"
      >
        🔔 Notifications On — tap to turn off
      </button>
    );
  }

  return (
    <button
      onClick={subscribe}
      disabled={status === "subscribing"}
      className="mt-3 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition active:scale-95 disabled:opacity-50"
    >
      {status === "subscribing" ? "Setting up…" : "🔔 Notify Me When a Spot Opens"}
    </button>
  );
}
