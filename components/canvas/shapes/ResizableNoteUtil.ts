"use client";

import { NoteShapeUtil } from "tldraw";

/**
 * tldraw's built-in sticky note ships with `resizeMode: "none"`, so notes can
 * only grow to fit their text and never expose resize handles. We swap in this
 * subclass (via `mergeArraysAndReplaceDefaults` on the `note` type) to flip the
 * single option to `"scale"`, which gives selected notes corner handles that
 * scale the whole note (font and box together). Everything else about the
 * default note behavior is preserved.
 */
export class ResizableNoteUtil extends NoteShapeUtil {
  constructor(...args: ConstructorParameters<typeof NoteShapeUtil>) {
    super(...args);
    this.options = { ...this.options, resizeMode: "scale" };
  }
}
