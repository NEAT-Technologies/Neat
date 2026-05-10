# Gaps and Stubs

Unimplemented elements, visual stubs, known missing behaviours, and improvement candidates.

---

## Stub buttons — no action wired

These buttons render correctly but do nothing when clicked.

### TopBar

| Button | Location | What it should do |
|--------|----------|-------------------|
| History | `TopBar` top-right | Time-travel panel or graph history view |
| Share | `TopBar` top-right | Share current graph state / URL copy |
| Layout: cose | `GraphCanvas` canvas-toolbar | Trigger re-layout (different algorithms) |
| Locked | `GraphCanvas` canvas-toolbar | Toggle node dragging (`autoungrabify`) |

### Rail

| Button | Keyboard hint | What it should do |
|--------|--------------|-------------------|
| Layers | `L` | Open layered view / group by layer |
| Find | `F` | Open find panel or focus search bar |
| NeatScript | `N` | Open NeatScript query editor |
| Time travel | `T` | Open time-travel scrubber panel |
| Blast radius | `B` | Open blast-radius analysis panel |
| Diff | `D` | Open graph diff view |
| Comments | `C` | Open comments sidebar |
| Agents | `A` | Open agent control panel |
| Settings | _(none)_ | Open settings panel |

### Inspector

| Tab | What it should do |
|-----|------------------|
| Owners | Show code owners / team responsible for the node |
| History | Show graph change history for this specific node |

---

## Feature gaps

### Search — no result navigation

Clicking a search result clears the query and closes the dropdown but does **not**:
- Select the node in the graph
- Pan/zoom the canvas to the node
- Open the inspector for the node

The `SearchResult` type has `node.id` which could be used to call `onNodeSelect` and `cy.getElementById(id).select()`.

### Incidents — no stacktrace display

`Incident.stacktrace` is in the TypeScript interface and returned by the API, but the table never renders it. No expand/collapse row or detail view.

### Incidents — no back-link to graph node

Each incident row has `nodeId` but there's no link to select that node in the graph. The `/incidents` page is a dead-end; navigating back goes to `/` but the node is not pre-selected.

### Incidents — no badge count on rail

The "⚠ Incidents" rail button has no badge (unlike Blast radius which shows violation count). Could show `incidents.count` or unresolved count.

### StatusBar scrubber — not interactive

The time scrubber (`.scrub`) is purely decorative:
- Fill is always 100% (always "now")
- No drag/click to time-travel
- Playhead is permanently at the right edge

### SSE live updates — no visual feedback

When `node-added` / `edge-added` events arrive:
- Node/edge is added to the graph silently
- Status bar counts are **not** updated (they come from the initial `graphData` state which is never mutated)
- No toast / pulse / notification

### Multi-project — graph not re-fetched on project change

`AppShell` passes `project` prop to `GraphCanvas`, but `GraphCanvas`'s `useEffect` has an empty dependency array (`[]`). Changing the project in the dropdown does not trigger a re-fetch or re-render of the graph.

Fix: add `project` to the `useEffect` dependency array and prepend project to the API URL (e.g. `/api/projects/${project}/graph` or pass as `?project=` param).

### Metrics — fully synthetic

All three metric values (req/s, p99, err%) use `Math.random()` on every render. They will flicker on re-renders and don't represent real data. No metrics API exists yet.

### `GraphView.tsx` — orphan file

`packages/web/app/components/GraphView.tsx` is the old v0.1.3 component. It's no longer imported anywhere (replaced by `AppShell` + `GraphCanvas`). Should be deleted.

---

## Keyboard shortcuts — declared but not wired

The rail tooltips advertise keyboard shortcuts (`G`, `L`, `F`, `N`, `T`, `B`, `D`, `C`, `A`) but there is no `keydown` event listener anywhere in the codebase. The `⌘K` hint in the search bar is also visual-only (no global hotkey handler).

---

## Accessibility gaps

| Element | Issue |
|---------|-------|
| Rail buttons | No `aria-label` — only visible via hover tooltip |
| Inspector tabs | No `role="tablist"` / `role="tab"` / `aria-selected` |
| Canvas | `#cy` has no `aria-label` or `role` |
| Search input | No `aria-label`, no `aria-expanded` on dropdown |
| Search dropdown | No `role="listbox"` / `role="option"` |
| Metrics | Random values re-announced on every render for screen readers |

---

## Minor visual inconsistencies

| Item | Note |
|------|------|
| `--n-stream` and `--n-queue` | Same hex (`#b8b0c8`) — may be intentional but duplicated |
| `cloud` compound type | Uses hardcoded `#1d1d22` instead of a CSS token |
| Incidents topbar | Uses inline `style` on the Link element instead of a CSS class |
| `GraphCanvas` `project` prop | Accepted and named `_project` (underscore-prefixed) indicating it's unused |
