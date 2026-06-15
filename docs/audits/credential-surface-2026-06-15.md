# Credential Surface Audit — 2026-06-15

Scope: all credentials that authenticate to an external system (API keys, passwords,
connection strings, auth tokens, OAuth tokens, bearer tokens) anywhere in the repo.

Methodology: grep-first pass over every `.ts`/`.tsx`/`.mjs` source file in the
working tree (excluding `node_modules`, `dist`, `.next`, `.claude` worktrees),
followed by manual line-level verification of each hit.

---

## Summary table

| file:line                                                                | field / var name                                            | credential type                            | how stored today                                                                                                                                                                                                                           | consumer                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `packages/types/src/data-sources.ts:17`                                  | `DataSource.apiKey`                                         | Notion integration token                   | Plaintext field on the domain type (propagated to DB)                                                                                                                                                                                      | `NotionConnector.connect()` / `query()` |
| `packages/types/src/data-sources.ts:18`                                  | `DataSource.connectionString`                               | DB connection string (future)              | Plaintext field on the domain type (propagated to DB)                                                                                                                                                                                      | Future PostgreSQL connector             |
| `packages/types/src/data-sources.ts:28-29`                               | `CreateDataSourceInput.apiKey`, `.connectionString`         | same as above                              | Wire type for inserts; same propagation path                                                                                                                                                                                               | Write mutations                         |
| `packages/types/src/data-sources.ts:51`                                  | `DataSourceMutations.update(…apiKey…)`                      | Notion integration token                   | Wire type for updates                                                                                                                                                                                                                      | Write mutations                         |
| `packages/app/src/lib/stores/types.ts:132`                               | `NotionDataSource.apiKey`                                   | Notion integration token                   | Client-side domain type (no separate storage)                                                                                                                                                                                              | Reads from WyStack query result         |
| `packages/app/src/lib/stores/types.ts:139`                               | `PostgreSQLDataSource.connectionString`                     | DB connection string                       | Client-side domain type                                                                                                                                                                                                                    | Future PostgreSQL connector             |
| `apps/server/src/functions/app-artifacts.ts:216-217`                     | `config.apiKey`, `config.connectionString`                  | Notion token / DB conn string              | **Read from `data_sources.config` jsonb and returned verbatim to every client on `listDataSources` / `getDataSource`**                                                                                                                     | UI reads to pre-fill forms              |
| `apps/server/src/functions/app-artifacts.ts:378`                         | `config: { apiKey, connectionString }`                      | Notion token / DB conn string              | **Written into `data_sources.config` jsonb column (plaintext in PGLite on-disk DB)**                                                                                                                                                       | `addDataSource` mutation                |
| `apps/server/src/functions/app-artifacts.ts:403-405`                     | `config.apiKey`, `config.connectionString`                  | Notion token / DB conn string              | **Written into `data_sources.config` jsonb column (plaintext)**                                                                                                                                                                            | `updateDataSource` mutation             |
| `apps/server/src/functions/commands.ts:275-277`                          | `config.apiKey`, `config.connectionString`                  | Notion token / DB conn string              | **Written into `data_sources.config` jsonb column (plaintext) via `CreateDataSource` command**                                                                                                                                             | `createDataSource` command handler      |
| `apps/server/src/functions/commands.ts:312-314`                          | `config.apiKey`, `config.connectionString`                  | Notion token / DB conn string              | **Written into `data_sources.config` jsonb column (plaintext) via `SetDataSourceConfig` command**                                                                                                                                          | `setDataSourceConfig` command handler   |
| `packages/server-core/src/schema.ts:57-80`                               | `dataSources.config` (jsonb column)                         | Notion token / DB conn string              | **Plaintext in `artifacts.db` (PGLite file on disk)**. Schema comment says "Secrets are encrypted at rest here; the decryption key lives outside the folder (OS keychain in Electron)" — this comment is **aspirational, not implemented** | All data-source read paths              |
| `packages/server-core/src/schema.ts:201-215`                             | `secrets` table (`ciphertext` bytea)                        | Any credential                             | Schema exists, AES-256-GCM design documented in comment, **but no application code reads or writes this table** (only db constraint tests in `db.test.ts:136-174`)                                                                         | Vault design — unimplemented            |
| `apps/web/lib/trpc/routers/notion.ts:15-21`                              | `input.apiKey`                                              | Notion integration token                   | In-flight only — received from client, passed to `fetchNotionDatabases()`, never stored server-side                                                                                                                                        | Notion API call                         |
| `apps/web/lib/trpc/routers/notion.ts:33-41`                              | `input.apiKey`                                              | Notion integration token                   | In-flight only — same                                                                                                                                                                                                                      | Notion API call                         |
| `apps/web/lib/trpc/routers/notion.ts:52-74`                              | `input.apiKey`                                              | Notion integration token                   | In-flight only — same                                                                                                                                                                                                                      | Notion API call                         |
| `packages/connector-notion/src/client.ts:22`                             | `apiKey` param                                              | Notion integration token                   | In-flight only — passed to `new Client({ auth: apiKey })`                                                                                                                                                                                  | Notion SDK                              |
| `packages/app/src/components/data-sources/DataSourceControls.tsx:99-160` | `dashframe:notion-databases:<id>` localStorage key          | **Database list** (not the API key itself) | Notion database names/ids cached in `localStorage`                                                                                                                                                                                         | UI display only — not credentials       |
| `apps/desktop/src/main.ts:179`                                           | `authToken` (loopback token)                                | Per-launch loopback bearer token           | In-memory only — `randomBytes(32).toString('base64url')`; never written to disk or logged                                                                                                                                                  | Electron IPC → renderer                 |
| `apps/desktop/src/main.ts:108-111`                                       | `dashframe:server:info` IPC handle returns `{ url, token }` | Per-launch loopback bearer token           | In-flight only — passed over contextBridge to renderer process                                                                                                                                                                             | `nativeConnector` fetch calls           |
| `apps/renderer/src/nativeConnector.ts:69`                                | `token` (NativeConnectorOptions)                            | Per-launch loopback bearer token           | In-memory only — sent as `Authorization: Bearer <token>` on every loopback HTTP call                                                                                                                                                       | Arrow IPC endpoint auth                 |
| `apps/server/src/index.ts:181`                                           | `opts.token` (CLI `--token` flag)                           | Serve auth token                           | In-memory only — read from `process.argv`, never persisted                                                                                                                                                                                 | HTTP/WS auth gate                       |
| `apps/server/src/app.ts:306`                                             | `expectedToken` (createTokenResolver)                       | Serve auth token                           | In-memory only — compared via `timingSafeEqual(sha256(actual), sha256(expected))`                                                                                                                                                          | Request validation                      |
| `.env.local` (gitignored)                                                | `NEXT_PUBLIC_POSTHOG_KEY`                                   | PostHog analytics key                      | Local-only file — gitignored, not committed                                                                                                                                                                                                | PostHog browser SDK                     |
| `apps/web/vite.config.ts:134`                                            | `NEXT_PUBLIC_POSTHOG_KEY`                                   | PostHog analytics key                      | **Baked into the client bundle at build time** — becomes a public JS constant                                                                                                                                                              | PostHog analytics                       |
| `apps/web/components/providers/PostHogProvider.tsx:87`                   | `process.env.NEXT_PUBLIC_POSTHOG_KEY`                       | PostHog analytics key                      | In-flight read of the bundle-baked constant                                                                                                                                                                                                | PostHog SDK init                        |

---

## Plaintext-at-rest sites

These are persisted to disk or a database in unencrypted form. They are the highest-priority targets for the SecretVault.

### 1. `data_sources.config` jsonb column — `artifacts.db` on disk

**Location:** `packages/server-core/src/schema.ts:64` (column definition); written by:

- `apps/server/src/functions/app-artifacts.ts:378` — `addDataSource`
- `apps/server/src/functions/app-artifacts.ts:403-405` — `updateDataSource`
- `apps/server/src/functions/commands.ts:275-277` — `CreateDataSource` command
- `apps/server/src/functions/commands.ts:312-314` — `SetDataSourceConfig` command

The `config` column is a `jsonb` blob that currently holds `{ apiKey?, connectionString? }` in plaintext. The schema comment at line 7-8 states "Secrets are encrypted at rest here; the decryption key lives outside the folder (OS keychain in Electron)" — **this is aspirational documentation, not implemented code**. No encryption/decryption happens anywhere in the codebase today.

**Read path (credential exfiltration surface):** `rowToDataSource` at `apps/server/src/functions/app-artifacts.ts:210-220` reads `config.apiKey` and `config.connectionString` and returns them on every `listDataSources` and `getDataSource` WyStack query. This means every connected renderer receives all stored API keys over the WyStack channel on page load. The loopback token limits this to local clients in the desktop case, but the surface is still plaintext-in-transit from DB → server → renderer.

**On-disk path:** The PGLite database file lives at `project/artifacts.db` (per `packages/server-core/src/schema.ts:3-5`). Any process that can read this file gets all API keys and connection strings without decryption.

### 2. `secrets` table — schema exists, encryption not wired, writes never called

**Location:** `packages/server-core/src/schema.ts:201-215`

The `secrets` table is designed for AES-256-GCM encrypted storage. The schema is correct and the cascade delete test passes. However:

- No application code in `apps/server/src/functions/` or `packages/server-core/src/` reads from or writes to this table outside of tests.
- The `DataSource.config` jsonb column (site 1 above) is the actual storage path in use today.

The vault design session should decide whether to **wire the `secrets` table** as the encrypted backing and stop writing credentials into `data_sources.config`, or take a different approach.

---

## In-flight only

These are passed between components but not persisted to disk or a database.

| location                                                 | credential             | notes                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/trpc/routers/notion.ts` — three procedures | Notion `apiKey`        | Received from browser, forwarded to Notion API, never stored server-side in the web path. Web path has no persistent store.                                                                                                             |
| `packages/connector-notion/src/client.ts`                | Notion `apiKey`        | Passed as param to Notion SDK, not stored.                                                                                                                                                                                              |
| `apps/desktop/src/main.ts:179`                           | Loopback bearer token  | Minted with `randomBytes(32)`, lives in memory only, rotates on every app launch.                                                                                                                                                       |
| `apps/desktop/src/main.ts:108-111` / `preload.ts:21-23`  | Loopback bearer token  | Delivered to renderer via Electron contextBridge IPC (`dashframe:server:info`). In-memory only — the `token` field in the IPC response is the plaintext token string, but this is intentional for localhost-to-localhost communication. |
| `apps/renderer/src/nativeConnector.ts:69`                | Loopback bearer token  | Held in renderer memory, sent as `Authorization: Bearer …` on HTTP calls to `127.0.0.1`.                                                                                                                                                |
| `apps/server/src/index.ts:181`                           | Serve auth token (CLI) | Parsed from `--token` CLI arg, held in memory, never written to disk.                                                                                                                                                                   |
| `apps/server/src/app.ts:306`                             | Serve auth token       | Compared via timing-safe SHA-256; never logged or serialized.                                                                                                                                                                           |

---

## Notable findings

### F-1: `rowToDataSource` returns API keys to every client on every query (HIGH)

`apps/server/src/functions/app-artifacts.ts:210-220`

`listDataSources` and `getDataSource` return `apiKey` and `connectionString` in their response payload to the renderer. This means the Notion integration token is included in every data-source list response the WyStack client receives. In the desktop Electron path this goes renderer ↔ loopback server; in the web path it goes browser ↔ `dashframe serve`. Even if encryption at rest is added, the client still receives the plaintext credential to pre-fill the UI form. The SecretVault design needs to decide whether keys should be returned to the client at all (e.g., return a "key is set" boolean instead of the value).

### F-2: Schema comment claims encryption is implemented — it is not

`packages/server-core/src/schema.ts:7-8`

> "Secrets are encrypted at rest here; the decryption key lives outside the folder (OS keychain in Electron)."

This comment describes the **intended future state**, not the current implementation. A reader (or a security auditor) could mistake it for a guarantee. The `secrets` table exists but has zero production call sites; all credentials go into the plaintext `config` jsonb column instead.

### F-3: `connector.ts` UI hint says "Stored locally in your browser" — incorrect for desktop

`packages/connector-notion/src/connector.ts:59`

```ts
hint: "Stored locally in your browser.",
```

On the desktop path the API key is sent to the loopback server and persisted in `artifacts.db` (a filesystem file), not the browser. This hint is accurate only for a hypothetical browser-only storage path that does not exist. It may give users a false impression about where their Notion token resides.

### F-4: `NEXT_PUBLIC_POSTHOG_KEY` is baked into the web bundle

`apps/web/vite.config.ts:134-136`

The PostHog analytics key is inlined as a string literal in the built JavaScript at `process.env.NEXT_PUBLIC_POSTHOG_KEY`. This is standard practice for PostHog (the key is a client-side project identifier, not a secret), but it means the key is readable in the public bundle. This is low-risk by PostHog's design but worth noting. The `.env.local` file that supplies this value is correctly gitignored.

### F-5: `config` jsonb has no field-level access control

All three `listDataSources` / `getDataSource` / `getDataSourceByType` queries return the entire `config` blob verbatim to authenticated WyStack clients. There is no server-side redaction. Any client that can connect (loopback on desktop, any origin with a valid `--token` on `dashframe serve`) gets all connector credentials.

---

_Audit performed 2026-06-15 by read-only inspection. No code was modified._
