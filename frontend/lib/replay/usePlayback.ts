"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const PLAYBACK_SPEEDS = [1, 2, 4, 8] as const; // simulation ticks per real second

/**
 * Drives a fractional tick from 0 to `lastTick` with requestAnimationFrame.
 * Remount (e.g. key on the run id) to start a fresh replay.
 */
export function usePlayback(lastTick: number) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof PLAYBACK_SPEEDS)[number]>(4);
  const tRef = useRef(0);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = performance.now();
    const step = (now: number) => {
      const next = Math.min(lastTick, tRef.current + ((now - previous) / 1000) * speed);
      previous = now;
      tRef.current = next;
      setT(next);
      if (next >= lastTick) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, lastTick]);

  const seek = useCallback((tick: number) => {
    tRef.current = tick;
    setT(tick);
  }, []);

  const toggle = useCallback(() => {
    if (!playing && tRef.current >= lastTick) seek(0); // replay from the start
    setPlaying((p) => !p);
  }, [playing, lastTick, seek]);

  return { t, playing, speed, setSpeed, seek, toggle };
}
