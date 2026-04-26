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
 * - Reads SQL types, NOT NULL, PRIMARY KEY, UNIQUE, DEFAULT (including SQL
 *   expressions like `gen_random_uuid()`, `now()`), and ARRAY[].
 * - Emits named UNIQUE constraints and FOREIGN KEYs with ON DELETE / ON UPDATE.
 *
 * Does NOT do: ALTER TABLE, indexes (beyond UNIQUE), CHECK constraints, RLS,
 * generated columns, non-default schemas. Drift is a migration concern.
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
    return obj.queryChunks
      .map((chunk: any) => {
        const v = chunk?.value;
        if (Array.isArray(v)) return v.join("");
        return String(v ?? "");
      })
      .join("");
  }
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  return null;
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
