"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Connector "pulse": a charge that glides from source to destination along a
 * connection, with a ripple landing on the destination as it arrives. Two
 * triggers — ambient (an edge of the selected/hovered node, on a calm 5s loop)
 * and one-shot (a freshly made connection, or a just-created artifact's
 * source -> doc links, fired the moment it appears). Shared by the connector
 * lines and the provenance lines so the motion reads the same everywhere.
 */

export const PULSE_CYCLE_MS = 5000; // one pulse per connection every 5s
const TRAVEL = 0.3; // pill is in motion for the first 30% of the cycle (~1.5s)
const FADE = 0.16; // fade-in / fade-out as a fraction of the travel
const RIPPLE = 0.05; // ripple lasts ~5% of the cycle, right after arrival
const RECENT_MS = PULSE_CYCLE_MS + 400; // a one-shot pulses for ~one cycle

// --- one-shot origins (freshly created edges / docs) --------------------------
const origins = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

function bump(): void {
  version++;
  for (const cb of listeners) cb();
}

/** Mark `id` to pulse once, starting now — fires even when nothing is selected. */
export function markPulse(id: string): void {
  const now = Date.now();
  for (const [k, t] of origins) if (now - t > RECENT_MS) origins.delete(k); // prune
  origins.set(id, now);
  bump();
}

/** Creation time of a recent one-shot, or null if it's absent / expired. */
export function recentOrigin(id: string, now: number): number | null {
  const t = origins.get(id);
  if (t == null) return null;
  return now - t <= RECENT_MS ? t : null;
}

/** Whether any one-shot pulse is still within its window (gates the clock when
 *  a connection / artifact was just created with nothing selected). */
export function hasActiveOneShots(): boolean {
  const now = Date.now();
  for (const t of origins.values()) if (now - t <= RECENT_MS) return true;
  return false;
}

/** Re-render trigger that bumps whenever a one-shot is marked. */
export function useRecentVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => version,
  );
}

// --- animation clock ----------------------------------------------------------
/** requestAnimationFrame clock that ticks ONLY while `active`; returns now (ms).
 *  Idle when there's nothing to animate, so it costs nothing at rest. */
export function usePulseClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return now;
}

// --- pulse geometry -----------------------------------------------------------
export type PulseEdge = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  origin: number;
};
export type PulseFrame = {
  pill: { x: number; y: number; angle: number; opacity: number } | null;
  ripple: { r: number; opacity: number } | null;
};

// Ease-in-out: gentle start and a gentle settle into the node (no fast initial
// burst), so the glide reads as a calm drift rather than a dart.
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Pill position + ripple state for one edge at time `now`. Page-space points;
 *  the caller keeps the pill/ripple a constant screen size (counter-scale 1/z). */
export function pulseFrame(e: PulseEdge, now: number): PulseFrame {
  const p =
    ((((now - e.origin) % PULSE_CYCLE_MS) + PULSE_CYCLE_MS) % PULSE_CYCLE_MS) /
    PULSE_CYCLE_MS;

  let pill: PulseFrame["pill"] = null;
  if (p <= TRAVEL) {
    const tt = p / TRAVEL; // 0..1 across the travel window
    const t = easeInOutCubic(tt); // eased position so it settles into the node
    const opacity =
      tt < FADE ? tt / FADE : tt > 1 - FADE ? (1 - tt) / FADE : 1;
    pill = {
      x: e.x1 + (e.x2 - e.x1) * t,
      y: e.y1 + (e.y2 - e.y1) * t,
      angle: (Math.atan2(e.y2 - e.y1, e.x2 - e.x1) * 180) / Math.PI,
      opacity,
    };
  }

  let ripple: PulseFrame["ripple"] = null;
  const rp = p - TRAVEL; // time since arrival
  if (rp >= 0 && rp <= RIPPLE) {
    const rt = rp / RIPPLE;
    ripple = { r: 3 + rt * 22, opacity: (1 - rt) * 0.55 };
  }

  return { pill, ripple };
}
