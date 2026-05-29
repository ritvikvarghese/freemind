"use client";

import { DefaultBackground } from "tldraw";
import { ProvenanceLines } from "./ProvenanceLines";
import { Connectors } from "./Connectors";

/**
 * Rendered via tldraw's `Background` slot — sits BELOW the shapes layer.
 * Composes the default dot grid with our provenance lines so source→doc
 * lines tuck under nodes rather than slicing through their bodies.
 */
export function CanvasBackground() {
  return (
    <>
      <DefaultBackground />
      <ProvenanceLines />
      <Connectors />
    </>
  );
}
