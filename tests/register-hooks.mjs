// Loaded with `node --import ./tests/register-hooks.mjs …` before any check.
import { register } from 'node:module'
register('./resolve-extensionless.mjs', import.meta.url)
