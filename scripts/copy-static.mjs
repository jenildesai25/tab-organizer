import { cpSync, mkdirSync } from 'node:fs'

mkdirSync('dist/popup', { recursive: true })
mkdirSync('dist/dashboard', { recursive: true })
cpSync('manifest.json', 'dist/manifest.json')
cpSync('src/popup/popup.html', 'dist/popup/popup.html')
cpSync('src/popup/popup.css', 'dist/popup/popup.css')
cpSync('src/dashboard/index.html', 'dist/dashboard/index.html')
cpSync('src/dashboard/dashboard.css', 'dist/dashboard/dashboard.css')
