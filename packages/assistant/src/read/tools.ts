/**
 * The ~4 FIXED read tools — the assistant's perception surface.
 *
 * Built on `defineToolHandler` (the typed-tool seam) over an injected
 * `GraphReader` (the host binds it to the draft-scoped server read path; see
 * ./port.ts). This is NOT a query language — the agent calls these four fixed
 * tools, and the resolver (./graph.ts) + floor (./floor.ts) do the work.
 *
 * INVARIANTS (restated from the resolver, enforced here at the tool boundary):
 *   - STRUCTURE flows UNGATED; VALUES are floor-gated at the data sink.
 *     readNeighborhood / readGraph / readArtifact return STRUCTURE only.
 *     readData is the ONLY tool that returns value-shaped data, and it routes
 *     through the floor (./floor.ts, via the port's readDataProfile).
 *   - All reads go through the SERVER seam (the GraphReader port), against the
 *     DRAFT-OVERLAY view — the host scopes the reader to the active draftId, so
 *     the agent perceives its own in-progress edits. Tools never touch the DB.
 *   - Ambient perception (readNeighborhood) = invocation point + 1 hop, NOT the
 *     whole graph. readGraph/searchGraph are the on-demand global reach.
 */

import type { ArtifactKind } from "@dashframe/types";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { defineToolHandler, Type, type Static } from "../tool.js";

import type { Neighborhood, ReachedNode, SearchHit } from "./graph.js";
import { neighbors, search, summarize, traverse } from "./graph.js";
import { assembleDataRead } from "./perception.js";
import type {
  DashboardRead,
  DataReadResult,
  GraphReader,
  NodeRef,
} from "./port.js";

/**
 * TypeBox enum for an artifact kind (shared across the tool schemas). The
 * members are spelled out (not `.map()`-ed from an array) so TypeBox's `Static`
 * inference narrows `kind` to the literal union rather than widening to string.
 */
const KindSchema = Type.Union(
  [
    Type.Literal("dataSource"),
    Type.Literal("dataTable"),
    Type.Literal("dataFrame"),
    Type.Literal("insight"),
    Type.Literal("visualization"),
    Type.Literal("dashboard"),
  ],
  { description: "Artifact kind." },
);

/** A node reference param: { kind, id }. */
const NodeRefSchema = Type.Object({
  kind: KindSchema,
  id: Type.String({ description: "Artifact id (UUID)." }),
});

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/**
 * Build the four fixed read tools over a reader. The host calls this once with a
 * reader already scoped to the active draft, and registers the result on the
 * agent's tool set. Returned as a named record so the host can register exactly
 * the perception surface it wants.
 */
export function createReadTools(reader: GraphReader) {
  // -------------------------------------------------------------------------
  // 1. readNeighborhood — AMBIENT perception: invocation point + 1 hop.
  // -------------------------------------------------------------------------
  const readNeighborhood = defineToolHandler<
    typeof NodeRefSchema,
    { neighborhood: Neighborhood } | { error: string }
  >({
    name: "read_neighborhood",
    description:
      "Ambient perception: the invocation point (the artifact the assistant " +
      "was triggered from) plus its ONE-HOP neighbors, both directions. " +
      "Returns STRUCTURE only (names, kinds, edges) — never data. This is the " +
      "default local view; most intents are local. Use read_graph/find_nodes " +
      "to reach beyond one hop.",
    label: "Read neighborhood",
    parameters: NodeRefSchema,
    async execute(
      _id,
      params,
    ): Promise<
      AgentToolResult<{ neighborhood: Neighborhood } | { error: string }>
    > {
      const hood = await neighbors(reader, params as NodeRef);
      if (hood === null) {
        return {
          ...text(`No artifact found for ${params.kind} ${params.id}.`),
          details: { error: "not_found" },
        };
      }
      const downNames = hood.downstream.map((n) => n.name).join(", ") || "none";
      const upNames = hood.upstream.map((n) => n.name).join(", ") || "none";
      return {
        ...text(
          `${hood.center.name} (${params.kind}). ` +
            `Downstream: ${downNames}. Upstream: ${upNames}.`,
        ),
        details: { neighborhood: hood },
      };
    },
  });

  // -------------------------------------------------------------------------
  // 2a. readGraph — navigate on demand: bounded traversal from a node.
  // -------------------------------------------------------------------------
  const ReadGraphSchema = Type.Object({
    from: NodeRefSchema,
    depth: Type.Integer({
      minimum: 0,
      maximum: 6,
      description: "Hops to traverse (clamped to 6).",
    }),
  });
  const readGraph = defineToolHandler<
    typeof ReadGraphSchema,
    { reached: ReachedNode[] }
  >({
    name: "read_graph",
    description:
      "Navigate the artifact graph on demand: breadth-first from a node out to " +
      "`depth` hops. Returns STRUCTURE only (reached nodes + their hop " +
      "distance). The global-reach counterpart to read_neighborhood — use when " +
      "the relevant artifact is beyond the ambient one-hop view.",
    label: "Read graph",
    parameters: ReadGraphSchema,
    async execute(
      _id,
      params,
    ): Promise<AgentToolResult<{ reached: ReachedNode[] }>> {
      const reached = await traverse(
        reader,
        params.from as NodeRef,
        params.depth,
      );
      return {
        ...text(
          `Reached ${reached.length} node(s) within ${params.depth} hop(s).`,
        ),
        details: { reached },
      };
    },
  });

  // -------------------------------------------------------------------------
  // 2b. findNodes — find by name / type / relationship (the grep+ls model).
  // -------------------------------------------------------------------------
  const FindSchema = Type.Object({
    name: Type.Optional(
      Type.String({ description: "Case-insensitive name substring." }),
    ),
    kind: Type.Optional(KindSchema),
  });
  const findNodes = defineToolHandler<typeof FindSchema, { hits: SearchHit[] }>(
    {
      name: "find_nodes",
      description:
        "Find artifacts across the whole graph by name substring and/or kind " +
        "(any of dataSource, dataTable, dataFrame, insight, visualization, " +
        "dashboard). STRUCTURE only. An empty query lists everything (the `ls`). " +
        "Pair with read_graph to navigate from a hit.",
      label: "Find nodes",
      parameters: FindSchema,
      async execute(
        _id,
        params,
      ): Promise<AgentToolResult<{ hits: SearchHit[] }>> {
        const q: { name?: string; kind?: NodeRef["kind"] } = {};
        if (params.name !== undefined) q.name = params.name;
        if (params.kind !== undefined) q.kind = params.kind;
        const hits = await search(reader, q);
        return {
          ...text(
            `${hits.length} match(es): ` +
              (hits.map((h) => `${h.name} (${h.ref.kind})`).join(", ") ||
                "none"),
          ),
          details: { hits },
        };
      },
    },
  );

  // -------------------------------------------------------------------------
  // 3. readArtifact — ONE artifact's full DEFINITION (structure, ungated).
  // -------------------------------------------------------------------------
  const readArtifact = defineToolHandler<
    typeof NodeRefSchema,
    { kind: ArtifactKind; definition: unknown } | { error: string }
  >({
    name: "read_artifact",
    description:
      "Read ONE artifact's full definition: an insight's query shape (source, " +
      "selected fields, metrics, filters, sorts, joins), a visualization's " +
      "encoding/spec, a dashboard's layout, a data source/table's config. " +
      "STRUCTURE, UNGATED — never row data. Reads the DRAFT-OVERLAY view, so " +
      "in-progress draft edits are visible.",
    label: "Read artifact",
    parameters: NodeRefSchema,
    async execute(
      _id,
      params,
    ): Promise<
      AgentToolResult<
        { kind: ArtifactKind; definition: unknown } | { error: string }
      >
    > {
      const ref = params as NodeRef;
      const definition = await readArtifactDefinition(reader, ref);
      if (definition === null) {
        return {
          ...text(`No artifact found for ${ref.kind} ${ref.id}.`),
          details: { error: "not_found" },
        };
      }
      return {
        ...text(`${ref.kind} definition for ${ref.id}.`),
        details: { kind: ref.kind, definition },
      };
    },
  });

  // -------------------------------------------------------------------------
  // 4. readData — TIERED data sample. Works on a TABLE or an INSIGHT RESULT.
  //    The ONLY value-egress tool: routes through the floor (./floor.ts).
  // -------------------------------------------------------------------------
  const ReadDataSchema = Type.Object({
    // Constrained to the two artifacts that HAVE data: a data table's rows, or
    // an insight's computed result. (A viz reads its insight's result — the
    // agent reads the insight here.)
    kind: Type.Union([Type.Literal("dataTable"), Type.Literal("insight")], {
      description: "Only dataTable or insight have a data sample.",
    }),
    id: Type.String({ description: "Artifact id (UUID)." }),
  });
  const readData = defineToolHandler<
    typeof ReadDataSchema,
    DataReadResult | { error: string }
  >({
    name: "read_data",
    description:
      "Read a tiered DATA sample for a data table or an insight result. " +
      "Column structure (names, types, sensitivity) always flows. VALUES are " +
      "floor-gated: if any contributing SOURCE column is sensitive, the read " +
      "is MASKED. Every read returns column PROFILES (shape/stats). If the " +
      "host supplies a bounded sample, cleared columns may include raw values; " +
      "restricted columns are obfuscated. Incomplete lineage obfuscates every value.",
    label: "Read data",
    parameters: ReadDataSchema,
    async execute(
      _id,
      params,
    ): Promise<AgentToolResult<DataReadResult | { error: string }>> {
      const node: NodeRef = { kind: params.kind, id: params.id };
      // The port's readDataProfile IS the floor-gated profile sink (host wires
      // it to ./floor.applyFloor over the artifact's source fields). Optional
      // sample rows still enter only through the port and are immediately
      // reassembled under the same column-aware floor before reaching the agent.
      const result = await reader.readDataProfile(node);
      if (result === null) {
        return {
          ...text(`No data artifact found for ${params.kind} ${params.id}.`),
          details: { error: "not_found" },
        };
      }
      if (reader.readDataSample !== undefined) {
        try {
          const sampleRows = await reader.readDataSample(node, { maxRows: 5 });
          const assembled = assembleDataRead(
            node,
            result.masked,
            result.columns,
            {
              sampleRows,
              maxRows: 5,
            },
          );
          if (
            assembled.sample !== undefined &&
            (result.sample === undefined || assembled.sample.rowCount > 0)
          ) {
            result.sample = assembled.sample;
          }
        } catch {
          // Sample fetch is best-effort; profiles still return on DB/query failures.
        }
      }
      const masked = result.masked ? " (MASKED — sensitive source)" : "";
      const resolution =
        result.resolution === "unresolved"
          ? " Unresolved source; fail-closed."
          : "";
      const truncNote = result.sample?.truncated ? " (truncated)" : "";
      const sample =
        result.sample !== undefined
          ? ` ${result.sample.rowCount} ${result.sample.tier} sample row(s)${truncNote}.`
          : " No raw rows (profiles-only floor).";
      return {
        ...text(
          `${result.columns.length} column profile(s) for ${params.kind} ` +
            `${params.id}${masked}.${resolution}${sample}`,
        ),
        details: result,
      };
    },
  });

  // -------------------------------------------------------------------------
  // 5. readSource — BACKUP/verification: open an allowlisted project source file.
  // -------------------------------------------------------------------------
  const ReadSourceSchema = Type.Object({
    file: Type.String({
      description:
        "Allowlisted project source path, e.g. " +
        "apps/server/src/functions/commands.ts.",
    }),
  });
  const readSource = defineToolHandler<
    typeof ReadSourceSchema,
    { file: string; text: string } | { error: string }
  >({
    name: "read_source",
    description:
      "Open an ALLOWLISTED project source file as text — the BACKUP path for the " +
      "command vocabulary. The crafted command guide is the PRIMARY reference; " +
      "use this to verify exact arg shapes against the source " +
      "(apps/server/src/functions/commands.ts) when the guide is insufficient. " +
      "Returns an error for any non-allowlisted file.",
    label: "Read source",
    parameters: ReadSourceSchema,
    async execute(
      _id,
      params,
    ): Promise<
      AgentToolResult<{ file: string; text: string } | { error: string }>
    > {
      const source = await reader.readSource(params.file);
      if (source === null) {
        return {
          ...text(`No readable source for "${params.file}" (not allowlisted).`),
          details: { error: "not_readable" },
        };
      }
      return {
        ...text(`Source of ${params.file} (${source.length} chars).`),
        details: { file: params.file, text: source },
      };
    },
  });

  return {
    readNeighborhood,
    readGraph,
    findNodes,
    readArtifact,
    readData,
    readSource,
  };
}

/**
 * Resolve a node to its full server-side definition (structure). Used by
 * read_artifact. Each kind reads through the corresponding port method.
 */
async function readArtifactDefinition(
  reader: GraphReader,
  ref: NodeRef,
): Promise<unknown | null> {
  switch (ref.kind) {
    case "dataSource":
      return reader.getDataSource(ref.id);
    case "dataTable":
      return reader.getDataTable(ref.id);
    case "dataFrame":
      return reader.getDataFrameEntry(ref.id);
    case "insight":
      return reader.getInsight(ref.id);
    case "visualization":
      return reader.getVisualization(ref.id);
    case "dashboard":
      return reader.getDashboard(ref.id) as Promise<DashboardRead | null>;
  }
}

export type ReadTools = ReturnType<typeof createReadTools>;
export { summarize };
export type { Static };
