import { agentMarkerColor, roadColor, shelterFillColor } from "@/lib/map/styling";

const LEGEND_ITEMS: { label: string; swatch: string; shape: "line" | "line-dashed" | "circle" }[] = [
  { label: "Open road", swatch: roadColor("open", 0), shape: "line" },
  { label: "Congested road", swatch: roadColor("open", 1.2), shape: "line" },
  { label: "Closed road", swatch: roadColor("closed", 0), shape: "line-dashed" },
  { label: "Shelter — available", swatch: shelterFillColor(0, 100), shape: "circle" },
  { label: "Shelter — near capacity", swatch: shelterFillColor(85, 100), shape: "circle" },
  { label: "Shelter — full", swatch: shelterFillColor(100, 100), shape: "circle" },
  { label: "Agent — moving", swatch: agentMarkerColor("moving"), shape: "circle" },
  { label: "Agent — arrived", swatch: agentMarkerColor("arrived"), shape: "circle" },
  { label: "Agent — unserved", swatch: agentMarkerColor("unserved"), shape: "circle" },
];

export function Legend() {
  return (
    <div
      role="list"
      aria-label="Map legend"
      className="absolute bottom-4 left-4 z-[1000] rounded-lg border border-slate-700 bg-slate-900/90 p-3 text-xs text-slate-200 backdrop-blur"
    >
      {LEGEND_ITEMS.map((item) => (
        <div role="listitem" key={item.label} className="flex items-center gap-2 py-0.5">
          <span
            aria-hidden
            className={item.shape === "circle" ? "h-3 w-3 rounded-full" : "h-0.5 w-4"}
            style={{
              backgroundColor: item.shape === "line-dashed" ? "transparent" : item.swatch,
              borderBottom: item.shape === "line-dashed" ? `2px dashed ${item.swatch}` : undefined,
            }}
          />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
