# Assistant drive-loop — UX scenarios for the pi-vs-Vercel prototype spike (YW-240)

Derived from the Notion specs (PRD — Agentic Report-Building Harness; Spec — pi-agent/assistant; Spec — v0.3 UI Artifact-Center Shell & Assistant Sidebar). These scenarios decide BOTH the substrate (pi vs Vercel AI SDK 6) AND the assistant UI/UX. The finalist that makes the GOOD UX cheap wins.

## Non-negotiable UX constraints from the specs (every scenario obeys these)

- **Artifact-center, NOT chat.** Three-region shell: left nav / CENTER = the artifact (hero, edited directly) / RIGHT = a dockable, artifact-aware **assistant sidebar** (summon/dismiss, holds the multi-turn sweep). The agent acts ON the artifact; it is NOT a chat app the artifact lives inside.
- **Mode separation (load-bearing):**
  - _Direct edits_ (rename a field, tweak a chart) = optimistic, sub-100ms, NOT agent runs. No spinner.
  - _Agent runs_ = an explicitly-entered mode; seconds expected; **commands STREAM into a DRAFT as authored — the user watches the Report build** (streaming-as-feedback, never a dead spinner).
- **Draft sandbox + mandatory preview.** The agent NEVER writes canonical. It writes to a draft; the center shows the proposed diff; the user PUBLISHES (atomic replay onto canonical) or DISCARDS. Preview is the run's deliberate terminal, not a modal interruption.
- **Proportional ceremony.** Small intent → assistant just does it (1 command, no plan, Claude-Code-fast). Big intent → an EDITABLE PLAN surfaces ("earns its surface"). The plan is a mutable artifact the user drives before commands run.
- **The artifact is the contract.** Trust = inspectability + correctability, not agent confidence. Wrong filter → edit the artifact, don't re-prompt. "Make being wrong cheap to fix."
- **Real seam:** `apps/server/src/functions/commands.ts` (`cmd()`, `applyCommands`), `apps/server/src/functions/preview-diff.ts` (`buildPreviewDiff` @ 449). Loop runs server-side (Electron main). LLM stubbed.

## The six scenarios

### S1 — Small intent, no plan (proportional ceremony: small)

On an open visualization, user types "make this a bar chart." Assistant emits ONE command (`SetChartType`), streams it into the draft, the center re-renders the proposed chart, user publishes. NO plan ceremony. Must FEEL like a quick Claude-Code edit. **Tests:** does the lib make a single-command, no-plan, sub-100ms-feeling path trivial?

### S2 — Big intent, editable plan + streaming draft (proportional ceremony: big + diff review)

User types "build me a sales dashboard with revenue by region." Assistant EXPANDS into a multi-step editable PLAN (create insight → create viz → set bar chart → create dashboard → add item). User can reorder/delete/edit a plan step before running. On run, commands STREAM into the draft as authored — the center materializes the dashboard piece by piece (the "watch it build" requirement). Terminates in a previewable diff; user publishes. **Tests:** plan-as-mutable-artifact + streaming-commands-into-a-draft-as-authored (the headline UX).

### S3 — Mid-flight steering (steering mid-flight)

While the agent is mid-sweep on S2, user types "skip the regional breakdown, add a YoY comparison instead." The assistant re-steers WITHOUT restarting from scratch — folds the new intent in, re-expands the affected plan steps. **Tests:** interrupt / inject / re-expand mid-run; how conversational + interruptible the loop feels.

### S4 — Diff review + selective/direct-edit commit (diff review: the trust surface)

Preview shows 4 new nodes + downstream blast-radius flags. User (a) publishes 3 nodes and discards 1, OR (b) directly edits a filter value IN the diff before committing (mode separation: an optimistic direct-edit inside the agent's draft). Then publishes. **Tests:** per-node commit granularity + direct-edit-the-artifact-in-the-draft (does the lib's approval model allow partial/edited commit, or is it all-or-nothing yes/no?).

### S5 — Late-bound protected value (diff review: privacy floor, DashFrame-specific)

Assistant proposes a filter on a `sensitive` field (e.g. `salary > X`). It CANNOT see the protected value, so it emits a LATE-BOUND placeholder/reference, not a literal. At preview, the user BINDS the protected value (supplies the meaning the agent can't see) before publishing. **Tests:** can the substrate's approval/gate model carry a "bind this operand" step — a structured user-supplies-a-value interaction — not just approve/deny?

### S6 — Maintenance re-wiring + intent re-validation (the repair half)

A source column was renamed, breaking an insight (the health ledger flags it). User asks the assistant to fix it. Assistant proposes STRUCTURAL re-wiring (re-point the renamed column) into a draft; at preview the user RE-VALIDATES intent (confirms the re-wire matches what they meant — the artifact doesn't store "why"). Publish. **Tests:** the maintenance flow (not just authoring) — proposing a structural fix + a user-re-validation gate, distinct from a fresh-authoring diff.

## Stress-axis coverage

| Axis                                       | Scenarios            |
| ------------------------------------------ | -------------------- |
| Proportional ceremony                      | S1 (small), S2 (big) |
| Steering mid-flight                        | S3                   |
| Diff review + selective/direct-edit commit | S2, S4, S5           |
| Maintenance / repair                       | S6                   |

## What each finalist prototype must deliver

A runnable assistant-sidebar slice (a throwaway route/surface in `packages/app`) that ACTS OUT each scenario end-to-end against the real `applyCommands`/`buildPreviewDiff` seam, with: the three-region shell (artifact center + assistant sidebar), commands STREAMING into a visible draft, the proportional small-vs-big split, the editable plan (S2), mid-flight steer (S3), the diff/preview surface with selective-or-edited commit (S4), the late-bound bind step (S5), and the maintenance re-validation (S6). LLM stubbed (deterministic canned tool batches per scenario). Score each scenario: does the library make this UX NATIVE/cheap, POSSIBLE/hand-rolled, or FIGHT it — and capture HOW THE UX FEELS / what the library's grain pushes the UX toward.
