/**
 * syncSchema — idempotent CREATE TABLE IF NOT EXISTS from a Drizzle pg schema.
 *
 * v0.2 dev-mode bootstrap helper: caller defines tables via `pgTable(...)`,
 * then calls `syncSchema(db, schema)` at boot to materialize them. First boot
 * creates tables; subsequent boots are no-ops. Real schema evolution will
 * route through drizzle-kit migrations once schema actually starts changing.
 *
 * Behavior:
 * - Topologically orders tables by FK dependency.
 * - Emits `CREATE TABLE IF NOT EXISTS <name> (cols..., PK..., UNIQUE..., FK...)`.
 * - Emits `CREATE INDEX IF NOT EXISTS` for declared non-unique indexes.
 * - Reads SQL types, NOT NULL, PRIMARY KEY, UNIQUE, DEFAULT (including SQL
 *   expressions like `gen_random_uuid()`, `now()`), and ARRAY[].
 * - Emits named UNIQUE constraints and FOREIGN KEYs with ON DELETE / ON UPDATE.
 *
 * Does NOT do: ALTER TABLE, CHECK constraints, RLS, generated columns,
 * non-default schemas. Drift is a migration concern.
 */

/* eslint-disable @typescript-eslint/no-explicit-any, sonarjs/cognitive-complexity */

import { sql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

export interface SyncTarget {
  execute: (query: ReturnType<typeof sql>) => Promise<any>;
}

export async function syncSchema(
  db: SyncTarget,
  schema: Record<string, PgTable>,
): Promise<void> {
  const tables = Object.values(schema);
  const ordered = sortByFkDeps(tables);
  for (const table of ordered) {
    await db.execute(sql.raw(renderCreateTableIfNotExists(table)));
  }
  for (const table of ordered) {
    for (const stmt of renderCreateIndexesIfNotExists(table)) {
      await db.execute(sql.raw(stmt));
    }
  }
}

/**
 * Install (or replace) the `strip_data_frames_sample_values` trigger on the
 * `data_frames` table.  This is the **non-bypassable DB-floor** component of
 * the artifact-DB write gate.
 *
 * Why a DB trigger (in addition to the Proxy gate):
 * - The Proxy gate catches ORM builder paths at construction time.  However,
 *   Drizzle's `.prepare()` / `.execute()` API binds values at execute time, so
 *   a prepared statement bypasses the gate: the placeholder is not a plain
 *   object and the builder-level intercept never sees the real value.
 * - Raw `db.execute(sql`…`)` is similarly invisible to the Proxy.
 * - A database BEFORE INSERT OR UPDATE trigger runs regardless of how the row
 *   reaches PGLite — ORM builders, prepared statements, raw SQL, or any future
 *   code path — making the strip truly invariant.
 *
 * The trigger function iterates every element of `NEW.analysis->'columns'` and
 * sets `sampleValues` to `'[]'::jsonb`.  If `analysis` is NULL or has no
 * `columns` array the function is a no-op.
 *
 * Idempotency: `CREATE OR REPLACE FUNCTION` replaces the function on re-open;
 * `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` replaces the trigger binding.
 * Running this on every `openArtifactDb` call is safe.
 */
export async function installSampleValuesTrigger(
  db: SyncTarget,
): Promise<void> {
  // 1. Create (or replace) the trigger function.
  await db.execute(
    sql.raw(`
CREATE OR REPLACE FUNCTION strip_data_frames_sample_values()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  i   integer;
  len integer;
BEGIN
  IF NEW.analysis IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.analysis->'columns') <> 'array' THEN
    RETURN NEW;
  END IF;
  len := jsonb_array_length(NEW.analysis->'columns');
  FOR i IN 0 .. len - 1 LOOP
    NEW.analysis := jsonb_set(
      NEW.analysis,
      ARRAY['columns', i::text, 'sampleValues'],
      '[]'::jsonb,
      true
    );
  END LOOP;
  RETURN NEW;
END;
$$;
  `),
  );

  // 2. Drop any existing binding so CREATE TRIGGER is idempotent.
  await db.execute(
    sql.raw(`
DROP TRIGGER IF EXISTS trg_strip_sample_values ON "data_frames";
  `),
  );

  // 3. Bind the trigger — fires BEFORE every INSERT and UPDATE on data_frames.
  await db.execute(
    sql.raw(`
CREATE TRIGGER trg_strip_sample_values
  BEFORE INSERT OR UPDATE ON "data_frames"
  FOR EACH ROW
  EXECUTE FUNCTION strip_data_frames_sample_values();
  `),
  );
}

export function renderCreateTableIfNotExists(table: PgTable): string {
  const cfg = getTableConfig(table);
  const lines: string[] = [];

  for (const col of cfg.columns) {
    lines.push(renderColumn(col));
  }

  for (const pk of cfg.primaryKeys) {
    const cols = pk.columns.map((c) => quoteIdent(c.name)).join(", ");
    lines.push(`PRIMARY KEY (${cols})`);
  }

  for (const uc of cfg.uniqueConstraints) {
    const cols = uc.columns.map((c) => quoteIdent(c.name)).join(", ");
    const name =
      uc.name ??
      `${cfg.name}_${uc.columns.map((c) => c.name).join("_")}_unique`;
    lines.push(`CONSTRAINT ${quoteIdent(name)} UNIQUE (${cols})`);
  }

  for (const fk of cfg.foreignKeys) {
    lines.push(renderForeignKey(fk));
  }

  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(cfg.name)} (\n  ${lines.join(",\n  ")}\n);`;
}

export function renderCreateIndexesIfNotExists(table: PgTable): string[] {
  const cfg = getTableConfig(table);
  return cfg.indexes.map((idx: any) => {
    const indexCfg = idx.config;
    const unique = indexCfg.unique ? "UNIQUE " : "";
    const method = indexCfg.method ? ` USING ${indexCfg.method}` : "";
    const cols = indexCfg.columns.map(renderIndexColumn).join(", ");
    return `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdent(indexCfg.name)} ON ${quoteIdent(cfg.name)}${method} (${cols});`;
  });
}

function renderColumn(col: any): string {
  const parts: string[] = [quoteIdent(col.name), col.getSQLType()];
  if (col.isArray) parts[parts.length - 1] += "[]";
  if (col.notNull) parts.push("NOT NULL");
  if (col.hasDefault && col.default !== undefined) {
    const expr = renderDefault(col.default);
    if (expr !== null) parts.push(`DEFAULT ${expr}`);
  }
  if (col.primary) parts.push("PRIMARY KEY");
  if (col.isUnique) parts.push("UNIQUE");
  return parts.join(" ");
}

function renderForeignKey(fk: any): string {
  const ref = typeof fk.reference === "function" ? fk.reference() : fk;
  const localCols = (ref.columns as any[])
    .map((c) => quoteIdent(c.name))
    .join(", ");
  const foreignCols = (ref.foreignColumns as any[])
    .map((c) => quoteIdent(c.name))
    .join(", ");
  const foreignTable = ref.foreignTable ?? ref.foreignColumns?.[0]?.table;
  const foreignName = foreignTable ? getTableConfig(foreignTable).name : "?";

  const clauses = [
    `FOREIGN KEY (${localCols})`,
    `REFERENCES ${quoteIdent(foreignName)} (${foreignCols})`,
  ];
  if (fk.onDelete)
    clauses.push(`ON DELETE ${String(fk.onDelete).toUpperCase()}`);
  if (fk.onUpdate)
    clauses.push(`ON UPDATE ${String(fk.onUpdate).toUpperCase()}`);
  return clauses.join(" ");
}

function renderDefault(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const obj = value as any;
  if (obj && Array.isArray(obj.queryChunks)) {
    const rendered = obj.queryChunks
      .map((chunk: any, index: number) => {
        const v = chunk?.value;
        if (v === undefined) {
          throw new Error(
            `renderDefault: unexpected undefined chunk.value in obj.queryChunks[${index}]: ${JSON.stringify(chunk)}`,
          );
        }
        if (Array.isArray(v)) return v.join("");
        return String(v);
      })
      .join("");
    if (rendered.trim() === "") {
      throw new Error(
        `renderDefault: unexpected empty default from obj.queryChunks: ${JSON.stringify(obj.queryChunks)}`,
      );
    }
    return rendered;
  }
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  return null;
}

function renderIndexColumn(col: any): string {
  const name = quoteIdent(col.name);
  const indexCfg = col.indexConfig ?? {};
  const parts = [name];
  if (indexCfg.order) parts.push(String(indexCfg.order).toUpperCase());
  if (indexCfg.nulls)
    parts.push(`NULLS ${String(indexCfg.nulls).toUpperCase()}`);
  return parts.join(" ");
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sortByFkDeps(tables: PgTable[]): PgTable[] {
  const cfgs = new Map(tables.map((t) => [t, getTableConfig(t)]));
  const result: PgTable[] = [];
  const emitted = new Set<string>();

  while (result.length < tables.length) {
    let progressed = false;
    for (const t of tables) {
      const cfg = cfgs.get(t);
      if (!cfg || emitted.has(cfg.name)) continue;

      const deps = cfg.foreignKeys
        .map((fk: any) => {
          const ref = typeof fk.reference === "function" ? fk.reference() : fk;
          const refTable = ref.foreignTable ?? ref.foreignColumns?.[0]?.table;
          return refTable ? getTableConfig(refTable).name : null;
        })
        .filter((name): name is string => name !== null && name !== cfg.name);

      if (deps.every((d) => emitted.has(d))) {
        result.push(t);
        emitted.add(cfg.name);
        progressed = true;
      }
    }

    if (!progressed) {
      for (const t of tables) {
        const cfg = cfgs.get(t);
        if (cfg && !emitted.has(cfg.name)) {
          result.push(t);
          emitted.add(cfg.name);
        }
      }
      break;
    }
  }

  return result;
}
