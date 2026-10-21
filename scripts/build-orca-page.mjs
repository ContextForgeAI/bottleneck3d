// Builds the web app and inlines it into one HTML file for the Orca plugin tab:
// Orca loads plugin pages as raw HTML, so external /assets/* URLs cannot resolve.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'dist-orca')
const target = join(root, 'orca-plugin', 'src', 'bottleneck3d_orca', 'web', 'index.html')

await build({ root, logLevel: 'warn', build: { outDir, emptyOutDir: true } })

let html = await readFile(join(outDir, 'index.html'), 'utf8')
const asset = (href) => readFile(join(outDir, href.replace(/^\//, '')), 'utf8')

for (const [tag, src] of [...html.matchAll(/<script type="module" crossorigin src="([^"]+)"><\/script>/g)]) {
  const js = (await asset(src)).replace(/<\/script/gi, '<\\/script')
  html = html.replace(tag, () => `<script type="module">${js}</script>`)
}
for (const [tag, href] of [...html.matchAll(/<link rel="stylesheet" crossorigin href="([^"]+)">/g)]) {
  const css = await asset(href)
  html = html.replace(tag, () => `<style>${css}</style>`)
}

if (/(src|href)="\/assets\//.test(html)) throw new Error('Unresolved asset left in the page')

await mkdir(dirname(target), { recursive: true })
await writeFile(target, html, 'utf8')
await rm(outDir, { recursive: true, force: true })
console.log(`Orca page: ${target} (${(html.length / 1024).toFixed(0)} KB)`)
