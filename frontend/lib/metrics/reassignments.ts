import type { PlanChange } from "@/lib/api/client";

export interface ReassignmentGroup {
  originZone: string;
  from: string;
  to: string;
  count: number;
}

/** Collapse per-agent plan changes into "N people from zone Z move from S_a to S_b". */
export function summarizeReassignments(changes: PlanChange[]): ReassignmentGroup[] {
  const groups = new Map<string, ReassignmentGroup>();
  for (const c of changes) {
    const from = c.oldShelter ?? "unassigned";
    const to = c.newShelter ?? "unassigned";
    const key = `${c.originZone}|${from}|${to}`;
    const group = groups.get(key) ?? { originZone: c.originZone, from, to, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
