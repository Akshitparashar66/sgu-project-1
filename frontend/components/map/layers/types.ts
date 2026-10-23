import type { RoadNode } from "@/lib/schemas/types";

export type MapSelection = { kind: "edge" | "shelter" | "zone"; id: string } | null;

export interface LayerContext {
  nodeById: Map<string, RoadNode>;
  selection: MapSelection;
  onSelect?: (selection: MapSelection) => void;
}

export function isSelected(selection: MapSelection, kind: NonNullable<MapSelection>["kind"], id: string): boolean {
  return selection?.kind === kind && selection.id === id;
}
