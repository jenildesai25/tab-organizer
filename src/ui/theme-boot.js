/* Sync FOUC guard: classic script in <head>, no defer/module.
   Mirrors chrome.storage.local via localStorage key written by theme.ts */
try {
  var meta = document.querySelector('meta[name="color-scheme"]')
  if (meta) {
    meta.content = localStorage.getItem('tab-organizer-color-scheme') || 'light dark'
  }
} catch (_) {
  /* ignore private-mode / blocked storage */
}
