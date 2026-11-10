/**
 * The few helpers every check uses. No test framework: each check is a plain script that
 * prints its failures and ends with "PASS — …" or "FAIL — …" and the matching exit code.
 */
let passed = 0
let failed = 0

export function ok(condition, message) {
  if (condition) passed++
  else { failed++; console.log(`  FAIL ${message}`) }
}

export function eq(actual, expected, message) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected)
  ok(a === b, `${message}\n       got      ${a}\n       expected ${b}`)
}

export function section(title) {
  console.log(`· ${title}`)
}

export function done(name) {
  if (failed) console.log(`FAIL — ${name}: ${failed} of ${passed + failed} checks failed`)
  else console.log(`PASS — ${name}: ${passed} checks`)
  process.exitCode = failed ? 1 : 0
}

export const bytesOf = (text) => new TextEncoder().encode(text)
