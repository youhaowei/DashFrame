# Assistant drive-loop — feature-depth synthesis (YW-240, round 2)

**Date:** 2026-06-15. **Reframe (owner):** the loop is server-side regardless (renderer cost out); **maturity/reliability explicitly EXCLUDED** (owner trusts TanStack's trajectory). Decision is now **feature-richness + roadmap fit**, not the stability bet that drove round 1.

**Method:** three opus feature-depth evaluations against the REAL current `.d.ts` of each library, scoring four roadmap features per library as **NATIVE** (designed-for seam) / **POSSIBLE** (host hand-rolls it) / **FIGHTS**. Builds on the round-1 minimum-loop spikes (which proved the loop runs on all three).

## Feature matrix

| Roadmap feature                            | pi (`@earendil-works` 0.79.3)                                                                                                    | Vercel AI SDK 6                                                                                                                                 | TanStack AI 0.28                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1. Editable plan + NL re-steer             | **NATIVE** — `steer()` upstream of gate + mutable `state.messages` + session-tree fork                                           | POSSIBLE — `Output.object` plan, but `ToolApprovalResponse` is `{approved,reason}` only (no approve-with-edit)                                  | POSSIBLE — `createToolRegistry`/`onConfig` native, but `addToolApprovalResponse` approve/deny-only, no plan object              |
| 2. Multi-turn refine                       | **NATIVE** — `followUp()` + persisted sessions + first-class compaction                                                          | **NATIVE** — `ModelMessage[]` + `prepareCall` injects live state + `pruneMessages`                                                              | **NATIVE** — `sendMessage`/`reload`, pluggable persistence, `summarize()` compaction, cross-tab sessions                        |
| 3. Plan/diff as typed transcript artifacts | **NATIVE** — `CustomEntry`/`CustomMessageEntry`, persisted, `display` flag (UI-render vs model-visibility)                       | **NATIVE** — `data-*` parts via `createUIMessageStream` + **update-by-`id` reconciliation** (living artifact)                                   | **POSSIBLE** — `MessagePart` union is **CLOSED**; one `StructuredOutputPart`, else `emitCustomEvent` workarounds                |
| 4. Tool/subagent + ecosystem               | POSSIBLE — native dynamic registry + 35+ providers, but **no subagent primitive**, no middleware-chain, no structured-output API | **NATIVE** — first-class subagents (agent-as-tool), `prepareStep` activeTools, `dynamicTool`, `toolApproval`+OPA/WASM, broadest provider matrix | **NATIVE** — deep middleware (transform/skip/abort/defer, cache/guard/OTel), live registries, native MCP; subagents hand-rolled |
| **NATIVE count**                           | **3**                                                                                                                            | **3**                                                                                                                                           | **2**                                                                                                                           |

## The decisive axis: Feature 3 (typed artifacts = DashFrame's core thesis)

DashFrame's whole bet is the **explicit, diffable, living Report artifact** ([[project_explicit_artifact_agent_absorbs_labor]], [[project_dashframe_vision_harness]]). Feature 3 is where that thesis meets the substrate — and it's where the three actually SPLIT:

- **pi — NATIVE + PERSISTED.** Typed `CustomEntry` in a branchable session tree; the `display` flag cleanly separates what the UI renders from what the model sees.
- **Vercel — NATIVE + LIVING.** `data-*` parts with **update-by-`id`** reconciliation — re-run the diff, re-write the same id, the entry MUTATES in place instead of duplicating. The "living artifact" vision as designed-for SDK behavior.
- **TanStack — POSSIBLE. The `MessagePart` union is CLOSED.** No custom typed parts. This hits the artifact thesis hardest of the three. (Trajectory note: AG-UI `StateSnapshot`/`StateDelta` are in TanStack's wire but not yet surfaced client-side — the team is visibly building toward it, but it's not here.)

## Shared gap (NOT a differentiator)

**Editable-plan-on-the-approval-gate is POSSIBLE/hand-rolled on ALL THREE.** None ships approve-with-edit (Vercel confirmed that's a LangGraph feature; pi routes via `steer()` upstream; TanStack is approve/deny-only). So the editable plan is a host-built artifact regardless of library — it does not discriminate. Don't weight it.

## The real divergence — three SHAPES of richness

- **pi: branchable persisted session TREE** (fork/moveTo/branch-summaries) = auditable artifact **history & navigation**. Uniquely matches "user navigates a branchable, auditable Report history." pi is a _session/agent runtime_, not just a loop. (Caveat: harness features proven at TYPE/CONTRACT level, not yet wired to the live `buildPreviewDiff`/`applyCommands` seam — validate that first if pi wins.)
- **Vercel: subagents + broadest ECOSYSTEM** + id-reconciled living data-parts = **composition & capability breadth**. The living-artifact reconciliation + first-class subagents are the strongest _composition_ story.
- **TanStack: middleware POLICY layer** (onBeforeToolCall transform/skip/abort/defer, cache/guard/OTel) = **egress control**, maps cleanly onto "guard the sink, not provenance." But the CLOSED artifact model is the cost.

## Recommendation (feature-richness only; maturity excluded per owner)

**Top tier: pi and Vercel (both 3/4 NATIVE), distinguished by thesis-fit on Feature 3.**

- **If the roadmap thesis is "branchable, auditable, navigable artifact history"** → **pi.** The persisted session tree is a category match nothing else offers, and typed persisted entries nail Feature 3. Cost: no subagent primitive (compose them yourself), and the harness↔seam integration is type-proven not run-proven.
- **If the roadmap thesis is "rich composition + living in-place-mutating artifacts + broad capability surface"** → **Vercel.** The id-reconciled data-parts are the cleanest "living artifact" mechanism, and subagents + ecosystem are the broadest. Cost: editable-plan rides a separate host state machine (true everywhere, but Vercel's approval gate is strictly yes/no).

**TanStack (2/4):** strongest middleware/egress story (aligns with the privacy/guard-the-sink model) and the owner's trajectory pick — but the CLOSED `MessagePart` union is a direct hit on the artifact thesis, the one axis DashFrame can't compromise. Defensible ONLY if you weight the middleware policy layer + future AG-UI state-delta trajectory over a native typed-artifact model TODAY.

**The tiebreaker is a THESIS question, not a feature count:** branchable-history-as-runtime (pi) vs compose-and-extend breadth (Vercel) vs egress-control-and-trajectory (TanStack). pi has the single best Feature-3 fit for the living-Report vision; Vercel has the best composition + a living-artifact mechanism that's equally on-thesis.

## Owner decision

_(pending — the choice is which SHAPE of richness matches the roadmap, not which has more features)_
