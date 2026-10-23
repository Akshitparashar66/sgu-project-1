"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window` at import time, so the map only ever loads in the
// browser — Next's ssr:false must live in a Client Component like this one.
const loading = () => <div className="grid h-full place-items-center text-sm text-slate-500">Loading map…</div>;

export const MapView = dynamic(() => import("./EvacuationMap").then((m) => m.EvacuationMap), { ssr: false, loading });

/** The map plus the moving-agents canvas layer, for the Live Simulation replay. */
export const ReplayMapView = dynamic(() => import("./ReplayMap"), { ssr: false, loading });
