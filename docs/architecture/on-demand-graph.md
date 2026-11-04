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
index range or whole table, is bounded at `LIMIT` (1,000 rows in `graph.ts`)
and refuses beyond it with a pagination message. That refusal, inside
`Graph.scan`, is the one row cap the command engine still has; the section
below names what reaches it.

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
`LIMIT` insights, the scan refuses and names pagination; because these scans
run inside one command transaction they cannot page, and removing their cap
needs an index per relationship they search or a denormalized reverse
reference, which #531 leaves open. Preview lets that refusal through as the
query's error rather than recording it against a command, so review and
publish surface the same message. The cleanup outbox's reference scan
(`cleanup.ts`) still reads eleven tables under its own cap; that is #368.

## What no longer caps

The other reads that once stopped at 1,000 rows were not bounded by anything a
user builds, so #531 replaced each cap with the tool its situation called for:

- `removeDataFrame` finds the table that points at a frame through
  `by_workspaceId_and_dataFrameId` instead of scanning every table.
- The host reads `listDataFrames` and `listDataFramesByInsight` return one
  page at a time through `.paginate()`, and the host-side adapters in
  `apps/server/src/host` follow the cursor until the backend reports it is
  done.
- `clearAllData` and `repairGa4MeasureContracts` work in batches bounded by
  `BULK_WRITE_BATCH` rows and `BULK_READ_BYTES` per transaction, read in small
  chunks charged against both (Convex allows one `paginate` per function, so
  the reads are `take`s over exact index positions), and schedule their own
  continuation
  with `ctx.scheduler.runAfter` until nothing is left. Each returns `complete`;
  the clear's host adapter calls again until it is true, so "Clear all data"
  returns once the workspace is empty, while the repair reports the first
  batch's counts and the backend finishes the rest on its own. A continuation
  belongs to the run that scheduled it, recorded in `hostSettings`; a new call
  starts a new run and retires the queued one, and completing a run removes
  the record, so a continuation queued before a clear completed cannot clear
  what the user created after it. A clear is no longer one atomic snapshot:
  rows written while it is still running are cleared with the rest, and a
  workspace read between two batches is partly cleared, children first. The repair walks only the tables of legacy
  GA4 sources, through each source's index, and walks again on every boot: a
  draft written before contracts can still publish legacy rows.
- A draft's log is read whole under `DRAFT_COMMAND_LIMIT` (200), the limit
  `replaceDraft` enforces, so the guard in `store.ts` asserts that invariant
  rather than a workspace size. A draft's staged changes are written whole by
  one transaction and are read back whole with no cap.

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
that accumulated more than `LIMIT` frames before retention existed is not
pruned either, and its refresh or publication still commits; deleting frames
from the Data Frames page drains that history. The reference scan itself still
reads eleven tables under its own cap on every prune; that cost is #368.
