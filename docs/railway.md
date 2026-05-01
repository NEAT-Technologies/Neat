# Deploying the demo to Railway

The local stack is `docker compose up`. Railway runs the same six pieces as separate services on a private network, plus the managed Postgres plugin in place of the `payments-db` container.

This runbook is a step-by-step. None of it is automated yet — Railway's IaC is opt-in and we haven't taken on the dependency. Follow it linearly and you'll end up with a deployed demo Claude Code can connect to.

## Prerequisites

- A Railway account on a plan that allows six services and one Postgres plugin (the free hobby plan is enough for the demo).
- The Railway CLI installed (`brew install railwayapp/railway/railway` or `npm i -g @railway/cli`) — only required for the optional MCP-from-anywhere step at the end.
- `gh` and `git` set up against `neat-tools/Neat`.

## Service map

| Railway service | Source                            | Public? | Notes |
|-----------------|-----------------------------------|---------|-------|
| `payments-db`   | Postgres plugin, pinned to v15    | private | not a deploy — the Add → Database → PostgreSQL flow |
| `service-b`     | `demo/service-b/`                 | private | uses pg 7.4.0 against PG 15 — this is the failing call |
| `service-a`     | `demo/service-a/`                 | public  | only this one needs a public URL — it's the entry point hit by `/data` |
| `otel-collector`| `demo/collector/`                 | private | needs a one-line config swap, see below |
| `neat-core`     | `packages/core/Dockerfile`        | public  | the REST API + OTLP receiver. MCP server connects here. |
| `neat-web`      | `packages/web/`                   | public  | Next.js shell — `/api/health` proxies to neat-core |

Public means "Generate a Domain" in Railway's networking tab. Private services only need the internal `*.railway.internal` DNS that Railway provisions automatically.

## 1. Create the project and the database

1. New project → "Deploy from GitHub repo" → pick `neat-tools/Neat`. Don't deploy any services yet — we'll add them one by one.
2. Add → Database → PostgreSQL. Once it provisions, change the version to `15` from the plugin's settings (Railway defaults to the latest major; the demo's failure mode requires 14+ specifically).
3. From the plugin's Variables tab, note the `DATABASE_URL`. Railway also exposes individual `PG*` vars; we'll wire those into `service-b` directly rather than parsing the URL.

## 2. Deploy `neat-core`

1. New service → "GitHub repo" → `neat-tools/Neat`. Set the root directory to `/` (the `packages/core/Dockerfile` build context is the repo root).
2. Settings → Build → Dockerfile Path: `packages/core/Dockerfile`.
3. Variables:

   ```
   HOST = 0.0.0.0
   PORT = 8080
   NEAT_SCAN_PATH = /demo
   NEAT_OUT_PATH = /neat-out/graph.json
   ```

   `NEAT_SCAN_PATH = /demo` matches the Dockerfile's expectation; the demo source files are baked in at build time. `/neat-out` lives on Railway's ephemeral container filesystem — if you want snapshots to survive restarts, attach a volume mounted at `/neat-out`.
4. Networking → Generate Domain. The MCP server will point at this URL.

`neat-core` exposes two ports: `8080` (REST API) and `4318` (OTLP receiver). Railway only exposes one HTTP port externally; the `4318` port is reachable internally via `*.railway.internal:4318`.

## 3. Deploy `otel-collector`

The collector image we use locally (`otel/opentelemetry-collector-contrib:0.96.0`) reads its config from a file. Docker-compose mounts the config in; Railway can't, so we ship a tiny image that bakes the config. That image is in `demo/collector/Dockerfile`.

The local config points at `http://neat-core:4318` (the docker-compose service name). On Railway, swap that hostname for the private DNS name of your neat-core service. `demo/collector/config.railway.yaml` is the variant ready to use — it reads `NEAT_CORE_HOST` from the environment.

1. New service → "GitHub repo" → `Neat`. Root directory `/demo/collector`.
2. Build → Dockerfile Path: `Dockerfile`.
3. Before deploying, replace `demo/collector/config.yaml` (the one the Dockerfile copies) with `demo/collector/config.railway.yaml` — easiest is a symlink or a small Railway-only branch. (We're keeping both files in tree because the local docker-compose stack still needs the original.)
4. Variables:

   ```
   NEAT_CORE_HOST = neat-core.railway.internal
   ```

   Replace `neat-core` with whatever you named the service in step 2 if it's different.

The collector listens on `4318` internally only.

## 4. Deploy `service-b`

1. New service → root directory `/demo/service-b`. Dockerfile Path: `Dockerfile` (the one already there).
2. Variables — pull the `PG*` values from the Postgres plugin's variable references (Railway lets you `${{ payments-db.PGHOST }}` style):

   ```
   PORT = 3001
   PGHOST = ${{ payments-db.PGHOST }}
   PGPORT = ${{ payments-db.PGPORT }}
   PGUSER = ${{ payments-db.PGUSER }}
   PGPASSWORD = ${{ payments-db.PGPASSWORD }}
   PGDATABASE = ${{ payments-db.PGDATABASE }}
   OTEL_EXPORTER_OTLP_ENDPOINT = http://otel-collector.railway.internal:4318/v1/traces
   OTEL_SERVICE_NAME = service-b
   ```

3. No public domain — service-a calls service-b on the private network.

## 5. Deploy `service-a`

1. New service → root directory `/demo/service-a`. Dockerfile Path: `Dockerfile`.
2. Variables:

   ```
   PORT = 3000
   SERVICE_B_URL = http://service-b.railway.internal:3001
   OTEL_EXPORTER_OTLP_ENDPOINT = http://otel-collector.railway.internal:4318/v1/traces
   OTEL_SERVICE_NAME = service-a
   ```

3. Networking → Generate Domain. This is the `/data` endpoint you'll curl to drive traffic.

## 6. Deploy `neat-web`

1. New service → root directory `/packages/web`. Railway should auto-detect Next.js; no Dockerfile required.
2. Variables:

   ```
   NEAT_CORE_URL = https://<your neat-core domain>
   ```

3. Networking → Generate Domain.

## 7. Smoke-test the deployment

```bash
# Drive traffic through the failure path.
for i in {1..10}; do curl -s https://<service-a domain>/data; done

# Confirm core saw the spans + the inferred edge.
curl -s https://<neat-core domain>/graph | jq '.edges[] | select(.id | contains("OBSERVED") or contains("INFERRED"))'

# Confirm the incident log.
curl -s https://<neat-core domain>/incidents | jq '.[0]'
```

Expected: at least two edges (OBSERVED `CALLS`, INFERRED `CONNECTS_TO`) and one incident with `affectedNode: "database:payments-db"`.

## 8. Point Claude Code at the deployed core

The MCP server runs locally and talks to deployed neat-core over HTTPS. From your laptop:

```bash
NEAT_CORE_URL=https://<your neat-core domain> \
  claude mcp add neat -- node "$(pwd)/packages/mcp/dist/index.cjs"
```

Then in any Claude Code session: *"Why is payments-db failing?"* — same expected output as the local quickstart, with confidence 0.7 once the trace stitcher has populated the INFERRED CONNECTS_TO edge from the deployed traffic.

## Cost guardrails

The demo idles at near-zero CPU when nothing's hitting `/data`. The two cost surprises:

- **OTel collector buffer** — the `logging` exporter writes spans to stdout, which ends up in Railway's log stream. If you leave the demo idle for days under high traffic the log volume will dominate the bill. Drop the `logging` exporter from `config.railway.yaml` once you've verified spans are flowing.
- **Postgres storage** — the demo never inserts anything, so storage stays in MB. Don't attach the Postgres plugin to anything else.

## Rollback / teardown

Each service is independent. To tear down: delete the services and the Postgres plugin. The repo is unchanged.
