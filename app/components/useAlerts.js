"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { urlBase64ToUint8Array, isIos, isStandalone, pushSupported } from "@/lib/pushClient";

// status: checking | needs-install | unsupported | off | on | denied | working | error
export function useAlerts() {
  const [status, setStatus] = useState("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isIos() && !isStandalone()) return setStatus("needs-install");
      if (!pushSupported()) return setStatus("unsupported");
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          // Re-link subscriptions created before alerts were tied to a device.
          await api.subscribe(existing.toJSON()).catch(() => {});
        }
        if (!cancelled) setStatus(existing ? "on" : Notification.permission === "denied" ? "denied" : "off");
      } catch {
        if (!cancelled) setStatus("unsupported");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setStatus("working");
    setError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setStatus("denied");
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) throw new Error("Alerts aren't configured on this server yet.");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      await api.subscribe(sub.toJSON());
      setStatus("on");
    } catch (err) {
      setError(String(err?.message ?? err));
      setStatus("error");
    }
  }, []);

  const disable = useCallback(async () => {
    setStatus("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.unsubscribe(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch (err) {
      setError(String(err?.message ?? err));
      setStatus("on");
    }
  }, []);

  return { status, error, enable, disable };
}
