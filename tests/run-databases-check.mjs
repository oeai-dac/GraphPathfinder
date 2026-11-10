// Databases: the Access files (.accdb, .mdb) and the PostgreSQL dumps (COPY, --inserts) of the
// example read back as make_databases/model.json describes them — every cell, primary key, unique
// key and foreign key —, the declared keys carry the sketch, and the pg_dump reader's details.
import { readFileSync } from 'node:fs'
import { addTables, emptyCatalog } from '../src/lib/catalog'
import { buildSketch } from '../src/lib/defaultSketch'
import { explore } from '../src/lib/explore'
import { applySuggestion } from '../src/lib/suggestions'
import { readSource } from '../src/sources/index'
import { parsePgDump, unescapeCopy } from '../src/sources/pgdump'
import { bytesOf, done, eq, ok, section } from './check.mjs'
import { referenceSketch } from './fixtures/serpents-reference.mjs'
import { sketchDistance } from './sketch-distance.mjs'

const dir = new URL('../0_exampleData/', import.meta.url)
const fixtures = new URL('./fixtures/', import.meta.url)
const model = JSON.parse(readFileSync(new URL('make_databases/model.json', dir), 'utf8'))
// The dump with --inserts is the same database as serpents_meadow.pgdump.sql. Only the tests need
// it, so it lies with them, not with the example data.
const FILES = {
  'serpents_meadow.accdb': dir,
  'serpents_meadow.mdb': dir,
  'serpents_meadow.pgdump.sql': dir,
  'serpents_meadow.pgdump-inserts.sql': fixtures,
}
const read = (file) => readSource(file, new Uint8Array(readFileSync(new URL(file, FILES[file]))))
const acceptAll = (sketch, suggestions) => suggestions.reduce(applySuggestion, sketch)
const asText = (v) => (v === null || v === undefined ? '' : String(v))
const sorted = (list) => [...list].sort()

// PostGIS hands geometries over as binary; the WKT written from it may differ from the model's in
// the last digit (GDAL rounds to 15 places), never in structure.
const numbers = (w) => (w.match(/-?\d+(\.\d+)?(e-?\d+)?/gi) ?? []).map(Number)
const shape = (w) => w.replace(/-?\d+(\.\d+)?(e-?\d+)?/gi, '#').replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ')
function sameCell(expected, got, type) {
  if (expected === null) return got === ''
  if (type === 'decimal') return got !== '' && Number(got) === expected
  if (type === 'geometry') {
    if (shape(expected) !== shape(got)) return false
    const a = numbers(expected), b = numbers(got)
    return a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-8)
  }
  return got === asText(expected)
}

const catalogs = {}
for (const file of Object.keys(FILES)) {
  section(`${file}: as in the model`)
  const { tables, warnings } = read(file)
  const catalog = addTables(emptyCatalog(), tables)
  catalogs[file] = catalog
  eq(warnings, [], 'no warnings')
  eq(sorted(catalog.tables.map((t) => t.name)), sorted(model.tables.map((t) => t.name)), 'one table per model table, named without schema')
  let cells = 0, same = 0
  const keys = { pk: [], uq: [], fk: [] }, expected = { pk: [], uq: [], fk: [] }
  for (const mt of model.tables) {
    const t = catalog.tables.find((x) => x.name === mt.name)
    if (!t) continue
    eq(t.columns.map((c) => c.name), mt.columns.map((c) => c.name), `${mt.name}: columns`)
    eq(t.rows.length, mt.rows.length, `${mt.name}: rows`)
    const byKey = new Map(t.rows.map((r) => [mt.primaryKey.map((k) => r[k]).join('|'), r]))
    for (const mr of mt.rows) {
      const row = byKey.get(mt.primaryKey.map((k) => asText(mr[k])).join('|'))
      for (const c of mt.columns) { cells++; if (row && sameCell(mr[c.name], row[c.name], c.type)) same++ }
    }
    keys.pk.push(`${t.name}(${t.primaryKey})`)
    expected.pk.push(`${mt.name}(${mt.primaryKey})`)
    keys.uq.push(...t.uniques.map((u) => `${t.name}(${u})`))
    expected.uq.push(...(mt.uniques ?? []).map((u) => `${mt.name}(${u})`))
    keys.fk.push(...t.foreignKeys.map((f) => `${t.name}(${f.columns}) → ${f.refTable}(${f.refColumns})`))
    expected.fk.push(...mt.foreignKeys.map((f) => `${mt.name}(${f.columns}) → ${f.refTable}(${f.refColumns})`))
  }
  eq(`${same}/${cells}`, `${cells}/${cells}`, 'every cell as in the model')
  eq(sorted(keys.pk), sorted(expected.pk), 'primary keys, also the composite one')
  eq(sorted(keys.uq), sorted(expected.uq), 'unique keys')
  eq(sorted(keys.fk), sorted(expected.fk), `all ${expected.fk.length} foreign keys`)
}

section('Declared keys carry the sketch')
for (const [file, catalog] of Object.entries(catalogs)) {
  const { sketch, suggestions } = buildSketch(catalog)
  // As simulated in step 2 (run-heuristics-check): what the database declares is applied, only
  // the stratigraphic relation table and the phase role are guesses.
  eq(suggestions.map((s) => s.kind), ['matrix', 'role'], `${file}: only the matrix and the phase role left to suggest`)
  const before = sketchDistance(catalog, sketch, referenceSketch())
  eq(before.differences.map((d) => d.column.split('.')[0]), ['su_relation', 'su_relation', 'su_relation', 'su_relation'], `${file}: only the relation table differs from the reference`)
  const accepted = acceptAll(sketch, suggestions)
  eq(sketchDistance(catalog, accepted, referenceSketch()).differences, [], `${file}: nothing left after accepting`)
  if (file.endsWith('.accdb') || file.endsWith('pgdump.sql')) {
    const { graph, diagnostics } = explore(catalog, accepted)
    eq(diagnostics.unpairable.length + diagnostics.typeCollisions.length, 0, `${file}: graph without diagnostics`)
    const finds = Object.values(graph.nodes).filter((n) => graph.schema.typeLabels[n.t] === 'Find')
    eq(finds.length, 203, `${file}: all 203 finds in the graph`)
  }
}

section('pg_dump: statements and values')
{
  const dump = [
    '--',
    '-- PostgreSQL database dump',
    '\\restrict abc',
    "SET client_encoding = 'UTF8';",
    'CREATE FUNCTION public.f() RETURNS trigger',
    '    LANGUAGE plpgsql',
    "    AS $$ BEGIN RAISE NOTICE 'a;b'; RETURN NEW; END; $$;",
    'CREATE TABLE public."Fund stelle" (',
    '    id integer NOT NULL,',
    '    "Name" character varying(50) DEFAULT \'x;y\'::character varying,',
    '    ok boolean,',
    '    weight numeric(8,2),',
    '    scan bytea,',
    '    pos public.geometry(PointZ,31256),',
    '    site text REFERENCES archive.site',
    ');',
    'CREATE TABLE archive.site (code text PRIMARY KEY, label text);',
    'CREATE TABLE public.site (code text, label text);',
    'COPY public."Fund stelle" (id, "Name", ok, weight, scan, pos, site) FROM stdin;',
    '1\tTab\\there\\nnew line\tt\t12.50\t\\\\x0102\t01010000A0C87A0000000000000000F03F00000000000000400000000000000840\tA',
    '2\t\\N\tf\t\\N\t\\N\t\\N\t\\N',
    '3\tGrubenverf\\303\\274llung\t\\N\t\\N\t\\N\t\\N\t\\N',
    '\\.',
    "INSERT INTO archive.site VALUES ('A', 'it''s here'), ('B', NULL);",
    "INSERT INTO public.site (code, label) OVERRIDING SYSTEM VALUE VALUES ('X', E'line\\none');",
    'ALTER TABLE ONLY public."Fund stelle"',
    '    ADD CONSTRAINT "Fund stelle_pkey" PRIMARY KEY (id);',
    'ALTER TABLE ONLY public."Fund stelle" ADD CONSTRAINT u UNIQUE ("Name", ok);',
    'COPY public.spatial_ref_sys (srid) FROM stdin;',
    '31256',
    '\\.',
  ].join('\r\n')
  const { tables, warnings } = readSource('grabung.sql', bytesOf(dump))
  eq(tables.map((t) => t.name), ['Fund stelle', 'archive.site', 'site'], 'quoted names; schema only where two schemas share a name; no extension tables')
  const fs = tables[0]
  eq(fs.columns.map((c) => c.declared), ['integer', 'text', 'boolean', 'decimal', 'binary', 'geometry', 'text'], 'declared types')
  eq(fs.columns[5].srid, 31256, 'SRID of a geometry column')
  eq(fs.rows[0], { id: '1', Name: 'Tab\there\nnew line', ok: 'true', weight: '12.50', scan: '', pos: 'POINT Z (1 2 3)', site: 'A' }, 'COPY escapes, boolean, numeric as written, bytea left out, EWKB → WKT')
  eq(fs.rows[1], { id: '2', Name: '', ok: 'false', weight: '', scan: '', pos: '', site: '' }, 'NULL is an empty cell')
  eq(fs.rows[2].Name, 'Grubenverfüllung', 'octal escapes are UTF-8 bytes')
  eq(fs.primaryKey, ['id'], 'primary key from ALTER TABLE over two lines')
  eq(fs.uniques, [['Name', 'ok']], 'composite unique key')
  eq(fs.foreignKeys, [{ columns: ['site'], refTable: 'archive.site', refColumns: ['code'] }], 'REFERENCES without columns → the primary key; table in another schema')
  eq(tables[1].rows, [{ code: 'A', label: "it's here" }, { code: 'B', label: '' }], 'INSERT with several tuples and doubled quotes')
  eq(tables[2].rows, [{ code: 'X', label: 'line\none' }], 'INSERT with column list, OVERRIDING SYSTEM VALUE and E-string')
  eq(warnings, ['grabung.sql: Fund stelle.scan: binary data (bytea) left out'], 'one warning for the bytea column')

  eq([unescapeCopy('\\N'), unescapeCopy('a\\\\b'), unescapeCopy('\\x41\\101')], [null, 'a\\b', 'AA'], 'COPY: \\N, backslash, hex and octal')

  const parts = parsePgDump([
    'CREATE TABLE public.su (id text, year integer) PARTITION BY RANGE (year);',
    'CREATE TABLE public.su_2024 (id text, year integer);',
    'ALTER TABLE ONLY public.su ATTACH PARTITION public.su_2024 FOR VALUES FROM (2024) TO (2025);',
    'COPY public.su_2024 (id, year) FROM stdin;', 'SU1\t2024', '\\.',
  ])
  eq(parts.tables.map((t) => [t.name, t.rows.length]), [['su', 1]], 'partitions hold the rows of their parent')

  const dataOnly = readSource('data.sql', bytesOf('COPY public.find (id, su) FROM stdin;\nF1\tSU1\n\\.\n'))
  eq([dataOnly.tables[0].name, dataOnly.tables[0].columns.map((c) => c.name), dataOnly.tables[0].rows.length], ['find', ['id', 'su'], 1], 'data-only dump: columns from COPY')
  ok(dataOnly.warnings.some((w) => w.includes('data-only')), 'data-only dump: says keys are guessed')
}

section('pg_dump: what is turned away')
{
  const message = (file, bytes) => { try { readSource(file, bytes); return '' } catch (e) { return e.message } }
  const custom = new Uint8Array(readFileSync(new URL('fixtures/pgdump-custom-format.dump', import.meta.url)))
  ok(message('grabung.dump', custom).includes('pg_restore -f dump.sql'), 'custom format (-Fc): with instructions for plain SQL')
  ok(message('grabung.backup', custom).includes('plain SQL'), 'pgAdmin backup (.backup) likewise')
  ok(message('my.sql', bytesOf('CREATE TABLE `finds` (\n  `id` int\n);\n')).includes('MySQL'), 'MySQL dump recognised')
  ok(message('notes.sql', bytesOf('SELECT 1;\n')).includes('No tables found'), 'SQL without tables')
}

section('Access: what is turned away')
{
  const message = (file, bytes) => { try { readSource(file, bytes); return '' } catch (e) { return e.message } }
  ok(message('broken.accdb', bytesOf('not a database')).includes('not readable as an Access database'), 'not a database')
}

done('databases')
