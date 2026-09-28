import type { EditorView } from "@tiptap/pm/view";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { dropPoint } from "@tiptap/pm/transform";
import { MAX_IMAGE_BYTES, prepareImage } from "@/components/canvas/ingestImages";
import { toast } from "@/components/canvas/toast";

/** The image files in a clipboard or drag payload, in order. */
export function imageFiles(files: FileList | null | undefined): File[] {
  return Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
}

/**
 * Downscale each image (same path as canvas images: long edge <= 1568px, JPEG,
 * animated GIF/WebP kept as-is) and insert them as image nodes. The result is
 * stored inline as a data URL in the document markdown, so downscaling is what
 * keeps a phone photo from becoming a multi-megabyte string.
 *
 * With `pos` (a drop), the images land at the nearest valid block position to
 * it; without, they replace the current selection (paste, slash menu).
 */
export async function insertImageFiles(
  view: EditorView,
  files: File[],
  pos?: number,
): Promise<void> {
  const prepared: { src: string; alt: string }[] = [];
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) {
      toast(
        `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB, max is 20 MB.`,
        "error",
      );
      continue;
    }
    try {
      const { dataUrl } = await prepareImage(file);
      prepared.push({ src: dataUrl, alt: file.name });
    } catch (err) {
      toast(
        `Could not read "${file.name}": ${err instanceof Error ? err.message : "unknown error"}`,
        "error",
      );
    }
  }
  // The editor may have been destroyed while images were decoding.
  if (!prepared.length || view.isDestroyed) return;

  const { state } = view;
  const imageType = state.schema.nodes.image;
  if (!imageType) return;
  const nodes: PMNode[] = prepared.map((attrs) => imageType.create(attrs));

  const tr = state.tr;
  if (pos === undefined) {
    for (const node of nodes) tr.replaceSelectionWith(node);
  } else {
    const fragment = Fragment.from(nodes);
    const at = Math.min(pos, state.doc.content.size);
    const target = dropPoint(state.doc, at, new Slice(fragment, 0, 0)) ?? at;
    tr.insert(target, fragment);
  }
  view.dispatch(tr.scrollIntoView());
}
