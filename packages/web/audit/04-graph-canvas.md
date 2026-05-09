# Graph Canvas Component

**File:** `packages/web/app/components/GraphCanvas.tsx`  
**CSS:** `.canvas-wrap`, `.canvas-tag`, `.canvas-toolbar`, `.zoomctl`, `.legend`, `.minimap`

---

## Overlay layout

```
┌────────────────────────────────────────────────────────────────────────┐
│  NEAT  live · N nodes · M edges · cose layout     [Locked][Fit][Center]│  ← canvas-tag (top-left) + canvas-toolbar (top-right)
│                                                   [Layout: cose]       │
│                                                                         │
│                   (Cytoscape graph — #cy)                               │
│                                                            [+]          │  ← zoomctl (right edge, below toolbar)
│                                                            [−]          │
│                                                            [⌖]          │
│                                                                         │
│  ┌─────────────────────┐                  ┌──────────────────────────┐  │
│  │ Edge provenance     │                  │  overview (minimap)      │  │  ← legend (bottom-left), minimap (bottom-right)
│  │  — Static       N   │                  │  [canvas rendering]      │  │
│  │  -- Observed    N   │                  └──────────────────────────┘  │
│  │  ·· Inferred    N   │                                                │
│  │  ─────────────────  │                                                │
│  │ Node kind           │                                                │
│  │  ■ service  ■ db    │                                                │
│  └─────────────────────┘                                                │
└────────────────────────────────────────────────────────────────────────┘
```

Background: radial gradients (blue at top-left, purple at bottom-right) + 24px grid dots, all over `--ink-0`.

---

## Canvas tag (`.canvas-tag`)

Top-left overlay. Pointer-events: none (not interactive).

| Element | Class | Content | Font |
|---------|-------|---------|------|
| Title | `.title` | "NEAT" | Spectral italic 18px, `--paper-0` |
| Meta | `.meta` | "loading…" → "live · N nodes · M edges · cose layout" | JetBrains Mono 11px, `--paper-3` |

---

## Canvas toolbar (`.canvas-toolbar`)

Top-right overlay. Background `--ink-1`, border `--rule`, padding 3px, gap 4px.

| Button | Initial state | Action |
|--------|--------------|--------|
| **Locked** | `.on` class (active) | No toggle wired — visual stub |
| **Fit** | normal | `cy.fit(undefined, 40)` — fits all nodes with 40px padding |
| **Center** | normal | `cy.center()` — pans to centre of graph |
| **Layout: cose** | normal | **Stub** — label only, no re-layout action wired |

Divider: `<span class="div">` — 1px vertical rule.

Button hover: background `--ink-3`, color `--paper-0`.  
Button `.on`: background `--ink-3`, color `--paper-0` (same as hover).

---

## Zoom controls (`.zoomctl`)

Right edge, 56px from top. Stack of 3 buttons (30×28px each).

| Button | `id` | Action |
|--------|------|--------|
| `+` | `z-in` | `cy.zoom * 1.2` centred on canvas centre |
| `−` | `z-out` | `cy.zoom / 1.2` centred on canvas centre |
| `⌖` | `z-fit` | `cy.fit(undefined, 60)` |

---

## Provenance legend (`.legend`)

Bottom-left. Background `--ink-1`, border `--rule`, min-width 220px.

### Edge provenance rows

Each row has `data-prov` attribute. Clicking **toggles** that provenance type on/off (hides matching edges).

| Row | `data-prov` | Swatch style | Label | Count element |
|-----|------------|-------------|-------|---------------|
| Static | `STATIC` | Solid line, `--prov-static` (#6ea8ff blue) | "Static" | `#ct-static` |
| Observed | `OBSERVED` | Dashed line, `--prov-observed` (#5fcf9e green) | "Observed" | `#ct-observed` |
| Inferred | `INFERRED` | Dotted line, `--prov-inferred` (#d27ad8 purple) | "Inferred" | `#ct-inferred` |

Toggle behaviour:
- Click → adds prov key to `provFilterRef` Set → sets matching edges to `display: none`
- Click again → removes from Set → shows edges
- Row opacity drops to 0.4 when filtered

### Node kind grid (2-column)

Read-only colour key. 10 entries:

| Label | CSS variable |
|-------|-------------|
| service | `--n-service` |
| db | `--n-db` |
| cache | `--n-cache` |
| stream | `--n-stream` |
| lambda | `--n-lambda` |
| cron | `--n-cron` |
| api | `--n-api` |
| compute | `--n-compute` |
| storage | `--n-storage` |
| external | `--n-external` |

Each: 9×9px colour square (`border-radius: 2px`) + label (11px, `--paper-2`). Not interactive.

---

## Minimap (`.minimap`)

Bottom-right. 220×150px, `--ink-1` background, `--rule` border, border-radius 4px.

| Element | Description |
|---------|-------------|
| Label | `.minimap-label` — "overview", Spectral italic 11px, `--paper-3` |
| Canvas | `<canvas>` — raw 2D rendering of all nodes (dots) and edges (lines) |
| Frame | `.frame` div — absolute positioned, `--accent` border + 8% gold bg, shows current viewport |

Updates: on `cy.on('viewport zoom pan render')` + `window.resize` via `requestAnimationFrame(drawMinimap)`.

---

## Cytoscape graph (`#cy`)

Fills entire canvas area. Configured with:

```
minZoom: 0.001  maxZoom: 50  wheelSensitivity: 0.25
autoungrabify: true  (nodes not draggable)
autounselectify: false
boxSelectionEnabled: false
```

Layout: `cose`, `animate: false`, `randomize: true`, `idealEdgeLength: 90`, `nodeRepulsion: 9000`

### Node types and visual styles

| Visual type | Source types | Shape | Approx size |
|-------------|-------------|-------|-------------|
| service | ServiceNode | round-rectangle | 32px |
| db | DatabaseNode | barrel | 34px |
| storage | ConfigNode | round-tag | 28px |
| external | FrontierNode | round-octagon | 30px |
| compute | InfraNode (default) | round-rectangle | 32px |
| cluster | InfraNode kind=cluster | round-rectangle | compound |
| namespace | InfraNode kind=namespace | round-rectangle | compound |
| vpc | InfraNode kind=vpc/network | round-rectangle | compound |
| cache | (future) | barrel | 28px |
| stream | (future) | cut-rectangle | 32px |
| queue | (future) | cut-rectangle | 28px |
| lambda | (future) | diamond | 30px |
| cron | (future) | tag | 26px |
| api | (future) | round-rectangle | 22px (8px in graph) |
| apigw | (future) | round-rectangle | 36×22px |
| search | (future) | barrel | 28px |

### Edge styles by provenance

| Provenance (visual) | Line style | Width | Opacity | Color |
|--------------------|-----------|-------|---------|-------|
| STATIC | solid | 1.2 | 0.75 | `--prov-static` |
| OBSERVED | dashed | 1.4 | 0.85 | `--prov-observed` |
| INFERRED | dotted | 1.0 | 0.55 | `--prov-inferred` |

All edges: bezier curve, triangle-backcurve arrowhead, edge-type label (min-zoom 11px).

### Selection behaviour

1. Click node → `cy.$(':selected').unselect()` → select tapped node → `focusNode(id)`
2. `focusNode(id)`:
   - Node + its neighbourhood → `.hl` class (opacity 1, highlighted edge widens)
   - All other elements → `.dim` class (nodes: opacity 0.18, edges: opacity 0.08)
   - Calls `onNodeSelect(id)` → lifts to AppShell → Inspector receives new `selectedNodeId`
3. Click canvas background → clear `.hl`/`.dim` from all, deselect all

### Selected node style

- `border-color: --accent` (gold), border-width 2px
- `background-opacity: 1`
- Label color: `#f4efe6`
- `font-weight: 600`
- `z-index: 999`

Auto-selects first leaf node on `cy.ready()` after 80ms delay.

### Trackpad handling

Custom `wheel` event handler (capture phase):

- `ctrlKey` down → pinch-zoom: `cy.zoom(factor)` centred on cursor
- Otherwise → pan: `cy.panBy({ x: -deltaX, y: -deltaY })`

### SSE live updates

`EventSource` on `/api/events`. Handles:

| Event | Action |
|-------|--------|
| `node-added` | `cy.add(node element)` |
| `edge-added` | `cy.add(edge element)` |
| `node-removed` | `cy.getElementById(id).remove()` |
| `edge-removed` | `cy.getElementById(id).remove()` |
| `error` | silently ignored (pre-v0.2.8) |

---

## API dependencies

| Endpoint | When | Data used |
|----------|------|-----------|
| `GET /api/graph` | on mount | full graph `{ nodes, edges }` |
| `GET /api/events` (SSE) | persistent after mount | live mutations |
