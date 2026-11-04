# Replace the local WyStack runtime with Convex

Decision: Convex owns DashFrame metadata, authorization, reactive queries and drafts.
This is a greenfield replacement: no PGlite migration, backfill, dual writes or legacy
schema-adoption bridge. Existing UI workflows and the command vocabulary remain.

DuckDB, Arrow/Parquet storage, connectors and SecretVault remain host resources. Their
existing operations are reused. The JSON host artifact from the spike is not part of the
application architecture.

## Boundaries

- `@dashframe/convex-backend`: native Convex tables, queries, mutations, application
  commands, draft overlay/review/publication and private metadata operations for the host.
- `@dashframe/convex-local`: official local-backend process lifecycle, project isolation,
  loopback binding, private administration, readiness and offline restart.
- DashFrame host: native data/credential operations, MCP, JWT issuance
  after existing host authentication. Admin credentials never cross renderer IPC.
- Renderer: generated Convex API and subscriptions; ordinary authenticated host requests
  for host-only operations. No WyStack RPC/subscription runtime.

A project gets one local workspace. Existing UUID-facing artifact IDs remain stable API
keys; Convex document IDs identify native records internally. Every metadata access is
workspace-scoped. Signed host identity distinguishes user and service principals; a
service may draft but cannot publish canonical changes.

Commands execute atomically inside Convex mutations. A draft has an owner, revision,
ordered command log and materialized changes. Review and publication check the reviewed
draft revision and canonical base revisions. Preview changes no durable state. No host
side effect is treated as part of a Convex database transaction.

The host saves Arrow bytes before committing their metadata. Native import claims reserve
an operation ID, frame ID and timestamp; completed retries return the recorded result even
when a newer import has advanced the table pointer. Conflicting request content is rejected.
A lost publication response is recovered from its native operation record. If the outcome
cannot be established, files are retained; they may remain orphaned until future cleanup.
There is no extra JSON artifact sidecar.

SecretVault keeps credentials and its host-local ref mappings outside Convex. The host
persists a private signing key and official local-backend configuration under `.convex`.
Those files are runtime configuration, not a second application metadata store.

Command batches, draft reads, previews, and publishes load artifact rows on demand rather
than reading whole tables; see [on-demand-graph.md](on-demand-graph.md). Inside a command,
the delete cascade, the preview dependency walk, and two lookups (unmodified insight draft
by table, data source by type) still scan user-authored tables whole and refuse above
`LIMIT` (1,000) rows; that refusal and the cleanup outbox's reference scan (#368) are the
remaining row caps, both left open by #531. Data frames are never read whole inside a
command. Host reads page through cursors, bulk writes (clear all data, the GA4 measure
repair) run in batches with scheduled continuation, and frame removal uses the frame index.
Atomic command batches and complete draft logs are capped at 200 commands; that cap is an
invariant the draft-log guard asserts, not a workspace size. The UI list queries in
`app.ts` are the other half of #531.

## Required proof before publication

- No application runtime imports of `@wystack/server`, `@wystack/client` or `@wystack/db`.
  UI, identity and SecretVault packages are separate and may remain.
- Existing metadata/command behavior represented by focused native Convex tests, including
  cross-owner denial, service cannot publish, atomic batch rollback, stale draft review,
  conflicting canonical edits and idempotent retry.
- Actual local import through the host pipeline, queryable output and retry/restart proof.
- Desktop and browser startup, subscriptions, host authentication and clean shutdown.
- Full repository check, formatting, local code review and independent second model review.

No existing project data is deleted automatically. Legacy PGlite projects are unsupported
by this greenfield backend; development/testing uses fresh project directories.
