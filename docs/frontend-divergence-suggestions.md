# Frontend surfaces for `get_divergences` — suggestions for later

**Date:** 2026-05-10
**Status:** Suggestions. Not binding. Captured separately from ADR-060 so the backend contract can ship now and frontend integration follows when Jed's v0.3.0 track picks it up.

The backend divergence query (REST `/graph/divergences`, MCP `get_divergences`, CLI `neat divergences`) ships in v0.2.10 as ADR-060. The frontend integration is deferred because the v0.3.0 frontend track is independent and Jed will pace it.

What follows is the recommended set of frontend surfaces for the divergence query, derived from how a user would actually consume it. Order is rough priority — MVP-essential first, polish after.

## 1. Dedicated `/divergences` page

The headline UI for the query. When you open NEAT against an unfamiliar codebase — medusa, the canonical MVP-success-PR target — this should be the page you reach for first. The Rail's "Diff" stub (per ADR-056's inventory) was the placeholder; this is the real surface.

**Shape:**
- List view of every current divergence for the active project
- Sortable by `confidence × severity` (default), `type`, `recently observed`, `source/target node`
- Filterable by divergence type (`missing-observed`, `missing-extracted`, `version-mismatch`, etc.)
- Each row: source node, target node, divergence type, confidence, recommendation, "open in graph" link
- Empty state: "No divergences found. Either nothing has diverged, or OBSERVED coverage is thin — give the daemon more time."

**Why first:** this is THE answer to "what bug does NEAT find?" for an external user. ADR-027 (MVP success) depends on the operator being able to reach a list like this in one click.

## 2. GraphCanvas visual distinction for divergent edges

ADR-029's coexistence rule means OBSERVED and EXTRACTED edges between the same node pair both render today, with no visual hint that they conflict. After ADR-060, the GraphCanvas should *show* the gap, not hide it.

**Shape:**
- Edges involved in a divergence get a distinct visual treatment — dashed line, color shift, or a small badge between the source/target indicating the divergence type
- Tooltip on hover reveals the specific divergence (e.g., *"EXTRACTED says A→B but no OBSERVED edge. Coverage gap or dead code?"*)
- Clicking the badge opens the inspector to the divergence detail

**Why second:** the graph is the spatial representation of NEAT's data. Letting the user see divergences directly in the graph is the visceral demo. If the canvas doesn't surface them, users see disconnected lists.

## 3. Rail navigation — first-class divergences button

Per ADR-056 (web-completeness), every Rail button is either wired or explicitly disabled. The current "Diff" stub becomes either:

- **Wired to /divergences** with a real action (recommended), OR
- **Disabled** with affordance ("v0.3.x") and a separate "Divergences" entry added

Suggest keyboard shortcut `V` (for "varia... ce" — divergence has a v) since `D` is currently mapped to Diff.

**Why third:** the navigation surface is how users discover the query exists. A real Rail entry advertises NEAT's thesis loudly.

## 4. Inspector "Divergences" tab

When a node is selected, alongside the existing tabs (Outbound, Owners, History, etc. per Jed's audit), add a "Divergences" tab listing every divergence involving this node.

**Shape:**
- Filtered subset of the full divergences list, scoped to the selected node
- Same row shape as the main page

**Why fourth:** when investigating a specific node (rather than browsing all divergences), the inspector is the natural surface. Without this, the user has to bounce between the global list and the canvas selection.

## 5. StatusBar divergence count

Show total divergence count for the active project in the StatusBar, similar to how Blast radius shows violation count today. Click → opens the /divergences page.

**Shape:**
- Small numeric badge: "12 divergences" with a colored dot indicating severity (e.g., red if any version-mismatch, yellow for missing-extracted, neutral for missing-observed)
- Click-through to the full list

**Why fifth:** ambient awareness. The user notices the badge climbing when divergences accumulate, without having to actively check.

## 6. SSE event type — `divergence-detected` (deferred)

ADR-051's locked event taxonomy is eight types. Adding a ninth requires a successor ADR. For MVP, this is deferred — polling the `/graph/divergences` endpoint every N seconds works (matches the existing `neat://incidents/recent` poll model).

If real-user signal demands live divergence push, write the successor ADR (probably ADR-061) and implement the SSE event:

```ts
event: divergence-detected
data: { divergence: Divergence }
```

Trigger: when ingest.ts processes a new OBSERVED edge that creates a divergence with an existing EXTRACTED edge, or vice versa.

**Why deferred:** SSE event taxonomy is locked deliberately. Don't expand it speculatively. Wait for the consumer (Jed's v0.3.0 track) to surface the need.

## 7. Search results — divergence badge (polish)

When `semantic_search` returns nodes, a small badge next to each result indicates if the node is involved in any divergences. Click-through navigates to the inspector with the Divergences tab active.

**Why polish:** the existing search bar (ADR-058 #5 / Jed's audit) doesn't even navigate to selected nodes yet. This is a layer of polish on top of the basic search flow.

## What's NOT in scope for the frontend integration

- **CRUD on divergences.** Divergences are derived from the graph; you don't acknowledge / dismiss / suppress them. They appear or they don't based on what the data says. (If real-user signal demands "snooze this divergence for 7 days," that's a successor ADR introducing a divergence acknowledgement model — out of MVP.)
- **Real-time push via SSE.** Deferred per item 6.
- **Cross-project divergence views.** Per ADR-026, each project is its own graph. Divergence list is per-project. Cross-codebase joins are explicitly out of MVP per ADR-026.
- **Custom divergence rules.** The five built-in types (`missing-observed`, `missing-extracted`, `version-mismatch`, `host-mismatch`, `compat-violation` — see ADR-060) are the lock. Custom user-defined divergence rules would be a successor ADR, probably extending the policy schema.

## Implementation order recommendation

If shipping incrementally (one PR per item):

1. **`/divergences` page** (item 1) — biggest user value, simplest to ship as a new top-level page.
2. **Rail entry** (item 3) — easy follow-up once the page exists.
3. **StatusBar count** (item 5) — small, ambient.
4. **GraphCanvas visual distinction** (item 2) — requires Cytoscape styling work, more involved.
5. **Inspector tab** (item 4) — small, but depends on the inspector's tab framework.
6. **Search badge** (item 7) — polish.
7. **SSE push** (item 6) — only after item 1-6 prove the demand.

## Hand-off

This doc is suggestions, not binding. If/when Jed (or whoever drives v0.3.0 frontend implementation) picks up divergence integration, they read this as input — they're not contractually bound to it. The actual contract for any frontend divergence work would be a successor ADR amending ADR-051 / ADR-056 / ADR-057 / ADR-058 as needed.

ADR-060's binding scope is the backend surface (REST + MCP + CLI). Frontend integration is downstream of that, paced by Jed.
