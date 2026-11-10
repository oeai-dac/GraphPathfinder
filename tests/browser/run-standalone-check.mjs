// npm run check:browser — the standalone file in a real browser, opened via file://, used the way
// a person would: load the example tables, drag a column onto another table's key, change a
// column in the inspector and undo it, accept the suggestions, export, save the sketch and open
// it again on the same tables; then a German recording database and its Harris matrix roles in the
// inspector. Needs Chrome (or CHROME=<path>) and a fresh `npm run build:standalone`.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { done, eq, ok, section } from '../check.mjs'
import { FUNDE_CSV, PHASEN_CSV, SE_CSV } from '../fixtures/harris-tables.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const page_ = join(root, 'GraphPathfinder-standalone.html')
const chrome = process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)
if (!chrome) { console.log('skip — no Chrome found (set CHROME=<path>)'); process.exit(0) }
if (!existsSync(page_)) { console.log('FAIL — no GraphPathfinder-standalone.html: run npm run build:standalone first'); process.exit(1) }

const csvDir = join(root, '0_exampleData', 'serpents_meadow_tables')
const csvFiles = readdirSync(csvDir).filter((f) => f.endsWith('.csv')).map((f) => join(csvDir, f))
const downloads = mkdtempSync(join(tmpdir(), 'graphpathfinder-downloads-'))
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: chrome, headless: true })
try {
  const session = await browser.target().createCDPSession()
  await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })
  const problems = []
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })
  page.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) problems.push(`network request: ${r.url()}`) })
  page.on('dialog', (d) => d.accept())

  // Chrome on Windows may leave an empty placeholder behind a file already taken, so the first
  // file with content counts, not the first name.
  const takeDownload = async (suffix) => {
    for (let i = 0; i < 100; i++) {
      const f = readdirSync(downloads).find((x) => x.endsWith(suffix) && !x.endsWith('.crdownload') && statSync(join(downloads, x)).size > 0)
      if (f) {
        const text = readFileSync(join(downloads, f), 'utf8')
        rmSync(join(downloads, f))
        return { name: f, json: JSON.parse(text) }
      }
      await pause(100)
    }
    const messages = await page.$$eval('.message', (m) => m.map((x) => x.textContent))
    throw new Error(`no download *${suffix} (downloads: ${readdirSync(downloads).map((f) => `${f} ${statSync(join(downloads, f)).size}`).join(', ')}; messages: ${messages.join(' | ')})`)
  }
  const click = (text) => page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t)).click(), text)
  const openCount = () => page.$$eval('.suggestions-panel li', (li) => li.length)
  const badge = (table, column) => page.evaluate((t, c) => {
    const card = [...document.querySelectorAll('.react-flow__node')].find((n) => n.dataset.id === t)
    const row = [...card.querySelectorAll('.col-row')].find((r) => r.querySelector('.col-name').textContent === c)
    return row.querySelector('.col-badge').textContent
  }, table, column)
  const handle = async (table, id) => (await page.$(`.canvas .react-flow__handle[data-nodeid="${table}"][data-handleid="${id}"]`)).boundingBox()
  async function drag(from, to) {
    const a = await handle(from.table, from.handle), b = await handle(to.table, to.handle)
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + (b.x - a.x) * i / 12 + a.width / 2, a.y + (b.y - a.y) * i / 12 + a.height / 2)
    await page.mouse.up()
    await pause(300)
  }

  section('loading')
  await page.goto(pathToFileURL(page_).href)
  await page.waitForSelector('.drop.big', { timeout: 10000 })
  await (await page.$('input[type=file]')).uploadFile(...csvFiles)
  await page.waitForFunction((n) => document.querySelectorAll('.table-card').length === n, { timeout: 20000 }, csvFiles.length)
  await pause(800)
  eq(await openCount(), 12, 'twelve suggestions for the example tables (one of them the phase role)')
  eq(await badge('find', 'su_id'), 'Su id', 'find.su_id starts as a vocabulary of its own')

  section('dragging a column onto another table\'s key')
  await drag({ table: 'find', handle: 'r:su_id' }, { table: 'stratigraphic_unit', handle: 'l:su_id' })
  eq(await badge('find', 'su_id'), '→ Stratigraphic unit', 'find.su_id now refers to the units')
  eq(await openCount(), 11, 'its suggestion is settled by the gesture')
  ok(await page.$('.react-flow__edge.merge.reference'), 'the merge is drawn between the cards')

  section('inspector and undo')
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.react-flow__node')].find((n) => n.dataset.id === 'find')
    ;[...card.querySelectorAll('.col-row')].find((r) => r.querySelector('.col-name').textContent === 'preservation').click()
  })
  await pause(200)
  eq(await page.$eval('.inspector h3', (h) => h.textContent), 'find.preservation', 'the inspector shows the column')
  await page.evaluate(() => [...document.querySelectorAll('.inspector .radio')].find((l) => l.textContent.trim().startsWith('attribute')).querySelector('input').click())
  await pause(200)
  eq(await badge('find', 'preservation'), 'string', 'read as an attribute now')
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control')
  await pause(200)
  eq(await badge('find', 'preservation'), 'Preservation', 'Ctrl+Z brings the type back')

  section('suggestions and export')
  await click('Accept all')
  await page.waitForFunction(() => !document.querySelector('.suggestions-panel'), { timeout: 10000 })
  ok(true, 'all accepted, the list closes')
  eq(await badge('su_relation', 'relation'), 'kind of “stratigraphic relation”', 'the relation table is read as Harris matrix edges')
  await click('Explore')
  const { json: graph } = await takeDownload('-graph.json')
  const finds = Object.values(graph.nodes).filter((n) => graph.schema.typeLabels[n.t] === 'Find')
  eq(finds.length, 203, 'Graph JSON with all 203 finds')
  ok(finds.every((f) => Object.values(f.o).flat().some((id) => graph.schema.typeLabels[graph.nodes[id]?.t] === 'Stratigraphic unit')), 'every find linked to its unit')
  ok(Object.values(graph.nodes).some((n) => Object.keys(n.o).some((k) => k.includes('#dot1:'))), 'Harris matrix relations')
  await click('Project file')
  const { json: project } = await takeDownload('-project.json')
  ok(Array.isArray(project.nodes) && project.version === 6, 'Studio project file (version 6)')
  const schemaTypes = await page.$$eval('.type-node', (n) => n.length)
  ok(schemaTypes >= 10, `the resulting graph shows the types (${schemaTypes})`)

  section('save the sketch, start over, open it again')
  await click('Save sketch')
  const { name: sketchName, json: sketchFile } = await takeDownload('.sketch.json')
  eq(sketchFile.format, 'graphpathfinder-sketch', 'sketch file written')
  ok(!JSON.stringify(sketchFile).includes('TSP-1001-01'), 'without the data')
  await click('Start over')
  await page.waitForSelector('.drop.big', { timeout: 10000 })
  const saved = join(downloads, `again-${sketchName}`)
  writeFileSync(saved, JSON.stringify(sketchFile))
  await (await page.$('input[type=file]')).uploadFile(...csvFiles, saved)
  await page.waitForFunction((n) => document.querySelectorAll('.table-card').length === n, { timeout: 20000 }, csvFiles.length)
  await pause(800)
  eq(await badge('find', 'su_id'), '→ Stratigraphic unit', 'the drag is back')
  eq(await page.$('.suggestions-panel'), null, 'nothing left to suggest')
  await click('Explore')
  const { json: again } = await takeDownload('-graph.json')
  eq(Object.keys(again.nodes).length, Object.keys(graph.nodes).length, 'the same graph as before')

  section('Harris matrix roles in the inspector')
  await click('Start over')
  await page.waitForSelector('.drop.big', { timeout: 10000 })
  const harris = [['SE.csv', SE_CSV], ['Phasen.csv', PHASEN_CSV], ['Funde.csv', FUNDE_CSV]].map(([name, text]) => {
    const file = join(downloads, name)
    writeFileSync(file, text)
    return file
  })
  await (await page.$('input[type=file]')).uploadFile(...harris)
  await page.waitForFunction(() => document.querySelectorAll('.table-card').length === 3, { timeout: 20000 })
  await pause(800)
  eq(await openCount(), 9, 'nine suggestions: the matrix columns, three references, five roles')
  await click('Accept all')
  await page.waitForFunction(() => !document.querySelector('.suggestions-panel'), { timeout: 10000 })
  eq([await badge('SE', 'liegt_über'), await badge('SE', 'Einheitstyp'), await badge('Phasen', 'nächste_Phase')],
    ['→ SE · above · split “;”', 'Einheitstyp · unit type', '→ Phasen · phase order'], 'the cards say what the columns are in the matrix')
  const pick = async (table, column) => {
    await page.evaluate((t, c) => {
      const card = [...document.querySelectorAll('.react-flow__node')].find((n) => n.dataset.id === t)
      ;[...card.querySelectorAll('.col-row')].find((r) => r.querySelector('.col-name').textContent === c).click()
    }, table, column)
    await pause(200)
  }
  // A select in the inspector by its label (or a value row), marked so puppeteer can choose in it.
  const mark = (label) => page.evaluate((l) => {
    document.querySelectorAll('[data-check]').forEach((x) => x.removeAttribute('data-check'))
    const row = [...document.querySelectorAll('.inspector .field, .inspector .value-row')].find((f) => f.querySelector('span').textContent === l)
    const select = row?.querySelector('select')
    if (select) select.dataset.check = 'x'
    return select?.value ?? null
  }, label)
  await pick('SE', 'Einheitstyp')
  eq(await mark('Role in the Harris matrix'), 'unitType', 'unit type column: its role')
  eq(await page.$$eval('.inspector .value-row', (r) => r.map((x) => x.querySelector('span').textContent)), ['Schicht', 'Verfüllung', 'Interface', 'Mauer', 'Ablagerung'], 'each value of the column to map')
  eq(await mark('Schicht'), 'layer', 'Schicht → layer')
  await page.select('[data-check]', 'deposit')
  await pause(200)
  await pick('Phasen', 'nächste_Phase')
  eq(await mark('Role in the Harris matrix'), 'phaseOrder', 'next phase column: phase order')
  await page.evaluate(() => [...document.querySelectorAll('.inspector .check')].find((l) => l.textContent.includes('phase before')).querySelector('input').click())
  await pause(200)
  await click('Explore')
  const { json: matrix } = await takeDownload('-graph.json')
  const labels = (prefix) => Object.entries(matrix.nodes).filter(([id]) => id.includes(`/${prefix}/`)).map(([, n]) => n.l).sort()
  eq(labels('einheitstyp'), ['deposit', 'fill', 'interface', 'structure'], 'Schicht now drawn as deposit')
  const before = (p) => Object.entries(matrix.nodes[`https://example.org/graph/phasen/${p}`].o).filter(([k]) => k.includes('P120')).flatMap(([, t]) => t.map((x) => matrix.nodes[x].l))
  eq(['P1', 'P2', 'P3'].map(before), [[], ['Römisch'], ['Spätantik']], 'the phase order turned round')

  // The example as databases: the declared keys and relationships come along, only the matrix
  // and the phase role are left to suggest.
  for (const file of ['serpents_meadow.accdb', 'serpents_meadow.pgdump.sql']) {
    section(`database: ${file}`)
    await click('Start over')
    await page.waitForSelector('.drop.big', { timeout: 10000 })
    await (await page.$('input[type=file]')).uploadFile(join(root, '0_exampleData', file))
    await page.waitForFunction(() => document.querySelectorAll('.table-card').length === 11, { timeout: 20000 })
    await pause(800)
    eq(await page.$$eval('.message.error, .message.warning', (m) => m.map((x) => x.textContent)), [], 'read without errors or warnings')
    eq(await openCount(), 2, 'two suggestions: the matrix and the phase role')
    eq(await badge('find', 'su_id'), '→ Stratigraphic unit', 'the declared foreign key is applied')
    await click('Accept all')
    await page.waitForFunction(() => !document.querySelector('.suggestions-panel'), { timeout: 10000 })
    await click('Explore')
    const { json: db } = await takeDownload('-graph.json')
    const dbFinds = Object.values(db.nodes).filter((n) => db.schema.typeLabels[n.t] === 'Find')
    eq(dbFinds.length, 203, 'Graph JSON with all 203 finds')
    ok(dbFinds.every((n) => n.a?.['Find spot']?.startsWith('POINT Z')), 'find spots as WKT')
    eq(Object.keys(db.nodes).length, Object.keys(graph.nodes).length, 'as many nodes as from the CSV tables')
  }

  section('database: a pg_dump archive is turned away')
  await click('Start over')
  await page.waitForSelector('.drop.big', { timeout: 10000 })
  await (await page.$('input[type=file]')).uploadFile(join(root, 'tests', 'fixtures', 'pgdump-custom-format.dump'))
  await page.waitForSelector('.message.error', { timeout: 10000 })
  ok((await page.$eval('.message.error', (m) => m.textContent)).includes('pg_restore -f dump.sql'), 'with instructions for plain SQL')

  eq(problems, [], 'no page errors, no network requests')
} finally {
  await browser.close()
  rmSync(downloads, { recursive: true, force: true })
}
done('standalone in the browser')
