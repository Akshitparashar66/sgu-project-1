"use client";

import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";

import { agentMarkerColor } from "@/lib/map/styling";
import { framesAt, type Replay } from "@/lib/replay/replay";

/**
 * One canvas dot per evacuee, moved imperatively each animation frame.
 * Rendering ~750 React <CircleMarker>s at 60 fps would re-reconcile the
 * whole layer every frame; a single canvas renderer and setLatLng don't.
 * Arrived agents are hidden — they are counted in the shelter instead.
 */
export function MovingAgentsLayer({ replay, t }: { replay: Replay; t: number }) {
  const map = useMap();
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const markers = useRef(new Map<string, L.CircleMarker>());

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const created = new Map<string, L.CircleMarker>();
    for (const track of replay.tracks) {
      created.set(track.id, L.circleMarker([0, 0], {
        renderer, radius: 3, stroke: false, fillOpacity: 0, interactive: false,
      }).addTo(group));
    }
    markers.current = created;
    return () => {
      group.remove();
    };
  }, [map, renderer, replay]);

  useEffect(() => {
    for (const frame of framesAt(replay, t)) {
      const marker = markers.current.get(frame.id);
      if (!marker) continue;
      if (frame.status === "arrived") {
        marker.setStyle({ fillOpacity: 0 });
        continue;
      }
      marker.setLatLng([frame.lat, frame.lon]);
      marker.setStyle({ fillColor: agentMarkerColor(frame.status), fillOpacity: 0.9 });
    }
  }, [replay, t]);

  return null;
}
