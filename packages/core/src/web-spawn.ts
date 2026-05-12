/**
 * Web UI spawn helper (ADR-059).
 *
 * `neatd start` brings up the REST API + OTel receivers, then calls
 * `spawnWebUI(restPort)` to launch the Next.js web shell as a child process.
 * Lifecycle is parent-tied: SIGTERM/SIGINT on neatd cascades to the child
 * via `stop()`.
 *
 * Default port `6328` (NEAT in T9). Override with `NEAT_WEB_PORT`.
 * Hard-fails on collision so the operator never loses track of which URL to
 * open.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'

export const DEFAULT_WEB_PORT = 6328

export interface WebHandle {
  child: ChildProcess
  port: number
  stop: () => Promise<void>
}

/**
 * Best-effort port collision check before spawning. Binds, closes, returns.
 * Race condition between the check and the actual `next start` is acceptable
 * — Next.js will then fail loudly and the parent exits.
 */
async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tester = net.createServer()
    tester.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `neatd: web UI port ${port} in use; set NEAT_WEB_PORT to override or stop the conflicting process`,
          ),
        )
      } else {
        reject(err)
      }
    })
    tester.once('listening', () => {
      tester.close(() => resolve())
    })
    tester.listen(port, '127.0.0.1')
  })
}

/**
 * Resolve the web package directory. In a global install
 * (`npm install -g neat.is`) the package lives at
 * `node_modules/@neat.is/web/`; in the monorepo it's
 * `packages/web/`. `require.resolve` finds whichever one Node has on its
 * search path.
 */
function resolveWebPackageDir(): string {
  const req = (typeof require !== 'undefined'
    ? require
    : // ESM fallback — daemon CJS bundle has `require`, but typecheck wants this
      (eval('require') as NodeRequire))
  const pkgJsonPath = req.resolve('@neat.is/web/package.json')
  return path.dirname(pkgJsonPath)
}

/**
 * Locate the standalone server.js inside the web package. ADR-064 #2 — the
 * tarball ships `.next/standalone/packages/web/server.js` (path preserved
 * relative to the monorepo tracing root). Missing means the package was
 * published without `next build` having run, which the smoke-test gate
 * catches at publish time.
 */
function resolveStandaloneServerEntry(webDir: string): string {
  return path.join(webDir, '.next/standalone/packages/web/server.js')
}

export async function spawnWebUI(restPort: number): Promise<WebHandle> {
  const portRaw = process.env.NEAT_WEB_PORT
  const port = portRaw && portRaw.length > 0 ? Number.parseInt(portRaw, 10) : DEFAULT_WEB_PORT
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`neatd: invalid NEAT_WEB_PORT="${portRaw}"`)
  }

  await assertPortFree(port)

  const cwd = resolveWebPackageDir()
  const serverEntry = resolveStandaloneServerEntry(cwd)
  // ADR-064 — fail loudly if the standalone build is missing. v0.3.0 shipped
  // without it; the symptom on the user side was `next start` aborting with
  // `Could not find a production build in the '.next' directory`. This check
  // catches it at the parent's bootstrap instead of letting the child crash
  // a few moments later with a worse error.
  try {
    require.resolve(serverEntry)
  } catch {
    throw new Error(
      `neatd: web UI standalone build missing at ${serverEntry}. ` +
        `The published @neat.is/web tarball should include it; if you're running from a ` +
        `monorepo checkout, run \`npm run build --workspace @neat.is/web\` first, or set ` +
        `NEAT_WEB_DISABLED=1 to skip the web UI.`,
    )
  }

  // ADR-059 #6 — child inherits NEAT_API_URL pointing at our REST server,
  // unless the operator pre-configured it.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: process.env.HOSTNAME ?? '0.0.0.0',
    NEAT_API_URL: process.env.NEAT_API_URL ?? `http://localhost:${restPort}`,
  }

  // The standalone bundle is self-contained — its own `node_modules` and
  // `package.json` sit alongside `server.js`. Spawn `node` against it
  // directly; no `next start` (which needs the source tree + build cache)
  // and no `npm exec` (which is monorepo-only in practice).
  // `detached: false` keeps the child in our process group so signals reach it.
  const child = spawn(process.execPath, [serverEntry], {
    cwd: path.dirname(serverEntry),
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: false,
  })

  child.on('error', (err) => {
    console.error(`neatd: web UI spawn error — ${err.message}`)
  })

  console.log(`neatd: web UI listening on http://localhost:${port}`)

  let stopped = false
  async function stop(): Promise<void> {
    if (stopped || !child.pid) return
    stopped = true
    try {
      child.kill('SIGTERM')
    } catch {
      /* already gone */
    }
    // Give the child up to 3s to exit gracefully, then SIGKILL.
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* gone */
        }
        resolve()
      }, 3000)
      child.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
    })
  }

  return { child, port, stop }
}
