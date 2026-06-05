"use client";

import { SelectionRings } from "./SelectionRings";
import { RelatedRings } from "./RelatedRings";

/**
 * Rendered via tldraw's `OnTheCanvas` slot — sits ABOVE shapes. Selection
 * rings (solid accent) and related-node rings (dashed, on selection) live here
 * so they sit on top of the shapes they outline. The connecting lines live in
 * `CanvasBackground` (below shapes).
 */
export function WorldOverlay() {
  return (
    <>
      <RelatedRings />
      <SelectionRings />
    </>
  );
}
