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

export async function spawnWebUI(restPort: number): Promise<WebHandle> {
  const portRaw = process.env.NEAT_WEB_PORT
  const port = portRaw && portRaw.length > 0 ? Number.parseInt(portRaw, 10) : DEFAULT_WEB_PORT
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`neatd: invalid NEAT_WEB_PORT="${portRaw}"`)
  }

  await assertPortFree(port)

  const cwd = resolveWebPackageDir()
  // ADR-059 #6 — child inherits NEAT_API_URL pointing at our REST server,
  // unless the operator pre-configured it.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    NEAT_API_URL: process.env.NEAT_API_URL ?? `http://localhost:${restPort}`,
  }

  // `npm exec next start` works under both monorepo and global install.
  // `detached: false` keeps the child in our process group so signals reach it.
  const child = spawn('npm', ['exec', '--', 'next', 'start', '-p', String(port)], {
    cwd,
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
