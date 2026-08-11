/**
 * createDashframeServer — builds and starts the DashFrame WyStack server.
 *
 * Deployment-agnostic: the same factory serves all three surfaces (per the
 * Data Path & Transport Deployment spec). It binds an HTTP+WS host and returns
 * its URL + a stop handle. Callers supply the project's Drizzle DB and the
 * bind address:
 *   - desktop (Electron main): bind 127.0.0.1, port 0 → ephemeral loopback port.
 *   - `dashframe serve`: bind a chosen addr/port standalone.
 *
 * Why this inlines the Node adapter instead of calling `@wystack/server/node`'s
 * `serve()`: the renderer (a localhost web client) is a *different origin* from
 * the loopback server in dev (Vite `localhost:5173` vs `127.0.0.1:<port>`), so
 * the browser requires CORS. WyStack owns the protocol; DashFrame owns the
 * deployment — and "which origins may reach this server" is a deployment
 * concern. The generic `serve()` adapter exposes no middleware hook, so we
 * mirror its composition (`createNodeWebSocket` → `createRoutes` →
 * `nodeServe` + `injectWebSocket`) and add one `cors()` layer in front. If
 * WyStack later exposes a middleware hook, collapse back to `serve()`.
 *
 * @hono/node-server runs under both Node and Bun, so the standalone CLI and
 * tests work too. PGLite is WASM, so the DB layer is runtime-agnostic. (The
 * desktop main runs under Electron's embedded Node 20, where `Bun.serve` does
 * not exist — hence the Node adapter, never `/bun`.)
 *
 * Loopback auth is optional at the factory level because `dashframe serve`
 * still owns its separate remote-bind auth decision. Electron desktop passes a
 * per-launch bearer token, which protects both HTTP calls and WyStack's WS auth
 * frame. Packaged desktop also allows the renderer's `file://` Origin (`null`)
 * through CORS; the bearer token remains the authority.
 */
// Import from the transport-only subpath, NOT the package barrel: the barrel
// re-exports NativeDuckDBEngine, whose module top-level-imports the native
// `@duckdb/node-api` addon. Runtime composers load that platform binding only
// when they start (`dashframe serve` does so dynamically); importing this
// deployment-agnostic app factory remains safe. arrow-data-path has no native
// dependency.
import type { DataFrameStorage } from "@dashframe/engine";
import {
  createArrowDataPath,
  type ArrowQueryRunner,
  type ArrowTableRegistrar,
} from "@dashframe/engine-server/arrow-data-path";
import { schema, type ApiAccessCredentials } from "@dashframe/server-core";
import type { UUID } from "@dashframe/types";
import { serve as nodeServe } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { DraftDrizzleTracker, DrizzleTracker } from "@wystack/db";
import {
  isSecretRef,
  type SecretRef,
  type SecretVault,
} from "@wystack/secret-vault";
import { createRoutes, type WyStackApp } from "@wystack/server";
import type { Table } from "drizzle-orm";
import { eq as drizzleEq, getTableName } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createHash, timingSafeEqual } from "node:crypto";

import { type ArtifactDb } from "@dashframe/server-core";

import type { AppContext, DataPlaneRuntime } from "./app-context";
import { handleAssistantRunRequest } from "./assistant-run-route";
import { isLoopbackHost } from "./bind-host";
import {
  handleConnectorOAuthCallback,
  handleConnectorResumeLanding,
  handleConnectorSetupResume,
} from "./connector-oauth-callback";
import {
  readOptionalGoogleOAuthConfig,
  type GoogleOAuthConfig,
} from "./connector-setup/oauth-provider";
import { captureCommandCredentials } from "./credential-release";
import {
  consumeOperatedDraftDispatch,
  createDraftController,
  recoveredDraftWriteTables,
  type DraftController,
} from "./draft-controller";
import { assertPublishLogHasNoLateBound } from "./draft-late-bound";
import { functions } from "./functions";
import { createMcpRoute, type McpMode } from "./mcp/route";
import {
  expectedPermissionIds,
  LOCAL_USER_ID,
  LOOPBACK_ANON_USER_ID,
} from "./permissions";
import { wy } from "./wystack";

type CorsOrigin =
  | string
  | string[]
  | ((
      origin: string,
      c: Context,
    ) => Promise<string | undefined | null> | string | undefined | null);

/**
 * Secure-by-default bind-auth gate. Throws when a non-loopback bind has no
 * `authToken` (and no explicit `insecure` opt-out) — a non-loopback bind
 * exposes the project to the network, so the server must not serve unauthenticated
 * traffic on it. Loopback binds (127.x / ::1 / localhost) are reachable only from
 * this machine and may omit a token (local dev, Electron). A token always allows
 * any bind.
 *
 * Extracted from `createDashframeServer` so the allow/deny decision is unit-testable
 * on its own — the security-critical token-allows-non-loopback branch can be
 * exercised without binding a real socket. Returns nothing on success; throws on a
 * disallowed bind.
 */
export function assertBindAuthorized(opts: {
  hostname: string | undefined;
  authToken: string | undefined;
  authRef?: SecretRef;
  insecure?: boolean;
}): void {
  const loopback = isLoopbackHost(opts.hostname);
  const hasAuth = Boolean(opts.authToken) || isSecretRef(opts.authRef);
  if (!loopback && !hasAuth && !opts.insecure) {
    throw new Error(
      `createDashframeServer: refusing to bind ${opts.hostname} without an auth token. ` +
        `A non-loopback bind exposes the project to the network. ` +
        `Supply authToken or authRef, or set insecure: true to opt out deliberately.`,
    );
  }
  if (opts.insecure && !hasAuth && !loopback) {
    console.warn(
      "[dashframe] warning: insecure non-loopback bind without authToken or authRef exposes this project to the network",
    );
  }
}

/** Allow localhost Vite/preview origins when a caller has not pinned CORS. */
function allowLocalhostOrigin(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    if (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) {
      return origin;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface DashframeServerOptions {
  /** Project artifact DB — a Drizzle/PGLite instance (e.g. `ProjectHandle.db`). */
  db: object;
  /** Durable Arrow frame store owned by the selected project. */
  dataFrameStorage?: DataFrameStorage;
  /** Bind host. Default `127.0.0.1` (loopback). */
  hostname?: string;
  /** Bind port. Default `0` — the OS assigns an ephemeral port. */
  port?: number;
  /** Explicit MCP transport mode. Defaults to stateful. */
  mcpMode?: McpMode;
  /** Stateful MCP session bound; primarily configurable for deterministic tests. */
  mcpMaxStatefulSessions?: number;
  /** Idle stateful MCP session lifetime. */
  mcpStatefulSessionTtlMs?: number;
  /** Injectable stateful-session clock for deterministic lifecycle tests. */
  mcpSessionNow?: () => number;
  /**
   * Allowed CORS origin(s) for the renderer. Defaults to local Vite/preview
   * origins (`localhost` / `127.0.0.1`) for dev and smoke verification.
   */
  corsOrigin?: CorsOrigin;
  /**
   * Bearer token required for every HTTP request and WS auth frame when the
   * server is bound to a non-loopback address. Desktop mints this per launch.
   * Loopback binds (127.x / ::1 / localhost) may omit the token.
   *
   * Security: omitting this on a non-loopback bind causes `createDashframeServer`
   * to throw. Pass `insecure: true` to deliberately opt out of this requirement.
   *
   * Kept for backward compat — existing tests and `dashframe serve` pass
   * plaintext here. Prefer `authRef` + `vault` for new surfaces.
   */
  authToken?: string;
  /**
   * Vault-backed alternative to `authToken`. When both `authRef` and `vault`
   * are present the server resolves the expected token from the vault at each
   * request's auth gate — no plaintext token is stored in a server field.
   *
   * `authToken` is ignored when this pair is set. Satisfies the non-loopback
   * auth gate in the same way a plaintext `authToken` does.
   */
  authRef?: SecretRef;
  /**
   * Opt out of the non-loopback auth requirement. Use only in controlled
   * environments where the network exposure is intentional. The factory will
   * log a warning when this is set with a non-loopback bind and no token.
   */
  insecure?: boolean;
  /**
   * Optional native engine for the dedicated Arrow IPC data path. When
   * supplied, `POST /data/arrow` streams `application/vnd.apache.arrow.stream`
   * for a compiled query — the binary path that never rides WyStack RPC.
   *
   * Desktop and `dashframe serve` both construct the native engine and pass it
   * here. Keeping construction at the runtime edge lets this shared factory be
   * imported without eagerly loading a platform native addon.
   */
  arrowEngine?: ArrowQueryRunner & Partial<ArrowTableRegistrar>;
  /**
   * Optional hook fired after every SUCCESSFUL artifact-DB write mutation.
   * Called once per committed write (after the DB transaction commits, never
   * on a failed or rolled-back write). The host owns the semantics — desktop
   * passes `() => project?.touchSnapshot()` to drive the debounced snapshot
   * scheduler (#88); other surfaces may omit it entirely.
   *
   * The server does NOT import or depend on ProjectHandle — this narrow
   * callback is the dependency boundary (same injection pattern as
   * `arrowEngine`).
   */
  onWrite?: () => void;
  /**
   * Optional async hook that cancels any pending debounced timer, forces an
   * IMMEDIATE snapshot write to disk, and resolves only after the write is
   * durable — propagating errors to the caller.
   *
   * This is the durable counterpart to `onWrite`. It is ONLY called when the
   * pre-release gate requires durability before releasing a vault ref: a
   * credential ref is released only after the snapshot that drops it from the
   * config has been confirmed written. `onWrite`'s debounced schedule cannot
   * provide this guarantee because it returns immediately without awaiting the
   * write.
   *
   * Desktop passes `() => project.flushSnapshot()`. Surfaces that do not need
   * the guarantee may omit it; the pre-release gate falls back to the
   * debounced `onWrite` behaviour in that case (existing semantics).
   */
  flushSnapshot?: () => Promise<void>;
  /** Drain retained DB snapshots before deleting snapshot-owned frame bytes. */
  flushSnapshotRetentionWindow?: () => Promise<void>;
  /** Google OAuth client settings used by resumable connector setup. */
  googleOAuth?: GoogleOAuthConfig;
  /**
   * Secret vault for credential storage. The runtime composer (Electron main
   * or `dashframe serve`) registers a backend into a SecretRegistry, builds a
   * SecretVault, and injects it here. The server itself never picks or
   * instantiates a backend — it RECEIVES a fully-composed vault.
   *
   * When supplied, control-plane write mutations (create/update DataSource)
   * call `vault.store(plaintext, { class: CREDENTIAL_CLASS.ConnectorKey }) → ref` instead
   * of persisting the plaintext. Read mutations use `vault.has(ref)` for
   * presence checks (hasApiKey / hasConnectionString).
   *
   * Optional at the factory level, but the credential boundary FAILS CLOSED
   * when it is absent — there is no plaintext fallback. `storeCredential`
   * throws rather than persist plaintext (`functions/utils.ts`), and so do
   * `releaseCredentialRefs`, the assistant-provider release, and the connector
   * bound-resolver. Omitting it is the normal state for callers that never
   * cross the credential boundary (tests, read-only hosts) and for a keyless
   * `dashframe serve`; any credential-bearing mutation on a vault-less server
   * is an error, not a downgrade. The one vault-absent branch that does not
   * throw is the read-side `hasApiKey` presence check, which tolerates legacy
   * plaintext rows written before this boundary existed.
   *
   * Desktop always injects the keychain vault. `dashframe serve` injects an
   * encrypted-file vault when `DASHFRAME_SECRET_KEY` / `DASHFRAME_SECRET_KEY_FILE`
   * is set, and none otherwise — fail-closed, never a plaintext fallback.
   */
  vault?: SecretVault;
  /** Generic external-access credentials backed by the injected SecretVault. */
  accessCredentials?: ApiAccessCredentials;
}

export interface DashframeServer {
  /**
   * Base origin the renderer points its WyStack client at, e.g.
   * `http://127.0.0.1:53017`. The client appends its own route prefix
   * (`/api`), so this URL must NOT include it.
   */
  url: string;
  /** Bound port (resolved when `port: 0`). */
  port: number;
  /** Stop the HTTP+WS host. */
  stop(): void;
}

const NATIVE_UNREGISTER_MAX_ATTEMPTS = 3;
const NATIVE_UNREGISTER_RETRY_MS = 250;

/**
 * Owns native table registration generations and bounded post-commit cleanup.
 *
 * A generation advances only after registration succeeds. Cleanup captures the
 * current generation and re-checks it inside the same per-name operation queue
 * used by registration. Therefore a failed replacement leaves the prior
 * generation's cleanup live, while a successful replacement makes stale
 * cleanup a no-op before it can drop the newer table.
 */
class NativeTableLifecycle {
  readonly engine: ArrowQueryRunner & Partial<ArrowTableRegistrar>;
  private readonly generations = new Map<string, number>();
  private readonly operations = new Map<string, Promise<void>>();
  private readonly retryTimers = new Map<
    string,
    { generation: number; timer: ReturnType<typeof setTimeout> }
  >();
  private closed = false;

  constructor(
    private readonly native: ArrowQueryRunner & Partial<ArrowTableRegistrar>,
  ) {
    this.engine = {
      queryArrow: (sql, params) => native.queryArrow(sql, params),
      ...(typeof native.registerArrowTable === "function"
        ? {
            registerArrowTable: (name: string, arrow: Uint8Array) =>
              this.register(name, arrow),
          }
        : {}),
      ...(typeof native.unregisterTable === "function"
        ? { unregisterTable: (name: string) => this.unregisterCurrent(name) }
        : {}),
    };
  }

  async unregisterCommittedFrames(ids: readonly string[]): Promise<void> {
    if (typeof this.native.unregisterTable !== "function") return;
    await Promise.all(
      ids.map((id) => {
        const name = `df_${id.replaceAll("-", "_")}`;
        return this.tryUnregister(name, this.generation(name), 1);
      }),
    );
  }

  close(): void {
    this.closed = true;
    for (const { timer } of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }

  private generation(name: string): number {
    return this.generations.get(name) ?? 0;
  }

  private async register(name: string, arrow: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("Native table lifecycle is closed");
    await this.enqueue(name, async () => {
      if (this.closed) throw new Error("Native table lifecycle is closed");
      await this.native.registerArrowTable!(name, arrow);
      this.generations.set(name, this.generation(name) + 1);
      this.cancelRetry(name);
    });
  }

  private async unregisterCurrent(name: string): Promise<void> {
    if (typeof this.native.unregisterTable !== "function") return;
    const generation = this.generation(name);
    await this.enqueue(name, async () => {
      if (this.closed || this.generation(name) !== generation) return;
      await this.native.unregisterTable!(name);
    });
  }

  private async tryUnregister(
    name: string,
    generation: number,
    attempt: number,
  ): Promise<void> {
    try {
      await this.enqueue(name, async () => {
        if (this.closed || this.generation(name) !== generation) return;
        await this.native.unregisterTable!(name);
      });
    } catch (error) {
      if (this.closed || this.generation(name) !== generation) return;
      if (attempt >= NATIVE_UNREGISTER_MAX_ATTEMPTS) {
        console.error(
          `[dashframe] native table ${name} remains registered after ${attempt} cleanup attempts`,
          error,
        );
        return;
      }
      console.error(
        `[dashframe] native table ${name} unregister failed after durable frame deletion; retrying (${attempt + 1}/${NATIVE_UNREGISTER_MAX_ATTEMPTS})`,
        error,
      );
      this.scheduleRetry(name, generation, attempt + 1);
    }
  }

  private scheduleRetry(
    name: string,
    generation: number,
    attempt: number,
  ): void {
    this.cancelRetry(name);
    const timer = setTimeout(() => {
      const pending = this.retryTimers.get(name);
      if (pending?.generation !== generation) return;
      this.retryTimers.delete(name);
      this.tryUnregister(name, generation, attempt).catch((error) => {
        console.error("[dashframe] native unregister retry failed", error);
      });
    }, NATIVE_UNREGISTER_RETRY_MS);
    this.retryTimers.set(name, { generation, timer });
  }

  private cancelRetry(name: string): void {
    const pending = this.retryTimers.get(name);
    if (pending) clearTimeout(pending.timer);
    this.retryTimers.delete(name);
  }

  private enqueue(name: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.operations.get(name) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const settled = current.then(
      () => undefined,
      () => undefined,
    );
    this.operations.set(name, settled);
    settled.then(() => {
      if (this.operations.get(name) === settled) this.operations.delete(name);
    });
    return current;
  }
}

/**
 * Pull a draft handle out of a handler context. A `draftId` in the context bag
 * means "execute this write into the draft overlay, not canonical." Returns the
 * id string, or `undefined` for the no-draft (canonical) path.
 */
function draftIdFromContext(
  context: Record<string, unknown> | undefined,
): string | undefined {
  const id = context?.draftId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/**
 * The CLOSED set of canonical table names that have a `<table>__draft` shadow
 * (the draftable artifact tables). This MIRRORS draft-controller.ts's
 * DRAFT_SHADOW_TABLES — by the credential-security-boundary design, credential
 * and project tables (`secret_mappings`, `project_meta`) intentionally have NO
 * shadow, so a draft read against them must coalesce-read NOTHING and fall
 * through to canonical (there is no `project_meta__draft` relation to JOIN).
 * A new artifact table is a schema change, so this static set is authoritative.
 */
const DRAFTABLE_TABLE_NAMES: ReadonlySet<string> = new Set([
  getTableName(schema.dataSources),
  getTableName(schema.dataTables),
  getTableName(schema.dataFrames),
  getTableName(schema.insights),
  getTableName(schema.visualizations),
  getTableName(schema.dashboards),
]);

/**
 * A draft-scoped db handle that FALLS THROUGH to canonical for non-draftable
 * tables. `from(table)`/`into(table)` route to the wystack draft overlay only
 * when `table` has a `<table>__draft` shadow; for a non-draftable table (e.g.
 * `project_meta`, which has no shadow by the security-boundary design) they
 * delegate to the base canonical handle, so a handler reading `project_meta`
 * inside a draft reads canonical instead of failing on a missing
 * `project_meta__draft` relation.
 *
 * This keeps "handlers run UNMODIFIED inside a draft" true: a query like
 * `projectInfo` (reads only `project_meta`) just works; a command touching
 * draftable artifacts gets the overlay. The draftable-table POLICY lives here
 * in DashFrame (which owns the closed shadow set), not in the generic
 * @wystack/db `withDraft` primitive.
 *
 * Shape note: returned as `DraftDrizzleTracker` because that is the type the seam
 * yields; both base and draft handles share the `from/into/transaction` surface
 * handlers use, and `runHandler` already casts to `DrizzleTracker` (the builder
 * return-type difference is never observed by a handler).
 */
export function createFallThroughDraftDb(
  base: DrizzleTracker,
  draftId: string,
): DraftDrizzleTracker {
  const draft = base.withDraft(draftId);
  const isDraftable = (table: Table): boolean =>
    DRAFTABLE_TABLE_NAMES.has(getTableName(table));
  return {
    // The draft handle reuses the base tracker's sets, so reads/writes through
    // EITHER target accumulate into the same tablesRead/tablesWritten — the
    // call-result shape sees a draftable write and a canonical read alike.
    tablesRead: draft.tablesRead,
    tablesWritten: draft.tablesWritten,
    raw: draft.raw,
    from(table) {
      return (
        isDraftable(table) ? draft.from(table) : base.from(table)
      ) as ReturnType<DraftDrizzleTracker["from"]>;
    },
    into(table) {
      return (
        isDraftable(table) ? draft.into(table) : base.into(table)
      ) as ReturnType<DraftDrizzleTracker["into"]>;
    },
    transaction: draft.transaction.bind(draft),
  };
}

/**
 * The ctx.db draft seam. When a `draftId` is present in the context,
 * substitute the `tracked` handle with a draft-scoped overlay so existing
 * command handlers write into `<table>__draft` (the withDraft write-path)
 * UNMODIFIED — for DRAFTABLE tables. A read/write to a non-draftable table
 * (no shadow, e.g. `project_meta`) falls through to canonical so the unmodified
 * handler does not hit a missing `<table>__draft` relation. The no-draft path
 * returns `tracked` untouched — byte-identical, zero-overhead.
 *
 * `ctx.db` is set from the `tracked` argument inside @wystack/server's
 * `runHandler` (it always wins over the context bag), so the substitution MUST
 * happen on the `tracked` argument here, not by injecting a context key.
 * `withDraft(draftId)` is a pure @wystack/db primitive that accepts any
 * caller-supplied id.
 *
 * CONSUMER CONSTRAINTS — the seam is live: the assistant host
 * (assistant-host.ts) wires draftId through `DraftController` for the
 * `/assistant/run` route mounted below. Any host that injects a draftId owns
 * these:
 *   - LOG SYNC. A write mutation reached via raw `app.call({draftId})` lands in
 *     `<table>__draft` but does NOT append to `draft_command_log`; since publish
 *     replays only the log, that write is visible in the overlay yet dropped on
 *     publish. Drafted WRITES must route through `DraftController.appendToDraft`
 *     (which keeps shadow + log in sync); the seam alone is safe for drafted
 *     READS (coalesced reads need no log).
 *   - DRAFTABLE COMMANDS. `withDraft` supports PK-pinned reads/writes
 *     (`where(eq("id", …))`). A command whose handler filters a shadow table by a
 *     non-PK column (e.g. delete `data_frames` by `insightId`) is not draftable
 *     as-is; such paths must be PK-addressed or blocked before drafting.
 *   - CREDENTIAL SIDE EFFECTS. A credentialed handler's `vault.store` is a real
 *     side effect even in a draft. Handled by the two seams in
 *     credential-release.ts: capture-before-log rewrites plaintext to vault refs
 *     inside `DraftController.appendToDraft`, and publish/discard release
 *     superseded or minted refs via `releaseRefsAtTransition` (gated on
 *     snapshot persistence).
 *   - AUTHORIZATION. draftId is caller-supplied; a multi-tenant host must
 *     authorize it against the caller (single-user desktop is exempt).
 */
export function withDraftSeam(
  tracked: DrizzleTracker | DraftDrizzleTracker,
  context: Record<string, unknown> | undefined,
): DrizzleTracker | DraftDrizzleTracker {
  const draftId = draftIdFromContext(context);
  if (draftId === undefined) return tracked;
  // A draft handle has no nested `withDraft`; only a base DrizzleTracker is scoped.
  // `call` always passes a fresh base DrizzleTracker, so this is the live path. The
  // fall-through wrapper routes non-draftable tables to canonical.
  return "withDraft" in tracked
    ? createFallThroughDraftDb(tracked, draftId)
    : tracked;
}

/**
 * Build the WyStack app with the draft seam, vault injection, and the
 * onWrite hook — without starting an HTTP server.
 *
 * Extracted from `createDashframeServer` so the seams (the anti-shadow vault
 * merge, the draft-scoped db substitution) can be driven by direct unit tests
 * without a live socket. `createDashframeServer` calls this internally; tests
 * import and exercise it directly.
 *
 * Security invariant: `vault` is injected into every handler context via a
 * static spread that wins over per-call context. The merge order
 * `{ ...(context ?? {}), ...staticContext }` means the vault key cannot be
 * shadowed by a caller-supplied context — the vault identity is fixed for the
 * lifetime of the returned app.
 *
 * Draft seam: when the per-request context carries a `draftId`, `call`/
 * `runHandler` substitute the tracked handle with a draft-scoped one that routes
 * DRAFTABLE-table reads/writes through the `<table>__draft` overlay and falls
 * through to canonical for non-draftable tables (project_meta, secrets — no
 * shadow by the credential-security boundary). A context with NO draftId is
 * unchanged — the canonical path is byte-identical (zero-overhead).
 *
 * onWrite/runHandler asymmetry — INTENTIONAL and load-bearing:
 *
 * `onWrite` fires after `call` (`tablesWritten.size > 0`) but NOT after
 * `runHandler`. This is correct because every current production caller of
 * `runHandler` falls into one of two non-canonical categories:
 *
 *   1. `applyCommands(mode: 'preview')` — used exclusively by `buildPreviewDiff`
 *      (all three call sites in preview-diff.ts use mode `'preview'`). Preview
 *      executes handlers then forces a transaction rollback; nothing persists, so
 *      `onWrite` must NOT fire.
 *
 *   2. The draft controller's `appendToDraft` — routes writes through a
 *      `withDraft(draftId)` handle, so every `ctx.db.into/update/delete` lands in
 *      `<table>__draft` shadow tables. This wrapper must not fire `onWrite` per
 *      handler: the owning draft RPC aggregates the whole durable transition.
 *      In particular, `createDashframeServer` fires it exactly once when a later
 *      command rejects after an earlier prefix already committed.
 *
 * When the controller's `publishDraft` replays the log via
 * `applyCommands(app, log, { mode: 'commit' })` and returns a `CommitResult` with
 * `tablesWritten`, OBLIGATION: the caller that wires `publishDraft` into a server
 * route MUST fire `onWrite()` when `result.tablesWritten.size > 0` — the
 * controller does not fire it (mirroring `applyCommands`' posture). Adding
 * `onWrite` to this `runHandler` wrapper cannot safely cover that path because:
 * (a) preview also uses canonical `DrizzleTracker` handles that look identical at this
 * level, and (b) `runHandler` is called per-command while `tablesWritten`
 * accumulates across the batch — the per-command check would fire multiple times
 * or miss the first-write-only case. The clean seam is the `publishDraft` return
 * site, not here.
 */
export async function buildDashframeApp(opts: {
  db: object;
  dataFrameStorage?: DataFrameStorage;
  /** Host-owned native execution capability; absent hosts fail closed upstream. */
  dataPlaneRuntime?: DataPlaneRuntime;
  vault?: SecretVault;
  onWrite?: () => void;
  flushSnapshot?: () => Promise<void>;
  flushSnapshotRetentionWindow?: () => Promise<void>;
  unregisterServerFrames?: (ids: readonly string[]) => Promise<void>;
  accessCredentials?: ApiAccessCredentials;
  getServerEndpoint?: () => string | undefined;
  googleOAuth?: GoogleOAuthConfig;
}): Promise<WyStackApp> {
  const rawApp = await wy.build({
    db: opts.db,
    functions,
    expectedPermissionIds,
  });

  if (opts.dataFrameStorage != null) {
    // No requests can be in flight yet, so startup is the safe point to repair
    // a crash-interrupted delete and remove files with no persisted owner.
    await removeUnreferencedServerFrames(
      opts.db as ArtifactDb,
      opts.dataFrameStorage,
      opts.flushSnapshotRetentionWindow,
    );
  }

  const { vault, onWrite } = opts;

  // Build the static context additions once so every call shares the same object
  // reference (vault identity is stable for the server lifetime).
  const staticContext: AppContext = {
    getServerEndpoint: opts.getServerEndpoint ?? (() => undefined),
    ...(opts.dataFrameStorage != null
      ? {
          dataFrameStorage: opts.dataFrameStorage,
          captureServerFrameReferences: () =>
            referencedServerFrameIds(opts.db as ArtifactDb),
          cleanupDereferencedServerFrames: (before: ReadonlySet<string>) =>
            removeDereferencedServerFrames(
              opts.db as ArtifactDb,
              opts.dataFrameStorage!,
              before,
              opts.flushSnapshotRetentionWindow,
              opts.unregisterServerFrames,
            ),
        }
      : {}),
    ...(opts.dataPlaneRuntime != null
      ? { dataPlaneRuntime: opts.dataPlaneRuntime }
      : {}),
    ...(opts.accessCredentials != null
      ? { accessCredentials: opts.accessCredentials }
      : {}),
    ...(vault != null ? { vault } : {}),
    ...(opts.googleOAuth != null ? { googleOAuth: opts.googleOAuth } : {}),
    ...(opts.flushSnapshot != null
      ? { flushSnapshot: opts.flushSnapshot }
      : {}),
    ...(opts.flushSnapshotRetentionWindow != null
      ? { flushSnapshotRetentionWindow: opts.flushSnapshotRetentionWindow }
      : {}),
    ...(opts.unregisterServerFrames != null
      ? { unregisterServerFrames: opts.unregisterServerFrames }
      : {}),
  };

  // One shared dispatcher backs both public handler entry points. `call` asks it
  // to mint a tracker lazily; `runHandler` supplies one. Draft-mutation safety is
  // therefore decided once, before tracker creation or a supplied tracker's use,
  // and before withDraftSeam or handler dispatch. DraftController marks its
  // operated shadow+revision+log transaction through a module-private async
  // scope.
  //
  // EQUIVALENCE (load-bearing): rawApp.call is a THIN composition — `const t =
  // createTracked(); const result = await runHandler(path, args, t, context);
  // return { result, tablesRead: t.tablesRead, tablesWritten: t.tablesWritten }`
  // — with no retry, no error normalization, no separate tablesRead pass (see
  // @wystack/server create.ts). This decomposition reproduces it byte-for-byte
  // on the no-draft path. RE-MIRROR POINT: if a wystack upgrade adds logic INSIDE
  // rawApp.call, this wrapper must be updated to match — it cannot delegate to
  // rawApp.call because that path mints an internal tracker the seam can't reach.
  async function dispatchHandler(
    path: string,
    args: unknown,
    context: Record<string, unknown> | undefined,
    suppliedTracker?: DrizzleTracker | DraftDrizzleTracker,
    beforeHandler?: () => Promise<void>,
  ): Promise<{
    result: unknown;
    tracked: DrizzleTracker | DraftDrizzleTracker;
  }> {
    const merged = { ...(context ?? {}), ...staticContext };
    const isSuppliedDraftTracker =
      suppliedTracker !== undefined && !("withDraft" in suppliedTracker);
    const isDraftScoped =
      draftIdFromContext(merged) !== undefined || isSuppliedDraftTracker;
    const isDraftMutation =
      rawApp.functions.get(path)?.type === "mutation" && isDraftScoped;
    const isOperatedDraftMutation =
      isDraftMutation &&
      suppliedTracker !== undefined &&
      consumeOperatedDraftDispatch(path, suppliedTracker);
    if (isDraftMutation && !isOperatedDraftMutation) {
      throw new Error(
        `Direct draft mutation "${path}" is not allowed; use draftBatch or ` +
          "DraftController.appendToDraft so shadow state and the command log remain atomic",
      );
    }

    const tracked = suppliedTracker ?? rawApp.createTracked();
    await beforeHandler?.();
    const effective = withDraftSeam(tracked, merged);
    const result = await rawApp.runHandler(path, args, effective, merged);
    return { result, tracked };
  }

  const app: WyStackApp = {
    ...rawApp,
    async call(path, args, context) {
      let serverFrameCleanupHandled = false;
      const dispatchContext = {
        ...(context ?? {}),
        markServerFrameCleanupHandled: () => {
          serverFrameCleanupHandled = true;
        },
      };
      let framesBefore: Set<string> | undefined;
      const { result, tracked } = await dispatchHandler(
        path,
        args,
        dispatchContext,
        undefined,
        async () => {
          framesBefore =
            opts.dataFrameStorage != null
              ? await referencedServerFrameIds(opts.db as ArtifactDb)
              : undefined;
        },
      );
      // `tracked` and `effective` share the same tracker sets (withDraft reuses
      // the base tracker), so tablesWritten reflects the write either way.
      const tablesWritten = tracked.tablesWritten;
      if (
        opts.dataFrameStorage != null &&
        framesBefore != null &&
        !serverFrameCleanupHandled &&
        tablesWritten.size > 0
      ) {
        await removeDereferencedServerFrames(
          opts.db as ArtifactDb,
          opts.dataFrameStorage,
          framesBefore,
          opts.flushSnapshotRetentionWindow,
          opts.unregisterServerFrames,
        );
      }
      if (onWrite != null && tablesWritten.size > 0) {
        try {
          onWrite();
        } catch (err) {
          console.error("[dashframe] onWrite hook threw:", err);
        }
      }
      return {
        result,
        tablesRead: tracked.tablesRead,
        tablesWritten,
      };
    },
    async runHandler(path, args, tracked, context) {
      return (await dispatchHandler(path, args, context, tracked)).result;
    },
  };
  return app;
}

async function removeUnreferencedServerFrames(
  db: ArtifactDb,
  storage: DataFrameStorage,
  flushSnapshotRetentionWindow: (() => Promise<void>) | undefined,
): Promise<void> {
  const referenced = await referencedServerFrameIds(db);
  const pendingDeletes =
    (await storage.hasPendingDataFrameDeletes?.()) ?? false;
  const storedIds = await storage.list();
  const hasUnreferencedFrames = storedIds.some((id) => !referenced.has(id));
  if (!pendingDeletes && !hasUnreferencedFrames) {
    await storage.recoverStagedDeletes?.([...referenced] as UUID[]);
    return;
  }
  if (flushSnapshotRetentionWindow == null) {
    console.error(
      "[dashframe] no retained-snapshot flush hook; leaving server frame cleanup for a configured startup",
    );
    return;
  }
  await flushSnapshotRetentionWindow();
  await storage.recoverStagedDeletes?.([...referenced] as UUID[]);
  const ids = await storage.list();
  const results = await Promise.allSettled(
    ids.filter((id) => !referenced.has(id)).map((id) => storage.delete(id)),
  );
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length > 0) {
    console.error(
      `[dashframe] ${failures.length} unreferenced server frame(s) could not be removed at startup; the next start will retry`,
      failures.map(({ reason }) => reason),
    );
  }
}

async function removeDereferencedServerFrames(
  db: ArtifactDb,
  storage: DataFrameStorage,
  before: ReadonlySet<string>,
  flushSnapshotRetentionWindow: (() => Promise<void>) | undefined,
  unregister: ((ids: readonly string[]) => Promise<void>) | undefined,
): Promise<void> {
  const after = await referencedServerFrameIds(db);
  const dereferenced = [...before].filter((id) => !after.has(id));
  if (dereferenced.length === 0) return;
  if (flushSnapshotRetentionWindow == null) {
    console.error(
      "[dashframe] no retained-snapshot flush hook; leaving dereferenced server frames for startup recovery",
    );
    return;
  }
  try {
    await flushSnapshotRetentionWindow();
  } catch (error) {
    console.error(
      "[dashframe] snapshot flush failed; leaving dereferenced server frames for startup recovery",
      error,
    );
    return;
  }
  const results = await Promise.allSettled(
    dereferenced.map((id) => storage.delete(id as UUID)),
  );
  await optsUnregisterSuccessful(results, dereferenced, unregister);
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length > 0) {
    console.error(
      `[dashframe] ${failures.length} dereferenced server frame(s) could not be removed; startup recovery will retry`,
      failures.map(({ reason }) => reason),
    );
  }
}

async function optsUnregisterSuccessful(
  results: PromiseSettledResult<void>[],
  ids: string[],
  unregister: ((ids: readonly string[]) => Promise<void>) | undefined,
): Promise<void> {
  const removed = ids.filter(
    (_, index) => results[index]?.status === "fulfilled",
  );
  if (removed.length === 0 || unregister == null) return;
  try {
    await unregister(removed);
  } catch (error) {
    // File deletion is already committed. A runtime-native cleanup failure
    // cannot make the durable mutation untrue or suppress its onWrite hook.
    console.error(
      "[dashframe] native unregister failed after durable frame deletion; runtime cleanup will retry when configured",
      error,
    );
  }
}

async function referencedServerFrameIds(db: ArtifactDb): Promise<Set<string>> {
  const rows = (await db
    .select({ storage: schema.dataFrames.storage })
    .from(schema.dataFrames)) as Array<{ storage: unknown }>;
  return new Set(
    rows.flatMap((row) => {
      const location = row.storage as { type?: string; key?: string };
      return location.type === "file" && typeof location.key === "string"
        ? [location.key]
        : [];
    }),
  );
}

/**
 * Run the connector-setup sweep once at boot, and never let it stop the server.
 *
 * Housekeeping, not a precondition: the sweep only expires and prunes stale
 * connector-setup rows, and nothing else depends on it having run. Failing the
 * boot over it takes the whole app down for a problem confined to one
 * background chore. The next sweep, or the callback gate itself, catches
 * whatever this pass missed.
 *
 * `__bootSweep` waives the in-flight grace window. This is the one caller that
 * can prove no handler owns an `exchanging` / `verifying` row — the process
 * that would have owned it is the one that just died. It also has to waive it:
 * this pass is the only one scheduled, so a row left inside the window would
 * sit in flight indefinitely while the browser polled it to its own timeout.
 *
 * Must be called before the listener opens — see the call site. The waiver is
 * only sound while no request can be in flight.
 */
async function sweepConnectorSetupAtBoot(
  app: WyStackApp,
  flushSnapshot: (() => Promise<void>) | undefined,
): Promise<void> {
  try {
    await app.call(
      "sweepConnectorSetupSessions",
      {},
      {
        principal: { kind: "user", userId: LOCAL_USER_ID },
        __bootSweep: true,
      },
    );
    await flushSnapshot?.();
  } catch (error) {
    console.warn(
      `[dashframe] connector setup sweep skipped at boot: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
}

export async function createDashframeServer(
  opts: DashframeServerOptions,
): Promise<DashframeServer> {
  const hostname = opts.hostname ?? "127.0.0.1";
  const requestedPort = opts.port ?? 0;

  // Secure-by-default: refuse to start an unauthenticated server on a
  // non-loopback bind. Runs before any socket bind, so a disallowed config
  // never opens a listener. See assertBindAuthorized for the full rationale.
  assertBindAuthorized({
    hostname,
    authToken: opts.authToken,
    authRef: opts.authRef,
    insecure: opts.insecure,
  });

  const corsOrigin = opts.corsOrigin ?? allowLocalhostOrigin;
  // Single local operator: the operator principal is always LOCAL_USER_ID.
  // Configurable operator identity is a non-goal until a real multi-operator
  // consumer exists — a settable option here would authenticate but be denied
  // by the accessCredentials.manage check, a typed lie.
  const userId = LOCAL_USER_ID;
  const serverState: { endpoint?: string } = {};
  const googleOAuth = opts.googleOAuth ?? readOptionalGoogleOAuthConfig();
  const nativeTables = opts.arrowEngine
    ? new NativeTableLifecycle(opts.arrowEngine)
    : undefined;

  // Resolve the auth context builder: vault-backed ref takes priority over
  // plaintext token. Both produce the same (req) → context shape for WyStack.
  //
  // Defensive invariant: authRef requires vault — the ref is meaningless
  // without the mapping store and backend. A missing vault silently falls
  // through to unauthenticated without this guard; fail loudly instead.
  if (opts.authRef && !opts.vault) {
    throw new Error(
      "createDashframeServer: authRef requires vault — supply a SecretVault " +
        "instance when using vault-backed auth.",
    );
  }
  const credentialResolvers: CredentialResolver[] = [];
  if (opts.authRef && opts.vault) {
    credentialResolvers.push(
      createVaultTokenResolver(opts.authRef, opts.vault, userId),
    );
  } else if (opts.authToken) {
    credentialResolvers.push(createTokenResolver(opts.authToken, userId));
  }
  // Named access credentials are an ADDITIONAL way in, never the first one.
  // Registering this resolver is what makes `resolveContext` defined, and a
  // defined `resolveContext` turns on transport authentication for every
  // request. On a loopback `dashframe serve` with a secret key but no
  // `--token`/`authRef`, that would reject every unauthenticated request with
  // no way to bootstrap the first credential (the issue mutation itself needs
  // a credential). So the resolver only joins the chain when a primary auth
  // mechanism already exists; without one, the server stays open exactly as it
  // was before a key was configured, and the vault is still injected so the
  // issue/list/revoke functions remain configured for a `--token` operator.
  const hasPrimaryAuth = Boolean(
    (opts.authRef && opts.vault) || opts.authToken,
  );
  if (opts.accessCredentials && hasPrimaryAuth) {
    credentialResolvers.push(
      createAccessCredentialResolver(opts.accessCredentials),
    );
  }
  // `credentialResolvers` is empty here in two cases: no auth mechanism
  // configured at all (no authToken, no authRef, no accessCredentials — the
  // documented token-less loopback config; `dashframe serve` with no
  // `--token`, see index.ts's help text: "The default bind is loopback-only
  // and safe to run without a token"), OR `accessCredentials` IS configured
  // but `hasPrimaryAuth` is false (a keyed loopback serve with no
  // `--token`/`authRef` — the block above deliberately keeps that resolver
  // out of the chain). Both are "no request carries an authenticated
  // identity" configs and get the same treatment. `assertBindAuthorized`
  // above already confirmed either combination is only reachable on a
  // loopback bind (or an explicit `insecure: true` opt-out).
  // Pre-`commands.commit`, no procedure but `accessCredentials.manage`
  // carried an `.authorize` check, so a missing principal never blocked
  // anything on this config. Now that every command procedure does, an
  // absent principal denies every one of them: this loopback config would
  // silently become read-only (`commands.preview` is still open to any
  // well-formed principal — but `evaluate()` denies before it ever calls
  // `check` when there is no principal at all, so even `previewDiff` would
  // 403 without this — and every command, `commitBatch`, `publishDraft`, and
  // `discardDraft` would too). Synthesize a principal for every request so
  // the loopback config stays writable.
  //
  // Deliberately NOT `LOCAL_USER_ID` (the operator's own identity) — see
  // `LOOPBACK_ANON_USER_ID`'s doc comment in permissions.ts for why using the
  // operator id here would let any unauthenticated loopback request mint a
  // durable, off-host-usable API credential via `accessCredentials.manage`.
  // `commands.commit` only needs `kind === "user"`, which this satisfies.
  if (credentialResolvers.length === 0) {
    credentialResolvers.push(async () => ({
      principal: { kind: "user", userId: LOOPBACK_ANON_USER_ID },
    }));
  }
  const resolveContext = combineResolvers(...credentialResolvers);

  // Wrap the WyStack app to inject the vault into every handler context and
  // to fire `opts.onWrite` after every successful mutation.
  const vaultWrapped = await buildDashframeApp({
    db: opts.db,
    dataFrameStorage: opts.dataFrameStorage,
    ...(nativeTables ? { dataPlaneRuntime: nativeTables.engine } : {}),
    vault: opts.vault,
    onWrite: opts.onWrite,
    flushSnapshot: opts.flushSnapshot,
    flushSnapshotRetentionWindow: opts.flushSnapshotRetentionWindow,
    unregisterServerFrames: (ids) =>
      nativeTables?.unregisterCommittedFrames(ids) ?? Promise.resolve(),
    accessCredentials: opts.accessCredentials,
    getServerEndpoint: () => serverState.endpoint,
    googleOAuth,
  });

  // Inject server-level references needed by the previewDiff query handler
  // (wyStackApp, artifactDb). These are server-only concerns — separate from
  // the vault+onWrite seam in buildDashframeApp. Done via a thin wrapper so
  // vaultWrapped (the vault seam) stays testable in isolation.
  //
  // The mutation pattern: staticContext is a shared object closed over by the
  // wrapper; wyStackApp is populated after assignment because it IS the wrapped
  // app reference. Both keys win over per-request context (spread LAST).
  const serverContext: Record<string, unknown> = {};
  // Invalidation emit — the RE-MIRROR POINT in `buildDashframeApp` come due.
  //
  // wystack collapsed invalidation onto a single per-app source: `rawApp.call`
  // fuses `emit(tablesWritten)` after any write, and `createRoutes` no longer
  // publishes from the returned `tablesWritten` at all. Our `call` chain never
  // reaches `rawApp.call` (the draft seam in `buildDashframeApp` composes
  // `createTracked → runHandler` itself so it can hand the draft-scoped handle
  // to the handler), so that fuse never fires for us — without this, every
  // subscription across every surface silently stops invalidating.
  //
  // Emitted HERE, at the outermost wrapper, and with the MERGED set: the
  // `__extraTablesWritten` writes come from sub-trackers (publishDraft's
  // `applyCommands`) that no inner tracker ever saw, so emitting deeper would
  // miss them. Guarded on size so the router's own read-only recompute — which
  // re-enters `call` — cannot start a recompute storm.
  const emitInvalidation = (tablesWritten: Set<string>) => {
    if (tablesWritten.size > 0) vaultWrapped.emit(tablesWritten);
  };

  const app: WyStackApp = {
    ...vaultWrapped,
    async call(path, args, context) {
      const merged = { ...(context ?? {}), ...serverContext };
      let callResult: Awaited<ReturnType<typeof vaultWrapped.call>>;
      try {
        callResult = await vaultWrapped.call(path, args, merged);
      } catch (err) {
        // A later command can fail after appendToDraft atomically committed an
        // earlier prefix. The normal result metadata is then unavailable, so
        // consume the prefix's private write metadata before preserving the
        // original RPC error.
        notifyRecoveredDraftWrites(err, emitInvalidation, opts.onWrite);
        throw err;
      }

      // Handlers that use a sub-tracker (e.g. publishDraft, which calls
      // applyCommands with its own fresh tracked context) cannot surface their
      // writes via the outer DrizzleTracker. They signal the tables they wrote
      // by returning `__extraTablesWritten: string[]` in the result object. The
      // wrapper always strips the field (so clients never see it) and merges it
      // into `callResult.tablesWritten` when non-empty (so `createRoutes`
      // broadcasts the correct WS invalidation set).
      //
      // The double-underscore prefix is a reserved-internal convention. Any
      // handler whose result carries a non-empty `__extraTablesWritten` will
      // have those tables merged into the invalidation set — this is a
      // deliberate extension point, not accidental behaviour.
      const rawResult = callResult.result as
        | ({ __extraTablesWritten?: unknown } & object)
        | null
        | undefined;
      if (rawResult != null && "__extraTablesWritten" in rawResult) {
        const { __extraTablesWritten, ...cleanResult } = rawResult;
        const extra = Array.isArray(__extraTablesWritten)
          ? (__extraTablesWritten as string[])
          : [];
        const mergedTables =
          extra.length > 0
            ? new Set([...callResult.tablesWritten, ...extra])
            : callResult.tablesWritten;
        emitInvalidation(mergedTables);
        return {
          ...callResult,
          result: cleanResult,
          tablesWritten: mergedTables,
        };
      }

      emitInvalidation(callResult.tablesWritten);
      return callResult;
    },
    async runHandler(path, args, tracked, context) {
      const merged = { ...(context ?? {}), ...serverContext };
      return vaultWrapped.runHandler(path, args, tracked, merged);
    },
  };

  // Inject app + db references needed by the previewDiff query handler.
  // Done post-assignment because app itself is the wrapped version.
  serverContext.wyStackApp = app;
  serverContext.artifactDb = opts.db;

  // Inject the persistent draft controller. Must come after `app` is finalized
  // because the controller's `publishDraft` replay uses the full wrapped app.
  // The `onWrite` callback is also surfaced here so the `publishDraft` handler
  // can fire it explicitly — `buildDashframeApp`'s outer tracker never sees the
  // sub-tracker writes from `applyCommands(mode:'commit')` inside the controller.
  serverContext.draftController = createDraftController(
    app,
    opts.db as ArtifactDb,
    {
      // Capture-before-log: rewrite plaintext credential args into vault refs
      // before a credential command is snapshotted into draft_command_log, so the
      // durable log never holds plaintext. The vault closure makes the store real
      // (a draft append is never a preview); a missing vault fails closed.
      captureCredentials: (cmd) =>
        captureCommandCredentials(cmd, opts.vault, opts.db as ArtifactDb),
      validatePublishLog: (log) => {
        assertPublishLogHasNoLateBound(log);
      },
    },
  );
  serverContext.onWrite = opts.onWrite;
  // Durable counterpart to onWrite: cancels the debounce and forces an
  // immediate snapshot write, awaited for durability. Used by the pre-release
  // gate (publishDraft / discardDraft / direct canonical credential writes) to
  // guarantee the snapshot dropping a ref is on disk before the ref is deleted.
  serverContext.flushSnapshot = opts.flushSnapshot;

  // Mirror @wystack/server/node's serve() composition, adding CORS in front.
  const honoApp = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({
    app: honoApp,
  });
  // The MCP transport needs headers and methods the rest of the surface does
  // not. Allow client probes through CORS so the route can answer unsupported
  // methods with 405 instead of an opaque browser network error. Scoped to
  // /mcp rather than
  // widening the general policy, and registered first so a preflight for /mcp
  // is answered here and never reaches the policy below.
  honoApp.use(
    "/mcp",
    cors({
      origin: corsOrigin,
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "Mcp-Session-Id",
        "Mcp-Protocol-Version",
        "Last-Event-ID",
      ],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      exposeHeaders: ["Mcp-Session-Id", "Mcp-Protocol-Version"],
    }),
  );
  honoApp.use(
    "*",
    cors({
      origin: corsOrigin,
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );
  // Mount the dedicated Arrow IPC data path *before* the WyStack catch-all
  // route, so `/data/arrow` is served by the binary path, not WyStack. This is
  // the hard metadata/data boundary: WyStack frames never carry Arrow bytes.
  if (nativeTables) {
    honoApp.route(
      "/data",
      createArrowDataPath({
        engine: nativeTables.engine,
        dataFrameStorage: opts.dataFrameStorage,
        isFrameAvailable: async (id) => {
          const rows = await (opts.db as ArtifactDb)
            .select({ storage: schema.dataFrames.storage })
            .from(schema.dataFrames)
            .where(drizzleEq(schema.dataFrames.id, id))
            .limit(1);
          const location = rows[0]?.storage as
            | { type?: string; key?: string }
            | undefined;
          return location?.type === "file" && location.key === id;
        },
        ...(opts.authRef && opts.vault
          ? { authRef: opts.authRef, vault: opts.vault }
          : { authToken: opts.authToken }),
      }),
    );
  }

  honoApp.post("/assistant/run", (c) =>
    handleAssistantRunRequest(c, {
      app,
      db: opts.db as ArtifactDb,
      draftController: serverContext.draftController as DraftController,
      vault: opts.vault,
      flushSnapshot: opts.flushSnapshot,
      resolveContext,
    }),
  );

  honoApp.all(
    "/mcp",
    createMcpRoute({
      app,
      resolveContext,
      mode: opts.mcpMode,
      maxStatefulSessions: opts.mcpMaxStatefulSessions,
      statefulSessionTtlMs: opts.mcpStatefulSessionTtlMs,
      now: opts.mcpSessionNow,
    }),
  );

  // OAuth callback + resume are intentionally outside createRoutes: neither
  // browser request carries a bearer token. The callback reaches project writes
  // only through its state gates and the fixed internal principal in the
  // delegated app.call.
  honoApp.get("/api/connectors/oauth/callback", (c) =>
    handleConnectorOAuthCallback(c, app),
  );
  honoApp.get("/api/connectors/setup/:sessionId/resume", (c) =>
    handleConnectorSetupResume(c, app),
  );
  // This route owns the origin root. Hono matches first-registered-first, so a
  // static UI route registered at "/" below would never be reached, and one
  // registered above would silently swallow every resume link. Moving this line
  // relative to createRoutes changes which handler wins, with no error either
  // way — do it deliberately or not at all.
  honoApp.get("/", (c) => handleConnectorResumeLanding(c, app));

  honoApp.route("/", createRoutes({ app, resolveContext }, upgradeWebSocket));

  // Before the listener opens, and that ordering is load-bearing: the sweep
  // waives the in-flight grace window on the claim that no handler can own an
  // `exchanging` / `verifying` row. That claim is only true while nothing can
  // reach the callback route. Run it after `listen` and an OAuth callback
  // arriving in the same moment could have its session reset underneath it,
  // failing a connection that in fact succeeded.
  await sweepConnectorSetupAtBoot(app, opts.flushSnapshot);

  const { port, server } = await listen(honoApp, hostname, requestedPort);
  injectWebSocket(server);
  serverState.endpoint = `http://${hostname}:${port}/api`;

  return {
    url: `http://${hostname}:${port}`,
    port,
    stop: () => {
      nativeTables?.close();
      server.close();
    },
  };
}

/**
 * Start the Node HTTP server and resolve once it is listening, with the bound
 * port (the OS-assigned one when `requestedPort` is 0).
 */
function listen(
  honoApp: Hono,
  hostname: string,
  requestedPort: number,
): Promise<{ port: number; server: ReturnType<typeof nodeServe> }> {
  return new Promise((resolve, reject) => {
    const server = nodeServe(
      { fetch: honoApp.fetch, hostname, port: requestedPort },
      (info) => resolve({ port: info.port, server }),
    );
    // Without this, a bind failure leaves the promise unsettled — the listen
    // callback never fires, createDashframeServer hangs, and main's try/catch
    // never sees a throw. Surface it so startup fails loudly instead.
    server.on("error", reject);
  });
}

type ResolverContext = Record<string, unknown>;
type CredentialResolver = (req: Request) => Promise<ResolverContext | null>;

function notifyRecoveredDraftWrites(
  error: unknown,
  emitInvalidation: (tablesWritten: Set<string>) => void,
  onWrite: (() => void) | undefined,
): void {
  const recoveredTables = new Set(recoveredDraftWriteTables(error));
  if (recoveredTables.size === 0) return;
  emitInvalidation(recoveredTables);
  if (onWrite == null) return;
  try {
    onWrite();
  } catch (onWriteError) {
    console.error("[dashframe] onWrite hook threw:", onWriteError);
  }
}

function bearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
}

function createTokenResolver(
  expectedToken: string,
  userId: string,
): CredentialResolver {
  return async (req) => {
    const token = bearerToken(req);
    if (!tokenMatches(token, expectedToken)) {
      return null;
    }
    return { principal: { kind: "user", userId } };
  };
}

function createAccessCredentialResolver(
  credentials: ApiAccessCredentials,
): CredentialResolver {
  return async (req) => {
    const token = bearerToken(req);
    if (!token) return null;
    const credentialId = await credentials.authenticate(token);
    if (!credentialId) return null;
    return { principal: { kind: "service", credentialId } };
  };
}

function combineResolvers(
  ...resolvers: CredentialResolver[]
): (req: Request) => Promise<ResolverContext> {
  return async (req) => {
    for (const resolver of resolvers) {
      const context = await resolver(req);
      if (context !== null) return context;
    }
    throw new Error("Unauthorized");
  };
}

/**
 * Vault-backed token resolver. Resolves the expected token from the vault at
 * each request — no plaintext is held in a server field. Returned resolver has
 * the same signature as the one returned by `createTokenResolver`.
 *
 * FAIL-CLOSED: a token mismatch returns null so another credential family can
 * authenticate it. Any failure to resolve the expected token (missing/corrupt
 * keychain blob, vault error) throws and propagates immediately, so no weaker
 * resolver gets a turn.
 */
function createVaultTokenResolver(
  authRef: SecretRef,
  vault: SecretVault,
  userId: string,
): CredentialResolver {
  return async (req) => {
    const token = bearerToken(req);
    const authorized = await vault.withSecret(authRef, async (expected) =>
      tokenMatches(token, expected),
    );
    if (!authorized) {
      return null;
    }
    return { principal: { kind: "user", userId } };
  };
}

function tokenMatches(actual: string, expected: string): boolean {
  const actualBytes = createHash("sha256").update(actual).digest();
  const expectedBytes = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualBytes, expectedBytes);
}

export {
  createDraftController,
  type DraftController,
} from "./draft-controller";
export type { Functions } from "./functions";
