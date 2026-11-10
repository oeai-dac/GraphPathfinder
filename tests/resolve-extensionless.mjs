/**
 * Node resolve hook for Vite-style imports (as in the OntoGraphNavigator's tests).
 *
 * src/ and the vendored src/core/ import without a file extension (`from './keys'`), which
 * Vite resolves and Node does not. The copy in src/core/ must stay unchanged, so the test
 * runner adapts instead of the code.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?jsx?$/.test(specifier)) {
      return nextResolve(`${specifier}.js`, context)
    }
    throw err
  }
}
