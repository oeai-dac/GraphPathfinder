// Four small invented tables and the sketch a person would draw on them: SE with labels in two
// languages and a phase (role), finds and samples merged into SE, Material from two tables with
// no table of its own, and a relation table qualified by its kind (Dot-One, Harris matrix).
// Shared by run-compile-check and the cross-check against the GraphExplorer and the OntoGraphNavigator.
import { addTables, emptyCatalog } from '../../src/lib/catalog'
import { addAttribute, addRelation, addType, bindColumn, createSketch, mergeTypes, setKey } from '../../src/lib/sketch'
import { readSource } from '../../src/sources/index'

export const BASE = 'https://example.org/test/'

const csv = (file, text) => readSource(file, new TextEncoder().encode(text)).tables[0]

export const catalog = addTables(emptyCatalog(), [
  csv('SE.csv', 'se_id,bezeichnung,bezeichnung_en,phase,geom\nSU1001,Humus,Topsoil,Neuzeit,"POLYGON ((16.4160 48.2030, 16.4161 48.2030, 16.4161 48.2031, 16.4160 48.2030))"\nSU1002,Grubenverfüllung,Pit fill,Römisch,\nSU1003,Grube,Pit,Römisch,\nSU1004,Mauer,Wall,Bronzezeit,\n'),
  csv('Funde.csv', 'find_id,se_id,material,gewicht\n1,SU1002,Bronze,12.5\n2,SU1002,Keramik grob,80.25\n3,SU1004,Eisen,\n'),
  csv('Proben.csv', 'probe_id,se_id,material\n1,SU1003,Bronze\nP-2,SU1001,Holzkohle\n'),
  csv('SE_Rel.csv', 'von,nach,art\nSU1001,SU1002,über\nSU1002,SU1003,über\nSU1003,SU1004,contemporary with\n'),
])

export const ids = {}
let s = createSketch({ base: BASE, languages: { primary: 'de', additional: ['en'] }, title: 'Four tables' })
;[s, ids.seType] = addType(s, 'SE', { nameI18n: { en: 'Stratigraphic unit' } })
s = setKey(s, 'SE', 'se_id')
;[s, ids.se] = bindColumn(s, 'SE', 'se_id', ids.seType, { de: 'bezeichnung', en: 'bezeichnung_en' })
;[s, ids.phaseType] = addType(s, 'Phase')
;[s, ids.phase] = bindColumn(s, 'SE', 'phase', ids.phaseType)
;[s] = addRelation(s, ids.se, ids.phase, { name: 'Phase', role: 'phase' })
;[s] = addAttribute(s, 'SE', 'geom', ids.se, { name: 'Geometry', datatype: 'geo:wktLiteral' })

;[s, ids.fundType] = addType(s, 'Fund')
s = setKey(s, 'Funde', 'find_id')
;[s, ids.fund] = bindColumn(s, 'Funde', 'find_id', ids.fundType)
;[s, ids.matType] = addType(s, 'Material')
;[s, ids.mat1] = bindColumn(s, 'Funde', 'material', ids.matType)
;[s] = addRelation(s, ids.fund, ids.mat1, { name: 'material' })
;[s] = addAttribute(s, 'Funde', 'gewicht', ids.fund, { name: 'Weight (g)', datatype: 'xsd:decimal' })
;[s, ids.fse] = bindColumn(s, 'Funde', 'se_id', ids.seType) // merged into SE
;[s] = addRelation(s, ids.fund, ids.fse, { name: 'found in' })

;[s, ids.probeType] = addType(s, 'Probe')
s = setKey(s, 'Proben', 'probe_id')
;[s, ids.probe] = bindColumn(s, 'Proben', 'probe_id', ids.probeType)
;[s, ids.mat2Type] = addType(s, 'Material (Proben)')
;[s, ids.mat2] = bindColumn(s, 'Proben', 'material', ids.mat2Type)
s = mergeTypes(s, ids.matType, ids.mat2Type) // Material from two tables, no table of its own
;[s] = addRelation(s, ids.probe, ids.mat2, { name: 'material' })
;[s, ids.pse] = bindColumn(s, 'Proben', 'se_id', ids.seType)
;[s] = addRelation(s, ids.probe, ids.pse, { name: 'taken from' })

;[s, ids.von] = bindColumn(s, 'SE_Rel', 'von', ids.seType)
;[s, ids.nach] = bindColumn(s, 'SE_Rel', 'nach', ids.seType)
;[s] = addRelation(s, ids.von, ids.nach, { name: 'stratigraphic relation', kind: 'art' })

export const sketch = s
