// Folder nesting is unbounded, so a fixed indent per level eventually marches
// rows off the right edge of a narrow surface (the 300px sidebar drawer is the
// tightest). Levels up to TIGHT_AFTER get the caller's full step; deeper ones
// get a reduced one, which keeps deep trees readable without imposing a cap.
//
// Callers pass their own `step` because the surfaces disagree on it: the trees
// indent by 14px a level, the folder picker by 16px.

const TIGHT_AFTER = 3;
const TIGHT_STEP = 8;

/**
 * Indent contributed by a SINGLE level at `depth`. For layouts whose levels
 * nest in the DOM, so the indents compound on their own (the home tree's
 * nested `<ul>`s).
 */
export function indentStep(depth: number, step: number): number {
  return depth < TIGHT_AFTER ? step : TIGHT_STEP;
}

/**
 * Total indent accumulated by `depth`, i.e. the sum of every level's step. For
 * flat layouts that position each row itself (the sidebar tree and the folder
 * picker, which render all rows as siblings).
 */
export function indentFor(depth: number, step: number): number {
  const atFullStep = Math.min(depth, TIGHT_AFTER);
  return atFullStep * step + Math.max(0, depth - TIGHT_AFTER) * TIGHT_STEP;
}
