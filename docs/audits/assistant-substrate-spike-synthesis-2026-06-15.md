# Assistant drive-loop substrate — 3-way spike synthesis (YW-240)

**Date:** 2026-06-15. **Method:** three throwaway spikes, each building the EXACT loop (intent → agent emits command batch → approval pause → render OUR `buildPreviewDiff` artifact diff → commit via `applyCommands`) against the REAL seam (real PGLite artifact DB, real `cmd()` vocabulary, real `buildPreviewDiff`, real `applyCommands`). LLM stubbed in all three. All three RAN end-to-end, commit + discard verified.

Full findings: the three spike docs (this is the comparison layer). pi-core was framed as the incumbent (originally-intended lib); Vercel + TanStack as challengers.

## Score matrix (1–5)

| Axis                                                 | pi-core (`@earendil-works/pi-ai`)                  | Vercel AI SDK 6                                    | TanStack AI                          |
| ---------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| 1. Diff at the gate                                  | **5**                                              | **5**                                              | **5**                                |
| 2. Seam friction                                     | 4 (~190 lines, 0 type errors)                      | 4 (~40 lines glue)                                 | 4 (~30 lines glue)                   |
| 3. Proportional ceremony                             | 4 (richest steering surface)                       | 4 (per-call predicate)                             | 4 (assembled from 3 mechanisms)      |
| 4. **Maturity / risk**                               | **2** (deprecated → scope-rename, solo maintainer) | **3.5** (GA, but `needsApproval` deprecated in v7) | **2** (9 days old, sub-weekly churn) |
| 5. Renderer cost (moot — loop runs in Electron main) | 3 (~1.9 MB, model catalog + eager @google/genai)   | 3 (~117–134 KB gzip)                               | 4 (~17 KB gzip client subpath)       |

## Convergence (all three agreed)

1. **All three RUN** the full loop against the real seam. Architecture is sound on any.
2. **Diff-at-the-gate = 5/5 universally.** Every library's approval pause is _declarative data_ (a content part / message state / awaited hook), NOT a built-in confirmation UI. We render OUR artifact diff with zero framework opinion to override. This axis does not discriminate.
3. **Per-call → per-batch reconciliation is hand-rolled in ALL three** (~25–40 lines). Our `buildPreviewDiff` checkpoint is batch-level; every library's approval is per-call. This is STRUCTURAL to our design, a constant across libraries — not a differentiator.
4. **Run the loop in Electron MAIN, not the renderer** — forced by `buildPreviewDiff`/`applyCommands` needing the WyStack app + PGLite handle (already main-process). This neutralizes the renderer-cost axis on all three.
5. **The named "approval" feature can be a trap.** pi-core's `{block:true}` rejects-and-continues (doesn't pause); the real pause is an awaited promise in `beforeToolCall`. Vercel's `needsApproval` is the real one but deprecated in v7. Know the actual pause primitive per library.

## Divergence (the decision)

Fit is a near-tie (4–5 across the board). **The decision collapses to maturity** (axis 4):

- **Vercel AI SDK 6 — most mature (3.5).** GA, production-proven, extensive docs, first-class HITL story. Risk: `needsApproval` deprecated in v7 → call-level `toolApproval` (which is arguably a BETTER fit for our batch gate). Churn is ONE named API rename, containable behind a ~15-line adapter. Also showed minor internal provider-type skew within one install.
- **pi-core — best technical fit, weakest project health (2).** Awaited `beforeToolCall`-as-suspend is the cleanest cross-process gate; richest steering surface (`shouldStopAfterTurn`, steering, follow-up, `CustomAgentMessages` for typed plan/diff transcript entries). Terminal-CoG concern EVAPORATED (the two packages we'd import have no TUI/bash/Node-builtins; that weight is in sibling packages). Risk: deprecated mid-flight (badlogic → earendil-works scope rename), fast lockstep releases, ~solo maintainer. Mitigable: pin/vendor (MIT, pure TS, only typebox+pi-ai deps).
- **TanStack AI — cleanest integration arguably, youngest (2).** ~17 KB gzip client. Risk: 0.28.0, 9 days old, new minor every 1–2 days, three lockstep-versioned packages, actively-reshaping type surface. Disqualifying for a trust-critical commit checkpoint NOW.

## Recommendation: Vercel AI SDK 6

When fit is a tie, pick the lowest-reversal-cost substrate for a load-bearing, trust-critical feature (the commit checkpoint guards real data mutations). Vercel is the only GA/production-proven candidate. Its risk (a localized, named, adapter-isolable API rename) is one you can contain in ~15 lines; pi-core's and TanStack's are diffuse project-health risks you can't adapter your way around.

**The incumbent (pi-core) was genuinely strong** and earned its reconsideration — it loses only on the one axis that decides a tie. Defensible to pick pi-core if "richest steering surface" or "intended lib" is weighted over stability.

**Build discipline regardless of choice:** isolate the SDK-specific approval/resume shape (~15 lines) behind a thin DashFrame port from day one, so a substrate swap or major-version migration is contained. Run the loop in Electron main; renderer carries only the diff UI + IPC.

## CORRECTION (2026-06-15) — pi re-spiked on the current scope

The first pi spike used the OLD package scope `@mariozechner/pi-*` @ 0.73.1. pi.dev is actually the `earendil-works/pi` project; current packages are `@earendil-works/pi-*` @ 0.79.3. A targeted re-spike (picore-v2.md) re-ran the loop on the current scope and closed two gaps:

- **Maturity 2 → 3.** The 2/5 was driven entirely by the "DEPRECATED" string, which was only on the abandoned `@mariozechner` scope. The `@earendil-works` successor is live, non-deprecated, with **0 breaking changes to the agent-loop/approval API across 0.73.1→0.79.3** (6 minors), 3 maintainers (incl. Armin Ronacher). Capped at 3 by fast lockstep churn (17 versions in ~5 weeks on a ~5-week-old coordinate). Integration code ported verbatim — only the import string changed; typechecks 0-errors on 0.79.3.
- **pi-web-ui evaluated → NO real web story.** It's **Lit web components, not React** (framework boundary with our React 19 renderer); a **generic chat UI with zero tool-approval/gate/diff component** (doesn't wire into `beforeToolCall`); and **stale/orphaned** (frozen 0.75.3, absent from the repo package table, would force a pi-ai downgrade). pi gains NO in-renderer UI advantage — the diff-approval surface stays hand-rolled in `@wystack/ui` regardless (correct anyway: it must paint OUR `PreviewDiff`).

### Revised matrix

| Axis                  | pi-core (`@earendil-works`)                                    | Vercel AI SDK 6                                | TanStack AI        |
| --------------------- | -------------------------------------------------------------- | ---------------------------------------------- | ------------------ |
| Diff at gate          | 5                                                              | 5                                              | 5                  |
| Seam friction         | 4                                                              | 4                                              | 4                  |
| Proportional ceremony | 4                                                              | 4                                              | 4                  |
| **Maturity**          | **3** (renamed, API-stable so far, but young + lockstep churn) | **3.5** (GA; `needsApproval` deprecated in v7) | **2** (9 days old) |
| Renderer cost         | 3                                                              | 3                                              | 4                  |

### Revised recommendation: still Vercel AI SDK 6, by a narrower margin

pi closed most of the gap (3 vs 3.5). Both candidates' risk is "the approval primitive may move." Vercel's is ONE known, named, scheduled, adapter-isolable rename on a GA library; pi's is continuous lockstep churn (17 releases/5 weeks) on a ~5-week-old scope. Same mitigation (thin ~15-line seam), but Vercel's volatility is lower and more predictable.

**pi is now a DEFENSIBLE choice, not a compromised one** — and it was the originally-intended lib. If the owner weights "intended lib + richest steering surface" over "most-predictable maturity," pi at 3/5 is reasonable. The gap is 0.5 on a single axis.

## Owner decision

_(pending — owner deciding between Vercel (recommended, by 0.5) and pi (intended lib, now viable at 3/5). TanStack ruled out on maturity.)_
