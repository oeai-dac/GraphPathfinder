#!/usr/bin/env node
/**
 * Bring the copy of the OntoGraphNavigator's graph core up to date.
 *
 *   npm run sync-core                            # from ../OntoGraphNavigator
 *   npm run sync-core -- --from D:/repos/OntoGraphNavigator
 *
 * This tool never builds a graph itself. It writes a Studio project file and lets the
 * OntoGraphNavigator's own code turn it into Graph JSON, so "Explore" here gives exactly
 * what the OntoGraphNavigator makes of the same project — slugs, Dot-One keys and type
 * keys included. The code is copied, not shared: whoever downloads this tool gets one
 * repository. The price is this script, never an edit to the copy (as with the views
 * the OntoGraphNavigator takes from the GraphExplorer).
 *
 * What it does: replaces src/core/ with the listed files of the OntoGraphNavigator's
 * src/lib/, writes src/core/VENDORED.json (version, commit, a checksum per file) and
 * reports imports the copy would need that are not part of it.
 * tests/run-core-check.mjs then reports any file of the copy that no longer matches.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The part of src/lib/ that turns a project file into Graph JSON. Nothing here imports
// React, the store or the views.
const FILES = ['projectFile.js', 'materialize.js', 'graphJson.js', 'schema.js', 'keys.js', 'prefixes.js', 'languages.js']

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const fromArg = args.indexOf('--from')
const source = path.resolve(fromArg >= 0 ? args[fromArg + 1] : path.join(root, '..', 'OntoGraphNavigator'))
const sourceLib = path.join(source, 'src', 'lib')
const target = path.join(root, 'src', 'core')

if (!fs.existsSync(path.join(sourceLib, 'materialize.js'))) {
  console.error(`No OntoGraphNavigator at ${source}. Pass --from <path to the OntoGraphNavigator>.`)
  process.exit(2)
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { cwd: source, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })
const checksums = {}
for (const name of FILES) {
  fs.copyFileSync(path.join(sourceLib, name), path.join(target, name))
  checksums[name] = sha256(path.join(target, name))
}

const sourcePackage = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
const commit = git('rev-parse --short HEAD')
const uncommitted = git(`status --porcelain -- ${FILES.map((f) => `src/lib/${f}`).join(' ')}`)
const manifest = {
  note: 'A copy of part of the OntoGraphNavigator\'s src/lib. Do not edit — change the OntoGraphNavigator and run `npm run sync-core`.',
  source: 'OntoGraphNavigator',
  version: sourcePackage.version,
  commit: commit ? `${commit}${uncommitted ? ' + uncommitted changes' : ''}` : 'unknown',
  syncedAt: new Date().toISOString(),
  files: checksums,
}
fs.writeFileSync(path.join(target, 'VENDORED.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`copied ${FILES.length} files from OntoGraphNavigator ${manifest.version} (${manifest.commit})`)

// Every relative import must point into the copy; npm imports are listed.
const missing = [], packages = new Set()
for (const name of FILES) {
  const text = fs.readFileSync(path.join(target, name), 'utf8')
  for (const m of text.matchAll(/^\s*import\s+(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/gm)) {
    const spec = m[1]
    if (!spec.startsWith('.')) packages.add(spec)
    else if (!FILES.includes(path.basename(spec).replace(/(\.js)?$/, '.js'))) missing.push(`${name} imports ${spec}`)
  }
}
if (missing.length) console.log('imports outside the copy (add them to FILES):\n  ' + missing.join('\n  '))
if (packages.size) console.log('npm packages the copy imports: ' + [...packages].join(', '))
if (!missing.length && !packages.size) console.log('the copy is self-contained: no npm packages, no imports outside it')
