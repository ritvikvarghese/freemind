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
        // OCR is opt-in now (it costs tokens): images land idle and the user
        // triggers "Read text" from the right-click menu or focus mode.
        status: "idle",
      },
    });
    offset += STAGGER;
  }
}

/**
 * Run OCR on an already-placed image, on demand. Reads the shape's stored
 * dataUrl, sends it to Claude vision, and writes the transcription back to
 * `ocrText`. Used by the image right-click menu and focus mode — never
 * automatically (it costs tokens). Animated art has no static text to read.
 */
export async function readImageText(
  editor: Editor,
  id: ImageNodeShape["id"],
): Promise<void> {
  const shape = editor.getShape(id) as ImageNodeShape | undefined;
  if (!shape) return;
  if (shape.props.status === "ocr") return; // already running
  if (!hasApiKey()) {
    toast("Add your Anthropic API key in settings to read image text.", "error");
    return;
  }
  const { dataUrl, mediaType, filename } = shape.props;
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  if (!base64) return;

  editor.updateShape<ImageNodeShape>({
    id,
    type: "canvas-ai-image",
    props: { status: "ocr" },
  });

  const res = await ocrImage(base64, mediaType);
  if (!editor.getShape(id)) return; // deleted mid-OCR

  if (!res.ok) {
    editor.updateShape<ImageNodeShape>({
      id,
      type: "canvas-ai-image",
      props: { status: "error" },
    });
    toast(`Could not read "${filename}": ${res.error}`, "error");
    return;
  }

  editor.updateShape<ImageNodeShape>({
    id,
    type: "canvas-ai-image",
    props: { ocrText: res.text, status: "done" },
  });
}

type PreparedImage = {
  dataUrl: string;
  base64: string;
  mediaType: ImageMediaType;
  width: number;
  height: number;
  bytes: number;
};

// Downscale to MAX_EDGE on the long side and re-encode as JPEG. Returns both
// the data URL (for rendering / persistence) and the bare base64 (for the API).
async function prepareImage(file: File): Promise<PreparedImage> {
  // Animated formats (GIF, animated WebP) are kept byte-for-byte. Re-encoding
  // through a canvas flattens them to a single static frame, killing the
  // animation; storing the original bytes lets the <img> play them. Static
  // WebP still takes the downscale + OCR path below. (No downscale on the
  // kept-as-is path, so the 20 MB cap above is the guard on size.)
  if (file.type === "image/gif") {
    return prepareAsIs(file, "image/gif");
  }
  if (file.type === "image/webp" && (await isAnimatedWebp(file))) {
    return prepareAsIs(file, "image/webp");
  }

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

// Keep the original file bytes (no canvas re-encode) so animation survives.
// Dimensions are decoded via an <img> (handles animated GIF/WebP reliably,
// unlike createImageBitmap, which can choke on some animated files); the data
// URL is the whole file.
async function prepareAsIs(
  file: File,
  mediaType: ImageMediaType,
): Promise<PreparedImage> {
  const dataUrl = await fileToDataUrl(file);
  const { width, height } = await imageDimensions(dataUrl);
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;

  return { dataUrl, base64, mediaType, width, height, bytes: file.size };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Image read failed"));
    reader.readAsDataURL(file);
  });
}

function imageDimensions(
  src: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        width: Math.max(1, img.naturalWidth),
        height: Math.max(1, img.naturalHeight),
      });
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = src;
  });
}

// Animated WebP and static WebP share the `image/webp` mime type, so detect
// animation from the bytes. WebP is a RIFF container; animated files use a
// VP8X chunk with the animation flag (0x02) set and carry an "ANIM" chunk.
async function isAnimatedWebp(file: File): Promise<boolean> {
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  } catch {
    return false;
  }
  if (head.length < 21) return false;
  const tag = (o: number) =>
    String.fromCharCode(head[o], head[o + 1], head[o + 2], head[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") return false;
  if (tag(12) === "VP8X" && (head[20] & 0x02) !== 0) return true;
  // Fallback: look for the ANIM chunk in the header window.
  for (let i = 12; i <= head.length - 4; i++) {
    if (tag(i) === "ANIM") return true;
  }
  return false;
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
