import type { Ref } from "react";

import { agentMarkerColor, HAZARD_COLOR, roadColor, shelterFillColor, ZONE_COLOR } from "@/lib/map/styling";

type Shape = "line" | "line-dashed" | "circle" | "ring" | "area";

const LEGEND_ITEMS: { label: string; swatch: string; shape: Shape }[] = [
  { label: "Open road", swatch: roadColor("open", 0), shape: "line" },
  { label: "Congested road", swatch: roadColor("open", 1.2), shape: "line" },
  { label: "Closed road", swatch: roadColor("closed", 0), shape: "line-dashed" },
  { label: "Hazard zone", swatch: HAZARD_COLOR, shape: "area" },
  { label: "Population zone", swatch: ZONE_COLOR, shape: "ring" },
  { label: "Shelter — available", swatch: shelterFillColor(0, 100), shape: "circle" },
  { label: "Shelter — near capacity", swatch: shelterFillColor(85, 100), shape: "circle" },
  { label: "Shelter — full", swatch: shelterFillColor(100, 100), shape: "circle" },
  { label: "Agent — waiting to leave", swatch: agentMarkerColor("waiting"), shape: "circle" },
  { label: "Agent — moving", swatch: agentMarkerColor("moving"), shape: "circle" },
  { label: "Agent — arrived", swatch: agentMarkerColor("arrived"), shape: "circle" },
  { label: "Agent — unserved", swatch: agentMarkerColor("unserved"), shape: "circle" },
];

function swatchStyle(shape: Shape, color: string) {
  switch (shape) {
    case "line-dashed": return { borderBottom: `2px dashed ${color}` };
    case "ring": return { border: `2px solid ${color}` };
    case "area": return { backgroundColor: `${color}33`, border: `1px solid ${color}` };
    default: return { backgroundColor: color };
  }
}

const SHAPE_CLASS: Record<Shape, string> = {
  "line": "h-0.5 w-4",
  "line-dashed": "h-0.5 w-4",
  "circle": "h-3 w-3 rounded-full",
  "ring": "h-3 w-3 rounded-full",
  "area": "h-3 w-4 rounded-sm",
};

export function Legend({ ref }: { ref?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      role="list"
      aria-label="Map legend"
      className="absolute bottom-6 left-4 z-[1000] flex max-w-[min(46rem,calc(100%-2rem))] flex-wrap gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-800"
    >
      {LEGEND_ITEMS.map((item) => (
        <div role="listitem" key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className={`shrink-0 ${SHAPE_CLASS[item.shape]}`} style={swatchStyle(item.shape, item.swatch)} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
