import { z } from 'zod'
import { NodeType } from './constants.js'

export const CompatibleDriverSchema = z.object({
  name: z.string(),
  minVersion: z.string(),
})
export type CompatibleDriver = z.infer<typeof CompatibleDriverSchema>

export const ServiceNodeSchema = z.object({
  id: z.string(),
  type: z.literal(NodeType.ServiceNode),
  name: z.string(),
  language: z.string(),
  version: z.string().optional(),
  dbConnectionTarget: z.string().optional(),
  repoPath: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  incompatibilities: z
    .array(
      z.object({
        driver: z.string(),
        driverVersion: z.string(),
        engine: z.string(),
        engineVersion: z.string(),
        reason: z.string(),
      }),
    )
    .optional(),
})
export type ServiceNode = z.infer<typeof ServiceNodeSchema>

export const DatabaseNodeSchema = z.object({
  id: z.string(),
  type: z.literal(NodeType.DatabaseNode),
  name: z.string(),
  engine: z.string(),
  engineVersion: z.string(),
  compatibleDrivers: z.array(CompatibleDriverSchema),
  host: z.string().optional(),
  port: z.number().optional(),
})
export type DatabaseNode = z.infer<typeof DatabaseNodeSchema>

export const ConfigNodeSchema = z.object({
  id: z.string(),
  type: z.literal(NodeType.ConfigNode),
  name: z.string(),
  path: z.string(),
  fileType: z.string(),
})
export type ConfigNode = z.infer<typeof ConfigNodeSchema>

export const InfraNodeSchema = z.object({
  id: z.string(),
  type: z.literal(NodeType.InfraNode),
  name: z.string(),
  provider: z.string(),
  region: z.string().optional(),
  kind: z.string().optional(),
})
export type InfraNode = z.infer<typeof InfraNodeSchema>

export const GraphNodeSchema = z.discriminatedUnion('type', [
  ServiceNodeSchema,
  DatabaseNodeSchema,
  ConfigNodeSchema,
  InfraNodeSchema,
])
export type GraphNode = z.infer<typeof GraphNodeSchema>
