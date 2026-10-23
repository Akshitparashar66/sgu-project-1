"use client";

import type { Replay } from "@/lib/replay/replay";
import { EvacuationMap, type EvacuationMapProps } from "./EvacuationMap";
import { MovingAgentsLayer } from "./layers/MovingAgentsLayer";

export default function ReplayMap({ replay, t, ...mapProps }: EvacuationMapProps & { replay: Replay; t: number }) {
  return (
    <EvacuationMap {...mapProps}>
      <MovingAgentsLayer replay={replay} t={t} />
    </EvacuationMap>
  );
}
