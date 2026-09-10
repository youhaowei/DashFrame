# On-demand query streaming

This PR delivers the native PostgreSQL slice described under **First PR decisions**.
The contract and plan below describe the wider intended architecture; hosted, GA4,
and Notion streaming remain follow-up work.

## Target contract

On-demand fetches exhaust the persisted connector binding. A result exceeding
10,000 rows is valid. Batch size and preview limits do not limit snapshot rows.
DuckDB remains the analytical snapshot/cache: source reports are materialized
before Insight filters, joins, sorts, and aggregations execute. This first step
pushes pagination/report selection to providers; arbitrary Insight predicates and
cross-source joins stay in DuckDB until a separate equivalence contract exists.

The host pulls one connector batch at a time, validates its schema, and awaits
its durable writer before requesting another. Source and result Arrow files are
written incrementally, then reloaded into DuckDB incrementally. No full-result
array, base64 concatenation, Arrow Table concatenation, or read-all native result
is permitted on this path. Legacy bounded preview APIs retain their contracts.

Each run owns fresh generation IDs. Files use private temporary names, fsync,
atomic rename, and directory sync. Native registration stages batches privately
and exposes a complete table only after exhaustion. Convex atomically publishes
source and result metadata after all files and tables are complete. Failure
before publication removes the new generations; old pointers and handles remain.
A lost publication acknowledgement retains potentially referenced generations,
using the existing durable operation receipt for confirmation. Do not delete a
possibly committed generation on timeout or cancellation.

Persisted Field IDs own identity. Every batch must match the persisted ordered
column names and logical types; physical Arrow types must agree on populated
batches. Empty terminal pages do not constitute schema evolution. There is no
implicit widening, coercive column addition, or partial schema publication.
Schema changes fail the run and require an explicit table-schema update.

Cancellation and deadlines propagate to provider requests and the native query.
The run checks cancellation at every batch and before publication, closes its
iterator/cursor, and cleans unpublished generations. Once publication begins,
confirmation and retention take priority over cancellation. Shared identical
work must not let one disconnected caller cancel another caller's run.

Admission bounds distinct active runs, rather than queuing unlimited work.
Budget source/result bytes per run, batch bytes, elapsed time, and retained
project storage independently of row count. Reject budget exhaustion explicitly,
never publish a truncated prefix. Provider pages can allocate up to one response
before byte validation; document provider response limits and this overshoot.
DuckDB has its own native memory/spill behavior; IPC budgets are not a claim of
an RSS ceiling. Saved generations keep existing durable retention; previews
keep their session lease. Unknown publication outcomes can retain orphans, so
storage admission must count them; automatic orphan reclamation requires a
separate receipt-aware recovery design.

GA4 uses offset report windows, PostgreSQL uses a server cursor, and Notion uses
its provider continuation token. No adapter may fake streaming by slicing an
already complete result. Local Arrow generations use incremental file reads.
Unsupported providers fail closed for live materialization; existing preview
paths remain available. Provider pagination without a snapshot token cannot
promise a transactionally consistent view while the upstream source changes.

Telemetry contains generation/run IDs, connector kind, rows, IPC bytes, batches,
duration, outcome and sanitized budget/failure codes. It excludes SQL values,
row samples, credentials and raw provider errors.

## Implementation plan

1. Add optional incremental Arrow storage, registration, and native result export
   capabilities, preserving ordinary Arrow IPC file compatibility and existing
   bounded APIs. Exercise atomic replacement and incremental consumption.
2. Add lazy connector batch APIs and persisted-binding dispatch. Validate each
   batch without accumulating previous pages; preserve credential brokerage.
3. Route production materialization, intermediate Insights, and frame rehydration
   through incremental capabilities. Add run admission, budgets, cancellation,
   and metadata-only telemetry around the complete lifecycle.
4. Prove more than 10,000 rows reach DuckDB, a tail-sensitive aggregate is exact,
   slow consumers prevent read-ahead, restart rehydration works, and failure,
   cancellation, schema drift and budget exhaustion preserve previous pointers.
5. Run the repository gate and formatting, drive the actual production path,
   review the refreshed full branch diff, obtain an independent model review,
   resolve findings, and prepare a focused PR separate from PR #396.

## Rollout boundaries

This work is rebased on main after the hosted deployment PR #396 merged.
Hosted deployment integration must adopt these capabilities and budgets explicitly;
a local passing run does not prove hosted storage capacity or provider credentials.
No UI change, submodule pin change, arbitrary source SQL API, or automatic deletion
of saved generations is included.

## First PR decisions

The first implementation enables true streaming for PostgreSQL persisted table
bindings. It uses a read-only, repeatable-read cursor, 2,048 rows per pull, and
fixed Arrow types. Mapped PostgreSQL types retain their native scalar values;
unmapped types use a strict text fallback. Values that cannot fit that physical
schema fail with `SOURCE_VALUE_UNSUPPORTED`. This includes PostgreSQL infinite
or out-of-range dates/timestamps: the fixed Arrow timestamp representation cannot
retain them, so the run fails rather than replacing their values with null. A persisted logical type that disagrees with the source
still requires an explicit schema update. PostgreSQL preview `query` and `queryBounded` keep
their existing limits. GA4 and Notion keep their existing buffered compatibility
adapters; REST remains unsupported for live binding materialization. Extending
those providers is follow-up work, not a prerequisite for this PR. Native buffered
source transfers count toward run/storage IPC budgets, not the streamed-batch
ceiling, before they are saved; their
provider allocation has already happened at that point. Hosted compatibility
keeps its existing independent ceilings.

The native storage capability accepts standalone IPC batches and writes one
standard Arrow stream file. Rehydration reads that file incrementally. Result
export reads DuckDB chunks on a dedicated connection. Both source and result
files use the existing immutable IDs and metadata publication contract.

Defaults are 16 MiB per IPC batch, 256 MiB source-plus-result IPC per run,
2 GiB existing retained IPC plus new transfer bytes, and a 120-second run
deadline. One materialization runs at a time per native runtime, including
non-PostgreSQL sources because native result export also streams. Up to four
distinct requests may wait before any source is acquired; identical requests
coalesce. Waiting time counts toward the deadline, expired requests leave the
queue, and overflow returns `FETCH_BUSY`. This lets sibling Insight views load
concurrently without admitting unbounded work. These protect this transfer path, not unrelated imports or
arbitrary SQL queries; they are not a global filesystem quota or native RSS cap.
The storage estimate conservatively counts per-batch IPC framing before the
single-file writer consolidates it. Provider row objects may exceed the IPC byte
budget while one batch is being converted, especially a single oversized value.

The deadline owns source cancellation and native query interruption. No new HTTP
cancel endpoint or caller-disconnect policy is introduced. The merged PR #396 owns shared-request lifetime and completed replay. Its
caller-independent deadline is composed with the transfer deadline; its replay
keys, source refresh path, and conservative registration cleanup are preserved.

Transfer completion telemetry reports aggregate rows, IPC bytes, batches,
duration, and success/failure, without row values or provider error text. Rows
count source and result transfer work, not unique source records. Existing Convex
retention preserves the current and previous source generation plus references,
and session leases for previews. Unknown publication outcomes retain files as
before. Cleanup of abandoned final files remains a separate recovery concern.

The hosted sandbox currently exchanges one bounded IPC response and does not
implement the new streaming capabilities. Hosted PostgreSQL keeps its existing
bounded compatibility adapter, including its 10,000-row ceiling. The larger
snapshot capability in this PR is enabled only for the native composition;
streaming over the sandbox protocol requires a separate acknowledged-batch
transport and worker admission contract. No hosted isolation control is bypassed.
