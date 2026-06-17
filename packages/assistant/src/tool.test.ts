import { describe, expect, it } from "vitest";
import {
  defineToolHandler,
  isValidationError,
  ToolExecutionError,
  Type,
} from "./tool.js";

// ---------------------------------------------------------------------------
// Shared schema used across tests
// ---------------------------------------------------------------------------

const QuerySchema = Type.Object({
  tableId: Type.String(),
  limit: Type.Number({ minimum: 1, maximum: 1000 }),
});

// ---------------------------------------------------------------------------
// Valid args → typed params, success envelope
// ---------------------------------------------------------------------------

describe("defineToolHandler — valid args", () => {
  it("produces an AgentTool that executes when args match the schema", async () => {
    const tool = defineToolHandler({
      name: "query_table",
      description: "Query a table",
      label: "Query Table",
      parameters: QuerySchema,
      async execute(_callId, params) {
        // params is fully typed here — no `as` casts
        const tableId: string = params.tableId;
        const limit: number = params.limit;
        return {
          content: [{ type: "text", text: `queried ${tableId}` }],
          details: { rowCount: limit },
        };
      },
    });

    const result = await tool.execute("call-1", {
      tableId: "orders",
      limit: 10,
    });

    expect(result.content).toEqual([{ type: "text", text: "queried orders" }]);
    expect(result.details).toEqual({ rowCount: 10 });
    expect(isValidationError(result.details)).toBe(false);
  });

  it("passes toolCallId and abort signal through to execute", async () => {
    let receivedId: string | undefined;
    let receivedSignal: AbortSignal | undefined;

    const tool = defineToolHandler({
      name: "identity",
      description: "Identity",
      label: "Identity",
      parameters: Type.Object({ value: Type.String() }),
      async execute(toolCallId, params, signal) {
        receivedId = toolCallId;
        receivedSignal = signal;
        return { content: [{ type: "text", text: params.value }], details: {} };
      },
    });

    const controller = new AbortController();
    await tool.execute("abc-123", { value: "hello" }, controller.signal);

    expect(receivedId).toBe("abc-123");
    expect(receivedSignal).toBe(controller.signal);
  });
});

// ---------------------------------------------------------------------------
// Invalid args → clean error shape, not a crash
// ---------------------------------------------------------------------------

describe("defineToolHandler — invalid args", () => {
  it("returns a validation_error result when args fail schema check", async () => {
    const tool = defineToolHandler({
      name: "query_table",
      description: "Query a table",
      label: "Query Table",
      parameters: QuerySchema,
      async execute(_callId, _params) {
        // should NOT be reached
        throw new Error("execute should not be called with invalid args");
      },
    });

    // Missing `limit`, wrong type for `tableId`
    const result = await tool.execute("call-bad", {
      tableId: 42, // should be string
    } as unknown as { tableId: string; limit: number });

    expect(isValidationError(result.details)).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    // Error message must be a non-empty string
    const first = result.content[0];
    if (first?.type === "text") {
      expect(first.text.length).toBeGreaterThan(0);
    }
  });

  it("reports all validation errors when multiple fields are wrong", async () => {
    const tool = defineToolHandler({
      name: "query_table",
      description: "Query a table",
      label: "Query Table",
      parameters: QuerySchema,
      async execute(_callId, _params) {
        throw new Error("should not be reached");
      },
    });

    const result = await tool.execute("call-multi-err", {
      tableId: 99,
      limit: "not-a-number",
    } as unknown as { tableId: string; limit: number });

    expect(isValidationError(result.details)).toBe(true);
    if (isValidationError(result.details)) {
      expect(result.details.kind).toBe("validation_error");
      expect(result.details.errors.length).toBeGreaterThan(0);
    }
  });

  it("throws ToolExecutionError when execute throws, so pi marks result isError", async () => {
    const tool = defineToolHandler({
      name: "boom",
      description: "Always throws",
      label: "Boom",
      parameters: Type.Object({ x: Type.String() }),
      async execute() {
        throw new Error("kaboom");
      },
    });

    await expect(
      tool.execute("call-throw", { x: "ok" }),
    ).rejects.toBeInstanceOf(ToolExecutionError);

    await expect(tool.execute("call-throw", { x: "ok" })).rejects.toThrow(
      "kaboom",
    );
  });
});

// ---------------------------------------------------------------------------
// Envelope shape — details always present
// ---------------------------------------------------------------------------

describe("defineToolHandler — result envelope", () => {
  it("always produces a details field in the result", async () => {
    const tool = defineToolHandler({
      name: "greet",
      description: "Greet",
      label: "Greet",
      parameters: Type.Object({ name: Type.String() }),
      async execute(_id, params) {
        return {
          content: [{ type: "text", text: `Hello ${params.name}` }],
          details: { greeted: params.name },
        };
      },
    });

    const ok = await tool.execute("c1", { name: "world" });
    expect("details" in ok).toBe(true);
    expect(ok.details).toEqual({ greeted: "world" });

    // Validation-error path also always has details
    const err = await tool.execute("c2", { notAField: true } as unknown as {
      name: string;
    });
    expect("details" in err).toBe(true);
    expect(err.details).toBeDefined();
    expect(isValidationError(err.details)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tool metadata is preserved on the returned AgentTool
// ---------------------------------------------------------------------------

describe("defineToolHandler — AgentTool shape", () => {
  it("exposes name, description, label, and parameters on the returned tool", () => {
    const tool = defineToolHandler({
      name: "noop",
      description: "A no-op tool",
      label: "No-op",
      parameters: Type.Object({ value: Type.Number() }),
      async execute(_id, _params) {
        return { content: [], details: null };
      },
    });

    expect(tool.name).toBe("noop");
    expect(tool.description).toBe("A no-op tool");
    expect(tool.label).toBe("No-op");
    expect(tool.parameters).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });
});
