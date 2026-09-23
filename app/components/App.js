"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, REPORT_ERRORS } from "@/lib/api";
import { readJson, writeJson } from "@/lib/device";
import { getCurrentLocation, locationAlreadyGranted, LOCATION_ERROR_MESSAGES, navigationUrl, watchLocation } from "@/lib/clientGeo";
import { distanceMeters } from "@/lib/geo";
import { inPilotZone, PILOT_ZONE } from "@/lib/pilot";
import { EVENT_TYPES, scoreEvent } from "@/lib/signal";
import { AlertsControl, EventCard, PrimaryButton, SecondaryButton } from "./ui";
import { useAlerts } from "./useAlerts";

const LiveMap = dynamic(() => import("./LiveMap"), { ssr: false });

const SESSION_KEY = "spotseer.session";
const SESSION_MAX_MS = 60 * 60 * 1000;
const FRESH_FIX_MS = 20 * 1000;
const MAX_REPORT_ACCURACY_M = 75;

const BASELINE_CHOICES = [
  { label: "< 5 min", minutes: 3 },
  { label: "5–15", minutes: 10 },
  { label: "15–30", minutes: 22 },
  { label: "30+ min", minutes: 40 },
];

const REPORT_THANKS = {
  leaving: "Thanks — drivers searching nearby are being pinged now.",
  open: "Thanks — it'll show for 4 minutes, then drop off.",
  full: "Got it. We'll steer searchers elsewhere for a bit.",
};

// A search survives reloads and switching to a nav app, but not forever.
function loadSession() {
  const saved = readJson(SESSION_KEY);
  if (saved && Date.now() - saved.startedAt < SESSION_MAX_MS) return saved;
  if (saved) writeJson(SESSION_KEY, null);
  return null;
}

function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function App() {
  const [zone, setZone] = useState(PILOT_ZONE);
  const [rawEvents, setRawEvents] = useState([]);
  const [skewMs, setSkewMs] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [user, setUser] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [session, setSession] = useState(loadSession);
  const [mode, setMode] = useState(() => (loadSession() ? "searching" : "idle")); // idle | searching | parked
  const [result, setResult] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [focus, setFocus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [showHow, setShowHow] = useState(false);
  const alerts = useAlerts();

  const userRef = useRef(null);
  const stopWatchRef = useRef(null);
  const deepLinkRef = useRef(new URLSearchParams(window.location.search).get("event"));

  const flash = useCallback((text, tone = "ok") => {
    setToast({ text, tone, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  // On failure keep showing the last known state; the next poll retries.
  const refresh = useCallback(
    () =>
      api
        .live()
        .then((data) => {
          setZone(data.zone);
          setRawEvents(data.events);
          setSkewMs(data.now - Date.now());
        })
        .catch(() => {}),
    []
  );

  const startWatching = useCallback(() => {
    if (stopWatchRef.current) return;
    stopWatchRef.current = watchLocation(
      (fix) => {
        userRef.current = fix;
        setUser(fix);
        setLocationError(null);
      },
      (code) => setLocationError(LOCATION_ERROR_MESSAGES[code] ?? LOCATION_ERROR_MESSAGES.unsupported)
    );
  }, []);

  // A recent, precise fix if we have one; otherwise ask the GPS right now.
  const freshFix = useCallback(async () => {
    const current = userRef.current;
    if (current && Date.now() - current.at < FRESH_FIX_MS && current.accuracy <= MAX_REPORT_ACCURACY_M) return current;
    const fix = await getCurrentLocation({ maxAgeMs: 0 });
    userRef.current = fix;
    setUser(fix);
    startWatching();
    return fix;
  }, [startWatching]);

  // Boot: start polling and, if already permitted, location.
  useEffect(() => {
    locationAlreadyGranted().then((granted) => granted && startWatching());
    refresh();

    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => document.visibilityState === "visible" && refresh(), 10000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      stopWatchRef.current?.();
    };
  }, [refresh, startWatching]);

  // While searching, keep the server's idea of where you are roughly current
  // so alerts go to the right people.
  useEffect(() => {
    if (mode !== "searching" || !session) return;
    const beat = () => {
      const fix = userRef.current;
      if (fix) api.heartbeat(session.id, fix).catch(() => {});
    };
    beat();
    const id = setInterval(beat, 30000);
    return () => clearInterval(id);
  }, [mode, session]);

  const events = useMemo(() => {
    const serverNow = now + skewMs;
    return rawEvents
      .map((e) => {
        const spec = EVENT_TYPES[e.type];
        const distance = user ? distanceMeters(user.lat, user.lng, e.lat, e.lng) : null;
        return { ...e, title: spec?.title ?? e.type, tone: spec?.tone ?? "green", claimable: spec?.claimable, signal: scoreEvent(e, serverNow), distance };
      })
      .filter((e) => e.signal.remainingMs > 0);
  }, [rawEvents, now, skewMs, user]);

  // Best first: confident, fresh, close openings. "Block full" never outranks an opening.
  const openings = useMemo(
    () =>
      events
        .filter((e) => e.claimable)
        .sort((a, b) => {
          const rank = (e) => e.signal.score / (1 + (e.distance ?? 300) / 250);
          return rank(b) - rank(a);
        }),
    [events]
  );

  const selected = events.find((e) => e.id === selectedId) ?? null;

  useEffect(() => {
    if (!deepLinkRef.current) return;
    const target = events.find((e) => e.id === deepLinkRef.current);
    if (target) {
      deepLinkRef.current = null;
      setSelectedId(target.id);
      setFocus({ lat: target.lat, lng: target.lng, zoom: 18, key: Date.now() });
      window.history.replaceState(null, "", "/");
    }
  }, [events]);

  function select(id) {
    const e = events.find((x) => x.id === id);
    setSelectedId(id);
    if (e) setFocus({ lat: e.lat, lng: e.lng, key: Date.now() });
  }

  async function report(type) {
    setBusy(type);
    try {
      const fix = await freshFix();
      const res = await api.report(type, fix);
      flash(res.corroborated ? "Confirmed — you backed up another driver's report." : REPORT_THANKS[type]);
      refresh();
    } catch (err) {
      const code = err.message;
      flash(REPORT_ERRORS[code] ?? LOCATION_ERROR_MESSAGES[code] ?? "Couldn't send that. Try again.", "error");
    } finally {
      setBusy(null);
    }
  }

  async function startSearch() {
    setBusy("search");
    let fix = null;
    try {
      fix = await freshFix();
    } catch (err) {
      flash(LOCATION_ERROR_MESSAGES[err.message] ?? LOCATION_ERROR_MESSAGES.unsupported, "error");
    }
    try {
      const s = await api.startSearch(fix);
      writeJson(SESSION_KEY, s);
      setSession(s);
      setMode("searching");
      setSelectedId(null);
      if (fix) setFocus({ lat: fix.lat, lng: fix.lng, zoom: 17, key: Date.now() });
    } catch {
      flash("Couldn't start the search. Check your connection.", "error");
    } finally {
      setBusy(null);
    }
  }

  function clearSession() {
    writeJson(SESSION_KEY, null);
    setSession(null);
  }

  async function finishSearch(action) {
    if (!session) return;
    setBusy(action);
    let fix = null;
    try {
      fix = await freshFix();
    } catch {
      // Still record the outcome; without a location we just can't credit a report.
    }
    try {
      const res = await api.endSearch(session.id, action, fix);
      if (action === "parked") {
        setResult({ ...res, sessionId: session.id, baselineDone: false });
        setMode("parked");
      } else {
        setMode("idle");
        flash("Search ended.");
      }
      clearSession();
      refresh();
    } catch (err) {
      if (err.message === "not_found" || err.message === "already_ended") {
        clearSession();
        setMode("idle");
        flash("That search had already timed out.", "error");
      } else {
        flash("Couldn't reach SpotSeer. Try again.", "error");
      }
    } finally {
      setBusy(null);
    }
  }

  async function answerBaseline(minutes) {
    setResult((r) => ({ ...r, baselineDone: true }));
    api.baseline(result.sessionId, minutes).catch(() => {});
  }

  const outsideZone = user && !inPilotZone(user.lat, user.lng);
  const searchMs = session ? now - session.startedAt : 0;
  const nearbyOpenings = openings.filter((e) => e.distance === null || e.distance < 1200).slice(0, 3);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#0b0f14] text-slate-100">
      <div className="absolute inset-0 isolate z-0">
        <LiveMap zone={zone} events={events} user={user} selectedId={selectedId} onSelect={select} focus={focus} />
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#0f141b]/90 py-1.5 pl-1.5 pr-3.5 shadow-lg ring-1 ring-white/10 backdrop-blur">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-lg" />
          <span className="font-semibold tracking-tight">SpotSeer</span>
        </div>
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#0f141b]/90 px-3 py-2 text-xs text-slate-300 shadow-lg ring-1 ring-white/10 backdrop-blur">
          <span className={`h-2 w-2 rounded-full ${openings.length ? "bg-emerald-400" : "bg-slate-500"}`} />
          {openings.length} live · {zone.name}
        </div>
      </header>

      <div className="absolute inset-x-0 bottom-0 z-20">
        <div className="relative mx-auto max-w-lg">
          <button
            onClick={() => (user ? setFocus({ lat: user.lat, lng: user.lng, zoom: 17, key: Date.now() }) : startWatching())}
            aria-label="Center on my location"
            className="absolute -top-14 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#0f141b]/95 text-lg shadow-lg ring-1 ring-white/10 active:bg-[#1a2230]"
          >
            <span className="block h-3 w-3 rounded-full border-2 border-sky-400" />
          </button>

          {toast && (
            <div
              key={toast.id}
              role="status"
              className={`absolute -top-[4.5rem] inset-x-3 rounded-2xl px-4 py-3 text-sm shadow-xl ring-1 backdrop-blur ${
                toast.tone === "error" ? "bg-rose-950/95 text-rose-100 ring-rose-400/30" : "bg-[#0f141b]/95 text-slate-100 ring-white/10"
              }`}
            >
              {toast.text}
            </div>
          )}

          <div className="rounded-t-3xl bg-[#0f141b]/95 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />

            {(locationError || outsideZone) && mode !== "parked" && (
              <p className="mb-3 rounded-xl bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                {locationError ?? "You're outside the pilot zone (dashed box). You can look around, but reports only count inside it."}
              </p>
            )}

            {mode === "idle" && (
              <div className="space-y-3">
                {selected ? (
                  <EventCard
                    event={selected}
                    selected
                    caption="Selected"
                    onSelect={() => setSelectedId(null)}
                    navUrl={selected.claimable ? navigationUrl(selected.lat, selected.lng) : null}
                  />
                ) : openings[0] ? (
                  <EventCard
                    event={openings[0]}
                    caption="Best bet right now"
                    onSelect={() => select(openings[0].id)}
                    navUrl={navigationUrl(openings[0].lat, openings[0].lng)}
                  />
                ) : (
                  <div className="px-1">
                    <p className="font-semibold text-slate-100">No live openings right now</p>
                    <p className="text-sm text-slate-400">
                      Reports disappear after a few minutes, so anything you see here is fresh. Start a search and
                      we&rsquo;ll ping you when one comes in.
                    </p>
                  </div>
                )}

                <PrimaryButton onClick={startSearch} disabled={busy !== null}>
                  {busy === "search" ? "Starting…" : "Find parking"}
                </PrimaryButton>
                <div className="grid grid-cols-2 gap-2">
                  <SecondaryButton accent="amber" onClick={() => report("leaving")} disabled={busy !== null}>
                    {busy === "leaving" ? "Sending…" : "I'm leaving"}
                  </SecondaryButton>
                  <SecondaryButton accent="green" onClick={() => report("open")} disabled={busy !== null}>
                    {busy === "open" ? "Sending…" : "Spot open here"}
                  </SecondaryButton>
                </div>

                <div className="flex items-center justify-between px-1 text-xs text-slate-500">
                  <button onClick={() => setShowHow((v) => !v)}>{showHow ? "Hide" : "How it works"}</button>
                  <Link href="/stats">Pilot metrics</Link>
                </div>
                {showHow && (
                  <div className="space-y-1.5 rounded-xl bg-white/[0.03] p-3 text-xs leading-relaxed text-slate-400">
                    <p><b className="text-slate-200">Reported</b> — one driver on the block said so. <b className="text-emerald-300">Confirmed</b> — a second driver agreed.</p>
                    <p>Every report fades and expires within minutes. Old information is worse than none.</p>
                    <p>Reports only count from your real GPS location inside the pilot zone. Drivers whose reports lead to someone actually parking earn more trust.</p>
                    <p>No predictions yet. We&rsquo;ll only show them once there&rsquo;s enough history to be honest about them.</p>
                  </div>
                )}
              </div>
            )}

            {mode === "searching" && (
              <div className="space-y-3">
                <div className="flex items-end justify-between px-1">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-slate-500">Searching</div>
                    <div className="text-4xl font-semibold tabular-nums leading-none">{clock(searchMs)}</div>
                  </div>
                  <button onClick={() => finishSearch("gave_up")} disabled={busy !== null} className="pb-1 text-sm text-slate-400">
                    Give up
                  </button>
                </div>

                <AlertsControl alerts={alerts} />

                <div className="max-h-[34dvh] space-y-2 overflow-y-auto">
                  {nearbyOpenings.length ? (
                    nearbyOpenings.map((e) => (
                      <EventCard
                        key={e.id}
                        event={e}
                        selected={e.id === selectedId}
                        onSelect={() => select(e.id)}
                        navUrl={navigationUrl(e.lat, e.lng)}
                      />
                    ))
                  ) : (
                    <p className="px-1 text-sm text-slate-400">
                      Nothing live nearby yet. Keep circling — new reports show up here the moment they&rsquo;re made.
                    </p>
                  )}
                </div>

                <PrimaryButton tone="green" onClick={() => finishSearch("parked")} disabled={busy !== null}>
                  {busy === "parked" ? "Saving…" : "I parked"}
                </PrimaryButton>
                <SecondaryButton accent="red" onClick={() => report("full")} disabled={busy !== null}>
                  {busy === "full" ? "Sending…" : "This block is full"}
                </SecondaryButton>
                <p className="text-center text-[11px] text-slate-500">Driving? Let alerts come to you — tap only when stopped.</p>
              </div>
            )}

            {mode === "parked" && result && (
              <div className="space-y-4 text-center">
                <div>
                  <div className="text-sm font-medium text-emerald-400">Parked</div>
                  <div className="text-5xl font-semibold tabular-nums">{clock(result.durationMs)}</div>
                  <p className="mt-1 text-sm text-slate-400">
                    {result.usedReport
                      ? `You got a space another driver reported${result.usedReport.street ? ` on ${result.usedReport.street}` : ""}. That's the network working.`
                      : "Search time saved to the pilot."}
                  </p>
                </div>

                {result.baselineDone ? (
                  <p className="text-sm text-slate-400">Thanks. That&rsquo;s how we find out whether this actually helps.</p>
                ) : (
                  <div>
                    <p className="mb-2 text-sm text-slate-300">Without SpotSeer, finding parking here usually takes you…</p>
                    <div className="grid grid-cols-4 gap-2">
                      {BASELINE_CHOICES.map((c) => (
                        <button
                          key={c.minutes}
                          onClick={() => answerBaseline(c.minutes)}
                          className="h-11 rounded-xl bg-white/[0.06] text-sm ring-1 ring-white/10 active:bg-white/10"
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-slate-500">
                  Heading out later? Tap <b className="text-slate-300">I&rsquo;m leaving</b>. Someone circling gets your space.
                </p>
                <PrimaryButton onClick={() => setMode("idle")}>Done</PrimaryButton>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
