# Great Suspender — clean-room replication plan (MIT Tab Organizer)

**Purpose:** Architecture and behavior notes so Tab Organizer can replicate *features* without copying GPL code.  
**Sources:** REA static analysis of `/Users/jenil/Downloads/Great Suspender.zip`, plus public site/repo license text.  
**Constraint:** Do **not** import, paste, or derive code from the extracted extension into this MIT repo.

---

## Evidence ledger (REA)

| Step | Evidence ID | Notes |
|------|-------------|--------|
| ZIP inspect | `ev_4b15793631044e3816990a9f562680f528a7d3bf964342c0fd9c7942cbf5d713` | `inspect_artifact`; root sha256 `4ce08c656d28ea68a87e9110cb2e71d93aae72be6cb068849332b5ce316835b6`; graph `agm_70d6d5a62facf6fb7972adb744f2fe2b3f6d9782a0ce0a0c8a6e770d06ee0b98` (81 nodes) |
| Inventory substep | `ev_d9d4bf20537f1c7a78a4cf31db0838ee0ae1cd17e9ce1710ccd2fcfd36d0675a` | Nested under inspect |
| Extract | `ev_a505a02c68a9c41cceeb10772a778cd631520bb863f9f39cfdd43e5b69077969` | Materialized under REA temp dir; copy kept only under `.scratch/` (gitignored) |
| JS analyze | `ev_d41566c11a831bc8396500895f327b3e7344c0897edf2259e8c2f64e55358624` | Directory root sha256 `6aa33603e0d8d9acd27d3be24d5aac2ffeeb3f4c7d33a5f1991f04455b733245`; 26 JS files parsed; 3 parse failures; static only |

**Session note:** Live MCP `rea` discovery failed on Node 25; analysis used REA CLI 4.0.1 under Node 24.22.3 (doctor-healthy for Node/Hopper). That is tooling environment, not product behavior.

**Public (non-REA):** [greatsuspender.com](https://www.greatsuspender.com/) marketing claims; upstream [LICENSE](https://raw.githubusercontent.com/greatsuspender/thegreatsuspender/master/LICENSE) is GPL-2.0.

---

## Inventory (observations vs inferences vs unknowns)

### Package identity

| Claim | Class | Evidence |
|-------|-------|----------|
| Archive is a Chrome unpacked-extension zip under folder `jaekigmcljkkalnicnjoafgfjoefkpeg/` | **Observation** | ZIP listing + inspect occurrences |
| Locale name string: “The Great Suspender” | **Observation** | `_locales/en/messages.json` |
| Version `7.0.109` | **Observation** | `manifest.json` |
| Manifest **V2**, persistent background page, `browser_action`, host permissions `http(s)://*/*` | **Observation** | `manifest.json` |
| No `LICENSE` / GPL text inside this zip | **Observation** | Full-tree search in extract |
| Upstream project is GPL-2.0 | **Inference** (external) | GitHub LICENSE fetch; treat zip as GPL-encumbered *source* for clean-room purposes |
| Folder id equals a specific CWS listing identity for this build | **Unknown** | Not verified against store metadata in this pass |

### How “suspend” works (core architecture)

**Observation:** Primary path is **not** Chrome’s discard-only model. Default path replaces the tab URL with an extension page:

1. Content script arms a **per-tab `setTimeout`** from `suspendTime` (minutes → ms).
2. On fire → `runtime.sendMessage({ action: 'suspendTab' })`.
3. Background queues work (`gsSuspendManager`), re-checks eligibility, builds  
   `chrome-extension://<id>/suspended.html#ttl=…&pos=…&uri=<originalUrl>`.
4. Prefer content-script `location.replace(suspendedUrl)` (`confirmTabSuspend`); on failure → `chrome.tabs.update({ url: suspendedUrl })`.
5. Optional preview capture (`html2canvas` / screen-capture settings) before navigation.
6. Unsuspend restores the `uri` from the hash (click / message / reload flag).

**Observation:** `chrome.tabs.discard` is also present as **modes**, not the default:

| Setting key (storage) | Default | Behavior (static) |
|----------------------|---------|-------------------|
| `discardInPlaceOfSuspend` | `false` | Skip suspended page; call `tabs.discard` |
| `discardAfterSuspend` | `false` | After suspended page loads, discard inactive suspended tabs |
| `suspendInPlaceOfDiscard` | `true` | When Chrome marks a tab discarded, queue a real suspend instead |

**Inference:** Product “suspend” ≈ park original URL on a placeholder page (memory release by unloading the site), with discard as an optional Chrome-native complement.

**Unknown (runtime):** Exact memory savings vs discard-only; whether MV3 service-worker lifetimes break the content-script timer model without redesign.

### Alarms / scheduling

| Claim | Class | Evidence |
|-------|-------|----------|
| No `chrome.alarms` usage in extension JS (excluding vendor noise) | **Observation** | Repo-wide API inventory |
| Idle scheduling = content-script `setTimeout` + background queue `setTimeout`s | **Observation** | `contentscript.js`, `gsSuspendManager.js`, REA timer nodes |
| Default idle: `gsTimeToSuspend` = `'60'` (minutes) | **Observation** | `gsStorage` defaults |

**Inference for Tab Organizer (MV3):** Do **not** copy the CS-timer design; use `chrome.alarms` + `Tab.lastAccessed` (or equivalent) so a service worker can wake periodically.

### Whitelist / skip rules

**Observation — persistent whitelist:** storage key `gsWhitelist` (newline/space-separated items); matchers support substring or `/regex/` form.

**Observation — soft skips (settings):** pinned, audible, active tab, form input (content-script keydown heuristic), offline (`navigator.onLine`), charging (`navigator.getBattery`), special/chrome URLs, already-suspended.

**Observation — temporary whitelist:** in-memory / message-driven tab flag (`tempWhitelist`), not only the string list.

**Observation — force levels (queue):** 1 = aggressive; 2 = respect whitelist/forms/pinned/audio/active; 3 = also offline/battery.

### Settings keys (sync + local)

Observed logical keys ↔ storage strings (defaults in parentheses):

- `screenCapture` (`'0'`), `screenCaptureForce` (false)
- `suspendInPlaceOfDiscard` (true), `discardInPlaceOfSuspend` (false), `discardAfterSuspend` (false)
- `onlineCheck` / `batteryCheck` (false), `gsUnsuspendOnFocus` (false)
- `gsDontSuspendPinned` (true), `gsDontSuspendForms` (true), `gsDontSuspendAudio` (true), `gsDontSuspendActiveTabs` (true)
- `gsIgnoreCache` (false), `gsAddContextMenu` (true), `gsSyncSettings` (true)
- `gsTimeToSuspend` (`'60'`), `gsNoNag` (false), `gsWhitelist` (`''`), `gsTheme` (`'light'`)

Also IndexedDB namespaces for previews, suspended tab info, current/saved sessions (`tgs` DB) — **observation** of store names; schema details **partially unknown** without deeper db.js tracing.

### Message flow (literal `action` strings)

**Observation:**

| Action | Direction (static) |
|--------|--------------------|
| `initialiseContentScript` | BG → CS |
| `requestInfo` | BG → CS |
| `confirmTabSuspend` | BG → CS (then `location.replace`) |
| `suspendTab` | CS → BG |
| `reportTabState` | CS → BG |
| `savePreviewData` | (preview path) → BG |
| `unsuspendTab`, `tempWhitelist`, `disableUnsuspendOnReload`, `showNoConnectivityMessage`, `reloadOptions`, `ping` | page/BG messaging |

Listeners: `runtime.onMessage` in background; CS `onMessage`; suspended page handles unsuspend actions.

### Site marketing vs zip

**Observation (site):** idle auto-suspend, whitelist, optional screenshot, audio/form protection, offline/battery behavior, open-source transparency.  
**Aligned with zip:** yes for those bullets (static).  
**Unknown:** whether the zip is bit-identical to any published GitHub tag.

---

## Clean-room feature checklist → Chrome APIs (MIT Tab Organizer)

Design **new** MIT code. Prefer MV3-native primitives. Map *behaviors*, not filenames.

| # | Feature (behavior) | Recommended Chrome APIs | Notes for Tab Organizer |
|---|--------------------|-------------------------|-------------------------|
| 1 | Auto-park idle background tabs | `chrome.alarms`, `chrome.tabs.query`, `tabs.discard` and/or navigate to extension park page | Phase-1 can be **discard-only** (simpler, no park HTML). Park-page is optional later. |
| 2 | Configurable idle minutes | `chrome.storage.sync` / `local` | Own key names; do not reuse `gs*` keys. |
| 3 | Never-list (domains) | `storage` + site-key helper already in Tab Organizer | Prefer registrable-domain keys over freeform substring/regex unless product asks. |
| 4 | Skip active / pinned / audible | `tabs` fields `active`, `pinned`, `audible` | Matches GS skip *ideas*; implement independently. |
| 5 | Skip form editing | **Hard on MV3** without broad content scripts | Options: omit v1; or limited CS; or heuristics only. GS uses CS keydown — do not copy. |
| 6 | Skip when offline / on AC power | `navigator.onLine`, Battery Status API in SW/offscreen if available | Optional; test SW support. |
| 7 | Manual suspend / unsuspend | `commands`, `action` popup, `contextMenus`, `tabs.discard` / `tabs.reload` | Unsuspend for discard = reload/activate. |
| 8 | Suspended placeholder page + title/favicon/preview | `tabs.update` to `chrome-extension://…/parked.html#…`, `web_accessible_resources` | Only if discard UX is insufficient. Hash-encoded original URL is a common pattern — reinvent encoding. |
| 9 | Optional screenshot before park | `chrome.tabs.captureVisibleTab` (active tab only) or offscreen document | `html2canvas` approach is heavy and GPL-adjacent vendor; avoid. |
| 10 | Session history / recovery | `storage` / IndexedDB + `tabs`/`windows` snapshot | Separate feature; not required for MVP suspend. |
| 11 | Sync settings across devices | `chrome.storage.sync` | Keep payload small. |
| 12 | Icon state by tab status | `action.setIcon` / `setBadgeText` | Optional polish. |

### Suggested phased build (clean-room)

1. **MVP (aligns with discard-first):** alarm sweep → eligibility (idle via `lastAccessed`, never-list, skip active/pinned/audible) → `tabs.discard`. No content script. No GPL artifacts.
2. **Controls:** popup toggle, idle minutes, never-list, keyboard command.
3. **Optional park page:** only if users need title/preview while discarded tabs are confusing.
4. **Advanced skips:** form/audio edge cases, battery/offline — after MVP metrics.

### Explicit non-goals (license / product)

- Do not vendor `background.js` / `gs*.js` / `suspended.js` / options HTML from the zip.
- Do not depend on Manifest V2 persistent pages.
- Do not add Google Analytics / `html2canvas` from that tree.
- Do not claim “based on The Great Suspender” in a way that implies a GPL derivative.

---

## Architecture sketch (behavior, clean-room)

```text
[MV3 service worker]
  chrome.alarms (periodic)
       │
       ▼
  query tabs → score eligibility (own pure functions)
       │
       ├─ discard path ──► chrome.tabs.discard(id)
       └─ (optional) park path ──► tabs.update → parked.html#uri=…

[popup / commands / contextMenus] ──messages──► service worker

[optional content script] ── only if form-guard is product-required
```

Contrast (GS MV2, observed): per-tab CS timers + persistent BG queue + URL replace to `suspended.html`, with discard as setting overlays.

---

## Checklist status

| Question | Status |
|----------|--------|
| License posture | **Answered** — no LICENSE in zip; upstream GPL-2.0; treat as unclean for copying |
| MV2 vs MV3 | **Answered** — zip is MV2 |
| Suspend vs discard | **Answered** — default URL-park; discard optional |
| Alarms | **Answered** — none; CS/BG timeouts |
| Whitelist | **Answered** — string list + temp flags + skip toggles |
| Settings keys | **Answered** — listed above |
| Message flow | **Answered** — action table above |
| Runtime confirmation in Chrome | **Unresolved** — static only |
| Bit-identity vs GitHub tag / malware history of forks | **Unresolved** |

---

## Reproduce analysis (tooling)

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
npx -y rea-agents@4.0.1 inspect-artifact "/Users/jenil/Downloads/Great Suspender.zip" --format json
npx -y rea-agents@4.0.1 extract-artifact "/Users/jenil/Downloads/Great Suspender.zip" --format json
# then analyze-javascript-application on the extracted extension directory
```

Keep extracts under `.scratch/` only. Never commit GPL sources into this repository.
