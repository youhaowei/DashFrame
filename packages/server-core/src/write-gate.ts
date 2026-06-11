/**
 * Artifact-DB write gate — profiles only, by construction.
 *
 * Two-layer enforcement design
 * ─────────────────────────────
 * Layer 1 — this Proxy gate (fast, legible errors):
 *   Wraps the raw Drizzle ArtifactDb so that *every* ORM insert or update
 *   against `data_frames` has `analysis.columns[*].sampleValues` stripped to
 *   `[]` before the bytes reach PGLite.  Intercepts builder-level calls, so
 *   the error is thrown at the call site with a clear message naming the gate.
 *
 * Layer 2 — DB-floor trigger (`strip_data_frames_sample_values`):
 *   A PostgreSQL BEFORE INSERT OR UPDATE trigger installed on `data_frames` by
 *   `installSampleValuesTrigger` (sync-schema.ts) on every `openArtifactDb`
 *   call.  The trigger iterates `NEW.analysis->'columns'` and sets every
 *   `sampleValues` to `'[]'::jsonb` before the row lands.  Because this fires
 *   at the database level it catches paths the Proxy cannot see:
 *   - Drizzle `.prepare()` / `.execute()` — the placeholder is bound at
 *     execute time, after the Proxy builder-intercept has already run.
 *   - `db.execute(sql`…`)` — raw SQL entirely bypasses the Proxy.
 *   - Any future code path, ORM version, or third-party integration.
 *   The trigger is the invariant of record.  "No current caller" reasoning is
 *   invalid for this surface by policy — the gate exists to constrain future
 *   callers that haven't been written yet.
 *
 * Why both layers:
 *   The Proxy provides early, legible errors (fail-closed on sql`` expressions,
 *   clear gate name in the message).  The trigger provides unconditional
 *   enforcement regardless of call path.  Together they make the invariant
 *   "artifact DB contains zero raw sampleValues" physically unbreakable.
 *
 * Why a Proxy at this layer (Layer 1 detail):
 * - The earlier per-handler approach stripped sampleValues in specific mutation
 *   handlers; a future handler could accidentally skip the call.  The gate
 *   below makes that omission impossible — the strip fires on the Drizzle
 *   instance itself.
 * - Drizzle has no middleware/hook API, so a Proxy on the returned builder
 *   objects is the lowest-cost intercept point available.
 *
 * Scope: only `data_frames` writes carry `analysis` (a DataFrameAnalysis
 * JSONB column).  All other table writes pass through unchanged.
 *
 * The gate is applied once, inside `openArtifactDb`, before the db instance
 * is handed to any caller.
 *
 * Proxy gate coverage — every Drizzle ORM write path to `data_frames`:
 * - `.insert(dataFrames).values(...)`              → sampleValues stripped
 * - `.insert(...).onConflictDoUpdate({ set })`     → set payload stripped
 * - `.update(dataFrames).set(...)`                 → set payload stripped
 * - `db.transaction(async (tx) => ...)`            → `tx` is itself gated, so
 *   transactional and nested-transaction (savepoint) writes are stripped too.
 *   This composes with WyStack's TrackedDb, which calls `db.transaction(...)`
 *   on the underlying Drizzle instance and hands the resulting `tx` to its own
 *   wrapper — TrackedDb receives a gated `tx`, not a raw one.
 * - A `sql\`…\`` expression supplied as the `analysis` value (e.g.
 *   `.set({ analysis: sql\`…\` })`) cannot be statically stripped, so the gate
 *   THROWS rather than letting it through silently.  See
 *   `stripDataFrameAnalysis` for the rationale.
 *
 * DB trigger coverage (catches what the Proxy misses):
 * - `.prepare()` / `.execute({ analysis })` — value bound after builder phase.
 * - `db.execute(sql\`INSERT INTO data_frames … VALUES (…)\`)` — raw SQL.
 * - Any future call path.
 */

import { getTableName, is, SQL } from "drizzle-orm";

import type { ArtifactDb } from "./db";
import { dataFrames } from "./schema";

// ---- helpers ----------------------------------------------------------------

/** The SQL table name we guard — computed once at module load. */
const DATA_FRAMES_TABLE = getTableName(dataFrames);

/** Shape of any value that may carry a DataFrameAnalysis payload. */
type MaybeWithAnalysis = Record<string, unknown>;

/**
 * Strip raw sampleValues from a `data_frames` row value before it hits
 * PGLite.  Non-analysis columns are untouched.  Handles both single-row
 * objects and arrays of rows (Drizzle's `.values()` accepts both).
 *
 * Fail-closed on SQL expressions: if the `analysis` value is a Drizzle SQL
 * expression (e.g. `sql\`jsonb_set(analysis, '{columns,0,sampleValues}', …)\``)
 * the gate cannot statically inspect or rewrite it — the strip is a plain-object
 * transform, and a SQL fragment is opaque until PGLite evaluates it.  Rather
 * than forward it unmodified (which would silently defeat the privacy
 * invariant), we THROW.  A loud, unenforceable invariant is safer than a quiet
 * one: the caller must pass a plain analysis object so the gate can strip it.
 * This is the deliberate fail-closed design decision for this gate.
 */
function stripDataFrameAnalysis<T extends MaybeWithAnalysis>(value: T): T {
  if (!("analysis" in value) || value.analysis == null) return value;

  // Fail closed: a SQL expression in the analysis column is unstrippable by
  // construction.  Throw with the gate name and the safe alternative.
  if (is(value.analysis, SQL)) {
    throw new Error(
      "Artifact-DB write gate: the `analysis` column was given a raw " +
        "SQL expression, which the gate cannot statically strip of sampleValues. " +
        "Pass a plain DataFrameAnalysis object so the gate can enforce the " +
        "profiles-only invariant. (Raw SQL writes to data_frames.analysis are " +
        "not a supported path.)",
    );
  }

  const analysis = value.analysis as {
    columns?: Array<Record<string, unknown>>;
    [k: string]: unknown;
  };

  if (!Array.isArray(analysis.columns)) return value;

  return {
    ...value,
    analysis: {
      ...analysis,
      columns: analysis.columns.map((col) => ({ ...col, sampleValues: [] })),
    },
  };
}

function stripMaybeArray<T extends MaybeWithAnalysis>(
  values: T | T[],
): T | T[] {
  if (Array.isArray(values)) return values.map(stripDataFrameAnalysis);
  return stripDataFrameAnalysis(values);
}

// ---- builder proxies --------------------------------------------------------

/**
 * Wraps a post-`.values()` Drizzle insert builder so that `.onConflictDoUpdate`
 * also strips sampleValues from the `set` payload.  All other methods are
 * forwarded unchanged.
 */
function proxyInsertBuilderAfterValues(builder: unknown): unknown {
  return new Proxy(builder as object, {
    get(target, prop, receiver) {
      if (prop === "onConflictDoUpdate") {
        return function (
          config: { set?: MaybeWithAnalysis; [k: string]: unknown },
          ...rest: unknown[]
        ) {
          const safeConfig =
            config?.set != null
              ? { ...config, set: stripDataFrameAnalysis(config.set) }
              : config;
          // @ts-expect-error — dynamic forwarding; Drizzle type varies by driver
          return target.onConflictDoUpdate.call(target, safeConfig, ...rest);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Wraps a Drizzle insert builder so `.values(...)` applies the strip before
 * forwarding to the real builder, and the returned builder is further proxied
 * so `.onConflictDoUpdate({ set: … })` also has sampleValues stripped.
 * All other builder methods (`.returning`, `.onConflictDoNothing`, etc.) are
 * forwarded unchanged.
 */
function proxyInsertBuilder(builder: unknown): unknown {
  return new Proxy(builder as object, {
    get(target, prop, receiver) {
      if (prop === "values") {
        return function (
          values: MaybeWithAnalysis | MaybeWithAnalysis[],
          ...rest: unknown[]
        ) {
          const safe = stripMaybeArray(values);
          // @ts-expect-error — dynamic forwarding; Drizzle type varies by driver
          const next = target.values.call(target, safe, ...rest);
          // Proxy the returned builder so chained .onConflictDoUpdate is also gated.
          return proxyInsertBuilderAfterValues(next);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Wraps a Drizzle update builder so `.set(...)` applies the strip before
 * forwarding.  All other builder methods (`.where`, `.returning`, etc.)
 * are forwarded unchanged.
 */
function proxyUpdateBuilder(builder: unknown): unknown {
  return new Proxy(builder as object, {
    get(target, prop, receiver) {
      if (prop === "set") {
        return function (values: MaybeWithAnalysis, ...rest: unknown[]) {
          const safe = stripDataFrameAnalysis(values);
          // @ts-expect-error — dynamic forwarding; Drizzle type varies by driver
          const next = target.set.call(target, safe, ...rest);
          return next;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

// ---- db / tx proxy ----------------------------------------------------------

/** Does `table` resolve to the guarded `data_frames` table? */
function isDataFramesTable(table: unknown): boolean {
  return (
    table != null &&
    typeof table === "object" &&
    getTableName(table as Parameters<typeof getTableName>[0]) ===
      DATA_FRAMES_TABLE
  );
}

/**
 * Core gate: wrap any Drizzle write handle — the root `db` or a transaction
 * `tx` — so insert/update against `data_frames` are stripped and nested
 * transactions stay gated.
 *
 * This is recursive by `.transaction`: the handle passed to a transaction
 * callback is itself run through `gateHandle`, so a write inside a transaction,
 * or inside a nested transaction (savepoint), is gated exactly like a top-level
 * write.  The underlying `target.transaction` owns atomicity, commit, and
 * rollback — the gate only substitutes the callback's handle and forwards the
 * return value untouched, so rollback-on-throw and the resolved value are
 * preserved exactly.
 */
function gateHandle<T extends object>(handle: T): T {
  return new Proxy(handle, {
    get(target, prop, receiver) {
      // Intercept `.insert(table)` — only gate data_frames, pass others through.
      if (prop === "insert") {
        return function (table: unknown, ...rest: unknown[]) {
          // @ts-expect-error — dynamic call; prop is "insert"
          const builder = target.insert.call(target, table, ...rest);
          return isDataFramesTable(table)
            ? proxyInsertBuilder(builder)
            : builder;
        };
      }

      // Intercept `.update(table)` — only gate data_frames, pass others through.
      if (prop === "update") {
        return function (table: unknown, ...rest: unknown[]) {
          // @ts-expect-error — dynamic call; prop is "update"
          const builder = target.update.call(target, table, ...rest);
          return isDataFramesTable(table)
            ? proxyUpdateBuilder(builder)
            : builder;
        };
      }

      // Intercept `.transaction(callback, opts?)` — Drizzle hands the callback a
      // fresh, UNWRAPPED transaction handle.  Gate that handle before user code
      // runs so transactional (and nested-transaction) writes can't bypass the
      // strip.  The underlying transaction still owns atomicity/rollback; we
      // forward its return value and let throws propagate unchanged.
      if (prop === "transaction") {
        return function (
          callback: (tx: unknown) => unknown,
          ...rest: unknown[]
        ) {
          const gatedCallback = (tx: object) => callback(gateHandle(tx));
          // @ts-expect-error — dynamic forwarding; Drizzle type varies by driver
          return target.transaction.call(target, gatedCallback, ...rest);
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Return a proxy of `db` that enforces the artifact-DB write gate.
 *
 * Called once in `openArtifactDb`; callers receive the gated instance and
 * can never bypass the strip through normal Drizzle ORM calls — including
 * transactions, nested transactions, and upserts.
 */
export function applyDataFrameWriteGate(db: ArtifactDb): ArtifactDb {
  return gateHandle(db) as ArtifactDb;
}
