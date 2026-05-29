"use client";

import { SelectionRings } from "./SelectionRings";

/**
 * Rendered via tldraw's `OnTheCanvas` slot — sits ABOVE shapes. Selection
 * rings live here so they sit on top of the shape they outline.
 * Provenance lines live in `CanvasBackground` (below shapes).
 */
export function WorldOverlay() {
  return <SelectionRings />;
}
