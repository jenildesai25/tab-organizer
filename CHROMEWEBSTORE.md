# Chrome Web Store Listing — Tab Organizer

> Last Updated: 2026-11-26
>
> Listing copy updated for **0.4.12** (organize all windows, clean-up + undo,
> Protect presets, quiet hours, layouts, backup, onboarding). Package with
> `npm run build && npm run package:cws`. **You** still must host the privacy
> policy, add screenshots, and click Submit — this agent does not submit for you.

## Store Listing

**Extension Name** [REQUIRED]

Tab Organizer

**Short Description** [REQUIRED]
<!-- Max 132 characters. Matches manifest.json description (87 chars). -->

Files tabs into groups from the site, the title, and rules you write in plain language.

**Detailed Description** [REQUIRED]
<!-- Plain text for CWS (no markdown). Copy-paste below. -->

```
Tab Organizer files your open tabs into native Chrome tab groups using the site, the tab title, and short rules you write in plain English.

FEATURES
• Organize — files the current window; All windows for every normal window
• Auto-group new tabs — focused window only; optional Quiet hours; Don’t touch this window
• Plain-language rules — e.g. “use gb for github”; suggestions after you rename a site group by hand
• Saved layouts — re-apply named groups to matching open tabs
• Clean up old tabs — optional; preview and confirm; Undo for about 10 minutes; Protect lists and presets (Mail, Calendar, Banking, Shopping)
• Group management — rename, recolor, or ungroup from the dashboard
• Backup — export or import settings as a local JSON file
• Activity history — local plain-language log (domains / site keys, not full URLs)
• Optional local model — Ollama on your machine only; nothing sent to our servers

HOW TO USE
1. Click the Tab Organizer icon in the toolbar
2. Click Organize (or All windows), or turn on Auto-group new tabs
3. Open the dashboard for Rules, Protect, Clean up, layouts, and Backup
4. (Optional) Install Ollama locally, turn on Local model, pick a model, and Test connection

PRIVACY
Tab Organizer keeps your data on your device. Settings and activity history stay in Chrome local storage. Activity entries use site keys / domains and group titles — not full tab URLs. A short-lived clean-up undo may keep http(s) URLs in session storage for about 10 minutes. There is no Tab Organizer remote server. If you enable Local model, a small feature card is sent only to Ollama on localhost — never to us.

PERMISSIONS
• Tabs — read tab URLs and titles so tabs can be filed into the right groups
• Tab groups — create and update Chrome’s native tab groups
• Storage — save your rules, settings, and local activity history on this device
• Alarms — optional hourly clean-up of old tabs when you turn that feature on
• Access to 127.0.0.1:11434 and localhost:11434 — only so the optional Local model can talk to Ollama on your machine

SUPPORT
Questions or bugs: https://github.com/jenildesai25/tab-organizer/issues
Email: jenil.desai25@gmail.com

Version 0.4.13 — adds keyboard shortcuts (Organize, Protect site, open dashboard).
```

**Category** [REQUIRED]

Productivity

**Single Purpose** [REQUIRED]

Files browser tabs into native Chrome tab groups using the site, tab title, and user-written plain-language rules.

**Primary Language** [REQUIRED]

English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon-128.png` (also in package) |
| Extension icons | 16 / 48 / 128 | ✅ Ready | `icons/icon-16.png`, `icon-48.png`, `icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Not created | Capture popup: Organize + Auto-group new tabs |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | Dashboard Rules with example rules |
| Screenshot 3 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | Groups panel or Activity history |
| Promotional video [OPTIONAL] | YouTube URL | ✅ Clip ready | `docs/demo/tab-organizer-demo.mp4` (~30s) — **upload to YouTube**, paste URL in CWS (CWS does not accept a video file) |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

### Screenshot Notes

CWS requires at least one screenshot at **1280×800** or **640×400**. Suggested shots:

1. **Popup** — Organize / All windows, Auto-group, Don’t touch this window.
2. **Dashboard → Rules** — saved rules and a suggestion after hand rename (e.g. “use gb for github”).
3. **Dashboard → Settings** — Clean up / Protect presets, or Groups with a saved layout.

Reference UI from local mocks under `.scratch/ui-mock/shots/` (not store-sized; resize or re-capture before upload). Do not upload annotated “proof” crops.

## Permissions Justification

Paste each justification into the corresponding field in the Developer Dashboard.

| Permission | Type | Justification |
|------------|------|---------------|
| `tabs` | permissions | Needed to read each tab’s URL and title so the extension can decide which Chrome tab group the tab belongs in, run Organize this window / Auto-group new tabs, and record a local activity entry when a tab is filed. |
| `tabGroups` | permissions | Needed to create, rename, recolor, and update Chrome’s native tab groups when organizing tabs or when you edit groups from the dashboard. |
| `storage` | permissions | Needed to save your grouping rules, on/off settings (including optional Local model choice), theme preference, Protect lists, layouts, and a local activity history on this device only (`chrome.storage.local` / session for short-lived undo). |
| `alarms` | permissions | Needed only when you enable Clean up old tabs automatically, so Chrome can wake the service worker hourly to scan for unused tabs. |
| `http://127.0.0.1:11434/*` | host_permissions | Optional Local model feature only. Lets the extension call Ollama running on your machine at 127.0.0.1:11434 (list models, test connection, ask for help on ambiguous rules/tabs). No remote Tab Organizer server. |
| `http://localhost:11434/*` | host_permissions | Same as above for the `localhost` hostname alias some Ollama installs use. Scoped to port 11434 only. |

### Permission justification text (copy-paste blocks)

**tabs**

```
Needed to read each tab’s URL and title so Tab Organizer can file tabs into the correct Chrome tab groups (Organize this window / Auto-group new tabs) and keep a local activity history of filings. The extension does not inject scripts into pages or read page content beyond tab metadata Chrome provides. Activity history stores site keys / domains, not full tab URLs.
```

**tabGroups**

```
Needed to create and update Chrome’s native tab groups—assigning tabs into groups and renaming/recoloring groups from the popup and dashboard. Without tabGroups, the extension cannot fulfill its single purpose of filing tabs into native groups.
```

**storage**

```
Needed to store your rules, organizer/Local model settings, Protect lists, layouts, theme preference, and a capped local activity log on this device using Chrome local storage. Short-lived clean-up undo uses session storage. Data is not synced to our servers; we do not operate a remote backend for this extension.
```

**alarms**

```
Needed only when you turn on Clean up old tabs automatically. Schedules an hourly Chrome alarm so the extension can scan for unused tabs in the background. No network calls are made by this permission.
```

**http://127.0.0.1:11434/***

```
Used only when you enable Local model. Allows requests to Ollama on this machine (127.0.0.1:11434) to list models, test the connection, and optionally send a small feature card (domain, stripped title, path words) for ambiguous rules or tabs. No data is sent to Tab Organizer servers.
```

**http://localhost:11434/***

```
Same optional Local model access as 127.0.0.1, for installs that expose Ollama as localhost:11434. Limited to that host and port; not used for general web browsing.
```

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes — locally on the device for core features. No remote Tab Organizer collection.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | No | No | — | No |
| Personal communications | No | No | — | No |
| Location | No | No | — | No |
| Web history | Yes (tab URLs/titles read in memory to organize; activity keeps site keys only) | No (stays on device; optional localhost Ollama only) | File tabs into groups; local activity log | No |
| User activity | Yes (extension action log; domains / group titles, not full URLs) | No | Show Activity history in dashboard | No |
| Website content | No full page content; optional stripped title/path words to local Ollama only | No off-device remote server | Optional Local model disambiguation | No |

### Security notes (0.3.21)

- Extension messages are accepted only from this extension (`sender.id === chrome.runtime.id`); other extensions are ignored.
- Activity log never persists `tabUrl`; legacy rows are stripped on read. Stored fields use `siteKey` / domain.
- Production client responses omit sweep-diag URL samples; user-visible diag uses hostnames/counts only.

### Chrome Web Store privacy practices form (suggested answers)

- **Single purpose:** Files browser tabs into native Chrome tab groups using the site, tab title, and user-written plain-language rules.
- **Remote code:** No (all JS bundled in the package).
- **Data usage:** Not sold; used only for extension functionality; not used for creditworthiness.
- **Host remote / certify:** Local-only storage; optional user-run Ollama on localhost is not a Tab Organizer server.

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED — host before submit]

Draft in-repo: [`docs/privacy-policy.md`](docs/privacy-policy.md)

Host options (pick one, then paste the live URL here):

1. GitHub Pages from this repo / `docs/`
2. Raw or rendered GitHub URL for `docs/privacy-policy.md` (prefer a stable Pages URL for review)
3. A public gist of the same text

**Live URL:** _[FILL AFTER HOSTING — leave blank until live]_

## Distribution

**Visibility**: Public  
**Regions**: All regions  

## Developer Info

**Publisher Name** [REQUIRED]

Jenil Desai

**Contact Email** [REQUIRED]

jenil.desai25@gmail.com

**Support URL / Email** [RECOMMENDED]

https://github.com/jenildesai25/tab-organizer/issues

**Homepage URL** [RECOMMENDED]

https://github.com/jenildesai25/tab-organizer

## Package

| Item | Value |
|------|--------|
| Manifest version | 3 |
| Extension version | 0.3.21 |
| Build | `npm run build` → `dist/` |
| Store ZIP | `release/tab-organizer-v0.3.21.zip` (from `dist/` only) |
| Regenerate | `npm run package:cws` |
| Icons in ZIP | 16×16, 32×32, 48×48, 128×128 PNG |

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.3.21 | 2026-11-26 | Security: sender check; no `tabUrl` in activity; redact/omit sweep samples. Store package ready. | Ready to upload — human submit |
| 0.3.20 | 2026-11-25 | Store package + listing prep (blocked on security). | Superseded |

## Review Notes

### Known Issues / Limitations

- Optional Ollama requires the user to set `OLLAMA_ORIGINS` so Chrome extension origins are allowed; otherwise Local model shows 403.
- Store screenshots still need to be captured at required sizes before first submission.
- Privacy policy must be hosted at a public URL before submit.

### Pre-submit gate

- [x] Security findings addressed (PR #3 / 0.3.21)
- [x] `npm run package:cws` for 0.3.21
- [ ] Privacy policy URL live and pasted into dashboard
- [ ] ≥1 screenshot at 1280×800 or 640×400 uploaded
- [ ] Permission justifications pasted from this file
- [ ] Privacy practices form matches this file
- [ ] Manual smoke: load ZIP unpacked (or load `dist/`), Organize this window, Rules, Local model off/on

### Rejection History

_None yet — not submitted._

## Human registration checklist

See also: `scripts/publish-cws-wizard.sh` (`npm run publish:wizard`).

1. **Chrome Web Store developer account** — [https://chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole) → one-time **$5** registration fee (Google payments).
2. **Enable 2-Step Verification** on the Google account used for the developer console (required).
3. **Host privacy policy** — publish `docs/privacy-policy.md` (GitHub Pages or equivalent) and keep the live URL.
4. **Screenshots** — at least one **1280×800** or **640×400** PNG showing the extension in use (popup and/or dashboard). Still required even if you add a video.
5. **(Optional) Promotional video** — upload `docs/demo/tab-organizer-demo.mp4` to **YouTube**, then paste the **YouTube URL** into the CWS listing (the store does not accept a video file upload).
6. **New item** → Upload package `release/tab-organizer-v0.3.21.zip` (regenerate with `npm run package:cws` if needed).
7. **Store listing** — paste Short / Detailed descriptions, category **Productivity**, and single purpose from this file.
8. **Privacy practices** — single purpose + data use as above; link the live privacy policy URL.
9. **Permission justifications** — paste the copy-paste blocks above for `tabs`, `tabGroups`, `storage`, and the two localhost Ollama host permissions.
10. **Manual smoke** — load the ZIP unpacked (or `dist/`), run Organize this window, open Rules, toggle Local model off/on.
11. **Submit for review** when listing, screenshots, and privacy URL are complete.
