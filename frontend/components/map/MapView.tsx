"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window` at import time, so the map only ever loads in the
// browser — Next's ssr:false must live in a Client Component like this one.
export const MapView = dynamic(() => import("./EvacuationMap").then((m) => m.EvacuationMap), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-slate-500">Loading map…</div>,
});
