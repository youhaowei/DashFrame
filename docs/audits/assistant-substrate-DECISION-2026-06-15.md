# Assistant substrate — FINAL decision synthesis (YW-240)

**Date:** 2026-06-15. Three investigation rounds, converging. Both finalist UX prototypes (pi, Vercel AI SDK 6) built runnable slices acting out all six spec-derived scenarios (S1–S6) against the REAL `applyCommands`/`buildPreviewDiff` seam, verified end-to-end (headless 6/6 + React surface).

## The three rounds, converging

1. **Round 1 — maturity.** Recommended Vercel (GA vs pi's then-apparent deprecation). Then pi re-spiked: deprecation was a SCOPE RENAME (`@mariozechner` → `@earendil-works`), API stable across 6 minors → pi maturity 2→3. Owner then EXCLUDED maturity from the decision (trusts the trajectory).
2. **Round 2 — feature count.** pi and Vercel tied 3/4 NATIVE; TanStack 2/4 (closed `MessagePart` union, dropped). Flagged a "shared gap": neither ships approve-with-edit.
3. **Round 3 — UX scenarios (decisive).** Acting out DashFrame's six real interactions broke the tie — and revealed the "shared gap" was NOT shared.

## Scenario head-to-head

| Scenario                       | pi                                   | Vercel                               | Note                                                                                                                    |
| ------------------------------ | ------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| S1 small intent                | NATIVE                               | NATIVE                               | tie — Claude-Code-fast on both                                                                                          |
| S2 plan + streaming draft      | **NATIVE**                           | POSSIBLE (draft half NATIVE)         | pi: plan _is_ `state.messages`. Vercel: streaming draft native via `data-*` id-reconcile; editable plan = host list-ops |
| S3 mid-flight steer            | NATIVE                               | NATIVE                               | tie — both own the message history                                                                                      |
| **S4 selective/edited commit** | POSSIBLE                             | **FIGHTS**                           | THE SPLIT                                                                                                               |
| **S5 late-bound bind**         | POSSIBLE                             | **FIGHTS**                           | THE SPLIT                                                                                                               |
| S6 maintenance re-validate     | POSSIBLE                             | POSSIBLE                             | tie — both a host gate-part                                                                                             |
| **Tally**                      | **3 NATIVE / 3 POSSIBLE / 0 FIGHTS** | **3 NATIVE / 1 POSSIBLE / 2 FIGHTS** |                                                                                                                         |

## The deciding factor (confirmed independently by BOTH prototypes)

**pi's gate resolves with an ARBITRARY value; Vercel's resolves with a BOOLEAN.**

- pi: `beforeToolCall` suspends and resolves `resolve(decision)` where `decision` is any structured object. One property carries S4 (select a subset), S5 (bind a protected value), S6 (re-validate intent) — all for free. pi's own prototype: "a boolean-gate library would force those into hand-rolled side-channels."
- Vercel: `ToolApprovalResponse` is `{approved, reason?}` only — no `editedInput`. Vercel's OWN prototype verdict: "user supplies a structured value at the gate" is "structurally impossible" → S4 + S5 FIGHT, fully host-built.

This matters because the gate is **the trust surface** — the PRD's load-bearing UX. Three of DashFrame's six real interactions want a RICH gate. pi has one; Vercel doesn't.

## Where Vercel is genuinely better (honest counter-weight)

S2/S6 streaming draft via `data-*` **id-reconciliation** — a transcript node mutates in place as the Report builds; arguably the cleaner "living artifact" mechanism. BUT both libraries hit "watch it build" as NATIVE/cheap (pi via `state.messages` streaming) — so Vercel's edge sits on an axis where both already win. pi's edge sits on an axis where Vercel fights. Asymmetric → decisive for pi.

## DECISION: pi (`@earendil-works/pi-agent-core` + `pi-ai`, pinned 0.79.4)

Fits DashFrame's actual UX with zero fighting scenarios:

- Rich arbitrary-value gate → S4/S5/S6 (the trust-surface interactions) ride it.
- Plan-as-`state.messages` → S2 editable plan + streaming draft is the loop, not machinery.
- Branchable persisted session tree → the living-Report/navigable-history thesis (round-2 finding).
- Was the originally-intended lib; maturity set aside by owner.

**The one real cost / first risk to retire:** pi's harness↔seam integration is prototype+type-proven, not yet production-wired; the project is younger/churnier. Mitigation (already established): hard-pin the version, keep the SDK-specific seam thin (~190 lines) behind a DashFrame port, vendor `pi-agent-core` if needed (MIT, pure TS, deps = typebox + pi-ai).

## UI/UX decisions the scenarios also settled (feed the v0.3 UI spec)

- **Rich gate, not yes/no.** The approval/preview surface must carry structured interactions: per-node selective commit (S4), bind-a-protected-value (S5), intent re-validation (S6) — not a binary accept/discard. This is now a hard requirement on the substrate AND the UI.
- **Plan = the message transcript** rendered as an editable artifact (reorder/delete/edit steps), not a separate modal.
- **Streaming draft into the center** (watch-it-build) is confirmed achievable + is the headline feel.
- **Proportional ceremony** (S1 no-plan vs S2 plan) is real and cheap on pi — write it into the Notion UI spec (currently a documented gap).

## Next steps (post-decision)

1. Owner ratifies pi (or overrides).
2. First impl ticket = the thin DashFrame port over pi's gate + loop (the seam that contains pi's API surface). Identical regardless, but now concrete on pi.
3. Write proportional ceremony + the rich-gate UX into the Notion v0.3 UI spec.
4. Update YW-240 with the decision; spawn the impl ticket chain.

## Owner decision

**RATIFIED 2026-06-15: pi (`@earendil-works/pi-agent-core` + `pi-ai`, pinned 0.79.4).** Owner: "pi-agent then, matching my expectations." The UX scenario head-to-head (pi 3/3/0 vs Vercel 3/1/2) confirmed the originally-intended lib on evidence — the arbitrary-value gate carrying S4/S5/S6 (the trust-surface interactions) was decisive.

### Methodology note (for the record)

Both prototypes stubbed the LLM with the library's own test provider (pi `registerFauxProvider`; Vercel `MockLanguageModelV3` from `ai/test`) — NO real model/provider/API key. This isolated the variable being chosen (the agent-loop library's API shape) from the LLM. **Still unmeasured: real-model behavior** (streaming, tool-call parsing, latency, token cost) on pi — both libs wire a real path but neither exercised it. Production model/provider is a SEPARATE, still-open decision; default lean = latest Claude (Opus 4.8 / Sonnet 4.6) via pi's Anthropic adapter.

### OPEN — scope-model correction (raised by owner post-decision, NOT yet resolved)

Owner correction: **"the assistant is not centered but should act globally within the boundaries of draft."** This contradicts the v0.3 UI spec's _artifact-centered_ framing (sidebar bound to the current artifact). Corrected model (to be confirmed + designed): the assistant operates GLOBALLY across the whole artifact graph (multi-artifact sweeps), bounded by the DRAFT sandbox — the draft is the review/publish unit, not a single centered artifact; the center shows the draft's cross-artifact diff. This does NOT change the substrate decision (pi's session/draft-as-container strength leans further IN pi's favor under global+draft framing), but it DOES change the UI spec and likely the scenario framing. Resolve before writing the impl tickets. Do not re-spike unless the design surfaces a substrate question (unlikely).
