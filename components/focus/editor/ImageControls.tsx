"use client";

import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { Copy } from "lucide-react";
import { toast } from "@/components/canvas/toast";

type Props = {
  editor: Editor;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
};

type Selected = { src: string; top: number; right: number };

/**
 * "Copy image" chip on a selected (clicked) image. Cmd+C on an image only puts
 * `<img src="data:...">` HTML on the clipboard, which many apps ignore; this
 * writes a real PNG so it pastes anywhere.
 */
export function ImageControls({ editor, wrapperRef }: Props) {
  const [selected, setSelected] = useState<Selected | null>(null);

  const refresh = useCallback(() => {
    const { selection } = editor.state;
    const wrapper = wrapperRef.current;
    if (
      !wrapper ||
      !(selection instanceof NodeSelection) ||
      selection.node.type.name !== "image"
    ) {
      setSelected(null);
      return;
    }
    const dom = editor.view.nodeDOM(selection.from) as HTMLElement | null;
    const img = dom?.tagName === "IMG" ? dom : dom?.querySelector("img");
    if (!img) {
      setSelected(null);
      return;
    }
    const r = img.getBoundingClientRect();
    const w = wrapper.getBoundingClientRect();
    setSelected({
      src: selection.node.attrs.src as string,
      top: r.top - w.top + 8,
      right: w.right - r.right + 8,
    });
  }, [editor, wrapperRef]);

  useEffect(() => {
    editor.on("selectionUpdate", refresh);
    editor.on("update", refresh);
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("update", refresh);
    };
  }, [editor, refresh]);

  if (!selected) return null;

  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        copyImageAsPng(selected.src).then(
          () => toast("Image copied", "info"),
          () => toast("Could not copy this image", "error"),
        );
      }}
      className="absolute z-10 flex items-center gap-1.5 rounded-button border border-hairline bg-elevated px-2 py-1 text-[12px] text-text-secondary shadow-panel hover:text-text-primary"
      style={{ top: selected.top, right: selected.right }}
    >
      <Copy className="h-3 w-3" aria-hidden />
      Copy image
    </button>
  );
}

/**
 * The async Clipboard API only reliably accepts image/png, so re-encode.
 * The blob is passed as a promise so Safari keeps the click's user activation
 * while the image decodes. A remote image without CORS headers taints the
 * canvas and rejects, which the caller reports.
 */
function copyImageAsPng(src: string): Promise<void> {
  const png = new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.drawImage(img, 0, 0);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), "image/png");
    };
    img.onerror = () => reject(new Error("load failed"));
    img.src = src;
  });
  return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
