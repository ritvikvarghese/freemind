"use client";

import {
  AssetRecordType,
  createShapeId,
  toRichText,
  type Editor,
  type TLAssetId,
} from "tldraw";

// First-run intro content seeded onto a brand-new "welcome" canvas: a title and
// six feature cards (a screenshot image + a heading + a one-line caption). These
// are ordinary tldraw shapes, so the newcomer can drag, zoom, and ultimately
// clear them to start their own canvas. Images live in /public/welcome and are
// served same-origin (CSP img-src 'self'). Captions avoid em/en dashes per the
// project rule.

type Card = { src: string; heading: string; body: string };

const CARDS: Card[] = [
  {
    src: "/welcome/01-sources.png",
    heading: "Bring in your raw material",
    body: "Drop PDFs, paste links and YouTube videos, add images, text, or sticky notes. Everything you are working from lives on one canvas.",
  },
  {
    src: "/welcome/02-canvas-chat.png",
    heading: "Ask, and get a grounded answer",
    body: "Prompt Claude right on the canvas and get a cited answer or a full synthesis, drawn only from your sources.",
  },
  {
    src: "/welcome/03-add-to-chat.png",
    heading: "Select what matters, share it in",
    body: "Pick any cards on the canvas and they join the conversation, so Claude answers from exactly the sources you chose.",
  },
  {
    src: "/welcome/04-upload-focus.png",
    heading: "Read the source, not a summary",
    body: "Open any upload to see the original PDF or page beside the text the AI reads from it.",
  },
  {
    src: "/welcome/05-doc-focus.png",
    heading: "Write and edit in focus mode",
    body: "Open a document to read and edit it like a normal doc, with citations linking back to its sources.",
  },
  {
    src: "/welcome/06-doc-chat.png",
    heading: "Let Claude edit it inline",
    body: "Ask Claude to expand, tighten, or rewrite. Its changes arrive as edits you accept or reject.",
  },
];

// Source images are 1040x650 (16:10); shown on canvas at half that.
const NAT_W = 1040;
const NAT_H = 650;
const IMG_W = 520;
const IMG_H = 325;
const COL_GAP = 110;
const ROW_GAP = 150;
const CAP_GAP = 18; // image bottom -> heading
const BODY_GAP = 46; // heading top -> body top
const CARD_H = IMG_H + 130; // image + caption block

export function seedWelcomeCanvas(editor: Editor): void {
  editor.run(() => {
    // Title + tagline above the grid.
    editor.createShape({
      id: createShapeId(),
      type: "text",
      x: 0,
      y: -150,
      props: {
        richText: toRichText("Welcome to Freemind"),
        size: "xl",
        font: "sans",
        color: "black",
        textAlign: "start",
        autoSize: true,
      },
    });
    editor.createShape({
      id: createShapeId(),
      type: "text",
      x: 0,
      y: -78,
      props: {
        richText: toRichText(
          "A canvas for the mind. Drag around to explore, then clear this canvas when you are ready to start your own.",
        ),
        size: "s",
        font: "sans",
        color: "grey",
        textAlign: "start",
        autoSize: false,
        w: 780,
      },
    });

    CARDS.forEach((card, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = col * (IMG_W + COL_GAP);
      const y = 120 + row * (CARD_H + ROW_GAP);

      const assetId: TLAssetId = AssetRecordType.createId();
      editor.createAssets([
        {
          id: assetId,
          typeName: "asset",
          type: "image",
          props: {
            name: card.src.split("/").pop() ?? "welcome.png",
            src: card.src,
            w: NAT_W,
            h: NAT_H,
            mimeType: "image/png",
            isAnimated: false,
          },
          meta: {},
        },
      ]);
      editor.createShape({
        id: createShapeId(),
        type: "image",
        x,
        y,
        props: { w: IMG_W, h: IMG_H, assetId },
      });
      editor.createShape({
        id: createShapeId(),
        type: "text",
        x,
        y: y + IMG_H + CAP_GAP,
        props: {
          richText: toRichText(card.heading),
          size: "m",
          font: "sans",
          color: "black",
          textAlign: "start",
          autoSize: false,
          w: IMG_W,
        },
      });
      editor.createShape({
        id: createShapeId(),
        type: "text",
        x,
        y: y + IMG_H + CAP_GAP + BODY_GAP,
        props: {
          richText: toRichText(card.body),
          size: "s",
          font: "sans",
          color: "grey",
          textAlign: "start",
          autoSize: false,
          w: IMG_W,
        },
      });
    });
  });

  // Frame the whole intro so the newcomer sees it on arrival.
  editor.zoomToFit();
}
