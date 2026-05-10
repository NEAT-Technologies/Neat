# Rail Component

**File:** `packages/web/app/components/Rail.tsx`  
**CSS:** `.rail`, `.rail-group`, `.rail-btn`, `.rail-tip`, `.badge`, `.rail-spacer`

---

## Visual anatomy

```
┌────┐
│ ⬡  │  Graph (active — gold left bar)
│ ≡  │  Layers
│ 🔍 │  Find
├────┤  (divider)
│ ⊞  │  NeatScript
│ ⏱  │  Time travel
│ ⊙  │  Blast radius  [9] badge
│ </> │  Diff
├────┤  (divider)
│ 💬 │  Comments
│ ⚠  │  Incidents  (→ /incidents link)
│ ✦  │  Agents
│    │
│    │  (spacer — flex: 1)
│    │
├────┤  (divider top)
│ ⚙  │  Settings
└────┘
```

Width: 56px. Each button: 36×36px, border-radius 4px.

---

## Button inventory

| # | Label | Icon shape | Keyboard hint | Action | Status |
|---|-------|-----------|---------------|--------|--------|
| 1 | Graph | 4-circle network | `G` | Active state only (no toggle) | Visual stub |
| 2 | Layers | 3-line stack | `L` | None | Stub |
| 3 | Find | Circle + magnifier | `F` | None | Stub |
| 4 | NeatScript | 4-square grid | `N` | None | Stub |
| 5 | Time travel | Circle clock | `T` | None | Stub |
| 6 | Blast radius | Concentric circles | `B` | None | Stub — **has badge** |
| 7 | Diff | Code angle brackets | `D` | None | Stub |
| 8 | Comments | Chat bubble | `C` | None | Stub |
| 9 | Incidents | Warning triangle | _(none)_ | `<Link href="/incidents">` | **Navigates** |
| 10 | Agents | Sunburst / rays | `A` | None | Stub |
| 11 | Settings | Gear | _(none)_ | None | Stub |

---

## Active state (button 1 — Graph)

Class `.rail-btn.active`:

- Background: `--ink-3`
- Color: `--paper-0`
- Left accent bar: `::before` pseudo — 2px wide, `--accent` (gold), positioned at left edge, inset 8px top/bottom

---

## Tooltip (`.rail-tip`)

Each button has an absolutely positioned tooltip that appears on hover:

- Position: 44px right of button, vertically centred
- Background: `--ink-3`, border `--rule`, border-radius 3px
- Font: Spectral 11.5px
- Keyboard shortcut shown in `.k` span — JetBrains Mono 10.5px, `--paper-3`
- Transition: `opacity 0.12s`
- Hidden by default (`opacity: 0`), shown on `.rail-btn:hover` (`opacity: 1`)

---

## Blast-radius badge (`.badge`)

Rendered inside button #6 (Blast radius) when `blastBadge > 0`.

| Property | Value |
|----------|-------|
| Position | absolute top-right of button (top 4px, right 4px) |
| Size | min-width 14px, height 14px |
| Background | `--prov-inferred` (purple) |
| Color | `--ink-0` (dark) |
| Font | JetBrains Mono 9px 600 |
| Shape | border-radius 7px (pill) |
| Max value | 9 (violations.length capped at 9) |

Source: `GET /api/policies/violations` on mount. Falls back to 0 on error.

---

## Rail groups and dividers

```
group 1: Graph, Layers, Find
─── divider (border-top: 1px --rule, margin-top 4px) ───
group 2: NeatScript, Time travel, Blast radius, Diff
─── divider ───
group 3: Comments, Incidents, Agents
.rail-spacer (flex: 1 — pushes settings to bottom)
─── divider (border-top on group wrapper) ───
group 4: Settings
```

---

## API dependencies

| Endpoint | When | Data used |
|----------|------|-----------|
| `GET /api/policies/violations` | on mount | `d.violations.length` → badge count |
