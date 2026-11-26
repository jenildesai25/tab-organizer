/** Light / Dark / System color theme for popup + dashboard pages. */

export type ThemeChoice = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'uiColorScheme'
export const THEME_LOCAL_KEY = 'tab-organizer-color-scheme'

function metaEl(): HTMLMetaElement | null {
  return document.querySelector('meta[name="color-scheme"]')
}

function choiceFromStored(raw: unknown): ThemeChoice {
  if (raw === 'light' || raw === 'dark') return raw
  return 'system'
}

function metaContent(choice: ThemeChoice): string {
  return choice === 'system' ? 'light dark' : choice
}

function syncToggleButtons(choice: ThemeChoice): void {
  document.querySelectorAll('.theme-toggle').forEach((group) => {
    group.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach((btn) => {
      const id = btn.getAttribute('data-theme')
      btn.setAttribute('aria-pressed', id === choice ? 'true' : 'false')
    })
  })
}

function writeLocalMirror(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_LOCAL_KEY)
    else localStorage.setItem(THEME_LOCAL_KEY, choice)
  } catch {
    /* ignore */
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const meta = metaEl()
  if (meta) meta.content = metaContent(choice)
  writeLocalMirror(choice)
  syncToggleButtons(choice)
}

export async function persistTheme(choice: ThemeChoice): Promise<void> {
  applyTheme(choice)
  if (choice === 'system') {
    await chrome.storage.local.remove(THEME_STORAGE_KEY)
  } else {
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: choice })
  }
}

export async function loadThemeChoice(): Promise<ThemeChoice> {
  try {
    const stored = await chrome.storage.local.get(THEME_STORAGE_KEY)
    return choiceFromStored(stored[THEME_STORAGE_KEY])
  } catch {
    try {
      return choiceFromStored(localStorage.getItem(THEME_LOCAL_KEY))
    } catch {
      return 'system'
    }
  }
}

/** Wire Light/Dark/System toggles; restores from chrome.storage.local. */
export async function bindThemeToggle(): Promise<void> {
  const choice = await loadThemeChoice()
  applyTheme(choice)

  document.querySelectorAll('.theme-toggle').forEach((group) => {
    group.addEventListener('click', (event) => {
      const btn = (event.target as Element | null)?.closest?.('[data-theme]')
      if (!btn || !group.contains(btn)) return
      const next = btn.getAttribute('data-theme')
      if (next === 'light' || next === 'dark' || next === 'system') {
        void persistTheme(next)
      }
    })
  })

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[THEME_STORAGE_KEY]) return
    applyTheme(choiceFromStored(changes[THEME_STORAGE_KEY].newValue))
  })
}
