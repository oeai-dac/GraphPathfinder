// Builds the tool into one self-contained HTML file, the way the GraphExplorer does
// (scripts/build-standalone.mjs there): colleagues without Node.js open it by double-click.
//
// The normal Vite build gives index.html, one JS and one CSS file and no further references,
// so both can be inlined. The JS goes in as a classic <script>: type="module" fails under
// file:// because of the browser's CORS check. A classic inline script runs at once, before
// <div id="root"> exists, so the bundle is started on DOMContentLoaded — the deferral a module
// would have had. The checks below keep it that way: no module syntax, no file left behind.
//
// Usage:  npm run build:standalone
// Result: GraphPathfinder-standalone.html in the project folder (attached to releases, not committed)

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(projectRoot, 'GraphPathfinder-standalone.html')
const buildDir = mkdtempSync(join(tmpdir(), 'graphpathfinder-standalone-'))

try {
  console.log('\n  [1/3] Vite build …\n')
  execSync(`npx vite build --base=./ --outDir "${buildDir}" --emptyOutDir`, { cwd: projectRoot, stdio: 'inherit' })

  console.log('\n  [2/3] Inlining JS and CSS …')
  let html = readFileSync(join(buildDir, 'index.html'), 'utf8')
  const readAsset = (ref) => readFileSync(join(buildDir, ref.replace(/^\.?\//, '')), 'utf8')
  // "</script" inside the bundle would close the surrounding tag; "<\/" is the same in JS.
  const escapeClosingTag = (js) => js.replace(/<\/script/gi, '<\\/script')
  const inlined = []

  html = html
    .replace(/\s*<link\b[^>]*\brel="modulepreload"[^>]*>/gi, '')
    .replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi, (tag, src) => {
      if (/^https?:/i.test(src)) return tag
      const js = readAsset(src)
      // new Function() compiles without running and throws on import/export: an exact test
      // that the bundle is valid as a classic script.
      try {
        new Function(`'use strict';${js}`)
      } catch (err) {
        throw new Error(`${src} does not run as a classic <script> (${err.message}).`)
      }
      inlined.push(src)
      // Replacement *function*: in a replacement string "$&" and friends would be patterns.
      return `<script>\n(function(){'use strict';\nfunction __start(){\n${escapeClosingTag(js)}\n}\nif (document.readyState === 'loading') {\n  document.addEventListener('DOMContentLoaded', __start);\n} else {\n  __start();\n}\n})();\n</script>`
    })
    .replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/gi, (tag) => {
      const href = tag.match(/\bhref="([^"]+)"/i)?.[1]
      if (!href || /^https?:/i.test(href)) return tag
      inlined.push(href)
      return `<style>\n${readAsset(href)}\n</style>`
    })

  // Every file the build made must be the page itself or embedded in it.
  const listFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)]))
  const normalise = (p) => p.replace(/^\.?\//, '').replace(/\\/g, '/')
  const embedded = new Set(inlined.map(normalise))
  const missed = listFiles(buildDir).map((f) => normalise(relative(buildDir, f))).filter((f) => f !== 'index.html' && !embedded.has(f))
  if (missed.length) throw new Error(`The build produces files that were not embedded: ${missed.join(', ')}`)

  // Outside <script>/<style> no reference to a local file may be left.
  const shell = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script/>').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style/>')
  const leftover = shell.match(/\b(?:src|href)="(?!https?:|data:|#)[^"]*"/gi)
  if (leftover) throw new Error(`References to external files left: ${leftover.join(', ')}`)

  writeFileSync(outFile, html, 'utf8')
  console.log(`\n  [3/3] Done: GraphPathfinder-standalone.html (${(Buffer.byteLength(html, 'utf8') / 1024 / 1024).toFixed(2)} MB)\n`)
} finally {
  rmSync(buildDir, { recursive: true, force: true })
}
