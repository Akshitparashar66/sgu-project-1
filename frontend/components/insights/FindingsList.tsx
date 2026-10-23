import { CircleCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";

import type { Recommendation, Severity } from "@/lib/insights/recommendations";

const SEVERITY: Record<Severity, { icon: typeof Info; label: string; className: string }> = {
  critical: { icon: OctagonAlert, label: "Critical", className: "border-red-200 bg-red-50/60 text-red-700" },
  warning: { icon: TriangleAlert, label: "Warning", className: "border-amber-200 bg-amber-50/60 text-amber-800" },
  info: { icon: Info, label: "Note", className: "border-blue-200 bg-blue-50/60 text-blue-700" },
  ok: { icon: CircleCheck, label: "OK", className: "border-green-200 bg-green-50/60 text-green-800" },
};

export function FindingsList({ recommendations }: { recommendations: Recommendation[] }) {
  return (
    <ul className="space-y-2">
      {recommendations.map((rec) => {
        const style = SEVERITY[rec.severity];
        const Icon = style.icon;
        return (
          <li key={rec.id} className={`relative rounded-md border p-2.5 ${style.className}`}>
            <div className="flex items-start gap-2">
              <Icon size={15} aria-hidden className="mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">
                  <span className="sr-only">{style.label}: </span>
                  {rec.title}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{rec.detail}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
