import { Radio } from "lucide-react";

import type { AegisState } from "@/lib/state/aegisReducer";

/** Which live alerts the current what-if changes came from, so a run can be traced back to its data. */
export function AppliedAlerts({ state }: { state: AegisState }) {
  if (state.appliedAlerts.length === 0) return null;
  return (
    <ul aria-label="Live conditions applied" className="mt-2 space-y-1">
      {state.appliedAlerts.map((a) => (
        <li key={a.id} className="flex gap-1.5 text-xs text-slate-600">
          <Radio size={12} className="mt-0.5 shrink-0 text-red-600" aria-hidden />
          <span>
            Live conditions applied from {a.isDemo ? "demo " : ""}alert <span className="font-medium text-slate-800">{a.title}</span>{" "}
            at {new Date(a.appliedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </li>
      ))}
    </ul>
  );
}
