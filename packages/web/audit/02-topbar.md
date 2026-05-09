# TopBar Component

**File:** `packages/web/app/components/TopBar.tsx`  
**CSS:** `.topbar`, `.brand`, `.crumbs`, `.top-search`, `.top-actions`, `.top-btn`

---

## Visual anatomy

```
┌──────┬──────────────────────┬────────┬─────────────────────────────────┬───────────────────────────┐
│  N·  │  project / graph view│        │ 🔍 find · query · @author · ⌘K │ ● Live  ⏱ History 📦 Share │
└──────┴──────────────────────┴────────┴─────────────────────────────────┴───────────────────────────┘
 brand   crumbs                spacer   top-search (320px)                top-actions
```

---

## Elements

### Brand mark (`.brand`)

| Property | Value |
|----------|-------|
| Content | Letter "N" |
| Font | Spectral 22px italic 500 |
| Color | `--paper-0` |
| Size | 56×44px |
| Border | right 1px `--rule` |
| Decoration | gold dot (`::after`, `--accent`, 4px circle) |
| `title` attr | "NEAT" |
| Cursor | default (not interactive) |

---

### Breadcrumb / project area (`.crumbs`)

Two variants based on number of registered projects:

#### Single project (≤1 project from API)

```
[project-name-in-mono] / graph view
```

- Project name: `<span class="repo">` — JetBrains Mono 12px, `--paper-1`
- Separator: `<span class="sep">` — `/`, color `--paper-4`
- Current page: `<span class="here">` — italic, `--paper-0`

#### Multi-project (>1 project from API)

```
[select▼] / graph view
```

- `<select class="project-select">` — JetBrains Mono 12px, background `--ink-2`, border `--rule`
- On change: calls `onProjectChange(value)` — lifts to `AppShell` → passed to `GraphCanvas` as `project` prop
- On focus: border becomes `--accent` (gold)

---

### Search bar (`.top-search`)

Fixed width 320px. JetBrains Mono 12px.

| Element | Tag | Behaviour |
|---------|-----|-----------|
| Search icon | `<svg>` | Static, 13×13, stroke `currentColor` |
| Input | `<input>` | Controlled, `value={query}`, fires debounced search |
| Keyboard hint | `<span class="kbd">⌘K</span>` | Shown only when `query` is empty |
| Dropdown | `.search-results` | Shown when results exist and input focused |

#### Search interaction flow

1. User types → 280ms debounce → `GET /api/search?q={query}`
2. Up to 8 results shown in absolute dropdown (`.search-results`)
3. Click-outside (mousedown on `document`) → hides dropdown
4. Clicking a result → clears query, hides dropdown (no navigation yet — stub)
5. Re-focus with existing results → shows dropdown again

#### Search result item (`.search-result-item`)

| Slot | Class | Font | Color |
|------|-------|------|-------|
| Name | `.sr-name` | JetBrains Mono | `--paper-1` |
| Type | `.sr-type` | Spectral italic 11px | `--paper-3` |
| Score | `.sr-score` | JetBrains Mono 10.5px | `--paper-4` |

Hover: background `--ink-3`.

---

### Top-right actions (`.top-actions`)

Three buttons with `gap: 4px`.

#### Live / Offline button

| State | Dot color | Label |
|-------|-----------|-------|
| Connected (`isLive: true`) | `--prov-observed` (green) | "Live" |
| Disconnected (`isLive: false`) | `--paper-4` (grey) | "Offline" |

- Polls `GET /api/health` every 15 seconds
- CSS class `.dot.live` adds green color; `.dot` alone = grey

#### History button

- Icon: clock SVG
- Label: "History"
- **Stub** — no action wired, no panel opens

#### Share button

- Icon: diamond/3D shape SVG
- Label: "Share"
- **Stub** — no action wired

---

## Button base styles (`.top-btn`)

| Property | Value |
|----------|-------|
| Height | 28px |
| Padding | 0 10px |
| Background | transparent (idle) → `--ink-2` (hover) |
| Border | transparent (idle) → `--rule` (hover) |
| Border-radius | 4px |
| Font | Spectral 13px |
| Color | `--paper-1` |
| Cursor | pointer |

`.top-btn.primary` variant (unused currently): background `--paper-0`, color `--ink-0`, font-weight 500.

---

## API dependencies

| Endpoint | When | Data used |
|----------|------|-----------|
| `GET /api/projects` | on mount | project list for switcher |
| `GET /api/health` | on mount + every 15s | `d.ok` → Live/Offline state |
| `GET /api/search?q=` | on query change (debounced 280ms) | `d.results[]` → dropdown |
