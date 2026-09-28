# Freemind

Freemind is a spatial canvas for research. You drop PDFs, images, markdown files, and YouTube links onto an infinite canvas, select the ones you care about, write a prompt, and Claude writes back a document that streams in next to your sources. From there you can edit it, annotate it, and export it.

It runs on your own machine. There are no accounts and nothing in the cloud. Your boards live in your browser and your Anthropic key stays on your laptop. Clone it, add your key, and go.

## Running it

```bash
pnpm install
pnpm use
```

Open http://localhost:3000. On first run, add your Anthropic key (see below). That is the only setup.

`pnpm use` builds the app and serves it, which is the normal way to run it. For development with hot reload, use `pnpm dev` instead. You need Node 20 or newer and pnpm 10; the postinstall step copies the pdf.js worker into `public/`.

## Your API key

Freemind uses the Anthropic API with your own key. Get one at [console.anthropic.com](https://console.anthropic.com/settings/keys), then click **"Add your API key"** in the top right of the app and paste it.

## What you can do with it

Drop things on the canvas to use as sources:

- Text notes you type yourself.
- PDFs and markdown files. Text is pulled out in the browser with pdf.js. If a PDF is a scan with no extractable text, Freemind sends the pages to Claude as images instead.
- Images, which get OCR'd and also passed to the model as pictures.
- YouTube links, which get turned into transcripts.

Select a few sources, pick a mode, write a prompt, and press Enter. There are four modes:

- **Freeform** chats with you about your sources, in whatever format you ask (Sonnet by default).
- **Deepsynth** reasons across only your sources and writes a synthesis document, no web (Opus by default).
- **Deepsearch** searches the web and writes a long, cited research document (Opus by default).
- **Create artifact** turns your sources straight into a document, no back and forth.

Chat is the default, so Freeform opens a side conversation while the other three write a document. Either way the document streams in next to whatever you selected, with the model's thinking shown as it works, and you can stop it from the document's header if it goes off the rails. You can also chat with the canvas or with any document and ask it to write findings straight into the doc.

A few other things that help you think on the canvas:

- Drag from the edge of one node to another to draw a connector. Hover the line and click the x to remove it.
- Select a document and faint lines show which sources it came from.
- Edit or delete a source after generating a document and that document gets a "sources changed" badge.
- Double-click a document to open focus mode: a full-screen editor with a slash menu, inline images, comments, and a side chat that proposes edits you accept or reject. Export to markdown or print to PDF from there.
- A small home page lets you keep separate boards.

Everything is saved in the browser per board, so it survives a reload.

## Working on it

```bash
pnpm exec tsc --noEmit
pnpm run lint
```

Rough layout:

- `app/` is the Next.js app, including the transcript route.
- `components/canvas/` is the tldraw setup, shapes, toolbar, prompt, and overlays.
- `components/focus/` is focus mode: the editor, comments, side chat, and export.
- `lib/agent/` has the prompts and the research and chat runners.
- `lib/storage/` handles boards, the API key, chat history, and connectors.

tldraw and its schema package are both pinned to 5.0.1 on purpose. The Anthropic SDK is on 0.84.0 and is called straight from the browser, so your key never touches a server.

## License

Freemind's own code is MIT (see [LICENSE](./LICENSE)). It depends on tldraw, which has its own license, not MIT. tldraw is free to use as long as the watermark stays visible; removing it, or commercial use at scale, needs a license from tldraw.
