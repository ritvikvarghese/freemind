# Freemind

Freemind is a spatial canvas for research. You drop PDFs, images, markdown files, and YouTube links onto an infinite canvas, select the ones you care about, write a prompt, and Claude writes back a document that streams in next to your sources. From there you can edit it, annotate it, and export it.

It runs on your own machine. There are no accounts and nothing in the cloud. Your boards live in your browser and your Anthropic key stays on your laptop. Clone it, add your key, and go.

## Running it

```bash
pnpm install
pnpm use
```

Open http://localhost:3000. On first run, click the **"Add your API key"** button in the top right and paste your Anthropic key (details just below). That is the only setup; everything else is ready to go.

`pnpm use` builds the app and serves it, which is the normal way to run it. For development with hot reload, use `pnpm dev` instead. You need Node 20 or newer and pnpm 10; the postinstall step copies the pdf.js worker into `public/`.

### Pick one address and stick with it

Your boards and notes are stored in the browser, scoped to the exact address you open, **including the port**. `http://localhost:3000` and `http://localhost:3005` are treated as two completely separate sites with their own, independent data.

So decide on one address for Freemind and always use it. If you switch ports later, your boards are not deleted, but they will not show up under the new address (they are still sitting under the old one).

If something else on your machine already uses port 3000, run Freemind on a different port and then keep using that same one every time:

```bash
pnpm build
pnpm exec next start -p 3005
```

Then open http://localhost:3005 (or whatever port you chose). If you want a portable copy of your boards regardless of port, use Export in Settings.

## Your API key

Freemind talks to the Anthropic API straight from the browser, so you bring your own key. Get one at [console.anthropic.com](https://console.anthropic.com/settings/keys).

The simplest way: when you open the app with no key set, an **"Add your API key"** button sits next to the gear in the top right. Click it (or the gear), paste your key, and it is checked with a single `models.list` call and saved to your browser's localStorage. That is it; the button goes away once the key is set.

If you would rather use a file, copy `.env.local.example` to `.env.local` and set `NEXT_PUBLIC_ANTHROPIC_API_KEY`. If you do both, the key you saved in the app wins.

One thing to be clear about: the key runs in the browser. Every request goes from your tab to Anthropic over HTTPS, which is fine on a machine that's only yours. Don't run this on a shared computer, don't screen-share with the network tab open, and don't host it anywhere public without putting a backend in front to hold the key. If a key ever leaks, rotate it in the Anthropic console.

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

## Configuration

These are optional and all go in `.env.local`:

- `NEXT_PUBLIC_ANTHROPIC_API_KEY`: your key, if you'd rather not use the in-app panel.
- `NEXT_PUBLIC_CLAUDE_MODEL`: model for Freeform research. Defaults to `claude-sonnet-4-6`.
- `NEXT_PUBLIC_CLAUDE_DEEP_MODEL`: model for Deepsynth and Deepsearch. Defaults to `claude-opus-4-7`.
- `NEXT_PUBLIC_CLAUDE_CHAT_MODEL`: model for canvas and document chat. Defaults to `claude-sonnet-4-6`.
- `NEXT_PUBLIC_CLAUDE_OCR_MODEL`: model for reading text from images. Defaults to `claude-sonnet-4-6`.

## Deploy

Freemind runs on [Railway](https://railway.com) as one public link. Point a new Railway project at this repo: it autodetects Next.js, builds with `pnpm build`, and serves with `pnpm start` (the included `railway.json` and `.nvmrc` pin this and Node 22). Add a public domain in the service settings and you have a link anyone can open.

Read this before you deploy publicly:

- **Do not set `NEXT_PUBLIC_ANTHROPIC_API_KEY` (or any Anthropic key) in Railway.** The `NEXT_PUBLIC_` prefix bakes the value into the browser bundle, so it would ship your personal key to every visitor. Leave it unset. There is no server code path that reads a key, so there is nothing to configure: each visitor pastes their own.
- **The app holds no secrets.** Every Anthropic call goes straight from the visitor's browser to Anthropic with the visitor's own key. Nothing touches your server, so there are no secret environment variables in the Railway project.
- **The two proxy routes are hardened.** `app/api/fetch-url` and `app/api/transcript` are the only server-side surface. They reject cross-origin callers and block requests to private or internal addresses. If you share the link widely, add per-IP rate limiting and a Railway usage alert first, since both routes run on your container.
- **Data is per-address.** Boards, chats, and the key live in the browser, scoped to the exact address (see "Pick one address and stick with it"). Moving to a new link, or from the Railway subdomain to a custom domain, starts fresh. Use Export and Import in Settings to carry data across.

## Things worth knowing

- It's almost all client-side. The only server code is two small Next.js routes: `app/api/transcript` (YouTube transcripts) and `app/api/fetch-url` (link previews), since the browser can't fetch those itself (CORS).
- Only one research run happens at a time. The Run button is disabled while one is streaming.
- No accounts, no sharing, no sync. Each board is a local document in one browser, scoped to the address (and port) you open. Keep using the same address so your boards stay visible (see "Pick one address and stick with it" above), and Export from Settings if you want a backup.
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

tldraw and its schema package are both pinned to 5.0.1 on purpose. The Anthropic SDK is on 0.84.0 and is called straight from the browser, so your key never touches a server.

## License

Freemind's own code is MIT (see [LICENSE](./LICENSE)). It depends on tldraw, which has its own license, not MIT. tldraw is free to use as long as the watermark stays visible; removing it, or commercial use at scale, needs a license from tldraw.
