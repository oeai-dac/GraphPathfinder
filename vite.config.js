import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// mdb-reader (Access) reaches Node-flavoured crypto through one module of its browser build,
// lib/browser/environment/index.js; src/sources/mdbEnvironment.js stands in for it (why: there).
// Two hooks, because the dev server pre-bundles dependencies with esbuild, where Rollup plugins
// do not run, while the build (also the standalone file) goes through Rollup.
const MDB_ENVIRONMENT = fileURLToPath(new URL('./src/sources/mdbEnvironment.js', import.meta.url))
const fromMdbReader = (importer) => /mdb-reader[\\/]lib[\\/]browser[\\/]/.test(importer ?? '')
const isEnvironment = (source) => /(^|[\\/])environment[\\/]index\.js$/.test(source)

const mdbEnvironment = {
  name: 'mdb-reader-environment',
  enforce: 'pre',
  resolveId: (source, importer) => (fromMdbReader(importer) && isEnvironment(source) ? MDB_ENVIRONMENT : null),
}
const mdbEnvironmentPrebundle = {
  name: 'mdb-reader-environment',
  setup(build) {
    build.onResolve({ filter: /environment[\\/]index\.js$/ }, (args) => (fromMdbReader(args.importer) ? { path: MDB_ENVIRONMENT } : undefined))
  },
}

// Port 3003: the Studio runs on 3000, the GraphExplorer on 3001, the OntoGraphNavigator on 3002.
// All of them are meant to be open at once.
export default defineConfig({
  plugins: [react(), mdbEnvironment],
  optimizeDeps: {
    esbuildOptions: { plugins: [mdbEnvironmentPrebundle] },
  },
  server: {
    port: 3003,
    open: true,
  },
})
