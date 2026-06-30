/**
 * The assistant READ layer — a privacy-aware graph resolver.
 *
 * The agent perceives the artifact graph through four fixed tools. STRUCTURE
 * (names, types, edges, definitions) flows ungated; VALUES pass the privacy
 * floor (binary, inherit-source). All reads go through the GraphReader port,
 * which the host binds to the draft-scoped server read path.
 *
 *   port.ts          — the read seam (host binds to app.runHandler + draftId)
 *   floor.ts         — the privacy floor (single value-egress gate)
 *   graph.ts         — structure navigation (neighbors, traverse, search)
 *   tools.ts         — the 4 fixed read tools on defineToolHandler
 *   command-guide.ts — the agent-readable command vocabulary + freshness anchor
 */
export type { ColumnProfile, DashboardRead, DataFrameRead, DataReadResult, DataReadSample, GraphReader, NodeRef, } from "./port.js";
export { applyFloor, isMaskedBySource, profileColumns } from "./floor.js";
export { assembleDataRead } from "./perception.js";
export type { PerceptionAssemblerOptions } from "./perception.js";
export { neighbors, search, summarize, traverse } from "./graph.js";
export type { Neighborhood, NodeSummary, ReachedNode, SearchHit, SearchQuery, } from "./graph.js";
export { createReadTools } from "./tools.js";
export type { ReadTools } from "./tools.js";
export { COMMAND_GUIDE, GUIDE_COMMAND_NAMES, renderCommandGuide, } from "./command-guide.js";
export type { CommandGuideEntry } from "./command-guide.js";
//# sourceMappingURL=index.d.ts.map