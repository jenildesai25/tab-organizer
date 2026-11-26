import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import * as esbuild from 'esbuild'

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist/popup', { recursive: true })
mkdirSync('dist/dashboard', { recursive: true })

await esbuild.build({
  entryPoints: ['src/background.ts', 'src/popup/popup.ts', 'src/dashboard/dashboard.ts'],
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outdir: 'dist',
  outbase: 'src',
  legalComments: 'none',
})

cpSync('manifest.json', 'dist/manifest.json')
cpSync('src/popup/popup.html', 'dist/popup/popup.html')
cpSync('src/popup/popup.css', 'dist/popup/popup.css')
cpSync('src/dashboard/index.html', 'dist/dashboard/index.html')
cpSync('src/dashboard/dashboard.css', 'dist/dashboard/dashboard.css')

const bundled = ['dist/background.js', 'dist/popup/popup.js', 'dist/dashboard/dashboard.js']
for (const name of bundled) {
  const source = readFileSync(name, 'utf8')
  if (source.includes('from "tldts"') || source.includes("from 'tldts'")) {
    console.error(`${name} still imports tldts as a bare module`)
    process.exit(1)
  }
}
