/**
 * YW-274 SPIKE — assistant vertical slice over pi (THROWAWAY).
 *
 * Headless harness that drives pi's real agent loop against:
 *   - a REAL Anthropic model (Claude), authenticated via the local Claude Code
 *     subscription OAuth token (sk-ant-oat…) read from the macOS Keychain at
 *     runtime and passed through pi's `getApiKey` hook. NEVER persisted/committed.
 *   - the REAL DashFrame mutation seam (cmd() -> applyCommands) and the REAL
 *     preview-diff checkpoint (buildPreviewDiff), over a real in-memory artifact DB.
 *
 * Two STUBS, reported as findings (not presented as real):
 *   1. Draft sandbox (YW-260 not built) — modelled in-memory as a second
 *      ArtifactDb/app the assistant writes into; publish = replay the batch on
 *      the canonical app. The SHAPE this needed is a primary finding.
 *   2. Perception data-read (YW-134 assembler not built) — the data-read tool
 *      returns column PROFILES only (names/types/row counts), never raw
 *      floor-protected cell values. Honours the privacy floor; reports the gap.
 *
 * This is a SPIKE. It reaches; it does not polish.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import {
  openArtifactDb,
  schema,
  type ArtifactDb,
} from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import {
  applyCommands,
  createWyStack,
  type Command,
  type WyStackApp,
} from "@wystack/server";

import { functions } from "../src/functions";
import { cmd } from "../src/functions/commands";
import { buildPreviewDiff } from "../src/functions/preview-diff";

const { dataSources, dataTables, insights, visualizations, dashboards } =
  schema;

// ───────────────────────────────────────────────────────────────────────────
// Credential: read the Claude Code subscription OAuth token from the keychain.
// pi routes sk-ant-oat… through its OAuth path (Claude Code identity headers).
// ───────────────────────────────────────────────────────────────────────────
interface KeychainOAuth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

function readKeychainOAuth(): KeychainOAuth {
  const raw = execFileSync(
    "security",
    [
      "find-generic-password",
      "-s",
      "Claude Code-credentials",
      "-a",
      "root",
      "-w",
    ],
    { encoding: "utf-8" },
  ).trim();
  const o = JSON.parse(raw)?.claudeAiOauth as KeychainOAuth | undefined;
  if (!o?.accessToken)
    throw new Error("no claudeAiOauth.accessToken in keychain");
  return o;
}

/**
 * Returns a LIVE Claude Code OAuth access token (sk-ant-oat…), refreshing it
 * in-memory via pi's `refreshAnthropicToken` when the keychain copy is expired.
 *
 * FINDING (the load-bearing seam): the keychain stores the SHORT-LIVED access
 * token + a long-lived refresh token + an `expiresAt`. The stored access token
 * is routinely stale (it expires ~hourly while CC refreshes silently). A naive
 * read → 401. The real impl needs a refresh leg. We DO NOT write the refreshed
 * token back to the keychain (would mutate the user's real CC credentials and
 * race CC's own refresher) — the refreshed token lives only in this process.
 */
async function getOAuthToken(): Promise<string> {
  const kc = readKeychainOAuth();
  const fresh = typeof kc.expiresAt === "number" && Date.now() < kc.expiresAt;
  if (fresh) return kc.accessToken!;
  if (!kc.refreshToken) {
    throw new Error("keychain token expired and no refreshToken present");
  }
  process.stderr.write(
    `[oauth] keychain access token expired (expiresAt=${kc.expiresAt}); ` +
      `refreshing in-memory…\n`,
  );
  return refreshAccessToken(kc.refreshToken);
}

/**
 * FINDING (pi packaging gap): pi DOES implement the refresh
 * (`refreshAnthropicToken`) and its `.d.ts` re-exports it from the package
 * root — but the runtime `exports` map does NOT, and there is no subpath for
 * the oauth utils, so it is UNREACHABLE at runtime through any declared export.
 * The real impl must either (a) get pi to add an `./oauth` export, or (b) own
 * the refresh. Here we own it, against the same Claude Code OAuth endpoint pi
 * uses (CLIENT_ID is Claude Code's public client id; values lifted verbatim
 * from pi's anthropic.js so this stays faithful to what pi would do).
 */
const CLAUDE_CODE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLAUDE_CODE_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token)
    throw new Error("refresh response had no access_token");
  return data.access_token;
}

// ───────────────────────────────────────────────────────────────────────────
// A minimal in-memory DRAFT SANDBOX (YW-260 stub).
// The assistant's tools write here; publish replays the captured batch onto
// the canonical app. We capture the ordered Command[] the loop emitted so we
// can (a) preview-diff it and (b) publish it atomically.
// ───────────────────────────────────────────────────────────────────────────
interface DraftSandbox {
  draftApp: WyStackApp;
  draftDb: ArtifactDb;
  /** Ordered commands the assistant has emitted into the draft, in loop order. */
  batch: Command[];
  vault: SecretVault;
}

function makeVault(): SecretVault {
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend(), { fallback: true });
  registry.setClassDefault("connector-key", "test");
  return new SecretVault(registry, new InMemoryMappingStore());
}

// ───────────────────────────────────────────────────────────────────────────
// READ TOOLS
// ───────────────────────────────────────────────────────────────────────────

/** Ambient graph-structure read: compact tree of names/types/edges. No data. */
async function readGraph(db: ArtifactDb): Promise<string> {
  const [srcs, tbls, ins, viz, dash] = await Promise.all([
    db.select().from(dataSources),
    db.select().from(dataTables),
    db.select().from(insights),
    db.select().from(visualizations),
    db.select().from(dashboards),
  ]);
  const tree = {
    dataSources: srcs.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
    dataTables: tbls.map((t) => ({
      id: t.id,
      name: t.name,
      dataSourceId: t.dataSourceId,
      fields: (t.fields as { id: string; name: string }[]).map((f) => ({
        id: f.id,
        name: f.name,
      })),
    })),
    insights: ins.map((i) => ({
      id: i.id,
      name: i.name,
      source: (i.definition as { source?: unknown }).source,
    })),
    visualizations: viz.map((v) => ({
      id: v.id,
      name: v.name,
      insightId: v.insightId,
      chartType: v.chartType,
    })),
    dashboards: dash.map((d) => ({
      id: d.id,
      name: d.name,
      items: ((d.layout as { visualizationId?: string }[]) ?? []).length,
    })),
  };
  return JSON.stringify(tree, null, 2);
}

/**
 * Data read (YW-134 stub): PROFILES ONLY — column names/types/row count.
 * NEVER returns raw cell values (privacy floor held in the spike).
 */
async function readTableProfile(
  db: ArtifactDb,
  tableId: string,
): Promise<string> {
  const [t] = await db
    .select()
    .from(dataTables)
    .where((await import("@wystack/db")).eq("id", tableId));
  if (!t) return `table ${tableId} not found`;
  return JSON.stringify(
    {
      id: t.id,
      name: t.name,
      // STUB: profiles only. The real YW-134 assembler would attach
      // tier-permitted sample values under a privacy budget. Here: schema only.
      fields: (t.fields as { id: string; name: string; type?: string }[]).map(
        (f) => ({ id: f.id, name: f.name, type: f.type ?? "unknown" }),
      ),
      note: "PROFILE ONLY — raw values withheld (YW-134 assembler stub)",
    },
    null,
    2,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// MUTATION TOOLS — each emits a cmd() into the draft batch (TRANSPARENT) and
// applies it to the draft app (so subsequent reads see it). NOTHING touches
// canonical until publish.
// ───────────────────────────────────────────────────────────────────────────
function makeTools(draft: DraftSandbox): AgentTool[] {
  const emit = async (command: Command, label: string) => {
    // VERIFIABLE: apply to the draft app through the real seam, in commit mode
    // (the draft IS the sandbox; canonical is a different app).
    await applyCommands(draft.draftApp, [command], {
      mode: "commit",
      context: { vault: draft.vault },
    });
    draft.batch.push(command);
    return label;
  };

  const readGraphTool: AgentTool = {
    name: "read_graph",
    label: "Read workspace graph",
    description:
      "Read the entire artifact graph structure (data sources, tables, insights, visualizations, dashboards) as a compact tree. Names, types, and edges only — no data values.",
    parameters: Type.Object({}),
    execute: async () => {
      const tree = await readGraph(draft.draftDb);
      return { content: [{ type: "text", text: tree }], details: {} };
    },
  };

  const readProfileTool: AgentTool = {
    name: "read_table_profile",
    label: "Read table profile",
    description:
      "Read a data table's column profile (field names + types + row count). Returns NO raw cell values.",
    parameters: Type.Object({
      tableId: Type.String({ description: "DataTable id" }),
    }),
    execute: async (_id, { tableId }) => {
      const text = await readTableProfile(draft.draftDb, tableId as string);
      return { content: [{ type: "text", text }], details: {} };
    },
  };

  const createInsightTool: AgentTool = {
    name: "create_insight",
    label: "Create insight",
    description:
      "Create a new insight (a query/transform) over a data table. selectedFields are field ids to project.",
    parameters: Type.Object({
      id: Type.String({ description: "client-generated uuid for the insight" }),
      name: Type.String(),
      sourceTableId: Type.String({
        description: "DataTable id to source from",
      }),
      selectedFields: Type.Array(Type.String(), { default: [] }),
    }),
    execute: async (_id, p) => {
      const label = await emit(
        cmd("CreateInsight", {
          id: p.id as string,
          name: p.name as string,
          source: {
            sourceType: "dataTable",
            sourceId: p.sourceTableId as string,
          },
          selectedFields: (p.selectedFields as string[]) ?? [],
        }),
        `created insight "${p.name}"`,
      );
      return {
        content: [{ type: "text", text: label }],
        details: { command: "CreateInsight", id: p.id },
      };
    },
  };

  const createVizTool: AgentTool = {
    name: "create_visualization",
    label: "Create visualization",
    description:
      "Create a chart over an insight. visualizationType e.g. 'bar' | 'line' | 'area'.",
    parameters: Type.Object({
      id: Type.String({ description: "client-generated uuid for the viz" }),
      name: Type.String(),
      insightId: Type.String(),
      visualizationType: Type.String(),
    }),
    execute: async (_id, p) => {
      const label = await emit(
        cmd("CreateVisualization", {
          id: p.id as string,
          name: p.name as string,
          insightId: p.insightId as string,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          visualizationType: p.visualizationType as any,
          // Minimal valid Vega-Lite spec; encoding wired separately in real impl.
          spec: { mark: p.visualizationType, encoding: {} } as any,
        }),
        `created ${p.visualizationType} chart "${p.name}"`,
      );
      return {
        content: [{ type: "text", text: label }],
        details: { command: "CreateVisualization", id: p.id },
      };
    },
  };

  const addToDashboardTool: AgentTool = {
    name: "add_to_dashboard",
    label: "Add visualization to dashboard",
    description:
      "Place a visualization tile on a dashboard at a grid position. Create the dashboard first if it does not exist (create_dashboard).",
    parameters: Type.Object({
      dashboardId: Type.String(),
      itemId: Type.String({
        description: "client-generated uuid for the tile",
      }),
      visualizationId: Type.String(),
      x: Type.Number({ default: 0 }),
      y: Type.Number({ default: 0 }),
      width: Type.Number({ default: 6 }),
      height: Type.Number({ default: 4 }),
    }),
    execute: async (_id, p) => {
      const label = await emit(
        cmd("AddDashboardItem", {
          dashboardId: p.dashboardId as string,
          item: {
            id: p.itemId as string,
            type: "visualization",
            visualizationId: p.visualizationId as string,
            x: p.x as number,
            y: p.y as number,
            width: p.width as number,
            height: p.height as number,
          },
        }),
        `placed viz on dashboard`,
      );
      return {
        content: [{ type: "text", text: label }],
        details: { command: "AddDashboardItem", id: p.itemId },
      };
    },
  };

  const createDashboardTool: AgentTool = {
    name: "create_dashboard",
    label: "Create dashboard",
    description: "Create a new (empty) dashboard.",
    parameters: Type.Object({
      id: Type.String({ description: "client-generated uuid" }),
      name: Type.String(),
    }),
    execute: async (_id, p) => {
      const label = await emit(
        cmd("CreateDashboard", { id: p.id as string, name: p.name as string }),
        `created dashboard "${p.name}"`,
      );
      return {
        content: [{ type: "text", text: label }],
        details: { command: "CreateDashboard", id: p.id },
      };
    },
  };

  return [
    readGraphTool,
    readProfileTool,
    createInsightTool,
    createVizTool,
    createDashboardTool,
    addToDashboardTool,
  ];
}

// ───────────────────────────────────────────────────────────────────────────
// MAIN — wire pi, drive ONE multi-artifact intent, gate, diff, publish.
// ───────────────────────────────────────────────────────────────────────────
async function main() {
  const dir = mkdtempSync(join(tmpdir(), "yw274-"));
  const canonicalDb = await openArtifactDb({ path: join(dir, "canonical.db") });
  const draftDb = await openArtifactDb({ path: join(dir, "draft.db") });
  const canonicalApp = await createWyStack({ db: canonicalDb, functions });
  const draftApp = await createWyStack({ db: draftDb, functions });
  const vault = makeVault();

  // ── Seed shared baseline state into BOTH canonical and draft (a real draft
  //    would fork from canonical; we seed both to model that fork). ──────────
  const SRC = crypto.randomUUID();
  const TBL = crypto.randomUUID();
  const F_REGION = crypto.randomUUID();
  const F_REVENUE = crypto.randomUUID();
  for (const app of [canonicalApp, draftApp]) {
    await applyCommands(
      app,
      [
        cmd("CreateDataSource", { id: SRC, type: "csv", name: "Sales CSV" }),
        cmd("CreateDataTable", {
          id: TBL,
          dataSourceId: SRC,
          name: "sales",
          table: "sales.csv",
          fields: [
            { id: F_REGION, name: "region", type: "string" } as any,
            { id: F_REVENUE, name: "revenue", type: "number" } as any,
          ],
          metrics: [],
        }),
      ],
      { mode: "commit", context: { vault } },
    );
  }

  const draft: DraftSandbox = { draftApp, draftDb, batch: [], vault };
  const tools = makeTools(draft);

  // ── The GATE. pi calls beforeToolCall after args validate, before execute. ──
  const gateLog: string[] = [];
  const agent = new Agent({
    initialState: {
      systemPrompt: [
        "You are the DashFrame report assistant. You build report artifacts",
        "(insights, visualizations, dashboards) by calling tools. Each tool is",
        "a single mutation command. Always read_graph first to learn the",
        "workspace. Use the existing data source/table; do not invent ids for",
        "things that already exist — read them. Generate fresh uuids (v4) for",
        "NEW artifacts you create. When done, briefly summarize what you built.",
      ].join(" "),
      model: getModel("anthropic", "claude-haiku-4-5"),
      tools,
    },
    getApiKey: async () => getOAuthToken(),
    beforeToolCall: async ({ toolCall, args }) => {
      const isMutation = [
        "create_insight",
        "create_visualization",
        "create_dashboard",
        "add_to_dashboard",
      ].includes(toolCall.name);
      gateLog.push(
        `[gate] ${isMutation ? "MUTATION" : "read"} ${toolCall.name} ${JSON.stringify(args)}`,
      );
      // SPIKE policy: allow all. A real gate would, for mutations, surface the
      // plan step to the UI and await per-node commit/bind decisions here.
      return undefined;
    },
  });

  // ── Transcript streaming (the "watch it build" leg). ────────────────────────
  agent.subscribe((event) => {
    if (event.type === "agent_end" || event.type === "turn_end") {
      // surface any swallowed error
      if (agent.state.errorMessage) {
        process.stderr.write(`\n[ERROR EVENT] ${agent.state.errorMessage}\n`);
      }
    }
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
    if (event.type === "tool_execution_start") {
      process.stdout.write(
        `\n  → ${event.toolName}(${JSON.stringify(event.args)})\n`,
      );
    }
    if (event.type === "tool_execution_end") {
      const d = event.result?.details as { command?: string } | undefined;
      if (d?.command) process.stdout.write(`    ✓ ${d.command}\n`);
    }
  });

  // ── Drive the ONE real multi-artifact intent. ───────────────────────────────
  const t0 = Date.now();
  console.log("\n========== PROMPT ==========");
  const intent =
    "Add a revenue-by-region bar chart to a new dashboard called 'Q3 Report'. " +
    "Use the existing sales data.";
  console.log(intent + "\n\n========== LOOP ==========");
  await agent.prompt(intent);
  let elapsed = Date.now() - t0;

  // ── FALLBACK: if the real model leg couldn't run (no live credential), drive
  //    the SAME tools deterministically so every non-model leg (tool→draft→gate
  //    →diff→publish) is still exercised for real. The model would emit exactly
  //    these tool calls; we invoke the tool `execute` fns directly (which run the
  //    gate-equivalent emit() through applyCommands and capture the batch).
  if (draft.batch.length === 0 && agent.state.errorMessage) {
    console.log(
      `\n[real model unavailable: ${agent.state.errorMessage.slice(0, 60)}…]`,
    );
    console.log(
      "[driving the tool set DETERMINISTICALLY — non-model legs are real]\n",
    );
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    const INS = crypto.randomUUID();
    const VIZ = crypto.randomUUID();
    const DASH = crypto.randomUUID();
    const ITEM = crypto.randomUUID();
    const scripted: { tool: string; args: Record<string, unknown> }[] = [
      { tool: "read_graph", args: {} },
      {
        tool: "create_insight",
        args: {
          id: INS,
          name: "Revenue by region",
          sourceTableId: TBL,
          selectedFields: [F_REGION, F_REVENUE],
        },
      },
      {
        tool: "create_visualization",
        args: {
          id: VIZ,
          name: "Revenue by region (bar)",
          insightId: INS,
          visualizationType: "bar",
        },
      },
      { tool: "create_dashboard", args: { id: DASH, name: "Q3 Report" } },
      {
        tool: "add_to_dashboard",
        args: {
          dashboardId: DASH,
          itemId: ITEM,
          visualizationId: VIZ,
          x: 0,
          y: 0,
          width: 6,
          height: 4,
        },
      },
    ];
    const ts = Date.now();
    for (const step of scripted) {
      // GATE: run the same beforeToolCall policy the agent would.
      await (agent.beforeToolCall as NonNullable<typeof agent.beforeToolCall>)({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        toolCall: { type: "toolCall", name: step.tool } as any,
        args: step.args,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assistantMessage: {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        context: {} as any,
      });
      const res = await byName[step.tool]!.execute(
        crypto.randomUUID(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        step.args as any,
      );
      const text = res.content.map((c) => ("text" in c ? c.text : "")).join("");
      console.log(`  → ${step.tool}  ${text.split("\n")[0].slice(0, 60)}`);
    }
    elapsed = Date.now() - ts;
  }

  console.log("\n\n========== GATE LOG ==========");
  for (const g of gateLog) console.log(g);

  // ── The DIFF checkpoint — preview the captured draft batch on CANONICAL. ────
  console.log("\n========== PREVIEW DIFF (canonical) ==========");
  console.log(`draft batch length: ${draft.batch.length}`);
  if (draft.batch.length > 0) {
    try {
      const diff = await buildPreviewDiff(
        canonicalApp,
        canonicalDb,
        draft.batch,
        {
          vault,
        },
      );
      console.log(`directNodes: ${diff.directNodes.length}`);
      for (const n of diff.directNodes) {
        const intents = n.intent.map((i) => i.summary).join("; ");
        console.log(`  [${n.change}] ${n.kind} "${n.name}" — ${intents}`);
      }
      console.log(`affectedDownstream: ${diff.affectedDownstream.length}`);
      console.log(`error: ${diff.error ? JSON.stringify(diff.error) : "none"}`);

      // ── PUBLISH — replay the batch atomically on canonical. ──────────────
      console.log("\n========== PUBLISH (commit to canonical) ==========");
      await applyCommands(canonicalApp, draft.batch, {
        mode: "commit",
        context: { vault },
      });
      console.log("published. canonical graph now:");
      console.log(await readGraph(canonicalDb));
    } catch (err) {
      console.log("preview/publish FAILED:", (err as Error).message);
    }
  }

  // ── Token / latency reporting. ──────────────────────────────────────────────
  console.log("\n========== PROVIDER REALITY ==========");
  console.log(`wall-clock: ${elapsed}ms`);
  const msgs = agent.state.messages;
  const usage = msgs
    .map(
      (m) =>
        (m as { usage?: { inputTokens?: number; outputTokens?: number } })
          .usage,
    )
    .filter(Boolean);
  console.log(`assistant turns with usage: ${usage.length}`);
  console.log(`usage: ${JSON.stringify(usage)}`);

  await canonicalDb.$client.close();
  await draftDb.$client.close();
  rmSync(dir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error("\nHARNESS ERROR:", e);
  process.exit(1);
});
