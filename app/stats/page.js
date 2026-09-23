import Link from "next/link";
import { getStats } from "@/lib/network";
import { EVENT_TYPES } from "@/lib/signal";

export const dynamic = "force-dynamic";
export const metadata = { title: "SpotSeer · Pilot metrics" };

const MIN_SAMPLE = 20;

function minutes(ms) {
  if (ms === null || ms === undefined) return "—";
  const m = ms / 60000;
  return m < 10 ? `${m.toFixed(1)} min` : `${Math.round(m)} min`;
}

function pct(n, d) {
  return d ? `${Math.round((n / d) * 100)}%` : "—";
}

function Metric({ label, value, note }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-50">{value}</div>
      {note && <div className="mt-1 text-xs text-slate-500">{note}</div>}
    </div>
  );
}

function Section({ title, question, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
      <p className="mb-3 text-xs text-slate-500">{question}</p>
      {children}
    </section>
  );
}

export default async function StatsPage() {
  const { search, reports, devices, departuresByHour } = await getStats();

  const claimable = reports.filter((r) => EVENT_TYPES[r.type]?.claimable);
  const primaryReports = claimable.reduce((s, r) => s + r.total, 0);
  const claimedReports = claimable.reduce((s, r) => s + r.claimed, 0);
  const corroborated = reports.reduce((s, r) => s + r.corroborated, 0);
  const allReports = reports.reduce((s, r) => s + r.total, 0);
  const peak = Math.max(1, ...departuresByHour);
  const lowSample = search.parked < MIN_SAMPLE;

  const saved =
    search.median_baseline_min && search.median_ms
      ? 1 - search.median_ms / 60000 / search.median_baseline_min
      : null;

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-5 pb-16 pt-8 text-slate-200">
      <Link href="/" className="text-sm text-emerald-400">← Back to map</Link>
      <h1 className="mt-3 text-2xl font-semibold text-slate-50">Pilot metrics</h1>
      <p className="mt-1 text-sm text-slate-400">
        One question matters: does SpotSeer cut the time it takes to find street parking?
      </p>

      {lowSample && (
        <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">
          Only {search.parked} completed search{search.parked === 1 ? "" : "es"} so far. Treat everything below as
          anecdote until there are at least {MIN_SAMPLE}.
        </p>
      )}

      <Section title="Search time" question="Primary metric. Timed from “Find parking” to “I parked”.">
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Median search" value={minutes(search.median_ms)} note={`${search.parked} parked`} />
          <Metric
            label="Usual time (self-reported)"
            value={search.median_baseline_min ? `${search.median_baseline_min} min` : "—"}
            note={`${search.baseline_answers} answers`}
          />
          <Metric
            label="With a live report"
            value={minutes(search.median_with_report_ms)}
            note={`${search.parked_with_report} searches`}
          />
          <Metric
            label="Without one"
            value={minutes(search.median_without_report_ms)}
            note={`${search.parked - search.parked_with_report} searches`}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {saved === null
            ? "Estimated time saved appears once people answer the “usually takes” question."
            : `Median search is ${Math.round(Math.abs(saved) * 100)}% ${saved >= 0 ? "shorter" : "longer"} than what drivers say it usually takes (target: 25–50% shorter). Self-reported baselines run high — confirm with the with/without split above.`}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {search.started} searches started · {search.gave_up} gave up · {search.unfinished} never finished (forgot to tap
          “I parked”) · {search.alerts_sent ?? 0} alerts sent
        </p>
      </Section>

      <Section title="Report quality" question="Are reports real? Last 7 days.">
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Openings reported" value={primaryReports} />
          <Metric label="Parked in by someone" value={pct(claimedReports, primaryReports)} note={`${claimedReports} claimed`} />
          <Metric label="Confirmed by 2nd driver" value={pct(corroborated, allReports)} />
        </div>
        <ul className="mt-3 space-y-1 text-xs text-slate-400">
          {reports.map((r) => (
            <li key={r.type}>
              {EVENT_TYPES[r.type]?.title ?? r.type}: {r.total} reports
              {EVENT_TYPES[r.type]?.claimable && ` · ${r.claimed} claimed · median ${minutes(r.median_claim_ms)} to claim`}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Retention" question="Do people come back the next time they need parking?">
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Active (7d)" value={devices.active_7d} />
          <Metric label="Came back another day" value={pct(devices.returning, devices.total)} note={`${devices.returning} of ${devices.total}`} />
          <Metric label="Devices ever" value={devices.total} />
        </div>
      </Section>

      <Section title="When spaces open up" question="Departures by hour (Pacific). The seed of the prediction layer.">
        <div className="flex h-28 items-end gap-[3px]">
          {departuresByHour.map((n, hour) => (
            <div key={hour} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-sm bg-emerald-400/70" style={{ height: `${(n / peak) * 88}px` }} title={`${hour}:00 — ${n}`} />
              {hour % 6 === 0 && <span className="text-[10px] text-slate-500">{hour}</span>}
            </div>
          ))}
        </div>
      </Section>

      <p className="mt-10 text-xs text-slate-600">
        No accounts, no names. Devices are random IDs; IP addresses are only stored as a daily-salted hash for abuse
        limits.
      </p>
    </main>
  );
}
