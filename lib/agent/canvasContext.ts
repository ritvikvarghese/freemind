import { getBoardContextByPersistenceKey } from "@/lib/storage/boards";
import { getCurrentBoardPersistenceKey } from "@/lib/storage/currentBoard";

/**
 * The active canvas's "what is this canvas about" text, formatted as a preamble
 * to prepend to the system prompt of every AI interaction on the canvas
 * (research, the canvas chat dock, document chat). It gives the model the
 * canvas's purpose as ambient background on every turn, without the user
 * restating it, and is distinct from the selected sources that ride in
 * <context> / <sources>.
 *
 * Token cost is deliberately near-zero on the steady state:
 *  - No context set => returns "" => callers prepend nothing, send nothing.
 *  - Context set => callers FOLD this into their existing, already
 *    prefix-cached system block (not a new block). So it consumes no extra
 *    cache breakpoint, and after the first turn it is a cache read, not
 *    re-billed input, even though it rides along on every request.
 *
 * Resolves the active board via the module-level current-board handle (set by
 * CanvasRoot on mount), which is the same board these AI calls are firing on.
 */
export function canvasContextPreamble(): string {
  const key = getCurrentBoardPersistenceKey();
  if (!key) return "";
  const ctx = getBoardContextByPersistenceKey(key)?.trim();
  if (!ctx) return "";
  return (
    "This canvas is about the following. Treat it as background context to keep your response relevant; it is not a source to cite.\n" +
    `<canvas_context>\n${ctx}\n</canvas_context>\n\n`
  );
}
