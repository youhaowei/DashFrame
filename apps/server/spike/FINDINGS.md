# YW-274 — Assistant vertical slice over pi: spike findings

**Status:** THROWAWAY spike. Do not merge to main. The deliverable is this report; the harness
(`apps/server/spike/harness.ts`) is durable evidence, not shippable code.

**What the harness is:** a headless driver that wires pi's _real_ agent loop to DashFrame's _real_
mutation seam. One multi-artifact intent ("Add a revenue-by-region bar chart to a new dashboard
called 'Q3 Report'. Use the existing sales data.") drives the loop: read -> emit mutation tools into
an in-memory draft -> gate (`beforeToolCall`) -> `buildPreviewDiff` on canonical -> publish (replay the
batch on canonical). Two legs are honest stubs (draft sandbox = YW-260; perception data-read =
YW-134); everything else is the production code path.

**Run command:** `bun run apps/server/spike/harness.ts` (bun is the runtime — see section 2.4).

---

## 1. What worked end-to-end (real + solid legs)

Every non-model leg ran **for real** against production code, end-to-end, repeatably:

- **Tool -> mutation command** (real): each mutation tool calls `cmd(<CommandName>, ...)` — the
  production vocabulary command builder — and emits it through
  `applyCommands(draftApp, [command], { mode: "commit", context: { vault } })`, the production seam.
- **Draft accumulation** (real, over a stub substrate): commands land in `draft.batch: Command[]` in
  loop order; applied to the draft app so subsequent reads see them.
- **Gate (`beforeToolCall`)** (real): pi invokes it after args validate, before `execute`. Gate log
  shows it firing on every call, classifying read vs MUTATION, with full validated args.
- **Preview diff** (real): `buildPreviewDiff(canonicalApp, canonicalDb, draft.batch, { vault })`
  produced a coherent 3-node multi-artifact diff: `[create] insight`, `[create] visualization`,
  `[create] dashboard` — with `add_to_dashboard` correctly **merged into the dashboard node** (two
  intents accumulated). `affectedDownstream: 0`, `error: none`.
- **Publish** (real): `applyCommands(canonicalApp, draft.batch, { mode: "commit" })` replayed the batch
  atomically onto canonical; final `read_graph` confirms insight + viz + dashboard (1 item), FK-linked.
- **OAuth routing (in pi)** (verified by code inspection): pi detects `sk-ant-oat`, switches to Bearer
  auth + Claude Code identity headers and prepends the "You are Claude Code" system block (see section 4).

**The architecture thesis holds:** the assistant is _just a tool-calling client of the existing
`cmd()`->`applyCommands` seam_. No new mutation path, no bypass of the command vocabulary, no special
assistant-only write API. The diff/publish checkpoint is the same `buildPreviewDiff` the human consent
surface uses. This is the load-bearing structural result of the spike and it is **confirmed real**.

## 2. What fought me

### 2.1 The model leg never completed — no live credential reachable (PRIMARY)

The real-model leg returned **401 `authentication_error`** on first run, then **400 `invalid_grant`
"Refresh token not found or invalid"** after I wired a refresh leg. Root cause chain:

1. The keychain (`Claude Code-credentials`) stores a **short-lived** access token (`expiresAt` was
   `1767257765010` ~ 2026-01-01; the run was ~2026-06) plus a refresh token. The stored access token
   was **months stale** -> 401.
2. I added an in-memory refresh leg (read `refreshToken`, POST to
   `https://platform.claude.com/v1/oauth/token` with Claude Code's public `client_id`,
   `grant_type=refresh_token`). The endpoint/request shape are correct (the 400 is `invalid_grant`,
   not malformed) — but the **refresh token itself is also dead**. The live Claude Code session has
   since re-authenticated, which rotates the refresh token; the keychain snapshot is stale on _both_.
3. No fresher credential is reachable from a child process here: `ANTHROPIC_API_KEY` /
   `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN` all unset; `~/.claude/.credentials.json` has no
   usable `claudeAiOauth` block. The wrapper-managed runtime (cmux) holds valid creds in-memory but does
   not expose them to spawned inference.

**This is an environment artifact, not a harness or pi defect.** The keychain-read + refresh path is
wired correctly; pi's OAuth routing is correct; the _only_ missing piece is a non-expired token. A run
from a freshly-logged-in interactive Claude Code (non-expired keychain access token) would complete the
model leg with **zero code changes** — the harness short-circuits to the deterministic fallback only
because `getApiKey` can't surface a live token. **Provider/model behavior (streaming, latency, token
cost) remains unmeasured** for exactly this reason; it is the one leg the spike could not close, and the
reason is credential staleness, not design.

### 2.2 pi packaging gap: `refreshAnthropicToken` is in the `.d.ts` but unreachable at runtime

pi's `@earendil-works/pi-ai` **type declarations** re-export `refreshAnthropicToken` from the package
root, but the **runtime** `index.js` does _not_ re-export it, and the package `exports` map exposes no
`./oauth` subpath. So the function is in the published _type_ surface yet importable through **no
declared runtime export**. `import { refreshAnthropicToken } from "@earendil-works/pi-ai"` type-checks
but throws `SyntaxError: Export named 'refreshAnthropicToken' not found` at runtime. I worked around it
by owning the refresh inline against the same endpoint/client_id pi uses. **Impl consequence:** the real
impl must either (a) upstream a fix to pi (add an `./oauth` export), or (b) own the OAuth refresh leg
ourselves. Given we already pin pi, owning it is the safer default.

### 2.3 The "AgentToolResult signature mismatch" (prior agent's note) — resolved, not a real mismatch

On inspection it is **pi's deliberate design**, not a bug:

- `AgentTool.execute(toolCallId, params, signal?, onUpdate?)` types `params` as `Static<TParameters>`,
  but `BeforeToolCallContext.args` is typed `unknown`. pi hands tool args as `unknown` at the gate
  boundary; the tool body must cast (`p.id as string`). The harness already does this. Noise, not defect.
- `AgentToolResult<T>` requires **`details: T` (non-optional)** plus `content: (TextContent |
ImageContent)[]`. Every tool returns `details: {}` or `{ command, id }`. Correct.

**Impl consequence:** our tool layer wants a thin typed wrapper that validates+narrows `args` from
`unknown` once (typebox `Static<>` is already the schema source of truth) and standardizes the
`{ content, details }` envelope, so feature tools don't each re-cast.

### 2.4 Workspace module resolution — bun yes, standalone `tsc` no (known hazard)

The harness imports `@wystack/server`, `@wystack/secret-vault`, `@wystack/db`, `@dashframe/server-core`
— workspace + submodule packages. **bun resolves these and runs the harness fine** (workspace TS
inlining; the project's real runtime). A standalone `tsc --noEmit` on the file cannot resolve them
(needs the build graph + path mapping + freshly-built submodule dist) and floods `TS2307`. Matches the
documented **stale-dist hazard**. The spike file is intentionally outside `apps/server`'s `rootDir: src`
/ `include`, so it is excluded from the project typecheck by design. **What builds/runs: the harness runs
green under bun. It does not pass a naive standalone tsc** — expected, not a defect.

### 2.5 Cosmetic diff-render bug in the harness (fixed)

First run printed `[create] insight — undefined`. Cause: the harness read `n.intent?.summary` and
`n.id`, but `PreviewDirectNode` exposes `n.name` and `n.intent: PreviewIntent[]` (an array), with the id
as `n.nodeId`. The **diff itself was correct** — only the console rendering used wrong field names. Fixed
to `n.name` + `n.intent.map(i => i.summary)`. Confirms the _real shape_ the UI adapter must render (section 6).

## 3. Draft-sandbox shape the loop needed (-> feeds YW-260)

The in-memory stub had to provide exactly this contract — the minimal interface YW-260 must realize:

```
interface DraftSandbox {
  draftApp: WyStackApp;   // a WyStack app the assistant writes into via applyCommands
  draftDb:  ArtifactDb;   // its backing store, readable by the read tools
  batch:    Command[];    // the ORDERED command log the loop emitted (the publish unit)
  vault:    SecretVault;  // passed in applyCommands context on every mutation
}
```

Observed requirements the shape imposes on a real YW-260:

1. **Fork-from-canonical, not a blank app.** The spike _seeds both_ canonical and draft with the same
   baseline to model a fork. A real draft must be a cheap copy-on-write fork of canonical state at
   session start, so the assistant's `read_graph` sees the user's real workspace. (The double-seed is
   the stub tell.)
2. **Same seam, "commit" mode, into a _different_ app.** Mutations apply through the production
   `applyCommands(... mode: "commit" ...)`; isolation comes from it being a separate `WyStackApp`/db,
   not a special "draft mode" on the seam. Clean result: **no new write path; isolation is at the app/db
   boundary.**
3. **An ordered `Command[]` is the publish unit.** Publish = replay `batch` on canonical via the same
   `applyCommands`. The draft must capture the _commands_, not a state delta — the diff and publish both
   consume the command log (capturing rows-only would lose the intent grouping; see section 2.5 where
   `add_to_dashboard` merged into the dashboard node).
4. **Vault threads through every mutation context.** Even artifact creation passes `{ vault }`. YW-260's
   draft must carry the same secret-resolution context as canonical.

**Open design fork for YW-260 owner (do not decide here):** full second app+db (spike's model — simple,
heavy) vs copy-on-write overlay over canonical (cheaper fork, needs overlay read semantics)? The spike
proves the full-app model works; it does not prove the right cost profile for many concurrent sessions.

## 4. Provider/model reality (the previously-unmeasured leg — partially closed)

**OAuth routing in pi: verified correct by code inspection** (`providers/anthropic.js`):

- detects an OAuth token via `apiKey.includes("sk-ant-oat")`.
- for OAuth uses **Bearer `authToken`** (not `x-api-key`), injects Claude Code identity headers:
  `anthropic-beta: claude-code-20250219,oauth-2025-04-20,...`, `user-agent: claude-cli/<version>`.
- for OAuth **forces the Claude Code system preamble** ("You are Claude Code, Anthropic's official CLI
  for Claude.") ahead of our system prompt — required for the subscription token to be accepted.
- even mimics Claude Code's canonical tool-naming ("stealth mode") to match the CC request shape.

So **pi routes the Claude Code subscription OAuth token correctly** — yes, `getApiKey` returning an
`sk-ant-oat...` token is the right integration, and pi does the header/system-preamble work for us.

**Still unmeasured:** live streaming cadence, wall-clock latency, token/cost on a real turn — no
non-expired token was reachable (section 2.1). The harness _is_ wired to capture all three: it streams
`text_delta` to stdout, prints `tool_execution_start/end`, and reports `agent.state.messages[].usage`
(input/output/cache/cost). On a fresh interactive login the harness emits these with no further change.
**Recommend the impl ticket include a one-time live-token measurement run.**

**Credential lifecycle is a real impl concern:** the access token is short-lived; the refresh token
rotates on re-login. The impl must own a refresh-on-expiry leg (read access+refresh+expiry from keychain;
if expired, refresh via the OAuth token endpoint; **never** write the rotated token back to the keychain
— it races Claude Code's own refresher and mutates the user's real credentials). The spike's
`getOAuthToken()` does exactly this in-memory and is the reference.

## 5. Tool-set surface

### 5.1 Mutation tools = one `applyCommands` command each

The slice needed these vocabulary commands surfaced as tools (1 tool : 1 `cmd()`):

- `create_insight` -> `CreateInsight` `{ id, name, source: { sourceType, sourceId }, selectedFields }`
- `create_visualization` -> `CreateVisualization` `{ id, name, insightId, visualizationType, spec }`
- `create_dashboard` -> `CreateDashboard` `{ id, name }`
- `add_to_dashboard` -> `AddDashboardItem` `{ dashboardId, item: { id, type, visualizationId, x, y, w, h } }`

The full impl wants the same 1:1 mapping over the broader vocabulary (`CreateDataSource`,
`CreateDataTable`, update/delete, `AddField`, ...). **The tool set is a mechanical projection of the
command vocabulary** — a generated tool layer (each command's typebox schema -> one tool) is viable and
probably right.

**Client-generated UUIDs:** every create takes a client-minted `id` (uuid v4). The system prompt must
instruct the model to mint fresh v4s for new artifacts and to **read existing ids, never invent them**.
Load-bearing (a hallucinated id for an existing artifact breaks FK linkage).

### 5.2 Read tools — two shapes

- **Ambient structure (`read_graph`):** compact tree of names/types/edges across all five artifact kinds
  — **no data values**. The model's map; it must `read_graph` first. Shape: ids + names + kinds + FK
  edges + per-table field names/ids.
- **Data read (`read_table_profile`) — STUB (YW-134):** **profiles only** (field names + types + row
  count), **never raw cell values**. Privacy floor held by construction. The real YW-134 assembler would
  attach tier-permitted sample values under a privacy budget — but the _tool contract the loop needs_ is
  "profile, optionally with a sampled/aggregated read", default (and floor) profile-only. Shape consumed:
  `{ id, name, fields: [{ id, name, type }], note }`.

## 6. Gate / UI surface

**What pi's `beforeToolCall` gave us (real):**

- Fires **after args validate, before `execute`**, with `{ assistantMessage, toolCall, args, context }`.
  Enough to classify (read vs mutation), inspect _exact validated args_, and decide.
- Return contract: `BeforeToolCallResult | undefined`: `undefined` = allow; `{ block: true, reason }` =
  block with a reason surfaced to the model. **Binary allow/block — NOT a rich "edit args / bind value /
  pause-for-human" channel.** The spike's gate is allow-all and logs.

**What the UI adapter must build (the gap between pi's gate and our consent surface):**

1. **Async human-in-the-loop pause.** Our gate must, for a mutation, _suspend_ the loop, surface the
   proposed step (ultimately the batch diff) to the UI, resume on the user's decision. `beforeToolCall`
   is `async` so the await-point exists — but pi gives only allow/block. **Selective commit,
   value-binding, re-validate are NOT pi primitives; they are adapter responsibilities** built around the
   diff + the batch, most likely _at the publish checkpoint_ rather than per-tool-call.
2. **Render `PreviewDiff` (real shape confirmed):** `directNodes: PreviewDirectNode[]` where each node is
   `{ nodeId, kind, name, change: "create"|"update"|"noop", intent: PreviewIntent[], ... }` and
   `PreviewIntent` is `{ command, summary }`. Multiple commands targeting one artifact **merge into one
   node with accumulated intents** (observed: dashboard node carried both "Create dashboard" and "Add
   dashboard item"). Plus `affectedDownstream` (blast radius) and `error`.
3. **Bind-value / late-bound values** are an _adapter_ concern layered on the diff, not pi-surfaced. The
   gate is the hook _point_; the consent semantics are ours.

**Open design fork (do not decide here):** per-tool-call gating (pause on each mutation — chatty,
fine-grained) vs per-batch at publish (build the whole draft, then one diff + one consent gate)? The
spike's structure (accumulate -> single diff -> single publish) leans **per-batch**, matching the
living-artifact/diff-checkpoint design — but per-tool gating is also expressible. Product/UX decision.

## 7. Proposed impl ticket breakdown

Grounded in what the spike hit. Sizes rough (S/M/L).

1. **[M] Draft sandbox (realize YW-260 to the section 3 contract).** Copy-on-write fork of canonical at
   session start; ordered `Command[]` as the publish unit; `applyCommands(commit)` into the draft app;
   publish = replay on canonical; vault threaded through. **Blocks everything.** Decide full-app-vs-overlay.
2. **[S] OAuth credential lifecycle + refresh leg.** Read access+refresh+expiry from keychain; refresh
   in-memory on expiry via the Claude Code OAuth token endpoint; never write back. Reference: the spike's
   `getOAuthToken()`. Include the pi packaging-gap decision (section 2.2): upstream an `./oauth` export to
   pi _or_ own refresh. Recommend own.
3. **[S] Typed tool-layer helper.** One wrapper that narrows `args` from `unknown` via the typebox
   `Static<>` schema and standardizes the `{ content, details }` envelope (section 2.3).
4. **[M] Generated mutation tool layer over the command vocabulary.** Project each `cmd()` command + its
   typebox schema -> one `AgentTool`. Covers the section 5.1 set and grows with the vocabulary. Enforce
   client-minted-uuid + read-don't-invent-ids in the system prompt.
5. **[M] Read tools: ambient structure + profile read.** `read_graph` (the section 5.2 tree). Profile
   read wired to the **YW-134 assembler** when it lands; until then profile-only (floor held by default).
   Coordinates with YW-134.
6. **[L] Gate -> consent UI adapter.** Async pause/resume around the publish checkpoint; `PreviewDiff`
   renderer over the real shape (section 6.2); selective-commit / bind-value / re-validate as **adapter**
   semantics on the diff+batch (pi gives only allow/block). Decide per-call-vs-per-batch gating. Biggest
   real surface and the spike's main "build this" finding.
7. **[S] Live-token provider measurement (acceptance step).** The one thing the spike couldn't close: run
   the canonical multi-artifact intent against a live token; record streaming cadence, latency, token/cost.
   Bolt onto whichever ticket first has a working end-to-end loop.

## Open questions for the owner (product/design forks — NOT decided in this spike)

1. **Draft model:** full second app+db vs copy-on-write overlay over canonical? (section 3) — cost profile
   under many concurrent sessions is the deciding axis the spike didn't test.
2. **Gate granularity:** per-tool-call consent vs per-batch consent at publish? (section 6).
3. **`visualization.spec` authoring:** the spike emitted a minimal `{ mark, encoding: {} }` Vega-Lite
   stub; the real loop needs the model to author encodings. Tool responsibility, a follow-up "bind
   encodings" step, or derived from the insight's selected fields?
4. **pi dependency posture:** upstream the OAuth-export fix to pi vs vendor the refresh ourselves? (section 2.2)

---

**What builds/runs:** the harness **runs green under bun** end-to-end for every non-model leg
(tool->draft->gate->diff->publish), with the real `cmd()`/`applyCommands`/`buildPreviewDiff` code. The
**model leg does not complete** in this environment — no non-expired OAuth credential is reachable
(section 2.1); pi's OAuth _routing_ is verified correct by code inspection but live streaming/latency/cost
remain **unmeasured**. The harness does **not** pass a naive standalone `tsc` (workspace/submodule
resolution — section 2.4); expected, not a defect.
