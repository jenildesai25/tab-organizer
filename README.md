# Tab Organizer

Chrome extension (Manifest V3) that files tabs into **native Chrome tab groups** from the site, the title, and rules you write in plain language. Optionally asks a **local Ollama** model when a rule or tab is unclear.

## Demo

Short walkthrough (~25s): popup (**Organize this window**, Auto-group new tabs, Local model) then dashboard **Groups** and **Activity**.

https://github.com/user-attachments/assets/ae3ac628-2e04-415c-a2ce-bc2baf9e26d9

Local source files: [`docs/demo/tab-organizer-demo.mp4`](docs/demo/tab-organizer-demo.mp4) (also `.webm`, poster JPG). Regenerate with `npm run build && npm run record:demo`.

## Features

- **Organize this window** — One click files every tab in the current window into Chrome tab groups.
- **Auto-group new tabs** — When you open a tab, Tab Organizer waits for the page to settle, then creates a group or joins an existing one, and reveals it when useful.
- **Moves with you** — If you navigate from one site to another (for example Google search → WhatsApp), the tab leaves the old group and lands in the right one.
- **Free up memory** — Optionally unload idle tabs with Chrome’s native `tabs.discard` (saves RAM; groups stay intact). Manual free/reload from the popup; optional never-list in Settings.
- **Plain-English rules** — Write short rules like “call linear Work” so sites get the group names you want (see [Rules](#rules-dashboard)).
- **Local model (optional)** — Turn on Ollama on your machine when a rule or tab is unclear. Nothing is sent to a Tab Organizer server.
- **AI rename groups** — Rewrite group titles from the tabs inside them; tabs stay where they are.
- **Dashboard Groups** — Rename, recolor, or ungroup from the Groups panel.
- **Activity log** — Plain-language history of organizes, auto-files, memory frees, AI renames, your edits, and rules. Filter and clear anytime.
- **Theme** — Light, dark, or match the system.
- **Privacy-first** — Feature cards stay local; activity stores site keys / domains, not full URLs. See [Privacy](#privacy).

## Prerequisites

- **Chrome** or Chromium (extension APIs: tabs, tabGroups, storage, alarms)
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
| **Auto-group new tabs** | When you open a tab, put it in a group (this window only) |
| **Local model** | When on, ask Ollama for ambiguous rules/tabs |
| **Model** dropdown | Pick an installed Ollama model |
| **Test connection** | Verify the extension can reach Ollama |
| **Rename groups with AI** | Rewrite group titles from tab titles (tabs stay put) |
| **Free up memory** | Auto-unload idle tabs; set idle minutes; free or reload the current tab |
| **This window** | Compact group count for the current window; open the dashboard to manage groups |
| **Rules** | Opens the dashboard Rules section |
| **Settings** | Opens the dashboard Settings section (never-list and memory controls) |

### Free up memory

Tab Organizer can free RAM with Chrome’s built-in tab discard (no placeholder page). Groups and filing keep working on discarded tabs.

1. In the popup, open **Free up memory**.
2. Turn on **Auto-unload idle tabs** and set **Unload after idle** (default 30 minutes; range 5–180).
3. Optional: in dashboard **Settings**, add sites to **Never unload these sites** (one domain per line), then **Save never-list**.
4. **Free this tab** unloads the active tab now; **Reload tab** restores it.
5. Auto-unload skips the active tab, pinned tabs, audible/playing tabs, `chrome://` and non-http(s) pages, already unloaded tabs, and never-list domains.
6. Activity shows lines like “freed memory on a example.com tab”.

### Rules (dashboard)

Rules tell Tab Organizer **what to name the Chrome tab group** for certain sites. Without a rule, a site often gets a default name (for example, Linear tabs might land in a group called “Linear”). With a rule, you pick the name.

In the dashboard, add a short English rule, then **Check** and **Save**.

| You write | Matches | Group name | In other words |
| --- | --- | --- | --- |
| `use gb for github` | Tabs from github.com | **gb** | GitHub tabs go in a group named gb. |
| `call linear Work` | Tabs from Linear | **Work** | Linear tabs go in a group named Work (not “Linear”). |
| `put github and gitlab in Code` | Tabs from GitHub and GitLab | **Code** | Both sites share one group named Code. |

You can also rename, recolor, or ungroup from the dashboard **Groups** panel.

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
node scripts/record-demo.mjs  # regenerate docs/demo video (needs build)
```
