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
// `@duckdb/node-api` addon. The `dashframe serve` path imports this app without
// passing `arrowEngine`, so pulling the native binding eagerly would break
// startup on platforms without it. arrow-data-path has no native dependency.
import {
  createArrowDataPath,
  type ArrowQueryRunner,
} from "@dashframe/engine-server/arrow-data-path";
import { schema } from "@dashframe/server-core";
import { serve as nodeServe } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { DraftDrizzleTracker, DrizzleTracker } from "@wystack/db";
import {
  isSecretRef,
  type SecretRef,
  type SecretVault,
} from "@wystack/secret-vault";
import { createRoutes, createWyStack, type WyStackApp } from "@wystack/server";
import type { Table } from "drizzle-orm";
import { getTableName } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createHash, timingSafeEqual } from "node:crypto";

import { type ArtifactDb } from "@dashframe/server-core";

import { captureCommandCredentials } from "./credential-release";
import { createDraftController } from "./draft-controller";
import { functions } from "./functions";

type CorsOrigin =
  | string
  | string[]
  | ((
      origin: string,
      c: Context,
    ) => Promise<string | undefined | null> | string | undefined | null);

/**
 * Returns true when `hostname` is a loopback address (127.0.0.0/8, ::1, or
 * the "localhost" name). Loopback-only binds are reachable from this machine
 * alone; no network auth token is required. Undefined / absent hostname
 * defaults to 127.0.0.1 (loopback).
 */
function isLoopbackHost(hostname: string | undefined): boolean {
  return (
    hostname === undefined ||
    hostname === "localhost" ||
    // Entire 127.0.0.0/8 block is loopback (RFC 3330), not just 127.0.0.1.
    hostname.startsWith("127.") ||
    hostname === "::1"
  );
}

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
  /** Bind host. Default `127.0.0.1` (loopback). */
  hostname?: string;
  /** Bind port. Default `0` — the OS assigns an ephemeral port. */
  port?: number;
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
   * Optional native engine for the dedicated Arrow IPC data path. When supplied
   * (desktop / `dashframe serve` with the native engine), `POST /data/arrow`
   * streams `application/vnd.apache.arrow.stream` for a compiled query — the
   * binary path that never rides WyStack RPC. Web try-it omits it: the
   * result already lives in renderer WASM, so there is no server data path.
   */
  arrowEngine?: ArrowQueryRunner;
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
  /**
   * Secret vault for credential storage. The runtime composer (Electron main
   * or `dashframe serve`) registers a backend into a SecretRegistry, builds a
   * SecretVault, and injects it here. The server itself never picks or
   * instantiates a backend — it RECEIVES a fully-composed vault.
   *
   * When supplied, control-plane write mutations (create/update DataSource)
   * call `vault.store(plaintext, { class: "connector-key" }) → ref` instead
   * of persisting the plaintext. Read mutations use `vault.has(ref)` for
   * presence checks (hasApiKey / hasConnectionString).
   *
   * Optional at the factory level — omitting it falls back to the legacy
   * plaintext-in-config path (pre-vault callers, tests that don't exercise
   * the credential boundary). Desktop always injects the keychain vault.
   */
  vault?: SecretVault;
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
 * CONSUMER CONSTRAINTS — the seam is dormant in this slice (no host injects a
 * draftId). The host that wires draftId into request context owns these:
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
 *   - CREDENTIAL SIDE EFFECTS. See draft-controller.ts SECURITY BOUNDARY: a
 *     credentialed handler's `vault.store` is a real side effect even in a draft.
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
 *      `<table>__draft` shadow tables. Draft writes are not canonical; `onWrite`
 *      drives canonical snapshot persistence and must NOT fire for draft-overlay
 *      writes.
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
  vault?: SecretVault;
  onWrite?: () => void;
}): Promise<WyStackApp> {
  const rawApp = await createWyStack({ db: opts.db, functions });

  const { vault, onWrite } = opts;

  // Build the static context additions once so every call shares the same object
  // reference (vault identity is stable for the server lifetime).
  const staticContext: Record<string, unknown> = vault != null ? { vault } : {};
  const hasStaticContext = Object.keys(staticContext).length > 0;

  // The draft seam wraps `call` itself (not just runHandler): `rawApp.call`
  // mints its own fresh DrizzleTracker internally, so a draftId-bearing `call` would
  // otherwise hit canonical. We mirror rawApp.call's composition (fresh tracked
  // → runHandler → result shape) but pass the draft-scoped handle when a draftId
  // is present, leaving the no-draft path identical to rawApp.call.
  //
  // EQUIVALENCE (load-bearing): rawApp.call is a THIN composition — `const t =
  // createTracked(); const result = await runHandler(path, args, t, context);
  // return { result, tablesRead: t.tablesRead, tablesWritten: t.tablesWritten }`
  // — with no retry, no error normalization, no separate tablesRead pass (see
  // @wystack/server create.ts). This decomposition reproduces it byte-for-byte
  // on the no-draft path. RE-MIRROR POINT: if a wystack upgrade adds logic INSIDE
  // rawApp.call, this wrapper must be updated to match — it cannot delegate to
  // rawApp.call because that path mints an internal tracker the seam can't reach.
  return {
    ...rawApp,
    async call(path, args, context) {
      // Static context wins over per-request context: spread per-request first
      // so static keys (vault) cannot be shadowed by a crafted request context.
      const merged = hasStaticContext
        ? { ...(context ?? {}), ...staticContext }
        : (context ?? {});
      const tracked = rawApp.createTracked();
      const effective = withDraftSeam(tracked, merged);
      const result = await rawApp.runHandler(path, args, effective, merged);
      // `tracked` and `effective` share the same tracker sets (withDraft reuses
      // the base tracker), so tablesWritten reflects the write either way.
      const tablesWritten = tracked.tablesWritten;
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
      const merged = hasStaticContext
        ? { ...(context ?? {}), ...staticContext }
        : (context ?? {});
      const effective = withDraftSeam(tracked, merged);
      return rawApp.runHandler(path, args, effective, merged);
    },
  };
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
  let resolveContext:
    | ((req: Request) => Promise<Record<string, unknown>>)
    | undefined;
  if (opts.authRef && opts.vault) {
    resolveContext = createVaultTokenResolver(opts.authRef, opts.vault);
  } else if (opts.authToken) {
    resolveContext = createTokenResolver(opts.authToken);
  }

  // Wrap the WyStack app to inject the vault into every handler context and
  // to fire `opts.onWrite` after every successful mutation.
  const vaultWrapped = await buildDashframeApp({
    db: opts.db,
    vault: opts.vault,
    onWrite: opts.onWrite,
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
  const app: WyStackApp = {
    ...vaultWrapped,
    async call(path, args, context) {
      const merged = { ...(context ?? {}), ...serverContext };
      const callResult = await vaultWrapped.call(path, args, merged);

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
        return {
          ...callResult,
          result: cleanResult,
          tablesWritten: mergedTables,
        };
      }

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
  if (opts.arrowEngine) {
    honoApp.route(
      "/data",
      createArrowDataPath({
        engine: opts.arrowEngine,
        ...(opts.authRef && opts.vault
          ? { authRef: opts.authRef, vault: opts.vault }
          : { authToken: opts.authToken }),
      }),
    );
  }

  honoApp.route("/", createRoutes({ app, resolveContext }, upgradeWebSocket));

  const { port, server } = await listen(honoApp, hostname, requestedPort);
  injectWebSocket(server);

  return {
    url: `http://${hostname}:${port}`,
    port,
    stop: () => server.close(),
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

function createTokenResolver(
  expectedToken: string,
): (req: Request) => Promise<Record<string, unknown>> {
  return async (req) => {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ")
      ? auth.slice("Bearer ".length)
      : "";
    if (!tokenMatches(token, expectedToken)) {
      throw new Error("Unauthorized");
    }
    return {};
  };
}

/**
 * Vault-backed token resolver. Resolves the expected token from the vault at
 * each request — no plaintext is held in a server field. Returned resolver has
 * the same signature as the one returned by `createTokenResolver`.
 *
 * FAIL-CLOSED: any failure to resolve the expected token (missing/corrupt
 * keychain blob, vault error) denies the request. The throw propagates to
 * WyStack's route handler, which maps it to 401 — never a 500 that would leak
 * the vault state, and never an allow.
 */
function createVaultTokenResolver(
  authRef: SecretRef,
  vault: SecretVault,
): (req: Request) => Promise<Record<string, unknown>> {
  return async (req) => {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ")
      ? auth.slice("Bearer ".length)
      : "";
    let authorized = false;
    try {
      authorized = await vault.withSecret(authRef, async (expected) =>
        tokenMatches(token, expected),
      );
    } catch {
      // Resolution failed — cannot confirm the token, so deny. Fall through to
      // the Unauthorized throw below (→ 401), never surface a 500 or allow.
      authorized = false;
    }
    if (!authorized) {
      throw new Error("Unauthorized");
    }
    return {};
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
