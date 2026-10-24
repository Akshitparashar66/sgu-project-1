import type { AlertSeverity } from "@/lib/api/client";

const STYLES: Record<AlertSeverity, string> = {
  extreme: "bg-red-700 text-white",
  severe: "bg-red-600 text-white",
  warning: "bg-amber-400 text-amber-950",
  info: "bg-slate-200 text-slate-700",
};

export function SeverityTag({ severity }: { severity: AlertSeverity }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STYLES[severity]}`}>{severity}</span>;
}

/** Striped, so a rehearsal alert can never be mistaken for a real one. */
export function DemoTag() {
  return (
    <span
      className="rounded border border-violet-400 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-800"
      style={{ backgroundImage: "repeating-linear-gradient(135deg, #ede9fe 0 6px, #ddd6fe 6px 12px)" }}
    >
      Demo
    </span>
  );
}
