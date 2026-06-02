import type { Editor, TLShapeId } from "tldraw";
import type { CanvasChatRecord } from "@/lib/storage/canvasChatTypes";
import type { ChatMessage } from "@/lib/storage/chatTypes";
import { isSourceShape, type SourceShape } from "@/lib/agent/buildContext";
import { launchResearch } from "@/components/canvas/prompt/launchResearch";

/**
 * Turn a canvas chat into a DocumentNode artifact. Reuses the existing
 * `launchResearch` → `runResearch` pipeline unchanged: we resolve the chat's
 * sources back to live shapes (by id), fold the transcript + optional focus
 * into the prompt, and let runResearch stream a real document onto the canvas.
 *
 * If some source shapes were deleted since the chat began, we proceed with
 * whatever remains — the conversation transcript still grounds the document.
 */
function buildTranscript(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.text && m.text.trim())
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text.trim()}`)
    .join("\n\n");
}

export function promoteToArtifact(
  editor: Editor,
  chat: CanvasChatRecord,
  opts?: { focus?: string },
): TLShapeId {
  const sources: SourceShape[] = [];
  for (const id of chat.sourceIds) {
    const shape = editor.getShape(id as TLShapeId);
    if (shape && isSourceShape(shape)) sources.push(shape);
  }

  const transcript = buildTranscript(chat.messages);
  const focus = opts?.focus?.trim();
  const head =
    focus && focus.length > 0
      ? focus
      : "Write up the key findings from our conversation as a standalone document.";
  const prompt = transcript
    ? `${head}\n\nBase it on the conversation below. Synthesize it into a standalone document — do not refer to "the conversation" or "the chat".\n\n<conversation>\n${transcript}\n</conversation>`
    : head;

  return launchResearch(editor, sources, prompt, chat.mode);
}
