#!/usr/bin/env node
// Post-`next build` step for the standalone bundle (ADR-064 #2).
//
// `next build` with `output: 'standalone'` produces a self-contained server
// at `.next/standalone/packages/web/server.js` (path preserved relative to
// the auto-detected monorepo tracing root). What it does NOT include — and
// what the server needs at runtime — is the static asset tree from
// `.next/static`, which has to live at `<server-dir>/.next/static` so that
// the embedded `next` resolver finds it.
//
// This script copies `.next/static` into the standalone bundle's expected
// location. Runs after every `npm run build`, including the publish gate's
// `prepublishOnly`. Idempotent.

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

const standaloneServerDir = path.join(
  pkgRoot,
  '.next/standalone/packages/web',
)
const standaloneStaticDir = path.join(standaloneServerDir, '.next/static')
const builtStaticDir = path.join(pkgRoot, '.next/static')

if (!existsSync(standaloneServerDir)) {
  console.error(
    `post-build-standalone: ${standaloneServerDir} missing — did \`next build\` actually run with \`output: 'standalone'\`?`,
  )
  process.exit(1)
}

if (!existsSync(builtStaticDir)) {
  console.error(
    `post-build-standalone: ${builtStaticDir} missing — did \`next build\` produce a static asset tree?`,
  )
  process.exit(1)
}

// Wipe any prior copy, then copy fresh. Static assets are content-hashed, so
// stale ones don't break anything — but we still want the tarball to reflect
// exactly the current build.
if (existsSync(standaloneStaticDir)) {
  rmSync(standaloneStaticDir, { recursive: true, force: true })
}
mkdirSync(path.dirname(standaloneStaticDir), { recursive: true })
cpSync(builtStaticDir, standaloneStaticDir, { recursive: true })

console.log(
  `post-build-standalone: copied .next/static → .next/standalone/packages/web/.next/static`,
)
