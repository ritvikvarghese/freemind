import type { Editor, TLShape } from "tldraw";

// A huge artifact shouldn't fling a viewport-sized ghost; cap the tile size.
const MAX_GHOST = 240;
const TARGET_INSET_X = 24; // from the right edge: roughly the download button
const TARGET_INSET_Y = 20; // from the top edge

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Delight flourish for a direct canvas download: a clone of the shape spins and
 * shrinks from its on-canvas position toward the top-right corner (where the
 * browser's download button lives) and fades out, handing off to the browser's
 * own download indicator. Purely cosmetic — wrapped so it can never block or
 * alter the actual save, and skipped under prefers-reduced-motion.
 */
export function flyShapeToDownload(editor: Editor, shape: TLShape): void {
  if (typeof document === "undefined" || prefersReducedMotion()) return;
  try {
    const el = editor
      .getContainer()
      .querySelector<HTMLElement>(`[data-shape-id="${CSS.escape(shape.id)}"]`);
    const rect = el?.getBoundingClientRect();
    if (!el || !rect || rect.width < 1 || rect.height < 1) return;

    // Shrink the tile if the shape is large on screen, keeping its aspect.
    const fit = Math.min(1, MAX_GHOST / Math.max(rect.width, rect.height));
    const w = rect.width * fit;
    const h = rect.height * fit;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const ghost = document.createElement("div");
    ghost.dataset.downloadFly = "";
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${cx - w / 2}px`,
      top: `${cy - h / 2}px`,
      width: `${w}px`,
      height: `${h}px`,
      borderRadius: "12px",
      overflow: "hidden",
      background: "var(--color-elevated, #1b1b1f)",
      boxShadow: "0 12px 32px rgba(0,0,0,.45)",
      pointerEvents: "none",
      zIndex: "9999",
      transformOrigin: "center",
      willChange: "transform, opacity",
    } as Partial<CSSStyleDeclaration> as CSSStyleDeclaration);

    // Clone the live shape so the artifact itself flies. The shape DOM is
    // rendered at intrinsic size with a camera-zoom transform on its wrapper;
    // re-scale the clone (intrinsic -> on-screen tile) so it fills the ghost.
    const zoom = editor.getZoomLevel() || 1;
    const intrinsicW = rect.width / zoom;
    const intrinsicH = rect.height / zoom;
    const inner = el.cloneNode(true) as HTMLElement;
    Object.assign(inner.style, {
      position: "absolute",
      left: "0",
      top: "0",
      margin: "0",
      width: `${intrinsicW}px`,
      height: `${intrinsicH}px`,
      transformOrigin: "0 0",
      transform: `scale(${fit * zoom})`,
      pointerEvents: "none",
    } as Partial<CSSStyleDeclaration> as CSSStyleDeclaration);
    ghost.appendChild(inner);
    document.body.appendChild(ghost);

    const dx = window.innerWidth - TARGET_INSET_X - cx;
    const dy = TARGET_INSET_Y - cy;

    const anim = ghost.animate(
      [
        { transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1 },
        {
          transform: `translate(${dx}px, ${dy}px) scale(0.12) rotate(720deg)`,
          opacity: 0.5,
        },
      ],
      { duration: 760, easing: "cubic-bezier(.55,0,.25,1)", fill: "forwards" },
    );
    const cleanup = () => ghost.remove();
    anim.onfinish = cleanup;
    anim.oncancel = cleanup;
  } catch {
    // A cosmetic flourish must never break a download.
  }
}
