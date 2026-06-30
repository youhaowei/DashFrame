/**
 * The COMMAND VOCABULARY GUIDE — the assistant's PRIMARY reference for the
 * commands it can apply (the applyCommand tool lands next and depends on
 * this).
 *
 * Each entry is a concise CONTRACT per command: the command NAME (the `cmd()`
 * name the apply tool uses), a one-line summary of effect, and its argument
 * shape. This is hand-crafted for the agent — a clean, navigable surface, not a
 * dump of the source. The SOURCE (apps/server/src/functions/commands.ts) is the
 * BACKUP/verification path: the agent can open it via `readSource` when the
 * guide is insufficient.
 *
 * FRESHNESS: the guide can DRIFT from the real command registry as commands are
 * added/removed. `GUIDE_COMMAND_NAMES` is the freshness anchor — a test in
 * apps/server (command-guide-freshness.test.ts) compares it against the live
 * `COMMAND_PATHS` registry and FAILS when they diverge, so a new command without
 * a guide entry (or a removed command still documented) is caught at CI. The
 * guide cannot silently lie to the agent.
 *
 * The guide does NOT carry full arg schemas (those live in the typed
 * `CommandPayloads` / the mutation handlers) — it carries the contract the agent
 * reasons over. For exact arg validation, the apply tool checks against
 * the typed payload at the seam; for exact arg shapes the agent falls back to
 * source.
 */
/** One command's agent-facing contract. */
export interface CommandGuideEntry {
    /** The `cmd()` command name — what the apply tool dispatches on. */
    name: string;
    /** Logical group for navigation. */
    group: "connector" | "dataTable" | "field" | "metric" | "insight" | "visualization" | "dashboard" | "node";
    /** One-line effect summary. */
    summary: string;
    /** Argument names → terse type/role. The contract, not the full schema. */
    args: Record<string, string>;
    /** Cautions the agent must heed (idempotency, validation, side effects). */
    notes?: string;
}
/**
 * The crafted guide. Ordered by group for readability. Names MUST match the
 * `cmd()` command names exactly (the freshness test enforces this against
 * COMMAND_PATHS).
 */
export declare const COMMAND_GUIDE: readonly CommandGuideEntry[];
/**
 * The set of command names the guide documents — the FRESHNESS ANCHOR. The
 * apps/server freshness test asserts this exactly equals the live registry's
 * command names (COMMAND_PATHS keys), so the guide can neither omit a real
 * command nor document a removed one without failing CI.
 */
export declare const GUIDE_COMMAND_NAMES: ReadonlySet<string>;
/**
 * Render the guide as a compact text block for injection into the agent's
 * context (the PRIMARY reference the apply tool hands the model). Source-backup
 * remains reachable via `readSource("apps/server/src/functions/commands.ts")`.
 */
export declare function renderCommandGuide(): string;
//# sourceMappingURL=command-guide.d.ts.map