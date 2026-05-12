// Verbatim minimisation of ~/neat-experiment/bugs/0014-types-to-redis-from-jsdoc-comment.md.
//
// The v0.3.0 extractor's tree-sitter walk descended into JSDoc comment bodies
// and treated string literals inside `@example` blocks as runtime code. This
// snippet, lifted from medusa's `packages/core/types/src/common/config-module.ts:78-90`,
// produced a CONNECTS_TO edge from `@medusajs/types` to `infra:redis:localhost`.
// Two layers of wrong: the source package is type-only (no runtime calls
// possible), and the URL inside the comment isn't even a redis URL.
//
// Filter: comment-body exclusion (ADR-065 #2).
// Expected: zero EXTRACTED edges produced from this file.

export interface ConfigModuleAdmin {
  /**
   * Where the admin UI proxies API calls to.
   *
   * @example
   * ```js title="medusa-config.ts"
   * module.exports = defineConfig({
   *   admin: {
   *     backendUrl: process.env.MEDUSA_BACKEND_URL ||
   *       "http://localhost:9000"
   *   },
   *   // ...
   * })
   * ```
   */
  backendUrl?: string
}
