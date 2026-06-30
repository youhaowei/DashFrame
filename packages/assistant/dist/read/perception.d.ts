import type { ColumnProfile, DataReadResult, NodeRef } from "./port.js";
export interface PerceptionAssemblerOptions {
    /** Bounded row sample; omit to return profiles only. */
    sampleRows?: ReadonlyArray<Record<string, unknown>>;
    /** Maximum rows the agent may see. Default: 5. */
    maxRows?: number;
    /** Approximate JSON-character budget for the sample. Default: 12k. */
    maxSampleChars?: number;
    /** Incomplete lineage: obfuscate every value even if a column is marked cleared. */
    maskAllValues?: boolean;
}
/**
 * Assemble the agent's value context under the privacy floor and a bounded
 * sample budget. Profiles are always present. Cleared columns may flow raw;
 * restricted columns are obfuscated. Incomplete lineage masks every value.
 */
export declare function assembleDataRead(node: NodeRef, masked: boolean, columns: ColumnProfile[], options?: PerceptionAssemblerOptions): DataReadResult;
//# sourceMappingURL=perception.d.ts.map