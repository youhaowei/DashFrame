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
import { Type, type Static } from "../tool.js";
import type { Neighborhood, ReachedNode, SearchHit } from "./graph.js";
import { summarize } from "./graph.js";
import type { DataReadResult, GraphReader } from "./port.js";
/**
 * Build the four fixed read tools over a reader. The host calls this once with a
 * reader already scoped to the active draft, and registers the result on the
 * agent's tool set. Returned as a named record so the host can register exactly
 * the perception surface it wants.
 */
export declare function createReadTools(reader: GraphReader): {
    readNeighborhood: import("@earendil-works/pi-agent-core").AgentTool<Type.TObject<{
        kind: Type.TUnion<[Type.TLiteral<"dataSource">, Type.TLiteral<"dataTable">, Type.TLiteral<"dataFrame">, Type.TLiteral<"insight">, Type.TLiteral<"visualization">, Type.TLiteral<"dashboard">]>;
        id: Type.TString;
    }>, {
        neighborhood: Neighborhood;
    } | {
        error: string;
    }>;
    readGraph: import("@earendil-works/pi-agent-core").AgentTool<Type.TObject<{
        from: Type.TObject<{
            kind: Type.TUnion<[Type.TLiteral<"dataSource">, Type.TLiteral<"dataTable">, Type.TLiteral<"dataFrame">, Type.TLiteral<"insight">, Type.TLiteral<"visualization">, Type.TLiteral<"dashboard">]>;
            id: Type.TString;
        }>;
        depth: Type.TInteger;
    }>, {
        reached: ReachedNode[];
    }>;
    findNodes: import("@earendil-works/pi-agent-core").AgentTool<Type.TObject<{
        name: Type.TOptional<Type.TString>;
        kind: Type.TOptional<Type.TUnion<[Type.TLiteral<"dataSource">, Type.TLiteral<"dataTable">, Type.TLiteral<"dataFrame">, Type.TLiteral<"insight">, Type.TLiteral<"visualization">, Type.TLiteral<"dashboard">]>>;
    }>, {
        hits: SearchHit[];
    }>;
    readArtifact: import("@earendil-works/pi-agent-core").AgentTool<Type.TObject<{
        kind: Type.TUnion<[Type.TLiteral<"dataSource">, Type.TLiteral<"dataTable">, Type.TLiteral<"dataFrame">, Type.TLiteral<"insight">, Type.TLiteral<"visualization">, Type.TLiteral<"dashboard">]>;
        id: Type.TString;
    }>, {
        kind: ArtifactKind;
        definition: unknown;
    } | {
        error: string;
    }>;
    readData: import("@earendil-works/pi-agent-core").AgentTool<Type.TObject<{
        kind: Type.TUnion<[Type.TLiteral<"dataTable">, Type.TLiteral<"insight">]>;
        id: Type.TString;
    }>, DataReadResult>;
    readSource: import("@earendil-works/pi-agent-core").AgentTool<Type.TObject<{
        file: Type.TString;
    }>, {
        file: string;
        text: string;
    } | {
        error: string;
    }>;
};
export type ReadTools = ReturnType<typeof createReadTools>;
export { summarize };
export type { Static };
//# sourceMappingURL=tools.d.ts.map