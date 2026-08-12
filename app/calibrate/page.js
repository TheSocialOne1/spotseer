"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getCurrentLocation, LOCATION_ERROR_MESSAGES } from "@/lib/clientGeo";

const CalibrateMap = dynamic(() => import("../components/CalibrateMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-zinc-400">
      Loading satellite view…
    </div>
  ),
});

export default function CalibratePage() {
  const [spots, setSpots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [errorById, setErrorById] = useState({});

  const fetchSpots = useCallback(async () => {
    const res = await fetch("/api/spots", { cache: "no-store" });
    const data = await res.json();
    setSpots(data.spots);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSpots();
  }, [fetchSpots]);

  async function saveLocation(spotId, lat, lng) {
    setSpots((prev) => prev.map((s) => (s.id === spotId ? { ...s, lat, lng } : s)));
    await fetch(`/api/spots/${spotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    });
    setSavedId(spotId);
    setTimeout(() => setSavedId((current) => (current === spotId ? null : current)), 2000);
  }

  async function useMyLocation(spotId) {
    setBusyId(spotId);
    setErrorById((prev) => ({ ...prev, [spotId]: null }));
    try {
      const { lat, lng } = await getCurrentLocation();
      await saveLocation(spotId, lat, lng);
    } catch (err) {
      const message = LOCATION_ERROR_MESSAGES[err.message] ?? LOCATION_ERROR_MESSAGES.unsupported;
      setErrorById((prev) => ({ ...prev, [spotId]: message }));
    } finally {
      setBusyId(null);
    }
  }

  function handleDragEnd(spotId, lat, lng) {
    saveLocation(spotId, lat, lng);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-zinc-50 pb-12">
      <header className="border-b border-zinc-200 bg-white px-4 py-5">
        <Link href="/" className="text-xs font-medium text-blue-600">
          ← Back to app
        </Link>
        <h1 className="mt-1 text-xl font-bold text-zinc-900">Calibrate Spot Locations</h1>
        <p className="mt-1 text-sm text-zinc-500">
          For the most accurate pins, stand at each spot and tap{" "}
          <span className="font-medium text-zinc-700">Use My Location</span>. You can also
          drag any pin on the satellite view to fine-tune it — changes save instantly.
        </p>
      </header>

      <main className="mx-auto max-w-md px-4 py-5">
        <div className="mb-5 h-72 overflow-hidden rounded-2xl border border-zinc-200 bg-[#e5e3df] shadow-sm">
          {!loading && spots.length > 0 && (
            <CalibrateMap spots={spots} onDragEnd={handleDragEnd} />
          )}
        </div>

        <div className="flex flex-col gap-3">
          {spots.map((spot, i) => (
            <div
              key={spot.id}
              className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold text-zinc-900">{spot.name}</h3>
                    <p className="text-sm text-zinc-500">{spot.cross}</p>
                  </div>
                </div>
                {savedId === spot.id && (
                  <span className="text-xs font-medium text-emerald-600">✓ Saved</span>
                )}
              </div>

              <p className="mt-2 font-mono text-xs text-zinc-400">
                {spot.lat.toFixed(6)}, {spot.lng.toFixed(6)}
              </p>

              <button
                disabled={busyId === spot.id}
                onClick={() => useMyLocation(spot.id)}
                className="mt-3 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition active:scale-95 active:bg-zinc-100 disabled:opacity-50"
              >
                {busyId === spot.id ? "📍 Getting your location…" : "📍 Use My Location"}
              </button>

              {errorById[spot.id] && (
                <p className="mt-2 rounded-lg bg-rose-100 px-2.5 py-1.5 text-xs font-medium text-rose-700">
                  {errorById[spot.id]}
                </p>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
