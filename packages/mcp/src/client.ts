// Thin HTTP client for the neat-core REST surface. Tools call out via this
// instead of fetch() directly so tests can swap in a stub implementation
// without monkey-patching globals.

export interface HttpClient {
  get<T>(path: string): Promise<T>
}

export function createHttpClient(baseUrl: string): HttpClient {
  const root = baseUrl.replace(/\/$/, '')
  return {
    async get<T>(path: string): Promise<T> {
      const res = await fetch(`${root}${path}`)
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new HttpError(res.status, `${res.status} ${res.statusText} on GET ${path}: ${body}`)
      }
      return (await res.json()) as T
    },
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
