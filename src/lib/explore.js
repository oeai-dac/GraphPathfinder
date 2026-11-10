/**
 * "Explore": the sketch as Graph JSON for the GraphExplorer.
 *
 * Not built here but by the OntoGraphNavigator's own code (vendored in src/core/), from the
 * project file the compiler writes — so the GraphExplorer gets exactly what the
 * OntoGraphNavigator would make of the handed-over project.
 */

import { readProjectFile } from '../core/projectFile'
import { materialize } from '../core/materialize'
import { writeGraphJson } from '../core/graphJson'
import { APP_NAME } from './app'
import { compile } from './compile'

/** @returns {{ json: string, graph, diagnostics, report, project }} */
export function explore(catalog, sketch, { pretty = false } = {}) {
  // In memory the rows need not be repeated on every node: the OntoGraphNavigator's reader
  // takes them from the first node of each table.
  const { project, report } = compile(catalog, sketch, { rowsOnce: true })
  const { graph, diagnostics } = materialize(readProjectFile(project))
  // The vendored code names itself; this file comes from here.
  graph.meta = { ...graph.meta, title: sketch.settings.title || 'Graph', generated_by: APP_NAME }
  return { json: writeGraphJson(graph, { pretty }), graph, diagnostics, report, project }
}
