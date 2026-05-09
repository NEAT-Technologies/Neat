# Screens

## Screen inventory

| Route | File | Component tree | Notes |
|-------|------|----------------|-------|
| `/` | `app/page.tsx` | `AppShell` → `TopBar + Rail + GraphCanvas + Inspector + StatusBar` | Main graph explorer |
| `/incidents` | `app/incidents/page.tsx` | Standalone — own topbar (minimal) + table | Separate full-page route |

---

## Screen 1 — Graph explorer (`/`)

### Layout

CSS grid, 3×3 areas, fixed 100vw × 100vh, `overflow: hidden` on `html/body`.

```
┌─────────────────────────────────────────────────────────┐  44px
│  topbar  topbar  topbar                                 │
├────┬────────────────────────────┬───────────────────────┤  1fr
│    │                            │                       │
│rail│       canvas               │      inspect          │
│    │                            │                       │
│    │                            │                       │
│ 56 │           1fr              │        360px          │
│px  │                            │                       │
├────┴────────────────────────────┴───────────────────────┤  28px
│  rail   status  status                                  │
└─────────────────────────────────────────────────────────┘
```

| Area | CSS class | Component | Size |
|------|-----------|-----------|------|
| topbar | `.topbar` | `TopBar` | 44px height, full width |
| rail | `.rail` | `Rail` | 56px wide, full height |
| canvas | `.canvas-wrap` | `GraphCanvas` | fills remaining |
| inspect | `.inspect` | `Inspector` | 360px wide |
| status | `.status` | `StatusBar` | 28px height |

### State: loading (initial)

- Canvas tag meta reads `loading…`
- Inspector shows italic "select a node to inspect"
- StatusBar nodes/edges show `—`
- TopBar Live button shows grey dot + "Offline"

### State: core connected

- Canvas populates with Cytoscape graph
- StatusBar shows green pulsing dot
- TopBar Live button shows green dot + "Live"
- Canvas tag meta updates to: `live · N nodes · M edges · cose layout`

### State: core unreachable

- Graph canvas stays empty (fetch to `/api/graph` silently fails)
- StatusBar Live dot stays grey (dead), shows "core offline" label
- TopBar Live shows grey dot + "Offline"

---

## Screen 2 — Incidents (`/incidents`)

### Layout

Full-page, non-grid. Own minimal topbar (not `AppShell`). Scrollable content below topbar.

```
┌─────────────────────────────────────────────────────────┐  44px
│  topbar: [N] graph view / incidents                     │
├─────────────────────────────────────────────────────────┤
│  h1: Incidents                                          │
│  subtitle: N total events — showing M                   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Node │ Time │ Type │ Message                    │    │
│  ├──────┼──────┼──────┼────────────────────────────┤    │
│  │ ...  │ ...  │ ...  │ ...                        │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### States

| State | Trigger | UI |
|-------|---------|---|
| loading | initial fetch | italic "loading…" centred below heading |
| empty | fetch succeeded, 0 events | italic "no incidents recorded" |
| error | fetch failed | red "failed to load: {message}" |
| populated | fetch succeeded, >0 events | table with rows |
| row hover | mouse over row | `td` background becomes `--ink-2` |
