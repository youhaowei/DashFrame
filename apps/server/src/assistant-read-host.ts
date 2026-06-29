/**
 * Host adapter — binds the assistant's `GraphReader` PORT to this server's read
 * seam, scoped to a draft.
 *
 * The assistant package (@dashframe/assistant) defines the read layer as a
 * privacy-aware graph resolver over a `GraphReader` port (it cannot import this
 * server — apps/server depends on the assistant, not the reverse). This file is
 * the HOST half: it implements the port by dispatching every structure read
 * through `app.runHandler(path, args, tracked, { draftId })` — the SERVER SEAM,
 * against the DRAFT-OVERLAY view (the withDraftSeam read path). The assistant
 * never sees the DB or the draftId; it gets a reader already scoped to the draft.
 *
 * Two invariants this adapter upholds:
 *   1. SINGLE STRUCTURE EGRESS — every structure read goes through the registered
 *      query functions (getInsight, getDataTable, …), never a raw DB query. The
 *      reads are byte-identical to what the renderer issues.
 *   2. SINGLE VALUE EGRESS via the FLOOR — `readDataProfile` resolves the
 *      artifact's CONTRIBUTING SOURCE FIELDS (real Field.sensitivity, read
 *      through the same seam) and hands them to the assistant's `applyFloor`,
 *      which makes the binary inherit-source masking decision and emits
 *      profiles plus any safe sample assembled by the assistant read layer. This adapter
 *      NEVER reads or assembles row data — profiles-only is structural.
 */

import {
  applyFloor,
  type ColumnProfile,
  type DashboardRead,
  type DataFrameRead,
  type DataReadResult,
  type GraphReader,
  type NodeRef,
} from "@dashframe/assistant";
import type {
  DataSource,
  DataTable,
  Field,
  Insight,
  UUID,
  Visualization,
} from "@dashframe/types";
import type { WyStackApp } from "@wystack/server";

/**
 * The set of project source files the assistant may open via `readSource` — its
 * BACKUP/verification path for the command vocabulary. Allowlisted, not
 * arbitrary FS access: the agent can fall back to the command source when the
 * crafted guide is insufficient, and nothing else.
 */
const READABLE_SOURCES: ReadonlySet<string> = new Set([
  "apps/server/src/functions/commands.ts",
]);

export interface AssistantReadHostOptions {
  app: WyStackApp;
  /**
   * The active draft handle. Every read is scoped to this draft's overlay, so
   * the assistant perceives its own in-progress edits. Omit for a canonical-only
   * reader (e.g. a read with no open draft).
   */
  draftId?: string;
  /**
   * Reads an allowlisted source file's text. Injected (not a direct fs import)
   * so the host owns the filesystem boundary; the adapter only enforces the
   * allowlist. Omit to disable source fallback.
   */
  readSourceFile?: (file: string) => Promise<string>;
}

/**
 * Build a draft-scoped `GraphReader` over the server app. The returned reader is
 * the assistant's single structure-and-value egress; pass it to
 * `createReadTools(reader)` to get the four fixed read tools.
 */
export function createAssistantReadHost(
  opts: AssistantReadHostOptions,
): GraphReader {
  const { app, draftId, readSourceFile } = opts;

  // Every read carries the draftId in context so the withDraftSeam routes the
  // read against the draft overlay. A fresh DrizzleTracker per call (read-only; the
  // tracking sets are discarded — we never publish from a read).
  const context: Record<string, unknown> =
    draftId !== undefined ? { draftId } : {};

  async function read<T>(path: string, args: unknown): Promise<T> {
    const tracked = app.createTracked();
    return (await app.runHandler(path, args, tracked, context)) as T;
  }

  /**
   * The contributing source fields for a data read, plus a fail-closed signal.
   * `forceMask` means "I could not confidently enumerate every contributing
   * column" — the floor masks regardless of `fields` (a masked read is always
   * safe; an unmasked-but-incomplete one is the leak).
   */
  interface SourceResolution {
    fields: Field[];
    forceMask: boolean;
  }

  /**
   * Resolve the CONTRIBUTING SOURCE FIELDS for a data read — the inherit-source
   * key. EVERY column the artifact reads from contributes; missing any sensitive
   * one would fail OPEN, so this errs toward `forceMask` whenever resolution is
   * incomplete.
   *
   *   - dataTable: its own fields.
   *   - insight: the union of EVERY contributing column —
   *       • base-source fields (the base may be a dataTable OR another insight —
   *         insight-on-insight composition writes the upstream INSIGHT id into
   *         `baseTableId`; the chain is walked, cycle-guarded),
   *       • join-table fields (joins read those tables; the join KEYS are columns
   *         too),
   *       • metric columns (`metric.columnName` over `metric.sourceTable`; an
   *         aggregate like SUM(salary) reads a column the dimension projection
   *         never lists).
   *     Narrowing to `selectedFields` is UNSAFE — it omits metric/join columns —
   *     so the contributing set is the FULL union above. A read where any
   *     contributing table/column can't be resolved sets `forceMask`.
   */
  async function sourceFieldsFor(node: NodeRef): Promise<SourceResolution> {
    if (node.kind === "dataTable") {
      const table = await read<DataTable | null>("getDataTable", {
        id: node.id,
      });
      // Fail closed on an absent table OR one with no known columns yet (a table
      // created before schema discovery/classification has empty `fields`).
      // "Unknown columns" must mask exactly like "unresolvable" — the inherit-
      // source floor's whole point is that unknown ⇒ restricted.
      if (table === null || (table.fields?.length ?? 0) === 0)
        return { fields: table?.fields ?? [], forceMask: true };
      return { fields: table.fields, forceMask: false };
    }
    return resolveInsightSourceFields(node.id, new Set<UUID>());
  }

  /**
   * Walk an insight's full contributing-column set. `seen` guards the
   * insight-on-insight source chain against cycles (the server rejects cycles on
   * write, but a read must never loop). Any unresolved hop forces masking.
   */
  async function resolveInsightSourceFields(
    insightId: UUID,
    seen: Set<UUID>,
  ): Promise<SourceResolution> {
    if (seen.has(insightId)) return { fields: [], forceMask: true };
    seen.add(insightId);

    const insight = await read<Insight | null>("getInsight", { id: insightId });
    if (insight === null) return { fields: [], forceMask: true };

    const fields: Field[] = [];
    let forceMask = false;
    // Add a referenced table's fields. A DANGLING ref (null table) forces
    // masking: deleting a DataTable does NOT cascade-delete dependent insights
    // (the server routes them to drift-repair), so an insight can carry a
    // dangling join `rightTableId` / metric `sourceTable`. A draft can also
    // delete a table the insight still references. If that vanished table held
    // the only sensitive column, silently contributing nothing would fail OPEN —
    // so an unresolvable table is treated as "I couldn't see its columns" and
    // masks. Guard the sink, not the write-time FK check.
    const addTableFields = async (tableId: UUID): Promise<void> => {
      const table = await read<DataTable | null>("getDataTable", {
        id: tableId,
      });
      // Null (dangling) OR empty-fields (columns not discovered yet) → fail
      // closed: a table whose columns we can't enumerate may hide a sensitive one.
      if (table === null || (table.fields?.length ?? 0) === 0) forceMask = true;
      else fields.push(...table.fields);
    };

    // Base source: a dataTable, OR an upstream insight (composition). Probe as a
    // table first; if it resolves to a table, add its fields (fail closed on
    // empty fields via addTableFields). If NOT a table, it is an insight id —
    // recurse into its source.
    const baseTable = await read<DataTable | null>("getDataTable", {
      id: insight.baseTableId,
    });
    if (baseTable !== null) {
      await addTableFields(insight.baseTableId);
    } else {
      const upstream = await resolveInsightSourceFields(
        insight.baseTableId,
        seen,
      );
      fields.push(...upstream.fields);
      forceMask = forceMask || upstream.forceMask;
    }

    // Join tables — every joined table's columns are read (incl. the join keys).
    for (const j of insight.joins ?? []) await addTableFields(j.rightTableId);

    // Metric source tables — a metric reads `columnName` from `sourceTable`,
    // which the dimension projection never lists. Add those tables' fields.
    for (const m of insight.metrics ?? []) {
      if (m.sourceTable) await addTableFields(m.sourceTable);
    }

    return { fields, forceMask };
  }

  return {
    // --- structure reads (ungated) — straight through the server seam ---
    getDataSource: (id) => read<DataSource | null>("getDataSource", { id }),
    getDataTable: (id) => read<DataTable | null>("getDataTable", { id }),
    getDataFrameEntry: (id) =>
      read<DataFrameRead | null>("getDataFrameEntry", { id }),
    getInsight: (id) => read<Insight | null>("getInsight", { id }),
    getVisualization: (id) =>
      read<Visualization | null>("getVisualization", { id }),
    getDashboard: (id) => read<DashboardRead | null>("getDashboard", { id }),

    listDataSources: () => read<DataSource[]>("listDataSources", {}),
    // NOTE: the *filtered* list/get reads below pass NO server-side filter and
    // filter in JS. The draft-overlay coalesce supports an UNFILTERED `.all()`
    // and a PK-pinned `.where(eq(id, …))`, but THROWS on any non-PK read filter
    // (see app.ts withDraftSeam / wystack tracked-db). `listDataTables`'s
    // dataSourceId filter, `listVisualizations`'s insightId filter, and
    // `getDataFrameByInsight`'s insightId lookup are all non-PK — issuing them
    // server-side would throw under an active draftId. Reading unfiltered (which
    // coalesces correctly) and filtering here is identical in canonical too.
    listDataTables: async (dataSourceId) => {
      const all = await read<DataTable[]>("listDataTables", {});
      return dataSourceId === undefined
        ? all
        : all.filter((t) => t.dataSourceId === dataSourceId);
    },
    listDataFrames: () => read<DataFrameRead[]>("listDataFrames", {}),
    listInsights: () => read<Insight[]>("listInsights", {}),
    listVisualizations: async (insightId) => {
      const all = await read<Visualization[]>("listVisualizations", {});
      return insightId === undefined
        ? all
        : all.filter((v) => v.insightId === insightId);
    },
    listDashboards: () => read<DashboardRead[]>("listDashboards", {}),
    getDataFrameByInsight: async (insightId) => {
      const all = await read<DataFrameRead[]>("listDataFrames", {});
      return all.find((d) => d.insightId === insightId) ?? null;
    },

    // --- value read (floor-gated) — the single value egress ---
    async readDataProfile(node: NodeRef): Promise<DataReadResult> {
      const { fields, forceMask } = await sourceFieldsFor(node);
      // Hand the contributing source fields to the assistant's floor. It makes
      // the binary inherit-source masking decision and emits profiles-only.
      // We pass name/type/sensitivity (structure) and no stats; row-derived
      // values are assembled separately by the assistant read layer.
      // `forceMask` carries the fail-closed signal up: if resolution couldn't
      // enumerate every contributing column, the floor masks regardless.
      const profileInput = fields.map(
        (
          f,
        ): Pick<Field, "name" | "type" | "sensitivity"> & {
          stats?: ColumnProfile["stats"];
        } => ({
          name: f.name,
          type: f.type,
          ...(f.sensitivity !== undefined
            ? { sensitivity: f.sensitivity }
            : {}),
        }),
      );
      return applyFloor(node, profileInput, { forceMask });
    },

    // --- source fallback (allowlisted) ---
    async readSource(file: string): Promise<string | null> {
      if (readSourceFile === undefined) return null;
      if (!READABLE_SOURCES.has(file)) return null;
      return readSourceFile(file);
    },
  };
}
