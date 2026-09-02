/** Assistant graph reads use the same owner-scoped Convex queries as the UI.
 * Native row bytes never enter this structural reader; applyFloor enforces
 * source-field privacy before returning profiles or safe samples.
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
import type { ApplicationOperations } from "./host/application";

/**
 * The set of project source files the assistant may open via `readSource` — its
 * BACKUP/verification path for the command vocabulary. Allowlisted, not
 * arbitrary FS access: the agent can fall back to the command source when the
 * crafted guide is insufficient, and nothing else.
 */
const READABLE_SOURCES: ReadonlySet<string> = new Set([
  "packages/convex-backend/convex/engine.ts",
]);

export interface AssistantReadHostOptions {
  app: ApplicationOperations;
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

type ServerDataFrameRead = DataFrameRead & {
  storage?: unknown;
  primaryKey?: unknown;
  sourceId?: UUID;
  definitionId?: UUID;
  analysis?: unknown;
};

function toDataFrameRead(frame: ServerDataFrameRead): DataFrameRead {
  return {
    id: frame.id,
    name: frame.name,
    insightId: frame.insightId,
    fieldIds: frame.fieldIds,
    rowCount: frame.rowCount,
    columnCount: frame.columnCount,
    createdAt: frame.createdAt,
    lastRefreshedAt: frame.lastRefreshedAt,
    currentInsightResult: frame.currentInsightResult,
  };
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

  // Draft identity is passed only to generated metadata queries.
  const context: Record<string, unknown> =
    draftId !== undefined ? { draftId } : {};

  async function read<T>(path: string, args: unknown): Promise<T> {
    return (await app.execute(path, args, context)) as T;
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
    missing?: boolean;
    unresolvedReason?: string;
  }

  /**
   * Resolve the CONTRIBUTING SOURCE FIELDS for a data read — the inherit-source
   * key. EVERY column the artifact reads from contributes; missing any sensitive
   * one would fail OPEN, so this errs toward `forceMask` whenever resolution is
   * incomplete.
   *
   *   - dataTable: its own fields.
   *   - insight: the union of EVERY contributing column —
   *       • source fields (the source may be a DataTable OR another Insight;
   *         the discriminated chain is walked, cycle-guarded),
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
      if (table === null) return { fields: [], forceMask: true, missing: true };
      if ((table.fields?.length ?? 0) === 0)
        return {
          fields: [],
          forceMask: true,
          unresolvedReason: "data table has no resolved fields",
        };
      return { fields: table.fields, forceMask: false };
    }
    const insight = await read<Insight | null>("getInsight", { id: node.id });
    if (insight === null) return { fields: [], forceMask: true, missing: true };
    return resolveInsightSourceFields(insight, new Set<UUID>());
  }

  /**
   * Walk an insight's full contributing-column set. `seen` guards the
   * insight-on-insight source chain against cycles (the server rejects cycles on
   * write, but a read must never loop). Any unresolved hop forces masking.
   */
  async function resolveInsightSourceFields(
    insight: Insight,
    seen: Set<UUID>,
  ): Promise<SourceResolution> {
    const insightId = insight.id;
    if (seen.has(insightId)) return { fields: [], forceMask: true };
    seen.add(insightId);

    const fields: Field[] = [];
    let forceMask = false;
    let unresolvedReason: string | undefined;
    // Add a referenced table's fields. A DANGLING ref (null table) forces
    // masking: deleting a DataTable does NOT cascade-delete dependent insights
    // (the repair target is TBD), so an insight can carry a
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
      if (table === null || (table.fields?.length ?? 0) === 0) {
        forceMask = true;
        unresolvedReason ??=
          "one or more contributing tables could not be resolved";
      } else fields.push(...table.fields);
    };

    // Follow the explicit source discriminant. An Insight source must never be
    // probed as a DataTable even if ids happen to collide across namespaces.
    if (insight.source.sourceType === "dataTable") {
      await addTableFields(insight.source.sourceId);
    } else {
      const upstreamInsight = await read<Insight | null>("getInsight", {
        id: insight.source.sourceId,
      });
      if (upstreamInsight === null) {
        forceMask = true;
        unresolvedReason ??= "base source could not be resolved";
      } else {
        const upstream = await resolveInsightSourceFields(
          upstreamInsight,
          seen,
        );
        fields.push(...upstream.fields);
        forceMask = forceMask || upstream.forceMask;
        unresolvedReason ??= upstream.unresolvedReason;
      }
    }

    // Join tables — every joined table's columns are read (incl. the join keys).
    for (const j of insight.joins ?? []) await addTableFields(j.rightTableId);

    // Metric source tables — a metric reads `columnName` from `sourceTable`,
    // which the dimension projection never lists. Add those tables' fields.
    for (const m of insight.metrics ?? []) {
      if (m.sourceTable) await addTableFields(m.sourceTable);
    }

    return { fields, forceMask, unresolvedReason };
  }

  return {
    // --- structure reads (ungated) — straight through the server seam ---
    getDataSource: (id) => read<DataSource | null>("getDataSource", { id }),
    getDataTable: (id) => read<DataTable | null>("getDataTable", { id }),
    getDataFrameEntry: async (id) => {
      const frame = await read<ServerDataFrameRead | null>(
        "getDataFrameEntry",
        { id },
      );
      return frame === null ? null : toDataFrameRead(frame);
    },
    getInsight: (id) => read<Insight | null>("getInsight", { id }),
    getVisualization: (id) =>
      read<Visualization | null>("getVisualization", { id }),
    getDashboard: (id) => read<DashboardRead | null>("getDashboard", { id }),

    listDataSources: () => read<DataSource[]>("listDataSources", {}),
    // NOTE: the *filtered* list/get reads below pass NO server-side filter and
    // filter in JS. The draft-overlay coalesce supports an UNFILTERED `.all()`
    // and a PK-pinned `.where(eq(id, …))`, but THROWS on any non-PK read filter
    // (the native Convex draft query). `listDataTables`'s
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
    listDataFrames: async () =>
      (await read<ServerDataFrameRead[]>("listDataFrames", {})).map(
        toDataFrameRead,
      ),
    listInsights: () => read<Insight[]>("listInsights", {}),
    listVisualizations: async (insightId) => {
      const all = await read<Visualization[]>("listVisualizations", {});
      return insightId === undefined
        ? all
        : all.filter((v) => v.insightId === insightId);
    },
    listDashboards: () => read<DashboardRead[]>("listDashboards", {}),
    getDataFrameByInsight: async (insightId) => {
      const all = (await read<ServerDataFrameRead[]>("listDataFrames", {})).map(
        toDataFrameRead,
      );
      return (
        all.find(
          (frame) =>
            frame.insightId === insightId &&
            frame.currentInsightResult === true,
        ) ??
        all
          .filter((frame) => frame.insightId === insightId)
          .sort(
            (left, right) =>
              (right.lastRefreshedAt ?? right.createdAt ?? 0) -
              (left.lastRefreshedAt ?? left.createdAt ?? 0),
          )[0] ??
        null
      );
    },

    // --- value read (floor-gated) — the single value egress ---
    async readDataProfile(node: NodeRef): Promise<DataReadResult | null> {
      const { fields, forceMask, missing, unresolvedReason } =
        await sourceFieldsFor(node);
      if (missing === true) return null;
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
      const result = applyFloor(node, profileInput, { forceMask });
      if (forceMask) {
        return {
          ...result,
          resolution: "unresolved",
          unresolvedReason:
            unresolvedReason ?? "source field resolution was incomplete",
        };
      }
      return { ...result, resolution: "complete" };
    },

    // --- source fallback (allowlisted) ---
    async readSource(file: string): Promise<string | null> {
      if (readSourceFile === undefined) return null;
      if (!READABLE_SOURCES.has(file)) return null;
      return readSourceFile(file);
    },
  };
}
