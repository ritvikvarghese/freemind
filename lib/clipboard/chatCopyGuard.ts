"use client";

/**
 * tldraw installs a document-level `copy`/`cut` handler that, whenever a shape
 * is selected and you are not editing a shape, calls `preventDefault()` and
 * writes serialized `application/tldraw` JSON to the clipboard. Our chat panels
 * render in overlays ON TOP of the canvas while the document shape stays
 * selected, so a plain Cmd+C over selected chat text gets hijacked: the user
 * copies shape JSON instead of the text they highlighted.
 *
 * This guard runs a CAPTURE-phase listener on `document` (which fires before
 * tldraw's bubble-phase listener). When the live selection lives inside a
 * `.canvas-ai-chat-selectable` container, it stops propagation so tldraw never
 * sees the event, and does NOT preventDefault — letting the browser perform its
 * normal text copy. Ref-counted so multiple chat panels share one listener.
 */

let installed = 0;

function selectionInChat(): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  const el =
    node instanceof Element ? node : (node?.parentElement ?? null);
  return !!el?.closest(".canvas-ai-chat-selectable");
}

function onClipboard(e: ClipboardEvent): void {
  if (selectionInChat()) {
    // Let the native text copy proceed; keep tldraw's handler from running.
    e.stopImmediatePropagation();
  }
}

export function installChatCopyGuard(): () => void {
  if (installed === 0) {
    document.addEventListener("copy", onClipboard, true);
    document.addEventListener("cut", onClipboard, true);
  }
  installed += 1;
  return () => {
    installed -= 1;
    if (installed === 0) {
      document.removeEventListener("copy", onClipboard, true);
      document.removeEventListener("cut", onClipboard, true);
    }
  };
}
