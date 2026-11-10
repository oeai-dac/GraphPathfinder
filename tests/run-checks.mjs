// npm run check: every tests/run-*-check.mjs, each in its own Node process, with the resolve hook.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const only = process.argv[2]
const checks = readdirSync(here).filter((f) => /^run-.+-check\.mjs$/.test(f) && (!only || f.includes(only))).sort()

const failed = []
for (const file of checks) {
  const res = spawnSync(process.execPath, ['--max-old-space-size=4096', '--import', './tests/register-hooks.mjs', join('tests', file)], { cwd: root, stdio: 'inherit' })
  if (res.status !== 0) failed.push(file)
}
console.log(failed.length ? `\n${failed.length} of ${checks.length} checks failed: ${failed.join(', ')}` : `\nall ${checks.length} checks passed`)
process.exitCode = failed.length ? 1 : 0
