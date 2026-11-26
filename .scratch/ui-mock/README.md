# Tab Organizer UI mocks (review only)

Open `index.html` in a browser (double-click or local static server).

```bash
open .scratch/ui-mock/index.html
# or
python3 -m http.server 8765 --bind 127.0.0.1 --directory .scratch/ui-mock
```

- `popup.html` — toolbar popup (~400px)
- `dashboard.html` — full-page dashboard
- Extension `src/popup` / `src/dashboard` are **not** modified

## Theme (Light / Dark / System)

- **Default:** follows the OS / browser (`prefers-color-scheme`) via `color-scheme: light dark` and CSS variables — no JS required.
- **Toggle:** header control on the dashboard and hub; compact Light / Dark / Sys on the popup.
- **Persist (mock only):** choosing Light or Dark stores `tab-organizer-mock-color-scheme` in `localStorage`. Choosing **System** clears that key so the page follows the OS again.
- Native form controls pick up the scheme via the root `color-scheme` property.

Awaiting approval before implementation.
