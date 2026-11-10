/**
 * mdb-reader's browser build uses Node's Buffer as a global. Imported before mdb-reader, so the
 * global exists before any of its code runs. In Node, 'buffer' is the built-in module.
 */
import { Buffer } from 'buffer'

if (!globalThis.Buffer) globalThis.Buffer = Buffer

export { Buffer }
