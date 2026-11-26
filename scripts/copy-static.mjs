import { cpSync, mkdirSync } from 'node:fs'

mkdirSync('dist/popup', { recursive: true })
mkdirSync('dist/dashboard', { recursive: true })
mkdirSync('dist/ui', { recursive: true })
cpSync('manifest.json', 'dist/manifest.json')
cpSync('icons', 'dist/icons', { recursive: true })
cpSync('fonts', 'dist/fonts', { recursive: true })
cpSync('src/ui/shared.css', 'dist/ui/shared.css')
cpSync('src/ui/theme-boot.js', 'dist/ui/theme-boot.js')
cpSync('src/popup/popup.html', 'dist/popup/popup.html')
cpSync('src/popup/popup.css', 'dist/popup/popup.css')
cpSync('src/dashboard/index.html', 'dist/dashboard/index.html')
cpSync('src/dashboard/dashboard.css', 'dist/dashboard/dashboard.css')
