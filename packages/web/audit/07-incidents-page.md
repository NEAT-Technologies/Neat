# Incidents Page

**File:** `packages/web/app/incidents/page.tsx`  
**CSS:** `.incidents-page`, `.incidents-table`, `.incidents-empty`, topbar reuses `.topbar`, `.brand`, `.crumbs`

---

## Layout

Standalone page — does NOT use `AppShell`. Has its own minimal topbar.

```
┌─────────────────────────────────────────────────────────┐  44px
│ [N]  graph view / incidents                             │  ← .topbar (same class as main)
├─────────────────────────────────────────────────────────┤
│ Incidents                                               │  ← h1 (Spectral italic 28px)
│ 1234 total events — showing 100                         │  ← .subtitle (JetBrains Mono 11.5px)
│                                                         │
│ Node │ Time            │ Type     │ Message             │
│ ─────┼─────────────────┼──────────┼──────────────────── │
│ ...  │ MM/DD/YYYY HH:MM│ ERR_TYPE │ Something went...   │
└─────────────────────────────────────────────────────────┘
```

Page padding: 24px top/bottom, 32px left/right. Max-width 1000px. Scrollable (height: calc(100vh - 44px)).

---

## Topbar (minimal, inline — not `<TopBar>` component)

| Element | Description |
|---------|-------------|
| `.brand` | Letter "N", same styles as main app |
| `.crumbs` | `<Link href="/">graph view</Link>` / `<span class="here">incidents</span>` |

Link: JetBrains Mono 12px, `--paper-2`, no underline, navigates back to `/`.  
"here" label: `incidents`, `--paper-0`, italic.

---

## States

### Loading

```
loading…
```
Rendered as `.incidents-empty` — Spectral italic, `--paper-3`, centred, `padding: 32px 0`.

### Error

```
failed to load: {error.message}
```
Rendered as `.incidents-empty` with `color: #e87a7a` (red).

### Empty (no incidents)

```
no incidents recorded
```
Rendered as `.incidents-empty`.

### Populated (>0 incidents)

Table: `<table class="incidents-table">`, full-width, `border-collapse: collapse`.

---

## Table columns

| Column | `<th>` text | `<td>` class | Font | Color |
|--------|------------|------------|------|-------|
| Node | "Node" | `.td-node` | JetBrains Mono | `--paper-1` |
| Time | "Time" | `.td-time` | JetBrains Mono 11px | `--paper-3` |
| Type | "Type" | `.td-type` | JetBrains Mono 11px | `--prov-inferred` (purple) |
| Message | "Message" | `.td-msg` | Spectral italic | `--paper-1` |

Table header: Spectral italic 500 11.5px, `--paper-2`, border-bottom `--rule`.  
Table body rows: border-bottom `--rule-soft`.  
Row hover: `td` background → `--ink-2`.

---

## Data source

`GET /api/incidents?limit=100`

Response shape used:
```typescript
interface IncidentsResponse {
  count: number
  total: number
  events: Incident[]
}
interface Incident {
  nodeId: string
  timestamp: string   // ISO 8601
  type: string
  message: string
  stacktrace?: string  // fetched but not displayed
}
```

Subtitle shows: `${data.total} total events — showing ${data.events.length}`.

---

## Timestamp formatting

```typescript
function formatTs(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toTimeString().slice(0, 8)
  // → "5/9/2026 14:22:31"
}
```

Uses locale date format + first 8 chars of `toTimeString()` (HH:MM:SS, no timezone).

---

## Missing / gaps

- `stacktrace` field is in the type but never rendered (no expand/collapse row)
- No pagination (hard limit 100)
- No sorting or filtering
- No link from incident row back to the node in graph view
- "⚠ Incidents" rail button has no badge count (unlike blast-radius)
