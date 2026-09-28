# Freemind

Freemind is a spatial canvas for research. Drop PDFs, images, markdown files, and YouTube links onto an infinite canvas, select and research them with AI. No accounts, 100% local, lives in your browser and your API key stays on your device. 

## Running it

```bash
pnpm install
pnpm use
```

Open http://localhost:3000 or any other. On first run, add your Anthropic key (see below). That is the only setup.

- `pnpm use` builds the app and serves it, which is the normal way to run it.
- `pnpm dev` runs it in development mode with hot reload, for working on the code.
- You need Node 20 or newer and pnpm 10; the postinstall step copies the pdf.js worker into `public/`.

## Your API key

Freemind uses the Anthropic API with your own key. Get one at [console.anthropic.com](https://console.anthropic.com/settings/keys), then click **"Add your API key"** in the top right of the app and paste it.

## What you can do with it

- Drop in notes, PDFs, markdown, images, and YouTube links as sources.
- Select sources, pick a mode, and prompt:
  - **Freeform**: chat about your sources.
  - **Deepsynth**: a synthesis document from your sources only.
  - **Deepsearch**: a cited research document using the web.
  - **Create artifact**: turn sources straight into a document.
- Edit documents in a full-screen editor with tables, equations, images, comments, and an AI side chat. Export to markdown or PDF.
- Connect nodes, see which sources a document came from, and keep separate boards.

Everything saves in your browser.

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
