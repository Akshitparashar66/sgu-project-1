import { shelterFillColor, UNAVAILABLE_COLOR } from "@/lib/map/styling";
import type { Shelter } from "@/lib/schemas/types";

/**
 * One meter per shelter (dataviz: "a single ratio against a limit" is a meter,
 * not a chart). The fill carries severity with the map's shelter colors; the
 * track is a quiet step of the surface so state reads across the whole bar.
 */
export function ShelterMeters({ shelters, occupancy }: { shelters: Shelter[]; occupancy: Record<string, number> }) {
  return (
    <ul className="space-y-3">
      {shelters.map((shelter) => {
        const occupied = occupancy[shelter.id] ?? 0;
        const ratio = shelter.totalCapacity > 0 ? Math.min(1, occupied / shelter.totalCapacity) : 0;
        const color = shelter.available ? shelterFillColor(occupied, shelter.totalCapacity) : UNAVAILABLE_COLOR;
        return (
          <li key={shelter.id}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-slate-300">{shelter.id} · {shelter.name}</span>
              <span className="shrink-0 tabular-nums text-slate-400">
                {shelter.available ? `${occupied} / ${shelter.totalCapacity}` : "unavailable"}
              </span>
            </div>
            <div
              role="meter"
              aria-label={`${shelter.name} occupancy`}
              aria-valuemin={0}
              aria-valuemax={shelter.totalCapacity}
              aria-valuenow={occupied}
              className="h-2 overflow-hidden rounded-full bg-slate-800"
            >
              <div className="h-full rounded-full transition-[width] duration-150" style={{ width: `${ratio * 100}%`, backgroundColor: color }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
