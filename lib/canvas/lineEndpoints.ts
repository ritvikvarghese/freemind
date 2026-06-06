// Geometry for connector / provenance lines. Lines are drawn beneath shapes,
// so for opaque cards the center-anchored half is hidden under the card and the
// line appears to leave from the card's edge. A plain text shape is transparent,
// so a center-anchored line shows through and cuts across the text. Clipping
// each endpoint to its shape's bounding-box edge makes every format behave the
// same: the line arises from the edge and never crosses the shape.

export type BoxLike = { x: number; y: number; w: number; h: number };

/** The point on box `b`'s edge along the ray from its center toward (tx, ty). */
export function edgePointToward(
  b: BoxLike,
  tx: number,
  ty: number,
): { x: number; y: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tX = dx !== 0 ? b.w / 2 / Math.abs(dx) : Infinity;
  const tY = dy !== 0 ? b.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tX, tY);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * Endpoints of the segment between two boxes, each clipped to the edge facing
 * the other box's center. The result lies between the two shapes (outside both),
 * so the line touches each at its edge instead of piercing to the center.
 */
export function edgeToEdge(
  a: BoxLike,
  b: BoxLike,
): { x1: number; y1: number; x2: number; y2: number } {
  const p1 = edgePointToward(a, b.x + b.w / 2, b.y + b.h / 2);
  const p2 = edgePointToward(b, a.x + a.w / 2, a.y + a.h / 2);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}
