import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { artifactKinds, type ArtifactRow, type ArtifactTable } from "./model";
import { clean, stable } from "./values";

/**
 * Upper bound on rows one bounded scan may return. A workspace whose
 * user-authored artifacts exceed it needs pagination; data frames are never
 * scanned whole at all (see `Graph.scan`).
 */
export const LIMIT = 1000;

/** Index-backed selector for `Graph.scan`. Exactly the fields the artifact indexes cover. */
export type Where = {
  dataSourceId?: string;
  insightId?: string;
  sourceId?: string;
  definitionId?: string;
  dataFrameId?: string;
};
export type Change = {
  table: ArtifactTable;
  id: string;
  base: ArtifactRow | null;
  value: ArtifactRow | null;
};
export type Overlay = Map<string, ArtifactRow | null>;
/** Snapshot of the working state, taken with `Graph.mark`. */
export type Mark = Map<string, ArtifactRow | null>;

export const graphKey = (table: ArtifactTable, id: string) => `${table}:${id}`;
function splitKey(key: string): [ArtifactTable, string] {
  const at = key.indexOf(":");
  return [key.slice(0, at) as ArtifactTable, key.slice(at + 1)];
}
export function rowValue(doc: Doc<ArtifactTable>): ArtifactRow {
  const { _id, _creationTime, ...value } = doc;
  return value;
}
function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

/**
 * The artifact graph a command batch runs against, loaded on demand.
 *
 * Rows are read by primary key or through an index range the moment a handler
 * asks for them, never as whole tables up front. Three layers are kept per row:
 * the canonical database value as first loaded (`original`), the draft overlay
 * value when a draft is open (`overlay`), and the mutable working copy handlers
 * edit in place (`current`). `changes()` diffs canonical against working, which
 * is what both `persist` and `replaceDraft` need; `baseline()` answers "what
 * did this row look like before these commands ran", which is what preview
 * needs and which includes the overlay.
 *
 * Reads are memoised for the life of the graph, so a reactive query that builds
 * one subscribes only to the rows and index ranges it actually touched.
 */
export class Graph {
  private readonly original = new Map<string, ArtifactRow | null>();
  private readonly current = new Map<string, ArtifactRow | null>();
  private readonly scanned = new Set<string>();
  constructor(
    private readonly ctx: QueryCtx,
    readonly workspaceId: string,
    private readonly overlay: Overlay = new Map(),
  ) {}

  private async canonical(
    table: ArtifactTable,
    id: string,
  ): Promise<ArtifactRow | null> {
    const key = graphKey(table, id);
    const known = this.original.get(key);
    if (known !== undefined || this.original.has(key)) return known ?? null;
    const doc = await this.ctx.db
      .query(table)
      .withIndex("by_workspaceId_and_id", (q) =>
        q.eq("workspaceId", this.workspaceId).eq("id", id),
      )
      .unique();
    const row = doc ? clean(rowValue(doc)) : null;
    this.original.set(key, row);
    return row;
  }
  /** The row as it stood when this graph was opened: overlay if drafted, else canonical. */
  async baseline(
    table: ArtifactTable,
    id: string,
  ): Promise<ArtifactRow | null> {
    const key = graphKey(table, id);
    if (this.overlay.has(key)) return this.overlay.get(key) ?? null;
    return this.canonical(table, id);
  }
  private baselineLoaded(key: string): ArtifactRow | null {
    if (this.overlay.has(key)) return this.overlay.get(key) ?? null;
    return this.original.get(key) ?? null;
  }
  /** Working copy of a row, or undefined when it does not exist. Loads on first use. */
  async find(
    table: ArtifactTable,
    id: string,
  ): Promise<ArtifactRow | undefined> {
    const key = graphKey(table, id);
    if (!this.current.has(key)) {
      const base = await this.baseline(table, id);
      this.current.set(key, base ? clean(base) : null);
    }
    return this.current.get(key) ?? undefined;
  }
  async get(table: ArtifactTable, id: string): Promise<ArtifactRow> {
    const row = await this.find(table, id);
    if (!row) throw new Error(`${artifactKinds[table]} ${id} not found`);
    return row;
  }
  async has(table: ArtifactTable, id: string): Promise<boolean> {
    return (await this.find(table, id)) !== undefined;
  }
  set(table: ArtifactTable, row: ArtifactRow): void {
    this.current.set(graphKey(table, row.id), row);
  }
  delete(table: ArtifactTable, id: string): void {
    this.current.set(graphKey(table, id), null);
  }

  /**
   * Bounded, index-backed read of one table, merged with the working state so
   * rows created or deleted earlier in the same batch or draft are reflected.
   * User-authored tables may be scanned whole up to LIMIT rows. Data frames
   * grow with usage rather than with what a user builds, so they must always
   * be selected through an index: a whole-table frame scan is a programming
   * error, not a workspace-size problem.
   */
  async scan(table: ArtifactTable, where: Where = {}): Promise<ArtifactRow[]> {
    return this.read(table, where, false);
  }
  /**
   * Bounded whole-table read for list surfaces. The only sanctioned way to
   * read every frame in a workspace; the cap error names the recovery path.
   */
  async list(table: ArtifactTable): Promise<ArtifactRow[]> {
    return this.read(table, {}, true);
  }
  private async read(
    table: ArtifactTable,
    where: Where,
    whole: boolean,
  ): Promise<ArtifactRow[]> {
    const cacheKey = `${table}|${stable(where)}`;
    if (!this.scanned.has(cacheKey)) {
      const docs = await this.select(table, where, whole);
      if (docs.length > LIMIT) throw new ConvexError(capMessage(table));
      for (const doc of docs) {
        const row = clean(rowValue(doc)),
          key = graphKey(table, row.id);
        if (!this.original.has(key)) this.original.set(key, row);
        if (!this.current.has(key)) {
          const base = this.overlay.has(key) ? this.overlay.get(key) : row;
          this.current.set(key, base ? clean(base) : null);
        }
      }
      const prefix = `${table}:`;
      for (const [key, row] of this.overlay)
        if (key.startsWith(prefix) && !this.current.has(key))
          this.current.set(key, row ? clean(row) : null);
      this.scanned.add(cacheKey);
    }
    const prefix = `${table}:`,
      out: ArtifactRow[] = [];
    for (const [key, row] of this.current)
      if (row && key.startsWith(prefix) && matches(row, where)) out.push(row);
    return out;
  }
  private select(table: ArtifactTable, where: Where, whole: boolean) {
    const q = this.ctx.db.query(table),
      ws = this.workspaceId;
    if (where.dataSourceId !== undefined)
      return q
        .withIndex("by_workspaceId_and_dataSourceId", (q) =>
          q.eq("workspaceId", ws).eq("dataSourceId", where.dataSourceId),
        )
        .take(LIMIT + 1);
    if (where.insightId !== undefined)
      return q
        .withIndex("by_workspaceId_and_insightId", (q) =>
          q.eq("workspaceId", ws).eq("insightId", where.insightId),
        )
        .take(LIMIT + 1);
    if (where.sourceId !== undefined)
      return q
        .withIndex("by_workspaceId_and_sourceId", (q) =>
          q.eq("workspaceId", ws).eq("sourceId", where.sourceId),
        )
        .take(LIMIT + 1);
    if (where.definitionId !== undefined)
      return q
        .withIndex("by_workspaceId_and_definitionId", (q) =>
          q.eq("workspaceId", ws).eq("definitionId", where.definitionId),
        )
        .take(LIMIT + 1);
    if (where.dataFrameId !== undefined)
      return q
        .withIndex("by_workspaceId_and_dataFrameId", (q) =>
          q.eq("workspaceId", ws).eq("dataFrameId", where.dataFrameId),
        )
        .take(LIMIT + 1);
    if (table === "dataFrames" && !whole)
      throw new Error(
        "Data frames are never scanned whole; select them through an index",
      );
    return q
      .withIndex("by_workspaceId_and_id", (q) => q.eq("workspaceId", ws))
      .take(LIMIT + 1);
  }

  /** Snapshot the working state so `changesSince` can attribute later edits. */
  mark(): Mark {
    return new Map(
      [...this.current].map(([key, row]) => [key, row ? clean(row) : null]),
    );
  }
  /** Rows whose working value differs from the snapshot (or from baseline, if first loaded since). */
  changesSince(mark: Mark): Change[] {
    const out: Change[] = [];
    for (const key of new Set([...this.current.keys(), ...mark.keys()])) {
      const base = mark.has(key)
          ? (mark.get(key) ?? null)
          : this.baselineLoaded(key),
        value = this.current.get(key) ?? null;
      if (same(base, value)) continue;
      const [table, id] = splitKey(key);
      out.push({ table, id, base, value });
    }
    return out;
  }
  /**
   * Rows whose working value differs from canonical storage. Every draft
   * overlay row is included, touched by this batch or not: a draft append
   * must carry forward what earlier batches staged.
   */
  async changes(): Promise<Change[]> {
    const out: Change[] = [];
    for (const key of new Set([
      ...this.current.keys(),
      ...this.overlay.keys(),
    ])) {
      const [table, id] = splitKey(key);
      const value =
        (this.current.has(key)
          ? this.current.get(key)
          : this.overlay.get(key)) ?? null;
      const base = await this.canonical(table, id);
      if (same(base, value)) continue;
      out.push({ table, id, base, value });
    }
    return out;
  }
}

export function capMessage(table: ArtifactTable): string {
  return table === "dataFrames"
    ? `Workspace exceeds ${LIMIT} dataFrames; use the Data Frames recovery list to delete rows`
    : `Workspace exceeds ${LIMIT} ${table}; pagination required`;
}
function matches(row: ArtifactRow, where: Where): boolean {
  return (
    (where.dataSourceId === undefined ||
      row.dataSourceId === where.dataSourceId) &&
    (where.insightId === undefined || row.insightId === where.insightId) &&
    (where.sourceId === undefined || row.sourceId === where.sourceId) &&
    (where.definitionId === undefined ||
      row.definitionId === where.definitionId) &&
    (where.dataFrameId === undefined || row.dataFrameId === where.dataFrameId)
  );
}
