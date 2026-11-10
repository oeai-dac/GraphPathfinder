// The vendored OntoGraphNavigator core (src/core/) is unchanged since `npm run sync-core`.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { done, ok, section } from './check.mjs'

const dir = new URL('../src/core/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('VENDORED.json', dir), 'utf8'))

section(`src/core from ${manifest.source} ${manifest.version} (${manifest.commit})`)
ok(!manifest.commit.includes('uncommitted'), 'copied from a committed state of the OntoGraphNavigator')
for (const [file, sum] of Object.entries(manifest.files)) {
  const actual = createHash('sha256').update(readFileSync(new URL(file, dir))).digest('hex')
  ok(actual === sum, `${file} was changed by hand — change the OntoGraphNavigator and run npm run sync-core`)
}
const present = readdirSync(dir).filter((f) => f !== 'VENDORED.json')
for (const f of present) ok(f in manifest.files, `${f} is in src/core but not in VENDORED.json`)

done('vendored core')
