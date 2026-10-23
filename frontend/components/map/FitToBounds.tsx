"use client";

import type { LatLngBoundsExpression, FitBoundsOptions } from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * Leaflet only tracks *window* resizes. When the results drawer opens or
 * collapses, the map container changes height on its own, leaving grey
 * gaps and an off-centre network. Watch the container and refit.
 */
export function FitToBounds({ bounds, options }: { bounds: LatLngBoundsExpression; options: FitBoundsOptions }) {
  const map = useMap();
  const key = JSON.stringify([bounds, options]);

  useEffect(() => {
    const refit = () => {
      map.invalidateSize();
      map.fitBounds(bounds, options);
    };
    // Fires once on observe (covers a padding change), then on every container resize.
    const observer = new ResizeObserver(refit);
    observer.observe(map.getContainer());
    return () => observer.disconnect();
    // `key` stands in for `bounds`/`options`, which are new objects every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);

  return null;
}
