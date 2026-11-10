// The reference sketch for the Serpent's Meadow tables: how a person who knows the data would
// read them. The heuristics are measured against it (tests/sketch-distance.mjs).
//
// Judgement calls, open to change: period and preservation are types (values shared by many
// units/finds), size, elevations, volume and weight are attributes; labels are the readable
// numbers (su_number, inventory_no) where a table has no name column.
import { addAttribute, addRelation, addType, bindColumn, createSketch, keyBinding, setKey } from '../../src/lib/sketch'

export function referenceSketch() {
  let s = createSketch({ base: 'https://example.org/serpents-meadow/', languages: { primary: 'en', additional: ['de'] } })
  const T = {}
  const record = (table, key, labels = {}, name = table) => {
    s = setKey(s, table, key)
    let t
    ;[s, t] = addType(s, name)
    ;[s] = bindColumn(s, table, key, t, labels)
    T[table] = t
  }
  const attr = (table, column, datatype) => { [s] = addAttribute(s, table, column, keyBinding(s, table).id, { datatype }) }
  const ref = (table, column, target) => {
    let b
    ;[s, b] = bindColumn(s, table, column, T[target])
    ;[s] = addRelation(s, keyBinding(s, table).id, b, { name: column })
  }
  const value = (table, column) => {
    let t, b
    ;[s, t] = addType(s, column)
    ;[s, b] = bindColumn(s, table, column, t)
    ;[s] = addRelation(s, keyBinding(s, table).id, b, { name: column })
  }

  for (const v of ['material', 'object_type', 'interpretation']) record(v, `${v}_code`, { en: 'name_en', de: 'name_de' })
  record('site', 'site_id', { en: 'name', de: 'name_de' })
  record('person', 'person_id', { en: 'full_name' })
  record('excavation', 'excavation_id', { en: 'title' })
  record('sondage', 'sondage_id', { en: 'label' })
  record('stratigraphic_unit', 'su_id', { en: 'su_number' })
  record('find', 'find_id', { en: 'inventory_no' })

  ref('site', 'parent_site_id', 'site')
  attr('site', 'description', 'xsd:string')
  ref('excavation', 'site_id', 'site')
  attr('excavation', 'start_year', 'xsd:integer')
  attr('excavation', 'end_year', 'xsd:integer')
  ref('sondage', 'site_id', 'site')
  ref('sondage', 'excavation_id', 'excavation')
  attr('sondage', 'size', 'xsd:string')
  attr('sondage', 'geom', 'geo:wktLiteral')
  ref('stratigraphic_unit', 'sondage_id', 'sondage')
  ref('stratigraphic_unit', 'interpretation_code', 'interpretation')
  attr('stratigraphic_unit', 'description', 'xsd:string')
  for (const c of ['elevation_top', 'elevation_bottom', 'volume_m3']) attr('stratigraphic_unit', c, 'xsd:decimal')
  value('stratigraphic_unit', 'period')
  attr('stratigraphic_unit', 'geom', 'geo:wktLiteral')
  ref('find', 'su_id', 'stratigraphic_unit')
  ref('find', 'object_type_code', 'object_type')
  ref('find', 'material_code', 'material')
  attr('find', 'description', 'xsd:string')
  value('find', 'preservation')
  attr('find', 'weight_g', 'xsd:decimal')
  attr('find', 'date_from', 'xsd:integer')
  attr('find', 'date_to', 'xsd:integer')
  attr('find', 'find_spot', 'geo:wktLiteral')

  // Junction and stratigraphic relations: edges, no records of their own.
  s = setKey(s, 'excavation_person', '#row')
  let a, b
  ;[s, a] = bindColumn(s, 'excavation_person', 'excavation_id', T.excavation)
  ;[s, b] = bindColumn(s, 'excavation_person', 'person_id', T.person)
  ;[s] = addRelation(s, a, b, { name: 'carried out by' })
  s = setKey(s, 'su_relation', 'relation_id')
  ;[s, a] = bindColumn(s, 'su_relation', 'su_from', T.stratigraphic_unit)
  ;[s, b] = bindColumn(s, 'su_relation', 'su_to', T.stratigraphic_unit)
  ;[s] = addRelation(s, a, b, { name: 'stratigraphic relation', kind: 'relation' })
  return s
}
