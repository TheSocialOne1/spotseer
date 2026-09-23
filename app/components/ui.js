"use client";

import { formatAge } from "@/lib/signal";
import { formatDistance } from "@/lib/geo";
import { TONE_HEX } from "./LiveMap";

const LEVEL_BARS = { high: 3, medium: 2, low: 1 };

export function PrimaryButton({ children, onClick, disabled, tone = "white" }) {
  const tones = {
    white: "bg-slate-50 text-slate-950 active:bg-slate-200",
    green: "bg-emerald-400 text-emerald-950 active:bg-emerald-300",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-14 w-full rounded-2xl text-lg font-semibold transition active:scale-[0.98] disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled, accent }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white/[0.06] text-[15px] font-medium text-slate-100 ring-1 ring-white/10 transition active:scale-[0.98] active:bg-white/10 disabled:opacity-50"
    >
      {accent && <span className="h-2 w-2 rounded-full" style={{ background: TONE_HEX[accent] }} />}
      {children}
    </button>
  );
}

function ConfidenceMeter({ level }) {
  const bars = LEVEL_BARS[level];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400" aria-label={`${level} confidence`}>
      <span className="inline-flex items-end gap-[2px]">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`w-[3px] rounded-sm ${n <= bars ? "bg-slate-200" : "bg-white/15"}`}
            style={{ height: 4 + n * 3 }}
          />
        ))}
      </span>
      {level === "high" ? "High" : level === "medium" ? "Medium" : "Fading"}
    </span>
  );
}

// One report, readable in a glance: what it is, how sure we are, where, how fresh.
export function EventCard({ event, navUrl, selected, onSelect, caption }) {
  const color = TONE_HEX[event.tone];
  const place = event.street ?? "Nearby";
  const parts = [place, event.distance !== null ? formatDistance(event.distance) : null, formatAge(event.signal.ageMs)];

  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-3 rounded-2xl p-3 ring-1 transition ${
        selected ? "bg-white/[0.08] ring-white/25" : "bg-white/[0.04] ring-white/10"
      }`}
    >
      <span className="relative flex h-3 w-3 shrink-0">
        {event.signal.level === "high" && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />
        )}
        <span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: color }} />
      </span>

      <div className="min-w-0 flex-1">
        {caption && <div className="text-[11px] uppercase tracking-wider text-slate-500">{caption}</div>}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-50">{event.title}</span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              event.signal.confirmed ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-slate-300"
            }`}
          >
            {event.signal.confirmed ? "Confirmed" : "Reported"}
          </span>
        </div>
        <div className="truncate text-sm text-slate-400">{parts.filter(Boolean).join(" · ")}</div>
        <ConfidenceMeter level={event.signal.level} />
      </div>

      {navUrl && (
        <a
          href={navUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-950 active:bg-slate-200"
        >
          Go
        </a>
      )}
    </div>
  );
}

export function AlertsControl({ alerts }) {
  const { status, error, enable, disable } = alerts;
  if (status === "checking" || status === "unsupported") return null;

  if (status === "needs-install") {
    return (
      <p className="rounded-xl bg-sky-400/10 px-3 py-2 text-xs leading-relaxed text-sky-200">
        Want a ping when a space opens nearby? On iPhone, tap Share → <b>Add to Home Screen</b>, then open SpotSeer from
        there.
      </p>
    );
  }
  if (status === "denied") {
    return <p className="text-xs text-slate-500">Alerts are blocked in your settings — you&rsquo;ll only see openings on the map.</p>;
  }
  if (status === "on") {
    return (
      <button onClick={disable} className="text-xs text-emerald-300">
        ● Alerts on while you search · turn off
      </button>
    );
  }
  return (
    <div>
      <button
        onClick={enable}
        disabled={status === "working"}
        className="w-full rounded-xl bg-sky-400/15 px-3 py-2 text-sm font-medium text-sky-200 active:bg-sky-400/25 disabled:opacity-50"
      >
        {status === "working" ? "Setting up…" : "Ping me when a space opens nearby"}
      </button>
      {status === "error" && <p className="mt-1 text-xs text-rose-300">Couldn&rsquo;t turn on alerts: {error}</p>}
    </div>
  );
}
