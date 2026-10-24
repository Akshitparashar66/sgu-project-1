"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

import { type AlertsOverview, fetchAlerts } from "@/lib/api/client";

export const POLL_MS = 15_000;

export interface AlertsFeed {
  overview: AlertsOverview | null;
  /** When the backend stopped answering, so old alerts are never shown as current. */
  unreachableSince: Date | null;
  refresh: () => Promise<void>;
  /** Use a response the backend already returned (demo start/stop, settings). */
  setOverview: (overview: AlertsOverview) => void;
}

const AlertsContext = createContext<AlertsFeed>({
  overview: null, unreachableSince: null, refresh: async () => {}, setOverview: () => {},
});

/** Polls /api/alerts every 15 s for the whole app. */
export function AlertsProvider({ children }: { children: ReactNode }) {
  const [overview, setOverview] = useState<AlertsOverview | null>(null);
  const [unreachableSince, setUnreachableSince] = useState<Date | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(() => fetchAlerts().then(
    (next) => {
      if (!mounted.current) return;
      setOverview(next);
      setUnreachableSince(null);
    },
    () => {
      if (mounted.current) setUnreachableSince((since) => since ?? new Date());
    },
  ), []);

  useEffect(() => {
    mounted.current = true;
    fetchAlerts().then(
      (next) => { if (mounted.current) setOverview(next); },
      () => { if (mounted.current) setUnreachableSince(new Date()); },
    );
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  return (
    <AlertsContext.Provider value={{ overview, unreachableSince, refresh, setOverview }}>
      {children}
    </AlertsContext.Provider>
  );
}

export const useAlerts = () => useContext(AlertsContext);
