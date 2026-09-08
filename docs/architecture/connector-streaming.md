# Connector streaming contract

On-demand acquisition must finish a source generation before charts can query it.
10,000 rows is a page size, not a dataset limit. DuckDB remains the snapshot layer
for repeatable queries, joins and filtering; previews may still limit response rows.

## First implementation

Stream GA4 v1/v2 pages into durable Arrow IPC, register that snapshot in DuckDB
in bounded batches, then stream the compiled Insight result into another immutable
frame. Keep the existing buffered interfaces for other connectors and older hosts.
The streaming path is selected only when storage and runtime provide every required
capability. There is no claim of streaming for the buffered compatibility path.

The batch interface is `AsyncIterable<Uint8Array>`: each item is a complete Arrow
IPC payload with schema and bounded record batches. `saveBatches` writes one standard
Arrow IPC stream using backpressure; `loadBatches` reads it incrementally.
`registerArrowBatches` consumes batches into a private DuckDB transaction on its own
connection, committing the complete table only at exhaustion. `queryArrowBatches`
fetches native result chunks without `runAndReadAll`. No result-wide array, base64
concatenation, or IPC buffer is permitted on this path.

## Publication, failure and refresh

Each fetch allocates new frame IDs. Source and result files are atomically renamed
and synced before the existing Convex publication mutation updates any pointer.
DuckDB registration is atomic independently of metadata publication. There is no
distributed transaction: before publication, failure/cancellation removes new files
and native registrations. Once publication starts, a lost acknowledgement retains
potentially referenced generations and uses the durable operation receipt. Never
delete a possibly committed frame in response to a transport error.

Refresh retains the prior generation until the new one is complete. Existing frame
retention keeps current and previous generations and references held by other
artifacts; its cleanup outbox remains authoritative. Crash-created unreferenced
final files retain the existing reconciliation limitation. Save temporaries use
the existing startup recovery convention. Cancellation closes iterators/connections;
provider cancellation and deadlines must be passed to the transport. Cancellation
after publication begins cannot undo a committed generation.

## Schema and resource controls

Persisted fields own identity. Pages must match names/order/logical types and every
populated Arrow schema; changed field IDs from provider discovery are ignored.
An empty terminal page contributes no rows and cannot replace a populated schema.
Schema evolution requires explicit source schema refresh, never silent coercion.

Acquisition is pull-driven with no page prefetch. The host admits one streaming
materialization per runtime and rejects overlapping distinct work rather than
building an unbounded queue; identical requests retain existing in-flight coalescing.
One caller cancelling leaves shared work running for its remaining consumers. The
final consumer's cancellation aborts acquisition and waits for rollback to settle.
Defaults: 1,000 GA4 rows per page, 8 MiB encoded bytes per batch, 256 MiB total
encoded bytes per materialization, 2 GiB durable project storage, and five minutes
per operation. Bytes are IPC accounting, not a promise about JavaScript/native RSS.
Buffered compatibility adapters retain their whole-payload save contract: the
8 MiB batch cap does not apply to that payload. Aggregate byte and storage checks
run after their acquisition, so they do not bound those adapters' acquisition memory.
Provider JSON is still decoded one page at a time. Native memory and disk-spill
isolation remain deployment responsibilities; this change does not grant additional
filesystem or network access to a query engine.

Progress is internal, value-free counters (phase, rows, bytes, elapsed time), with
sanitized error codes at the host boundary. Credentials, source values and SQL are
never progress payloads. No new public job protocol or progress UI is introduced.

## Connector and hosted boundaries

- GA4: ordered offset pages; no provider-wide transaction exists, so live report
  changes during pagination remain a consistency limitation. Published snapshots
  are immutable. Acquire another generation to see later provider changes.
- PostgreSQL: existing buffered fallback, with a 30-second statement timeout;
  connection establishment and result buffering have no new streaming guarantee.
  Follow-up: server cursor under one
  repeatable-read, read-only transaction, with authoritative OID schema and bounded
  FETCH. Do not simulate snapshot consistency using independent OFFSET queries.
- Notion: existing buffered fallback accumulates 100-row provider pages. The
  installed SDK defaults to 60 seconds per request, with no total acquisition
  deadline in that adapter. Follow-up: provider cursor pages with stable schema,
  bounded retries and cancellation. REST/local imports remain unchanged. Buffered
  fallback I/O can outlast the new operation deadline; it is rejected at the next
  budget check and never published as a partial result.
- Hosted: PR #396 owns a fail-closed Linux worker sandbox whose protocol currently
  accepts whole Arrow buffers. It must add versioned begin/append/commit/abort and
  result-chunk messages with per-message, operation, queue and process limits before
  enabling these optional capabilities. Durable paths and credentials stay in the
  trusted host; workers receive bytes and opaque table handles. Never fall back to
  in-process execution or send host filesystem paths across that seam. This PR is
  based on main and does not modify, merge, or ship the hosted protocol of PR #396.

## Plan and acceptance

1. Add optional batch storage/runtime interfaces and their native implementations.
2. Wire GA4 and Insight materialization through those interfaces with admission,
   budgets, cancellation, schema checks and existing publication semantics.
3. Test more than 10,000 rows, bounded pulls, empty results, schema drift, failure,
   cancellation, atomic replacement and durable restart registration. Drive the
   production materializer with real DuckDB and a controlled GA4 HTTP response.
4. Run repository checks, formatting, local review and an independent reviewer;
   record limitations and observed failures in the PR.

The [current v0.3 scope](https://www.notion.so/3b1d48ccaf548142a1b5c6de31a55cb9)
(read 8 September 2026) treats throughput and faster connector cancellation as
follow-ups. This is a separate performance effort, not an added release gate.
