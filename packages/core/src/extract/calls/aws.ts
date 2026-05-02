import path from 'node:path'
import { lineOf, snippet, type ExternalEndpoint, type SourceFile } from './shared.js'

// AWS SDK v3 calls. We catch S3 (`Bucket: "x"` near a `S3Client`-using
// PutObjectCommand / GetObjectCommand / DeleteObjectCommand) and DynamoDB
// (`TableName: "x"` near GetCommand / PutCommand / DynamoDBClient). The
// pattern is intentionally permissive: a literal Bucket/TableName near an
// SDK constant is good enough evidence; misses are fine because non-static
// resources can't be catalogued anyway.
const S3_BUCKET_RE = /Bucket\s*:\s*['"`]([^'"`]+)['"`]/g
const DYNAMO_TABLE_RE = /TableName\s*:\s*['"`]([^'"`]+)['"`]/g

function hasMarker(text: string, markers: string[]): boolean {
  return markers.some((m) => text.includes(m))
}

function findAll(re: RegExp, text: string): { name: string; index: number }[] {
  re.lastIndex = 0
  const out: { name: string; index: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({ name: m[1]!, index: m.index })
  }
  return out
}

export function awsEndpointsFromFile(
  file: SourceFile,
  serviceDir: string,
): ExternalEndpoint[] {
  const out: ExternalEndpoint[] = []
  const seen = new Set<string>()
  const make = (kind: string, name: string): void => {
    const key = `${kind}|${name}`
    if (seen.has(key)) return
    seen.add(key)
    const line = lineOf(file.content, name)
    out.push({
      infraId: `infra:${kind}:${name}`,
      name,
      kind,
      edgeType: 'CALLS',
      evidence: {
        file: path.relative(serviceDir, file.path),
        line,
        snippet: snippet(file.content, line),
      },
    })
  }

  if (hasMarker(file.content, ['S3Client', 'PutObjectCommand', 'GetObjectCommand', 'DeleteObjectCommand'])) {
    for (const { name } of findAll(S3_BUCKET_RE, file.content)) make('s3-bucket', name)
  }
  if (
    hasMarker(file.content, [
      'DynamoDBClient',
      'DynamoDBDocumentClient',
      'GetCommand',
      'PutCommand',
      'QueryCommand',
      'UpdateCommand',
      'DeleteCommand',
    ])
  ) {
    for (const { name } of findAll(DYNAMO_TABLE_RE, file.content)) make('dynamodb-table', name)
  }
  return out
}
