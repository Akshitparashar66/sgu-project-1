import { CircleCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";

import type { Recommendation, Severity } from "@/lib/insights/recommendations";

const SEVERITY: Record<Severity, { icon: typeof Info; label: string; className: string }> = {
  critical: { icon: OctagonAlert, label: "Critical", className: "border-red-500/30 bg-red-500/5 text-red-300" },
  warning: { icon: TriangleAlert, label: "Warning", className: "border-amber-500/30 bg-amber-500/5 text-amber-300" },
  info: { icon: Info, label: "Note", className: "border-cyan-500/30 bg-cyan-500/5 text-cyan-300" },
  ok: { icon: CircleCheck, label: "OK", className: "border-green-500/30 bg-green-500/5 text-green-300" },
};

export function FindingsList({ recommendations }: { recommendations: Recommendation[] }) {
  return (
    <ul className="space-y-2">
      {recommendations.map((rec) => {
        const style = SEVERITY[rec.severity];
        const Icon = style.icon;
        return (
          <li key={rec.id} className={`rounded-md border p-2.5 ${style.className}`}>
            <div className="flex items-start gap-2">
              <Icon size={15} aria-hidden className="mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">
                  <span className="sr-only">{style.label}: </span>
                  {rec.title}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{rec.detail}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
