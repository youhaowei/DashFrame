# On-demand artifact graph

The command engine in `packages/convex-backend/convex/engine.ts` runs every
batch against a `Graph` (`convex/graph.ts`) that loads rows the moment a
handler asks for them. Nothing reads a whole artifact table up front.

## Why

The previous `loadGraph` read all six artifact tables into memory for every
commit, draft append, preview, review, and publish, and threw once any table
passed 1,000 rows. Data frames grow with usage, not with what a user builds,
so a workspace that refreshed a live connector often enough lost every write
path at once. Each reactive query built on that graph also subscribed to every
table, so any write anywhere re-ran every read. Convex's own guidance for
agents is explicit: bounded reads through indexes, never a table scan inside a
mutation. This is that rule applied to the engine.

## Shape

`Graph` keeps three layers per row and reads through two paths.

- `original` is the canonical row as first loaded from the database.
- `overlay` is the open draft's staged value for that row, when a draft is
  open. It is loaded whole because a draft is bounded by its own change limit.
- `current` is the mutable working copy handlers edit in place.

`get`/`find`/`has` are point reads by primary key. `scan(table, where)` is an
index range read merged with the working state, so rows created or deleted
earlier in the same batch are visible to later commands. `where` names the
owner fields the artifact indexes cover: `dataSourceId`, `insightId`,
`sourceId`, `definitionId`, `dataFrameId`, `parentArtifactId` (the `id` and
`kind` indexes serve point reads and kind lookups, not scans). Every scan,
index range or whole table, is bounded at `LIMIT` and refuses beyond it with
the same pagination message as before.

Data frames are the one table that may not be scanned without a selector.
`Graph.scan("dataFrames")` with an empty `where` is a programming error, not a
workspace-size error. The only whole-table frame read is `Graph.list`, used by
the Data Frames page, which keeps the recovery-list escape hatch.

Diffs come from the graph rather than from comparing two full copies.
`changes()` compares canonical against working for every touched row, which is
what `persist` and `replaceDraft` need. `mark()`/`changesSince()` attribute
edits to a single command inside preview. `baseline()` and `scanBaseline()`
are the rows as they stood when the graph was opened, overlay included, which
is what preview reports as "before" and what its dependency walk reads so a
delete cascade still names what it orphans.

## What still scans

A few operations legitimately need to find rows without a foreign key on the
row's side, and all of them scan user-authored tables only:

- The delete cascade (`removeNode`) scans insights and dashboards to find
  orphaned definitions and layouts. Tables, visualizations, and frames it
  reaches through indexes; a source that owns more than 1,000 frames refuses
  with the frame cap message until the recovery list drains it.
- The preview downstream walk scans user-authored tables for edges; frames it
  reaches through indexed insight, source, definition, and parent-artifact lookups,
  plus a direct lookup for a table's linked frame.
- `GetOrCreateInsightDraft` scans insights for an unmodified draft on the same
  table, and `getDataSourceByType` under a draft scans data sources.

All are bounded by what a user has built. If a workspace ever holds more than
1,000 insights the scan refuses and names pagination, which is the tracked
follow-up in #354. Preview lets that refusal through as the query's error
rather than recording it against a command, so review and publish surface the
same message. The cleanup outbox's reference scan (`cleanup.ts`) still
reads eleven tables under its own cap; that is #368 and is unchanged here.

## Frame retention

Table frames and saved insight results share one pipeline in
`frameRetention.ts`: `frameHistory` reads an owner's frames through its index
and `pruneFrames` deletes what the caller does not keep and nothing else still
references. Both host paths that write a table frame, `commitImportedFrame` and
the sources loop of `publishMaterialization`, keep the frame the table points
at and the one it pointed at before; a saved publication keeps the previous
current result. The previous frame is the one-step rollback target and,
because the cleanup outbox refuses to reclaim a blob while any row still names
it, the protector for #367 acceptance case 1. Pruned frames leave the table and
their blobs are queued for cleanup, which re-checks references before
tombstoning. If the reference scan hits its cap, nothing is pruned. An owner
that accumulated more than 1,000 frames before retention existed is not pruned
either, and its refresh or publication still commits; the Data Frames recovery
list is the way out of that state. The reference scan itself still reads eleven
tables under its own cap on every prune; that cost is #368.
