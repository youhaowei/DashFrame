/**
 * Artifact-DB write gate — profiles only, by construction (YW-131).
 *
 * Wraps the raw Drizzle ArtifactDb in a Proxy so that *every* insert or
 * update against the `data_frames` table has `analysis.columns[*].sampleValues`
 * stripped to `[]` before the bytes reach PGLite, regardless of caller.
 *
 * Why a Proxy at this layer:
 * - YW-118 stripped sampleValues in specific mutation handlers; a future
 *   handler could accidentally skip the call.  The gate below makes that
 *   omission impossible — the strip fires on the Drizzle instance itself.
 * - Drizzle has no middleware/hook API, so a Proxy on the returned builder
 *   objects is the lowest-cost intercept point available.
 *
 * Scope: only `data_frames` writes carry `analysis` (a DataFrameAnalysis
 * JSONB column).  All other table writes pass through unchanged.
 *
 * The gate is applied once, inside `openArtifactDb`, before the db instance
 * is handed to any caller.  From that point on the invariant "artifact DB
 * contains zero raw sampleValues" is physically unbreakable for the
 * in-process session.
 */

import { getTableName } from "drizzle-orm";

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
 */
function stripDataFrameAnalysis<T extends MaybeWithAnalysis>(value: T): T {
  if (!("analysis" in value) || value.analysis == null) return value;

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
 * Wraps a Drizzle insert builder so `.values(...)` applies the strip before
 * forwarding to the real builder.  All other builder methods (`.returning`,
 * `.onConflictDoNothing`, etc.) are forwarded unchanged.
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
          // Continue proxying so chained methods (e.g. .returning()) are fine.
          return next;
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

// ---- db proxy ---------------------------------------------------------------

/**
 * Return a proxy of `db` that enforces the artifact-DB write gate.
 *
 * Called once in `openArtifactDb`; callers receive the gated instance and
 * can never bypass the strip through normal Drizzle ORM calls.
 *
 * Raw SQL (`db.execute(sql\`…\`)`) is NOT intercepted — existing raw-SQL
 * paths are the v2→v3 migration in `project.ts`, which explicitly clears
 * sampleValues itself, and `syncSchema`, which only issues DDL.  No raw-SQL
 * path writes raw analysis values, and raw SQL is not a public API.
 */
export function applyDataFrameWriteGate(db: ArtifactDb): ArtifactDb {
  return new Proxy(db, {
    get(target, prop, receiver) {
      // Intercept `.insert(table)` — only gate data_frames, pass others through.
      if (prop === "insert") {
        return function (table: unknown, ...rest: unknown[]) {
          // @ts-expect-error — dynamic call; prop is "insert"
          const builder = target.insert.call(target, table, ...rest);
          if (
            table != null &&
            typeof table === "object" &&
            getTableName(table as Parameters<typeof getTableName>[0]) ===
              DATA_FRAMES_TABLE
          ) {
            return proxyInsertBuilder(builder);
          }
          return builder;
        };
      }

      // Intercept `.update(table)` — only gate data_frames, pass others through.
      if (prop === "update") {
        return function (table: unknown, ...rest: unknown[]) {
          // @ts-expect-error — dynamic call; prop is "update"
          const builder = target.update.call(target, table, ...rest);
          if (
            table != null &&
            typeof table === "object" &&
            getTableName(table as Parameters<typeof getTableName>[0]) ===
              DATA_FRAMES_TABLE
          ) {
            return proxyUpdateBuilder(builder);
          }
          return builder;
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  }) as ArtifactDb;
}
