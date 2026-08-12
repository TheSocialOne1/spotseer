export const STATUS_STYLES = {
  amber: {
    hex: "#f59e0b",
    dot: "bg-amber-500",
    card: "border-amber-300 bg-amber-50",
    ring: "ring-amber-400",
  },
  green: {
    hex: "#10b981",
    dot: "bg-emerald-500",
    card: "border-emerald-300 bg-emerald-50",
    ring: "ring-emerald-400",
  },
  taken: {
    hex: "#64748b",
    dot: "bg-slate-500",
    card: "border-slate-300 bg-slate-50",
    ring: "ring-slate-400",
  },
  red: {
    hex: "#f43f5e",
    dot: "bg-rose-500",
    card: "border-rose-300 bg-rose-50",
    ring: "ring-rose-400",
  },
  gray: {
    hex: "#a1a1aa",
    dot: "bg-zinc-400",
    card: "border-zinc-200 bg-white",
    ring: "ring-zinc-300",
  },
};

export const STATUS_LEGEND = [
  { level: "amber", label: "Opening soon" },
  { level: "green", label: "Available now" },
  { level: "taken", label: "Just taken" },
  { level: "red", label: "Area full" },
  { level: "gray", label: "No reports" },
];
