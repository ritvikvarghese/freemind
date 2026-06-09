"use client";

import { useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import { useBoardKey } from "../BoardContext";
import { useConnectors, type Connector } from "@/lib/storage/connectors";
import { getProvenanceEdges } from "@/lib/canvas/provenance";
import { edgeToEdge } from "@/lib/canvas/lineEndpoints";
import {
  hasActiveOneShots,
  pulseFrame,
  recentOrigin,
  usePulseClock,
  useRecentVersion,
} from "@/lib/canvas/pulse";

type Spec = {
  key: string;
  startId: TLShapeId;
  endId: TLShapeId;
  origin: number;
};

/** Selected + hovered shape ids — the "active" node(s). */
function activeIdSet(editor: Editor): Set<TLShapeId> {
  const hovered = editor.getHoveredShapeId();
  return new Set<TLShapeId>([
    ...editor.getSelectedShapeIds(),
    ...(hovered ? [hovered] : []),
  ]);
}

/** Cheap gate: does the active node touch any connector / provenance edge? */
function anyActiveEdge(editor: Editor, connectors: Connector[]): boolean {
  const active = activeIdSet(editor);
  if (active.size === 0) return false;
  for (const c of connectors) {
    if (active.has(c.fromId as TLShapeId) || active.has(c.toId as TLShapeId))
      return true;
  }
  for (const e of getProvenanceEdges(editor)) {
    if (active.has(e.from) || active.has(e.to)) return true;
  }
  return false;
}

/**
 * Which edges should be pulsing right now: any connector / provenance edge
 * touching the active (selected or hovered) node, plus freshly created ones
 * (one-shot). Direction is always source -> destination, so the charge flows
 * outward from the source and INTO a new artifact. `origin` 0 = the calm 5s
 * ambient loop; a recent timestamp = a one-shot that fires from its creation.
 */
function collectSpecs(
  editor: Editor,
  connectors: Connector[],
  now: number,
): Spec[] {
  const active = activeIdSet(editor);
  const out = new Map<string, Spec>();

  for (const c of connectors) {
    const key = `c:${c.id}`;
    const recent = recentOrigin(key, now);
    if (
      recent == null &&
      !active.has(c.fromId as TLShapeId) &&
      !active.has(c.toId as TLShapeId)
    )
      continue;
    out.set(key, {
      key,
      startId: c.fromId as TLShapeId,
      endId: c.toId as TLShapeId,
      origin: recent ?? 0,
    });
  }

  // Provenance edges are stored from = doc, to = source; the charge flows the
  // other way (source -> doc), so a new artifact lights up from its sources.
  for (const e of getProvenanceEdges(editor)) {
    const key = `p:${e.from}->${e.to}`;
    const recent = recentOrigin(`d:${e.from}`, now);
    if (recent == null && !active.has(e.from) && !active.has(e.to)) continue;
    out.set(key, { key, startId: e.to, endId: e.from, origin: recent ?? 0 });
  }

  return [...out.values()];
}

/**
 * Animated connector pulses. Rendered in the Background slot (above the static
 * lines, below shapes — so pills tuck under the destination card on arrival).
 * The rAF clock only runs while there's something to animate, so it's free at
 * rest. See lib/canvas/pulse.ts for the timing.
 */
export function ConnectorPulses() {
  const editor = useEditor();
  const boardKey = useBoardKey();
  const connectors = useConnectors(boardKey);
  const recentVersion = useRecentVersion();

  // One reactive read: subscribes to selection / hover / shape changes (so the
  // clock starts when you select a node) and to one-shot marks. Returns the
  // camera (page -> screen) plus whether the active node touches any edge.
  const view = useValue(
    "pulse-view",
    () => {
      void recentVersion; // re-evaluate when a one-shot is marked
      return {
        camera: editor.getCamera(),
        activeEdge: anyActiveEdge(editor, connectors),
      };
    },
    [editor, connectors, recentVersion],
  );

  // Animate while the active node has edges OR a one-shot is in flight. `now`
  // comes from the clock (pure state read) — render stays side-effect free.
  const active = view.activeEdge || hasActiveOneShots();
  const now = usePulseClock(active);
  if (!active) return null;

  const specs = collectSpecs(editor, connectors, now);
  if (specs.length === 0) return null;

  const { camera } = view;
  const z = camera.z;
  const items = specs
    .map((s) => {
      const a = editor.getShapePageBounds(s.startId);
      const b = editor.getShapePageBounds(s.endId);
      if (!a || !b) return null;
      const { x1, y1, x2, y2 } = edgeToEdge(a, b);
      return {
        key: s.key,
        frame: pulseFrame({ x1, y1, x2, y2, origin: s.origin }, now),
        ex: x2,
        ey: y2,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <g transform={`translate(${camera.x * z} ${camera.y * z}) scale(${z})`}>
        {items.map(({ key, frame, ex, ey }) => (
          <g key={key}>
            {frame.ripple ? (
              <g transform={`translate(${ex} ${ey}) scale(${1 / z})`}>
                <circle
                  r={frame.ripple.r}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={1.5}
                  opacity={frame.ripple.opacity}
                />
              </g>
            ) : null}
            {frame.pill ? (
              <g
                transform={`translate(${frame.pill.x} ${frame.pill.y}) rotate(${frame.pill.angle}) scale(${1 / z})`}
              >
                {/* Thin dash, the same weight as the wire (1.5px stroke) — a
                    segment of the line lighting up, not a fat capsule on top. */}
                <rect
                  x={-7}
                  y={-0.85}
                  width={14}
                  height={1.7}
                  rx={0.85}
                  fill="var(--color-accent)"
                  opacity={frame.pill.opacity}
                />
              </g>
            ) : null}
          </g>
        ))}
      </g>
    </svg>
  );
}
