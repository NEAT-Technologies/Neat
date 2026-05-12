// Verbatim minimisation of ~/neat-experiment/bugs/0016-utils-to-redis-from-postgres-test-string.md.
//
// The v0.3.0 extractor produced a CALLS edge from `@medusajs/utils` to
// `infra:redis:localhost` from a postgres URL string in a `__tests__/*.spec.ts`
// file. Triple-wrong: the URL scheme was postgres (not redis), the file was a
// test (not runtime), and the target was matched by `localhost` substring
// regardless of protocol.
//
// Filter: test-scope exclusion (ADR-065 #1).
// Expected: zero EXTRACTED edges produced from this file.

describe('defineConfig', () => {
  it('parses a database url', () => {
    const config = {
      databaseUrl: "postgres://localhost/medusa-starter-default",
    }
    expect(config).toBeDefined()
  })
})
