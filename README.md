# Freemind

Freemind is a spatial canvas for research. You drop PDFs, images, markdown files, and YouTube links onto an infinite canvas, select the ones you care about, write a prompt, and Claude writes back a document that streams in next to your sources. From there you can edit it, annotate it, and export it.

It runs on your own machine. There are no accounts and nothing in the cloud. Your boards live in your browser and your Anthropic key stays on your laptop. Clone it, add your key, and go.

## Running it

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. You'll need Node 20 or newer and pnpm 10. The postinstall step copies the pdf.js worker into `public/`.

## Your API key

Freemind talks to the Anthropic API straight from the browser, so you bring your own key. Get one at [console.anthropic.com](https://console.anthropic.com/settings/keys).

You can paste it into the settings panel (the gear icon, top right), which checks it with a single `models.list` call and saves it to your browser's localStorage. Or you can put it in a file: copy `.env.local.example` to `.env.local` and set `NEXT_PUBLIC_ANTHROPIC_API_KEY`. If you do both, the key you saved in the app wins.

One thing to be clear about: the key runs in the browser. Every request goes from your tab to Anthropic over HTTPS, which is fine on a machine that's only yours. Don't run this on a shared computer, don't screen-share with the network tab open, and don't host it anywhere public without putting a backend in front to hold the key. If a key ever leaks, rotate it in the Anthropic console.

## What you can do with it

Drop things on the canvas to use as sources:

- Text notes you type yourself.
- PDFs and markdown files. Text is pulled out in the browser with pdf.js. If a PDF is a scan with no extractable text, Freemind sends the pages to Claude as images instead.
- Images, which get OCR'd and also passed to the model as pictures.
- YouTube links, which get turned into transcripts.

Select a few sources, pick a mode, write a prompt, and press Cmd+Enter. Freeform mode is quick and conversational (Sonnet by default). Deep research mode does the long, structured write-up and can search the web (Opus by default). The result streams into a new document next to whatever you selected, and you can stop it from the document's header if it goes off the rails.

A few other things that help you think on the canvas:

- Drag from the edge of one node to another to draw a connector. Hover the line and click the x to remove it.
- Select a document and faint lines show which sources it came from.
- Edit or delete a source after generating a document and that document gets a "sources changed" badge.
- Double-click a document to open focus mode: a full-screen editor with a slash menu, inline images, comments, and a side chat that proposes edits you accept or reject. Export to markdown or print to PDF from there.
- A small home page lets you keep separate boards.

Everything is saved in the browser per board, so it survives a reload.

## Configuration

These are optional and all go in `.env.local`:

- `NEXT_PUBLIC_ANTHROPIC_API_KEY`: your key, if you'd rather not use the in-app panel.
- `NEXT_PUBLIC_CLAUDE_MODEL`: model for Freeform mode. Defaults to `claude-sonnet-4-6`.
- `NEXT_PUBLIC_CLAUDE_DEEP_MODEL`: model for Deep research mode. Defaults to `claude-opus-4-7`.

## Things worth knowing

- It's almost all client-side. The one bit of server code is a small Next.js route at `app/api/transcript` that fetches YouTube transcripts, since the browser can't do that itself (CORS).
- Only one research run happens at a time. The Run button is disabled while one is streaming.
- No accounts, no sharing, no sync. Each board is a local document in one browser.
- Freemind uses tldraw on its free tier, so there's a small "made with tldraw" watermark in the corner. It has to stay unless you buy a tldraw license. See [tldraw.dev](https://tldraw.dev/#pricing).
- A lot of large files can fill the browser's storage quota. You'll get a toast when that happens; clear a board or delete sources you don't need.
- Images are stored inline (base64) inside the document, so a document with images gets large, and that size counts against your tokens if you later feed that document back in as a source.

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

Two dependencies are pinned on purpose. The Anthropic SDK is held at 0.70.0 because newer versions import `node:fs/promises` and won't bundle for the browser. tldraw and its schema package are both on 5.0.1.

## License

Freemind's own code is MIT (see [LICENSE](./LICENSE)). It depends on tldraw, which has its own license, not MIT. tldraw is free to use as long as the watermark stays visible; removing it, or commercial use at scale, needs a license from tldraw.
