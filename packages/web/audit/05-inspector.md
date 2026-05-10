# Inspector Component

**File:** `packages/web/app/components/Inspector.tsx`  
**CSS:** `.inspect`, `.inspect-tabs`, `.inspect-tab`, `.insp-section`, `.insp-eyebrow`, `.insp-title`, `.insp-sub`, `.insp-tags`, `.tag`, `.kv`, `.insp-h`, `.edge-list`, `.root-cause-block`, `.metrics`

---

## Empty state

When no node is selected (`selectedNodeId === null` or node fetch not yet returned):

```
┌─────────────────────────────────────────────┐
│  Inspect  Edges  Owners  History             │  ← tab bar (Inspect has .on class)
├─────────────────────────────────────────────┤
│                                             │
│         select a node to inspect            │  ← italic, Spectral, --paper-3, centred
│                                             │
└─────────────────────────────────────────────┘
```

All four tabs are visible but only "Inspect" is `.on`. No tab click handler in this state.

---

## Tabs

Four tabs. Only "Inspect" and "Edges" are functional.

| Tab | Class | Functional | Notes |
|-----|-------|-----------|-------|
| Inspect | `.inspect-tab` + `.on` when active | Yes | Main detail view |
| Edges | `.inspect-tab` + count badge | Yes | Shows all edges flat |
| Owners | `.inspect-tab` | No | Visual stub, no click handler wired to content |
| History | `.inspect-tab` | No | Visual stub |

Active tab: `border-bottom-color: --accent`, `color: --paper-0`, italic.  
Inactive: `color: --paper-2`, no underline.

Edge tab shows `<span class="ct">{edgeCount}</span>` — JetBrains Mono 10.5px, `--paper-3`.

---

## Inspect tab — populated state

When a node is selected and fetched, renders these sections in order:

### Section 1 — Identity header

```
SERVICE                          ← .insp-eyebrow (JetBrains Mono 10.5px uppercase)
checkout/payments                ← .insp-title (Spectral 22px)
  ↑ stem (italic, --paper-2)
service:checkout                 ← .insp-sub (JetBrains Mono 11px, --paper-2)

[tag] [tag] [tag]               ← .insp-tags
```

Name splitting: if node name contains `/`, the prefix before the first `/` becomes `.stem` (italic `--paper-2`), the rest is the main title.

Tags rendered (from node data):
- `language` value if present
- `engine` value if present
- `kind` value if present
- If none of the above: fallback = lowercased `typeLabel`

Tag classes: `.tag` (base), `.tag.alive` (green border), `.tag.warn` (purple border) — only base class used in current code.

### Section 2 — Metrics (synthetic)

Shown for all types **except** `ConfigNode` and `FrontierNode`.

Three metric tiles in a 3-column grid:

| Tile | Label | Value | Delta |
|------|-------|-------|-------|
| req/s | "req/s" | `40-240` (random) | `+0.0–4.0%` (random, always positive) |
| p99 ms | "p99 ms" | `38–102ms` (random) | `±0–8%` (bad class if p99 > 80) |
| err % | "err %" | `0–0.7%` (random) | `±0–0.3` (bad class if err > 0.4) |

`.metric.delta.bad` → color `#e87a7a` (red).  
All values are `Math.random()` — no real metrics API exists.

### Section 3 — Root cause (conditional)

Only shown when `GET /api/graph/root-cause/:id` returns a result with `rootCauseNode !== null`.

```
┌────────────────────────────────┐
│ divergence detected             │  ← rc-label (JetBrains Mono, --prov-inferred)
│ service:payments                │  ← rc-node (JetBrains Mono 12px, --paper-0)
│ version mismatch on pg driver   │  ← rc-reason (Spectral italic, --paper-1)
│ upgrade pg to 8.x               │  ← rc-fix (Spectral, --prov-observed) — optional
└────────────────────────────────┘
```

### Section 4 — Properties

Shown only when `nodeProps(node)` returns at least 1 entry.

`<dl class="kv">` — 2-column grid (110px label, 1fr value):

| Key | Source field |
|-----|-------------|
| language | `node.language` |
| version | `node.version` |
| engine | `node.engine` |
| engine version | `node.engineVersion` |
| provider | `node.provider` |
| region | `node.region` |
| kind | `node.kind` |
| host | `node.host` |
| port | `node.port` |
| file type | `node.fileType` |
| path | `node.path` |
| first seen | `node.firstObserved` |
| last seen | `node.lastObserved` |

`dt`: Spectral italic `--paper-3`. `dd`: JetBrains Mono `--paper-1`.

### Section 5 — Outgoing edges

`<ul class="edge-list">` listing all edges where `edge.source === node.id`.

Each `<li>`:
```
● calls   checkout-payments   0.95
^verb      ^target (name)     ^confidence
```

| Element | Class | Font | Color |
|---------|-------|------|-------|
| Prov dot | `.pdot.STATIC/.OBSERVED/.INFERRED` | — | blue/green/purple |
| Verb | `.verb` | Spectral italic 70px fixed | `--paper-2` |
| Target name | `.target` | JetBrains Mono, truncated | `--paper-1` |
| Confidence | `.conf` | JetBrains Mono 10.5px | `--paper-3` |

Empty: shows `— no outgoing edges` in `--paper-3`.

### Section 6 — Incoming edges

Same structure as outgoing, but filtered to `edge.target === node.id`.

### Section 7 — Provenance bar chart

Three rows: STATIC, OBSERVED, INFERRED.

Each row:
- Coloured dot
- Italic label (70px width)
- Progress bar (`--ink-3` background, colour fill for percentage)
- Count (JetBrains Mono 10.5px, right-aligned 34px)

---

## Edges tab — populated state

Flat list of ALL edges (out + in combined) via `<ul class="edge-list">`.

Same `<li>` structure as Inspect tab edge rows. Header: "All edges N".

---

## API dependencies

| Endpoint | When | Data used |
|----------|------|-----------|
| `GET /api/graph/node/:id` | on `selectedNodeId` change | node detail |
| `GET /api/graph/root-cause/:id` | on `selectedNodeId` change | root cause block |
| `graphData.edges` (prop) | derived locally | all edge rows — no extra fetch |
