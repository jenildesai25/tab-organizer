# Tab Organizer

Chrome extension (Manifest V3) that files tabs into **native Chrome tab groups** from the site, the title, and rules you write in plain language. Optionally asks a **local Ollama** model when a rule or tab is unclear.

## Demo

Short walkthrough (~30s): popup (Organize, File new tabs, Local model + model picker) then dashboard Rules, Groups, and Activity.

https://github.com/jenildesai25/tab-organizer/raw/main/docs/demo/tab-organizer-demo.mp4

<video src="docs/demo/tab-organizer-demo.mp4" controls width="720"></video>

[Download MP4](docs/demo/tab-organizer-demo.mp4) · [WebM](docs/demo/tab-organizer-demo.webm)

> **Chrome Web Store tip:** the store listing’s promotional video field expects a **YouTube URL**, not a file upload. Upload this same clip to YouTube (unlisted or public) and paste that URL into the developer dashboard. Screenshots are still required separately.

## Prerequisites

- **Chrome** or Chromium (extension APIs: tabs, tabGroups, storage)
- **Node.js** (to install deps and build)
- **Ollama** (optional) — only if you turn on Local model

## Install from source

```bash
git clone https://github.com/jenildesai25/tab-organizer.git
cd tab-organizer
npm install
npm run build
```

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select the `dist/` folder from this repo

Rebuild after code changes with `npm run build`, then click **Reload** on the extension card.

## How to use

Open the extension popup from the toolbar.

| Control | What it does |
| --- | --- |
| **Organize this window** | Sweep the current window and file tabs into groups |
| **File new tabs** | Auto-file tabs as you open them (focused window only) |
| **Local model** | When on, ask Ollama for ambiguous rules/tabs |
| **Model** dropdown | Pick an installed Ollama model |
| **Test connection** | Verify the extension can reach Ollama |
| **Rename groups with AI** | Rewrite group titles from tab titles (tabs stay put) |
| **This window** | Compact group count for the current window; open the dashboard to manage groups |
| **Rules** | Opens the dashboard Rules section |
| **Settings** | Opens the dashboard Settings section |

### Rules (dashboard)

In the dashboard, add short English rules, then **Check** and **Save**. Examples:

- `use gb for github`
- `call linear Work`
- `put github and gitlab in Code`

Rules map domains (and subdomains) into a short group title. You can also rename, recolor, or ungroup from the dashboard **Groups** panel.

### Activity (dashboard)

The **Activity** section is the full plain-language history of what the extension did (organize, auto-file, AI renames, your edits, rules). Filter by All / AI / You / Organize / Rules, scroll the full list, and clear it with confirmation when you want a fresh start.

## Ollama setup (optional)

1. Install [Ollama](https://ollama.com) and pull a model, e.g. `ollama pull llama3.2`
2. **Critical — CORS / 403:** Chrome extensions send `Origin: chrome-extension://…`. Quit any running Ollama, then start it with:

   ```bash
   OLLAMA_ORIGINS=chrome-extension://* ollama serve
   ```

   Or allow everything: `OLLAMA_ORIGINS=* ollama serve`. Without this, the extension gets **403**.
3. In the popup or dashboard, turn on **Local model**, choose a model, and hit **Test connection**.
4. Large models (e.g. `deepseek-r1:14b`) may need a warm-up load; if a call times out, wait and try again or pick a smaller model.

Nothing leaves your machine — the extension only talks to `127.0.0.1:11434` / `localhost:11434`.

## Privacy

Tab Organizer keeps browsing data on your device. The local activity log stores **site keys / domains** (and group titles), not full tab URLs.

When **Local model** is on, the extension may send a small **feature card** to Ollama on your machine only: registrable domain, a **stripped tab title**, and path words (secrets/long tokens filtered out). Titles go to local Ollama — not to any Tab Organizer server. The extension does **not** send the full page DOM, cookies, or passwords.

## Develop / test

```bash
npm test              # unit tests (vitest)
npm run build         # typecheck + bundle into dist/
npm run test:browser  # Puppeteer smoke against a built extension
npm run check         # TypeScript only
npm run package:cws   # zip dist/ → release/tab-organizer-v*.zip
node scripts/record-demo.mjs  # regenerate docs/demo video (needs build)
```

## Chrome Web Store

Listing copy, permission justifications, and the human registration checklist live in [`CHROMEWEBSTORE.md`](CHROMEWEBSTORE.md). Package for upload: `release/tab-organizer-v0.3.21.zip` (from `npm run package:cws`).
