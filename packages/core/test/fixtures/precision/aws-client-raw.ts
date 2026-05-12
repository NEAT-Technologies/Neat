// Verbatim minimisation of ~/neat-experiment/bugs/0007-file-s3-to-grpc-s3.md.
//
// The v0.3.0 extractor produced `infra:grpc-service:S3` from a raw
// `new S3Client(config)` constructor — defaulting any unknown `*Client(...)`
// to gRPC. AWS S3 is REST/HTTP, not gRPC. There's also no actual hostname
// in the snippet (config is injected at runtime).
//
// This fixture covers two related concerns:
//   - Precision (ADR-065): a raw `new S3Client()` with no `@aws-sdk/*` import
//     context shouldn't pin a specific protocol or hostname out of thin air.
//   - AWS SDK kind classification (#238): when `@aws-sdk/client-s3` IS imported,
//     the kind should be `infra:aws-s3:*`, not `infra:grpc-service:*`.
//
// Expected: no `infra:grpc-service:*` edge produced from this file. With
// the @aws-sdk/client-s3 import in scope (#238 implementation), the
// classification flips to infra:aws-s3:S3.

import { S3Client } from '@aws-sdk/client-s3'

interface S3Config {
  region: string
  endpoint?: string
  additionalClientConfig?: Record<string, unknown>
}

export function buildS3Client(config: S3Config): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    ...config.additionalClientConfig,
  })
}
