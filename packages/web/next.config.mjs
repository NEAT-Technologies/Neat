/** @type {import('next').NextConfig} */
const nextConfig = {
  // ADR-064 — ship a self-contained server bundle in the npm tarball so
  // `npm install -g neat.is` produces a runnable web UI without the operator
  // having to `next build` locally. `output: 'standalone'` produces the
  // runtime + a minimal copy of `node_modules` under `.next/standalone/`.
  //
  // In a monorepo, Next auto-detects the workspace root as the tracing root,
  // which puts the runtime at `.next/standalone/packages/web/server.js`
  // (path preserved relative to the tracing root). `.next/static` lives next
  // to `.next/standalone` and must be copied into
  // `.next/standalone/packages/web/.next/static` before the tarball ships —
  // the `prepublishOnly` script handles that.
  output: 'standalone',
};

export default nextConfig;
