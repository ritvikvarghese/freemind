import { createShapeId, type Editor, type VecLike } from "tldraw";
import { ocrImage, type ImageMediaType } from "@/lib/extract/ocr";
import { hasApiKey } from "@/lib/storage/apiKey";
import { toast } from "./toast";
import {
  IMAGE_NODE_DEFAULT_W,
  type ImageNodeShape,
} from "./shapes/ImageNode";

// Anthropic's vision sweet spot: long edge <= 1568px keeps token cost sane
// without throwing away detail needed for OCR.
const MAX_EDGE = 1568;
const JPEG_QUALITY = 0.9;
const STAGGER = 24;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function ingestImages(
  editor: Editor,
  files: File[],
  anchor?: VecLike,
): Promise<void> {
  const start = anchor ?? editor.getViewportPageBounds().center;

  let offset = 0;
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) {
      toast(
        `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — max is 20 MB.`,
        "error",
      );
      continue;
    }

    let prepared: PreparedImage;
    try {
      prepared = await prepareImage(file);
    } catch (err) {
      toast(
        `Could not read "${file.name}": ${err instanceof Error ? err.message : "unknown error"}`,
        "error",
      );
      continue;
    }

    const id = createShapeId();
    const displayW = IMAGE_NODE_DEFAULT_W;
    const displayH = Math.round(
      (prepared.height / prepared.width) * displayW,
    );

    editor.createShape<ImageNodeShape>({
      id,
      type: "canvas-ai-image",
      x: start.x - displayW / 2 + offset,
      y: start.y - displayH / 2 + offset,
      props: {
        w: displayW,
        h: displayH,
        filename: file.name,
        dataUrl: prepared.dataUrl,
        mediaType: prepared.mediaType,
        naturalW: prepared.width,
        naturalH: prepared.height,
        bytes: prepared.bytes,
        ocrText: "",
        status: hasApiKey() ? "ocr" : "idle",
      },
    });
    offset += STAGGER;

    if (hasApiKey()) {
      void runImageOcr(editor, id, file.name, prepared);
    }
  }
}

type PreparedImage = {
  dataUrl: string;
  base64: string;
  mediaType: ImageMediaType;
  width: number;
  height: number;
  bytes: number;
};

async function runImageOcr(
  editor: Editor,
  id: ImageNodeShape["id"],
  filename: string,
  img: PreparedImage,
): Promise<void> {
  const res = await ocrImage(img.base64, img.mediaType);
  if (!editor.getShape(id)) return; // deleted mid-OCR

  if (!res.ok) {
    editor.updateShape<ImageNodeShape>({
      id,
      type: "canvas-ai-image",
      props: { status: "error" },
    });
    toast(`OCR failed for "${filename}": ${res.error}`, "error");
    return;
  }

  editor.updateShape<ImageNodeShape>({
    id,
    type: "canvas-ai-image",
    props: { ocrText: res.text, status: "done" },
  });
}

// Downscale to MAX_EDGE on the long side and re-encode as JPEG. Returns both
// the data URL (for rendering / persistence) and the bare base64 (for the API).
async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  // Flatten onto white so JPEG (no alpha) doesn't render transparency as black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  if ("close" in bitmap) bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bytes = Math.round((base64.length * 3) / 4);

  return {
    dataUrl,
    base64,
    mediaType: "image/jpeg",
    width,
    height,
    bytes,
  };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  // Fallback for browsers without createImageBitmap.
  const url = URL.createObjectURL(file);
  try {
    const el = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Image decode failed"));
      image.src = url;
    });
    return el;
  } finally {
    URL.revokeObjectURL(url);
  }
}
