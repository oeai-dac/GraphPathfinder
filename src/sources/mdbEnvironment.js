/**
 * Stands in for mdb-reader's browser module `lib/browser/environment/index.js` (swapped in by the
 * plugin in vite.config.js, for the dev server and the build alike).
 *
 * The original pulls in browserify-aes and create-hash, which drag Node streams, `events` and
 * `process` into the bundle: the page then stops at load with "process is not defined". Both are
 * only needed for password-protected (Office-encrypted) .accdb files, which are turned away with
 * a clear message instead. `inflate` (compressed attachments) stays as it was.
 */
import { inflate as pakoInflate } from 'pako'

const unsupported = () => {
  throw new Error('Password-protected (encrypted) Access databases cannot be read yet')
}

export const createDecipheriv = unsupported
export const createHash = unsupported
export const environment = {
  inflate: (data) => Buffer.from(pakoInflate(data)),
}
