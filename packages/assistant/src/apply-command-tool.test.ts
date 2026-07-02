/**
 * Tests for `createApplyCommandTool` — the assistant's generic mutation tool.
 *
 * Contracts verified:
 *   1. A well-formed call appends exactly one command to the draft and returns
 *      the handler value in `details.commandResult`.
 *   2. A malformed/unknown command type propagates the error honestly — no
 *      silent swallow, no false success.
 *   3. Canonical is NEVER touched — only `appendToDraft` is called on the
 *      controller, never `publishDraft`.
 *   4. Multi-command sequence: repeated calls append commands in order, each
 *      landing in the same draft (draftId immutable per factory, canonical
 *      untouched until publish).
 *   5. `executionMode` is "sequential" (mutating — serialised against the batch).
 *   6. `buildCommand` receives the exact (type, args) pair from execute params —
 *      no silent mutation or drop.
 *   7. A result-count mismatch from `appendToDraft` is a host contract
 *      violation and throws rather than silently returning null/dropping extras.
 *   8. DeleteNode is DENIED at the allow-list gate — no vault call, no append.
 *   9. Unlisted arbitrary command types are DENIED at the gate (default-deny).
 *  10. Draft-safe artifact commands (CreateInsight, etc.) pass the gate and
 *      append normally.
 *  11. Credential commands (CreateDataSource, SetDataSourceConfig) are allowed
 *      with PLAINTEXT credentials, but a caller-supplied ref-shaped credential
 *      is REJECTED at the credential-ref gate — before buildCommand / append —
 *      so the agent cannot adopt a foreign/arbitrary vault ref.
 */

import { describe, expect, it, vi } from "vitest";
import type { AssistantCommand, DraftAppender } from "./apply-command-tool.js";
import { createApplyCommandTool } from "./apply-command-tool.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal DraftAppender spy for test isolation. */
function makeMockController(overrides?: {
  appendResult?: Array<{ id?: string; value: unknown }>;
  appendError?: Error;
}): DraftAppender & {
  appendCalls: Array<{
    draftId: string;
    batch: AssistantCommand[];
    context?: Record<string, unknown>;
  }>;
} {
  const appendCalls: Array<{
    draftId: string;
    batch: AssistantCommand[];
    context?: Record<string, unknown>;
  }> = [];

  return {
    appendCalls,
    async appendToDraft(draftId, batch, context) {
      appendCalls.push({ draftId, batch, context });
      if (overrides?.appendError) {
        throw overrides.appendError;
      }
      return overrides?.appendResult ?? [{ value: { ok: true } }];
    },
  };
}

/**
 * A minimal buildCommand stub that maps `"CreateFoo"` → `{ path: "createFoo", args }`.
 * Throws for unknown types (mirrors the required host behavior — cmd() is
 * compile-time-only typed and silently produces { path: undefined } for unknown
 * names; the host's buildCommand wrapper must guard this).
 */
function makeBuildCommand(knownCommands: Record<string, string>) {
  return (type: string, args: unknown): AssistantCommand => {
    const path = knownCommands[type];
    if (!path) {
      throw new Error(
        `applyCommand: unknown command type "${type}". ` +
          `Known commands: ${Object.keys(knownCommands).join(", ")}`,
      );
    }
    return { path, args };
  };
}

const TEST_COMMANDS: Record<string, string> = {
  CreateInsight: "createInsightCmd",
  CreateVisualization: "createVisualizationCmd",
  AddDashboardItem: "addDashboardItemCmd",
  CreateDashboard: "createDashboardCmd",
  CreateDataSource: "createDataSourceCmd",
  SetDataSourceConfig: "setDataSourceConfigCmd",
};

const buildCommand = makeBuildCommand(TEST_COMMANDS);

// ---------------------------------------------------------------------------
// 1. Happy path — correct call appends to draft and returns handler value
// ---------------------------------------------------------------------------

describe("createApplyCommandTool — happy path", () => {
  it("appends exactly one command to the draft and echoes the handler value", async () => {
    const controller = makeMockController({
      appendResult: [{ value: { id: "insight-001" } }],
    });
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-abc",
      buildCommand,
    });

    const result = await tool.execute("call-1", {
      type: "CreateInsight",
      args: {
        id: "insight-001",
        name: "Revenue trend",
        source: { sourceType: "dataTable", sourceId: "tbl-x" },
      },
    });

    // Exactly one appendToDraft call.
    expect(controller.appendCalls).toHaveLength(1);

    const call = controller.appendCalls[0]!;
    // draftId is the one minted at session open — not controlled per-call.
    expect(call.draftId).toBe("draft-abc");
    // Batch has exactly one command.
    expect(call.batch).toHaveLength(1);
    // The command path was resolved from the command name via buildCommand.
    expect(call.batch[0]!.path).toBe("createInsightCmd");

    // Result details echo the command type and handler value.
    expect(result.details.commandType).toBe("CreateInsight");
    expect(result.details.commandResult).toEqual({ id: "insight-001" });
    // Content is non-empty text.
    expect(result.content[0]?.type).toBe("text");
  });

  it("does not fail a successful append when result text is not JSON-serializable", async () => {
    const controller = makeMockController({
      appendResult: [{ value: 1n }],
    });
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-bigint",
      buildCommand,
    });

    const result = await tool.execute("call-bigint", {
      type: "CreateDashboard",
      args: { id: "dash-bigint", name: "BigInt result" },
    });

    expect(controller.appendCalls).toHaveLength(1);
    expect(result.details.commandType).toBe("CreateDashboard");
    expect(result.details.commandResult).toBe(1n);
    expect(result.content[0]?.type).toBe("text");
    const textContent = result.content[0];
    expect(textContent?.type).toBe("text");
    if (textContent?.type !== "text") {
      throw new Error("expected text content");
    }
    expect(textContent.text).toContain("[unserializable result]");
  });

  it("passes the exact (type, args) pair to buildCommand unchanged", async () => {
    const controller = makeMockController();
    const buildCommandSpy = vi.fn(buildCommand);
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-spy",
      buildCommand: buildCommandSpy,
    });

    const args = {
      id: "i-1",
      name: "Revenue",
      source: { sourceType: "dataTable", sourceId: "t-1" },
    };
    await tool.execute("call-spy", { type: "CreateInsight", args });

    // buildCommand was called exactly once with the original (type, args).
    expect(buildCommandSpy).toHaveBeenCalledOnce();
    expect(buildCommandSpy).toHaveBeenCalledWith("CreateInsight", args);
  });

  it("passes optional context through to appendToDraft", async () => {
    const controller = makeMockController();
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-xyz",
      buildCommand,
      context: { sessionId: "sess-1", vault: { kind: "stub" } },
    });

    await tool.execute("call-ctx", {
      type: "CreateDashboard",
      args: { id: "dash-001", name: "Overview" },
    });

    expect(controller.appendCalls[0]?.context).toMatchObject({
      sessionId: "sess-1",
      vault: { kind: "stub" },
    });
  });

  it("passes context as undefined when the factory is created without one", async () => {
    const controller = makeMockController();
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-noctx",
      buildCommand,
    });

    await tool.execute("call-noctx", {
      type: "CreateDashboard",
      args: { id: "dash-002", name: "No context" },
    });

    expect(controller.appendCalls[0]?.context).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Validation / error propagation — NO silent failure
// ---------------------------------------------------------------------------

describe("createApplyCommandTool — error propagation", () => {
  it("propagates an unknown command type as a thrown error (no canonical write)", async () => {
    const controller = makeMockController();
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-err",
      buildCommand,
    });

    // An unknown type must throw — no false success, no canonical write.
    // The allow-list gate fires BEFORE buildCommand, so the error comes from
    // the gate ("not draft-safe") rather than from buildCommand.
    await expect(
      tool.execute("call-bad-type", {
        type: "NonExistentCommand",
        args: {},
      }),
    ).rejects.toThrow(/not draft-safe/);

    // appendToDraft was NOT called (gate rejected before reaching appendToDraft).
    expect(controller.appendCalls).toHaveLength(0);
  });

  it("propagates a mutation validation error from appendToDraft (malformed args)", async () => {
    const controller = makeMockController({
      appendError: new Error("CreateInsight: source is invalid: Required"),
    });
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-err2",
      buildCommand,
    });

    // The error from the mutation handler must surface unchanged.
    await expect(
      tool.execute("call-bad-args", {
        type: "CreateInsight",
        args: { id: "i-1", name: "Bad" /* missing source */ },
      }),
    ).rejects.toThrow("CreateInsight: source is invalid");

    // appendToDraft was called (the command got that far — the mutation rejected it).
    expect(controller.appendCalls).toHaveLength(1);
  });

  it("throws when appendToDraft returns an empty array (host contract violation)", async () => {
    const controller = makeMockController({ appendResult: [] });
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-empty",
      buildCommand,
    });

    // An empty result array is a DraftAppender contract violation — the tool
    // must throw rather than silently returning commandResult: null, which
    // would look like success to the agent and hide a broken host.
    await expect(
      tool.execute("call-empty", {
        type: "CreateDashboard",
        args: { id: "dash-003", name: "Ghost" },
      }),
    ).rejects.toThrow(/appendToDraft returned 0 results for 1 command/);
  });

  it("throws when appendToDraft returns extra results for one command", async () => {
    const controller = makeMockController({
      appendResult: [{ value: { ok: 1 } }, { value: { ok: 2 } }],
    });
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-extra",
      buildCommand,
    });

    await expect(
      tool.execute("call-extra", {
        type: "CreateDashboard",
        args: { id: "dash-extra", name: "Extra" },
      }),
    ).rejects.toThrow(/appendToDraft returned 2 results for 1 command/);
  });

  it("does NOT call publishDraft — canonical is never touched", async () => {
    const controller = makeMockController();
    // Add a publishDraft spy on the mock — should never be called.
    const publishSpy = vi.fn();
    const controllerWithPublish = {
      ...controller,
      publishDraft: publishSpy,
    };

    const tool = createApplyCommandTool({
      controller: controllerWithPublish,
      draftId: "draft-pub-check",
      buildCommand,
    });

    await tool.execute("call-pub", {
      type: "CreateVisualization",
      args: {
        id: "v-1",
        name: "Chart",
        insightId: "i-1",
        visualizationType: "bar",
        spec: {},
      },
    });

    expect(publishSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Multi-command sequence — all land in the same draft, canonical untouched
// ---------------------------------------------------------------------------

describe("createApplyCommandTool — multi-command drive loop", () => {
  it("a multi-step intent (CreateInsight + CreateVisualization + AddDashboardItem) all land in the same draft", async () => {
    // Override the single default result with command-specific values.
    let callCount = 0;
    const resultMap = [
      { value: { id: "i-1" } },
      { value: { id: "v-1" } },
      { value: { ok: true } },
    ];
    const tracking: Array<{ draftId: string; batch: AssistantCommand[] }> = [];
    const trackingController: DraftAppender = {
      async appendToDraft(draftId, batch) {
        tracking.push({ draftId, batch });
        return [resultMap[callCount++]!];
      },
    };

    const tool = createApplyCommandTool({
      controller: trackingController,
      draftId: "draft-multi",
      buildCommand,
    });

    // Step 1: CreateInsight
    const r1 = await tool.execute("c1", {
      type: "CreateInsight",
      args: {
        id: "i-1",
        name: "Sales",
        source: { sourceType: "dataTable", sourceId: "t-1" },
      },
    });
    // Step 2: CreateVisualization
    const r2 = await tool.execute("c2", {
      type: "CreateVisualization",
      args: {
        id: "v-1",
        name: "Sales Chart",
        insightId: "i-1",
        visualizationType: "bar",
        spec: {},
      },
    });
    // Step 3: AddDashboardItem
    const r3 = await tool.execute("c3", {
      type: "AddDashboardItem",
      args: {
        dashboardId: "d-1",
        item: {
          id: "di-1",
          type: "visualization",
          visualizationId: "v-1",
          x: 0,
          y: 0,
          width: 4,
          height: 3,
        },
      },
    });

    // All three appended — each as a separate single-command batch.
    expect(tracking).toHaveLength(3);

    // draftId is the same across all three calls (captured at factory time,
    // not per-call). This is the load-bearing invariant: the agent cannot steer
    // writes to a different draft mid-session.
    for (const call of tracking) {
      expect(call.draftId).toBe("draft-multi");
    }

    // Each batch has exactly one command.
    expect(tracking[0]!.batch[0]!.path).toBe("createInsightCmd");
    expect(tracking[1]!.batch[0]!.path).toBe("createVisualizationCmd");
    expect(tracking[2]!.batch[0]!.path).toBe("addDashboardItemCmd");

    // Each call returns its details.
    expect(r1.details.commandType).toBe("CreateInsight");
    expect(r1.details.commandResult).toEqual({ id: "i-1" });
    expect(r2.details.commandType).toBe("CreateVisualization");
    expect(r2.details.commandResult).toEqual({ id: "v-1" });
    expect(r3.details.commandType).toBe("AddDashboardItem");
    expect(r3.details.commandResult).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// 4. Draft-safe allow-list gate — credential + unsafe commands DENIED
// ---------------------------------------------------------------------------

describe("createApplyCommandTool — DRAFT_SAFE_COMMANDS allow-list gate", () => {
  /**
   * `DeleteNode` is explicitly DENIED:
   *   - on a DataSource it calls vault.delete as an OS-keychain side effect the
   *     draft overlay does not draft or roll back;
   *   - on Insight / DataTable it uses non-PK cascade ops the overlay cannot
   *     safely replicate.
   *
   * (CreateDataSource / SetDataSourceConfig are NO LONGER denied — they are
   * draft-safe on the capture-before-log credential path; the credential-ref
   * gate below covers their security boundary instead.)
   *
   * The tool must reject DeleteNode BEFORE calling buildCommand or appendToDraft
   * so that no vault state is created from a supposed sandbox operation.
   */
  const deniedCredentialCommands = ["DeleteNode"] as const;

  it.each(deniedCredentialCommands)(
    "denies credential/unsafe command '%s' with an honest error — no appendToDraft, no buildCommand",
    async (commandType) => {
      const controller = makeMockController();
      const buildCommandSpy = vi.fn(buildCommand);
      const tool = createApplyCommandTool({
        controller,
        draftId: "draft-deny",
        buildCommand: buildCommandSpy,
      });

      // Must throw — describing the command as not draft-safe for the assistant.
      await expect(
        tool.execute("call-deny", { type: commandType, args: {} }),
      ).rejects.toThrow(/not draft-safe for the assistant/i);

      // CRITICAL: buildCommand must NOT have been called (gate fires before it).
      expect(buildCommandSpy).not.toHaveBeenCalled();
      // CRITICAL: appendToDraft must NOT have been called (no vault side effect).
      expect(controller.appendCalls).toHaveLength(0);
    },
  );

  it("denies an arbitrary unlisted command type (default-deny)", async () => {
    const controller = makeMockController();
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-deny-unknown",
      buildCommand,
    });

    await expect(
      tool.execute("call-unknown", {
        type: "SomeUnknownCommand",
        args: {},
      }),
    ).rejects.toThrow(/not draft-safe/i);

    expect(controller.appendCalls).toHaveLength(0);
  });

  it("allows a draft-safe artifact command (CreateInsight) through the gate and appends normally", async () => {
    const controller = makeMockController({
      appendResult: [{ value: { id: "i-allow-1" } }],
    });
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-allow",
      buildCommand,
    });

    // CreateInsight is in DRAFT_SAFE_COMMANDS — must pass the gate and append.
    const result = await tool.execute("call-allow", {
      type: "CreateInsight",
      args: {
        id: "i-allow-1",
        name: "Allowed",
        source: { sourceType: "dataTable", sourceId: "t-1" },
      },
    });

    // appendToDraft was called exactly once.
    expect(controller.appendCalls).toHaveLength(1);
    expect(controller.appendCalls[0]!.draftId).toBe("draft-allow");
    // Result details reflect the handler value.
    expect(result.details.commandType).toBe("CreateInsight");
    expect(result.details.commandResult).toEqual({ id: "i-allow-1" });
  });
});

// ---------------------------------------------------------------------------
// 5. Credential-ref gate — agent must supply plaintext, never a ref
// ---------------------------------------------------------------------------

describe("createApplyCommandTool — credential-ref gate (agent authoring)", () => {
  // A valid-shaped SecretRef (`secret:<uuid>`) the agent does NOT own — the
  // foreign-ref attack the gate must block.
  const FOREIGN_REF = "secret:11111111-1111-4111-8111-111111111111";

  // Each case puts a foreign ref in a different slot — the typed credential
  // fields AND a nested connector field (`extra.authRef`, which the REST connector
  // resolves via the vault). The gate is field-agnostic + recursive, so every slot
  // is caught — enumerating only apiKey/connectionString is what let authRef slip.
  const refRejectionCases = [
    {
      type: "CreateDataSource",
      args: { id: "d", type: "rest", name: "X", apiKey: "" },
    },
    {
      type: "SetDataSourceConfig",
      args: { id: "d", connectionString: "" },
    },
    {
      type: "SetDataSourceConfig",
      args: { id: "d", extra: { endpoint: "https://x", authRef: "" } },
    },
    {
      type: "CreateDataSource",
      args: {
        id: "d",
        type: "rest",
        name: "X",
        extra: { nested: { authRef: "" } },
      },
    },
  ] as const;

  it.each(refRejectionCases)(
    "REJECTS a caller-supplied ref anywhere in $type args — no buildCommand, no appendToDraft",
    async ({ type, args }) => {
      const controller = makeMockController();
      const buildCommandSpy = vi.fn(buildCommand);
      const tool = createApplyCommandTool({
        controller,
        draftId: "draft-cred-reject",
        buildCommand: buildCommandSpy,
      });

      // Inject the foreign ref into whichever slot the case left empty.
      const withRef = JSON.parse(
        JSON.stringify(args).replace('""', `"${FOREIGN_REF}"`),
      );

      // A ref-shaped value must be rejected so the agent cannot adopt a
      // foreign/arbitrary vault ref (bypassing storeCredential + fail-closed guard).
      await expect(
        tool.execute("call-cred-reject", { type, args: withRef }),
      ).rejects.toThrow(
        /must carry the plaintext credential, not a.*vault ref/is,
      );

      // CRITICAL: rejected BEFORE buildCommand and BEFORE appendToDraft — no
      // command is constructed, nothing reaches the draft / capture seam.
      expect(buildCommandSpy).not.toHaveBeenCalled();
      expect(controller.appendCalls).toHaveLength(0);
    },
  );

  it("ALLOWS a plaintext credential — the agent can author a data source", async () => {
    const controller = makeMockController({
      appendResult: [{ value: { id: "ds-plain" } }],
    });
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-cred-allow",
      buildCommand,
    });

    // Plaintext (not ref-shaped) is the sanctioned input — passes the gate and
    // appends; the server's capture-before-log path stores it as a vault ref.
    const result = await tool.execute("call-cred-allow", {
      type: "CreateDataSource",
      args: {
        id: "ds-plain",
        type: "rest",
        name: "My API",
        apiKey: "sk-live-super-secret-plaintext",
      },
    });

    expect(controller.appendCalls).toHaveLength(1);
    expect(controller.appendCalls[0]!.batch[0]!.path).toBe(
      "createDataSourceCmd",
    );
    expect(result.details.commandType).toBe("CreateDataSource");
    expect(result.details.commandResult).toEqual({ id: "ds-plain" });
  });

  it("ALLOWS a plaintext-only SetDataSourceConfig (no credential field) through", async () => {
    const controller = makeMockController({
      appendResult: [{ value: { ok: true } }],
    });
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-cred-noncred",
      buildCommand,
    });

    // A config update that touches no credential field is unaffected by the gate.
    await tool.execute("call-cred-noncred", {
      type: "SetDataSourceConfig",
      args: { id: "ds-1", extra: { database: "analytics" } },
    });

    expect(controller.appendCalls).toHaveLength(1);
  });

  it("does not reject a NON-credential command carrying a ref-shaped string field", async () => {
    const controller = makeMockController();
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-cred-unrelated",
      buildCommand,
    });

    // The gate is scoped to credential commands' credential fields — an
    // unrelated command with a coincidentally ref-shaped field is untouched.
    await tool.execute("call-cred-unrelated", {
      type: "CreateInsight",
      args: {
        id: "secret:22222222-2222-4222-8222-222222222222",
        name: "Not a credential",
        source: { sourceType: "dataTable", sourceId: "t-1" },
      },
    });

    expect(controller.appendCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5b. Agent-provenance stamp — CreateDataSource is marked agent-authored
// ---------------------------------------------------------------------------

describe("createApplyCommandTool — agent provenance stamp", () => {
  it("stamps createdBy:{kind:'agent'} into CreateDataSource args", async () => {
    const controller = makeMockController();
    const buildCommandSpy = vi.fn(buildCommand);
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-prov",
      buildCommand: buildCommandSpy,
    });

    await tool.execute("call-prov", {
      type: "CreateDataSource",
      args: { id: "ds-1", type: "rest", name: "API", apiKey: "plaintext" },
    });

    // The command built (and thus appended) carries agent provenance so the row
    // is auditably agent-authored after publish replay.
    expect(buildCommandSpy).toHaveBeenCalledWith(
      "CreateDataSource",
      expect.objectContaining({ createdBy: { kind: "agent" } }),
    );
  });

  it("OVERRIDES a caller-supplied createdBy — the agent cannot claim user authorship", async () => {
    const controller = makeMockController();
    const buildCommandSpy = vi.fn(buildCommand);
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-prov-override",
      buildCommand: buildCommandSpy,
    });

    await tool.execute("call-prov-override", {
      type: "CreateDataSource",
      args: {
        id: "ds-2",
        type: "rest",
        name: "API",
        apiKey: "plaintext",
        createdBy: { kind: "user" },
      },
    });

    const passedArgs = buildCommandSpy.mock.calls[0]![1] as {
      createdBy: unknown;
    };
    expect(passedArgs.createdBy).toEqual({ kind: "agent" });
  });

  it("does NOT stamp provenance on a non-provenance command", async () => {
    const controller = makeMockController();
    const buildCommandSpy = vi.fn(buildCommand);
    const tool = createApplyCommandTool({
      controller,
      draftId: "draft-prov-none",
      buildCommand: buildCommandSpy,
    });

    await tool.execute("call-prov-none", {
      type: "CreateInsight",
      args: {
        id: "i-1",
        name: "Trend",
        source: { sourceType: "dataTable", sourceId: "t-1" },
      },
    });

    const passedArgs = buildCommandSpy.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(passedArgs).not.toHaveProperty("createdBy");
  });
});

// ---------------------------------------------------------------------------
// 6. Tool metadata — executionMode, name (as a single invariant group)
// ---------------------------------------------------------------------------

describe("createApplyCommandTool — tool metadata", () => {
  it("tool is named 'applyCommand' and executionMode is 'sequential' (mutating)", () => {
    const tool = createApplyCommandTool({
      controller: makeMockController(),
      draftId: "d",
      buildCommand,
    });
    // Name is the agent's tool-dispatch key.
    expect(tool.name).toBe("applyCommand");
    // sequential = serialised against other tools in a multi-tool turn; required
    // for the single-writer-per-draftId contract on DraftController.appendToDraft.
    expect(tool.executionMode).toBe("sequential");
  });
});
