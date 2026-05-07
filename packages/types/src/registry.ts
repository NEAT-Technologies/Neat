import { z } from 'zod'

// Machine-level project registry (ADR-048). Single file at
// `~/.neat/projects.json`, per-user, machine-local. The wire shape lives here
// so the registry module and the daemon agree on it without a circular
// dependency through @neat/core.

export const RegistryStatusSchema = z.enum(['active', 'paused', 'broken'])
export type RegistryStatus = z.infer<typeof RegistryStatusSchema>

export const RegistryEntrySchema = z.object({
  // Unique within the registry. Project-scoped operations (`neat watch
  // --project <name>`, `neatd reload <name>`) key on this. Collisions are a
  // hard error at registration time.
  name: z.string().min(1),
  // Resolved absolute path on disk. Path normalisation is what keeps two
  // `neat init` calls from different relative paths from creating two entries
  // for the same directory.
  path: z.string().min(1),
  // ISO8601, set at first registration.
  registeredAt: z.string(),
  // ISO8601, updated whenever the daemon successfully sees the project.
  // Optional because a freshly-registered project hasn't been seen yet.
  lastSeenAt: z.string().optional(),
  // Languages detected at `init` time. Free-form strings keyed off the
  // installer modules — `'javascript'`, `'python'`, …
  languages: z.array(z.string()),
  status: RegistryStatusSchema,
})
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>

export const RegistryFileSchema = z.object({
  version: z.literal(1),
  projects: z.array(RegistryEntrySchema),
})
export type RegistryFile = z.infer<typeof RegistryFileSchema>

export const EMPTY_REGISTRY: RegistryFile = { version: 1, projects: [] }
