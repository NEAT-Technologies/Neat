# Design Tokens

**Source:** `packages/web/app/globals.css` `:root` block

---

## Palette — "ink and paper, in the dark"

### Ink (dark backgrounds)

| Token | Hex | Usage |
|-------|-----|-------|
| `--ink-0` | `#0a0a0b` | Page background, canvas bg, node label outline |
| `--ink-1` | `#111114` | Topbar, rail, inspector, statusbar, legend, minimap, canvas-toolbar |
| `--ink-2` | `#16161a` | Search bar, hover backgrounds, code blocks, metric tiles, root-cause block |
| `--ink-3` | `#1d1d22` | Active rail btn, selected state, legend row hover, scrub track |
| `--ink-4` | `#26262d` | Scrollbar thumb hover |

### Paper (text and foreground)

| Token | Hex | Usage |
|-------|-----|-------|
| `--paper-0` | `#f4efe6` | Primary text (titles, selected labels), brand mark |
| `--paper-1` | `#d8d3c9` | Default body text, table values, edge targets |
| `--paper-2` | `#9b968c` | Secondary text, icons, labels, meta |
| `--paper-3` | `#6a675f` | Tertiary / muted text, keys in kv, timestamps |
| `--paper-4` | `#46443f` | Very muted — separators, dead dot, `edge-list .conf` |

### Accent

| Token | Hex | Usage |
|-------|-----|-------|
| `--accent` | `#c8a25a` | Gold — active tab underline, selected node border, rail active bar, brand dot, minimap frame border, time scrubber playhead |

### Rules (borders)

| Token | Hex | Usage |
|-------|-----|-------|
| `--rule` | `#232328` | Primary dividers — topbar border, rail border, inspector border, group dividers |
| `--rule-soft` | `#1a1a1f` | Subtle dividers — edge list rows, incident table body rows |

---

## Provenance colours

| Token | Hex | What it means |
|-------|-----|---------------|
| `--prov-static` | `#6ea8ff` | EXTRACTED / STALE edges (blue) |
| `--prov-observed` | `#5fcf9e` | OBSERVED edges and live state (green) |
| `--prov-inferred` | `#d27ad8` | INFERRED edges, badge, rail blast-radius badge, type column in incidents (purple) |

---

## Node-type colours

All used as node background and legend swatches:

| Token | Hex | Visual type |
|-------|-----|------------|
| `--n-service` | `#d8d3c9` | service (ServiceNode) |
| `--n-db` | `#b8c7c2` | db (DatabaseNode) |
| `--n-cache` | `#c2b8a8` | cache |
| `--n-stream` | `#b8b0c8` | stream |
| `--n-queue` | `#b8b0c8` | queue (same as stream) |
| `--n-lambda` | `#c8c0a8` | lambda |
| `--n-cron` | `#b09c8a` | cron |
| `--n-api` | `#a8b8c8` | api |
| `--n-apigw` | `#98a8b8` | apigw |
| `--n-compute` | `#c8b098` | compute (InfraNode default) |
| `--n-storage` | `#a8a89c` | storage (ConfigNode) |
| `--n-external` | `#888278` | external (FrontierNode) |
| `--n-search` | `#c4b6a0` | search |
| `--n-cluster` | `#5a5750` | cluster (compound) |
| `--n-namespace` | `#45433d` | namespace (compound) |
| `--n-vpc` | `#38362f` | vpc (compound) |
| `--n-env` | `#2a2823` | env (compound) |

Note: `cloud` compound uses hardcoded `#1d1d22` (same as `--ink-3`), not a token.

---

## Typography

### Fonts

| Family | Role | Weights loaded |
|--------|------|---------------|
| Spectral (serif) | Primary UI — labels, titles, inspector headings, tabs | 300, 400, 500, 600, 700; italic 400 |
| JetBrains Mono | Technical — IDs, values, counts, search | 400, 500, 600 |
| Inter | Fallback sans | 400, 500, 600 |

Font loading: Google Fonts via `<link>` in `layout.tsx`.

Font helpers: `.mono`, `.sans`, `.serif` utility classes.

### Sizes used

| Size | Where |
|------|-------|
| 8px | Cytoscape edge labels |
| 8.5px | Node type api labels on graph |
| 9px | Rail badge, api font-size |
| 9.5px | Node labels on graph |
| 10px | Root-cause label |
| 10.5px | Tags, tab counts, kv, edge conf, kbd hint, legend counts |
| 11px | StatusBar, minimap label, legend grid, insp-sub |
| 11.5px | Topbar crumbs, inspector tabs, incidents subtitle |
| 12px | Search results, inspector kv, edge list, root-cause |
| 12.5px | Inspector top-btn, metrics lbl, legend row, incidents table |
| 13px | TopBar buttons (`.top-btn`), inspector tabs, inspector `insp-h` |
| 16px | Metric values |
| 18px | Canvas-tag title |
| 22px | Brand mark letter, inspector title (`.insp-title`) |
| 28px | Incidents h1 |

---

## CSS class system summary

| Category | Key classes |
|----------|-------------|
| Shell | `.app`, `.canvas-wrap`, `#cy` |
| TopBar | `.topbar`, `.brand`, `.crumbs`, `.top-search`, `.top-actions`, `.top-btn`, `.project-select`, `.search-results`, `.search-result-item` |
| Rail | `.rail`, `.rail-group`, `.rail-btn`, `.rail-tip`, `.badge`, `.rail-spacer` |
| Canvas overlays | `.canvas-tag`, `.canvas-toolbar`, `.zoomctl`, `.legend`, `.legend-row`, `.legend-rule`, `.nodes-grid`, `.minimap`, `.minimap-label` |
| Inspector | `.inspect`, `.inspect-tabs`, `.inspect-tab`, `.insp-section`, `.insp-eyebrow`, `.insp-title`, `.insp-sub`, `.insp-tags`, `.tag`, `.kv`, `.insp-h`, `.edge-list`, `.root-cause-block`, `.metrics`, `.metric` |
| StatusBar | `.status`, `.st-item`, `.st-spacer`, `.scrub`, `.live`, `.live-dead` |
| Incidents | `.incidents-page`, `.incidents-table`, `.incidents-empty` |
| States | `.on` (active tab/button), `.active` (rail btn), `.dim` (cy unfocused), `.hl` (cy focused), `.alive`, `.warn` (tags), `.bad` (metric delta), `.live` (green dot), `.live-dead` (grey dot) |
