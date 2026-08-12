"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { STATUS_STYLES, STATUS_LEGEND } from "@/lib/statusColors";
import { getCurrentLocation, LOCATION_ERROR_MESSAGES } from "@/lib/clientGeo";
import NotifyButton from "./components/NotifyButton";

const ParkingMap = dynamic(() => import("./components/ParkingMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-zinc-400">
      Loading map…
    </div>
  ),
});

const ACTIONS = [
  { type: "leaving", label: "I'm Leaving", icon: "🚗" },
  { type: "opened", label: "Space Opened", icon: "✅" },
  { type: "found", label: "I Found Parking", icon: "🅿️" },
  { type: "full", label: "Area Full", icon: "🚫" },
];

function timeAgo(ts) {
  if (!ts) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function directionsUrl(spot) {
  const query = encodeURIComponent(`${spot.lat},${spot.lng}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function SkeletonCard({ featured }) {
  return (
    <div className={`animate-pulse rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm ${featured ? "shadow-md" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className={`rounded bg-zinc-200 ${featured ? "h-5 w-40" : "h-4 w-32"}`} />
          <div className="mt-2 h-3 w-48 rounded bg-zinc-100" />
        </div>
        <div className="h-4 w-24 rounded bg-zinc-100" />
      </div>
      <div className="mt-3 h-3 w-20 rounded bg-zinc-100" />
      <div className={`mt-3 grid grid-cols-2 gap-2 ${featured ? "gap-2.5" : ""}`}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`rounded-xl bg-zinc-100 ${featured ? "h-11" : "h-9"}`} />
        ))}
      </div>
    </div>
  );
}

function SpotCard({ spot, onReport, pending, selected, onSelect, featured, error }) {
  const style = STATUS_STYLES[spot.status.level] ?? STATUS_STYLES.gray;

  return (
    <div
      onClick={() => onSelect(spot.id)}
      className={`rounded-2xl border p-4 shadow-sm transition-colors duration-300 ${style.card} ${
        selected ? `ring-2 ${style.ring}` : ""
      } ${featured ? "shadow-md" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className={`font-semibold text-zinc-900 ${featured ? "text-lg" : "text-base"}`}>
            {spot.name}
          </h3>
          <p className="text-sm text-zinc-500">{spot.cross}</p>
        </div>
        <div className="flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-zinc-700">
          <span
            className={`h-2.5 w-2.5 rounded-full ${style.dot} ${
              spot.status.level === "amber" ? "animate-pulse" : ""
            }`}
          />
          {spot.status.label}
        </div>
      </div>

      <p className="mt-1 text-xs text-zinc-400">
        {spot.status.lastReport
          ? `Last report: ${timeAgo(spot.status.lastReport.createdAt)}`
          : "No reports yet"}
      </p>

      <div className={`mt-3 grid grid-cols-2 gap-2 ${featured ? "gap-2.5" : ""}`}>
        {ACTIONS.map((action) => (
          <button
            key={action.type}
            disabled={pending}
            onClick={(e) => {
              e.stopPropagation();
              onReport(spot.id, action.type);
            }}
            className={`flex items-center justify-center gap-1.5 rounded-xl border border-zinc-300 bg-white font-medium text-zinc-700 shadow-sm transition active:scale-95 active:bg-zinc-100 disabled:opacity-50 ${
              featured ? "px-2 py-3 text-sm" : "px-2 py-2 text-xs"
            }`}
          >
            <span>{pending ? "📍" : action.icon}</span>
            {action.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-rose-100 px-2.5 py-1.5 text-xs font-medium text-rose-700">
          {error}
        </p>
      )}

      <a
        href={directionsUrl(spot)}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="mt-2 block text-center text-xs font-medium text-blue-600"
      >
        Get Directions →
      </a>
    </div>
  );
}

export default function Home() {
  const [spots, setSpots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [reportError, setReportError] = useState(null); // { spotId, message }

  const fetchSpots = useCallback(async () => {
    const res = await fetch("/api/spots", { cache: "no-store" });
    const data = await res.json();
    setSpots(data.spots);
    setLoading(false);
    setSelectedId((current) => current ?? data.spots.find((s) => s.featured)?.id ?? data.spots[0]?.id);
  }, []);

  useEffect(() => {
    fetchSpots();
    const interval = setInterval(fetchSpots, 8000);
    return () => clearInterval(interval);
  }, [fetchSpots]);

  async function handleReport(spotId, type) {
    setPendingId(spotId);
    setSelectedId(spotId);
    setReportError(null);

    let coords;
    try {
      coords = await getCurrentLocation();
    } catch (err) {
      const message = LOCATION_ERROR_MESSAGES[err.message] ?? LOCATION_ERROR_MESSAGES.unsupported;
      setReportError({ spotId, message });
      setPendingId(null);
      return;
    }

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotId, type, lat: coords.lat, lng: coords.lng }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "too_far") {
          const miles = (data.distanceMeters / 1609).toFixed(1);
          setReportError({
            spotId,
            message: `You're about ${miles} mi from this spot — too far to report it from here.`,
          });
        } else {
          setReportError({ spotId, message: "Couldn't submit that report. Try again." });
        }
        return;
      }

      await fetchSpots();
    } finally {
      setPendingId(null);
    }
  }

  const featuredSpot = useMemo(() => spots.find((s) => s.featured), [spots]);
  const otherSpots = useMemo(() => spots.filter((s) => !s.featured), [spots]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-zinc-50 pb-12">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-4 py-5 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500 text-xl shadow-sm">
            🅿️
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-zinc-900">SpotSeer</h1>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Pilot
              </span>
            </div>
            <p className="text-sm text-zinc-500">Live, location-verified reports · Bonito Ave</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
          {STATUS_LEGEND.map((item) => (
            <div key={item.level} className="flex items-center gap-1.5 text-xs text-zinc-500">
              <span className={`h-2 w-2 rounded-full ${STATUS_STYLES[item.level].dot}`} />
              {item.label}
            </div>
          ))}
        </div>

        <NotifyButton />
      </header>

      <main className="mx-auto max-w-md px-4 py-5">
        <div className="mb-5 h-64 overflow-hidden rounded-2xl border border-zinc-200 bg-[#e5e3df] shadow-sm">
          {!loading && spots.length > 0 && (
            <ParkingMap spots={spots} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>

        {loading ? (
          <div className="flex flex-col gap-3">
            <SkeletonCard featured />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <>
            {featuredSpot && (
              <section className="mb-6">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                  Your Spot
                </h2>
                <SpotCard
                  spot={featuredSpot}
                  onReport={handleReport}
                  pending={pendingId === featuredSpot.id}
                  selected={selectedId === featuredSpot.id}
                  onSelect={setSelectedId}
                  error={reportError?.spotId === featuredSpot.id ? reportError.message : null}
                  featured
                />
              </section>
            )}

            {otherSpots.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                  Nearby on Bonito Ave
                </h2>
                <div className="flex flex-col gap-3">
                  {otherSpots.map((spot) => (
                    <SpotCard
                      key={spot.id}
                      spot={spot}
                      onReport={handleReport}
                      pending={pendingId === spot.id}
                      selected={selectedId === spot.id}
                      onSelect={setSelectedId}
                      error={reportError?.spotId === spot.id ? reportError.message : null}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <footer className="mt-8 flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-white/60 px-4 py-3 text-center text-xs leading-relaxed text-zinc-400">
          <p>
            🔒 Reports require your phone&rsquo;s real GPS location within ~0.3 mi of the spot.
            Reports from farther away are rejected automatically.
          </p>
          <Link href="/calibrate" className="font-medium text-blue-600">
            Fine-tune spot locations →
          </Link>
        </footer>
      </main>
    </div>
  );
}
