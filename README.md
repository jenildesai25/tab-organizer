# Tab Organizer

Chrome extension (Manifest V3) that files tabs into **native Chrome tab groups** from the site, the title, and rules you write in plain language. Optionally asks a **local Ollama** model when a rule or tab is unclear.

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
| **Recent activity** | Short log of recent group changes |
| **Rules & more** | Opens the dashboard |

### Rules (dashboard)

In the dashboard, add short English rules, then **Check** and **Save**. Examples:

- `use gb for github`
- `call linear Work`
- `put github and gitlab in Code`

Rules map domains (and subdomains) into a short group title. You can also rename, recolor, or ungroup from the dashboard **Groups** panel, and filter/clear the **Activity** log.

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

When the local model is used, the extension sends **feature-card metadata only**: registrable domain, a stripped tab title, and path words (secrets/long tokens filtered out). It does **not** send the full page DOM, cookies, or passwords.

## Develop / test

```bash
npm test              # unit tests (vitest)
npm run build         # typecheck + bundle into dist/
npm run test:browser  # Puppeteer smoke against a built extension
npm run check         # TypeScript only
```
