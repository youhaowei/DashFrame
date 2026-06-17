import { describe, expect, it } from "vitest";
import {
  defineToolHandler,
  isValidationError,
  Type,
  validateToolArgs,
} from "./tool.js";

// ---------------------------------------------------------------------------
// Shared schema used across tests
// ---------------------------------------------------------------------------

const QuerySchema = Type.Object({
  tableId: Type.String(),
  limit: Type.Number({ minimum: 1, maximum: 1000 }),
});

// ---------------------------------------------------------------------------
// defineToolHandler — valid args → typed params, no casts
// ---------------------------------------------------------------------------

describe("defineToolHandler — valid args", () => {
  it("executes with typed params — no `as` casts in the body", async () => {
    const tool = defineToolHandler({
      name: "query_table",
      description: "Query a table",
      label: "Query Table",
      parameters: QuerySchema,
      async execute(_callId, params) {
        // These assignments would fail to compile if params were `unknown`.
        // The test is executable proof that types are narrowed correctly.
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

  it("result envelope always includes a details field", async () => {
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

    const result = await tool.execute("c1", { name: "world" });
    expect("details" in result).toBe(true);
    expect(result.details).toEqual({ greeted: "world" });
  });
});

// ---------------------------------------------------------------------------
// defineToolHandler — execute errors propagate (pi catches and marks isError)
// ---------------------------------------------------------------------------

describe("defineToolHandler — execute errors", () => {
  it("propagates thrown errors so pi can mark the result isError: true", async () => {
    const tool = defineToolHandler({
      name: "boom",
      description: "Always throws",
      label: "Boom",
      parameters: Type.Object({ x: Type.String() }),
      async execute() {
        throw new Error("kaboom");
      },
    });

    await expect(tool.execute("call-throw", { x: "ok" })).rejects.toThrow(
      "kaboom",
    );
  });
});

// ---------------------------------------------------------------------------
// validateToolArgs — the TypeBox boundary check for test/integration use
// ---------------------------------------------------------------------------

describe("validateToolArgs — valid args", () => {
  it("returns ok: true and narrows the type", () => {
    const result = validateToolArgs(QuerySchema, {
      tableId: "orders",
      limit: 10,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Type-check: the compiler allows these assignments only because result.value
      // is Static<typeof QuerySchema>, not `unknown`.
      const tableId: string = result.value.tableId;
      const limit: number = result.value.limit;
      expect(tableId).toBe("orders");
      expect(limit).toBe(10);
    }
  });
});

describe("validateToolArgs — coercion mirrors pi's Convert-then-Check", () => {
  // Pi's prepareToolCall runs Value.Convert THEN Check. Models routinely emit
  // numbers as strings (`"10"`), so a tool pre-validated here must coerce
  // identically to the live agent loop — otherwise the seam diverges from pi.
  it('coerces a string limit to a number (model emits "10")', () => {
    const result = validateToolArgs(QuerySchema, {
      tableId: "orders",
      limit: "10", // model-emitted string
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Coerced to the schema type — not left as a string.
      expect(result.value.limit).toBe(10);
      expect(typeof result.value.limit).toBe("number");
    }
  });

  it("coerces a numeric tableId to a string", () => {
    const result = validateToolArgs(QuerySchema, {
      tableId: 42, // number where a string is expected
      limit: 5,
    });

    // Convert coerces 42 -> "42" (string-typed field), so this is now VALID —
    // exactly as pi would handle it before calling execute.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tableId).toBe("42");
      expect(typeof result.value.tableId).toBe("string");
    }
  });

  it("does not mutate the caller's input object", () => {
    const raw = { tableId: "orders", limit: "10" };
    validateToolArgs(QuerySchema, raw);
    // raw.limit must still be the original string — Convert ran on a clone.
    expect(raw.limit).toBe("10");
  });
});

describe("validateToolArgs — invalid args", () => {
  it("returns ok: false with a structured validation_error when coercion can't satisfy the schema", () => {
    const result = validateToolArgs(QuerySchema, {
      tableId: "orders",
      limit: "not-a-number", // cannot coerce to number
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isValidationError(result.error)).toBe(true);
      expect(result.error.kind).toBe("validation_error");
      expect(result.error.message).toMatch(/Tool argument validation failed/);
      expect(result.error.errors.length).toBeGreaterThan(0);
      // Error points at the offending field, not a useless root path.
      expect(result.error.errors[0]?.path).toBe("/limit");
    }
  });

  it("reports a missing required field after coercion", () => {
    const result = validateToolArgs(QuerySchema, {
      tableId: "orders",
      // limit omitted entirely
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.errors.length).toBeGreaterThan(0);
      for (const e of result.error.errors) {
        expect(typeof e.path).toBe("string");
        expect(typeof e.message).toBe("string");
      }
    }
  });

  it("returns ok: false (not a crash) when value is the wrong root type", () => {
    const result = validateToolArgs(QuerySchema, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isValidationError(result.error)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// isValidationError — type guard
// ---------------------------------------------------------------------------

describe("isValidationError", () => {
  it("returns true for a ToolArgValidationError shaped object", () => {
    expect(
      isValidationError({ kind: "validation_error", message: "x", errors: [] }),
    ).toBe(true);
  });

  it("returns false for non-error shapes", () => {
    expect(isValidationError(null)).toBe(false);
    expect(isValidationError({ kind: "something_else" })).toBe(false);
    expect(isValidationError({ rowCount: 10 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AgentTool shape — metadata is preserved
// ---------------------------------------------------------------------------

describe("defineToolHandler — AgentTool shape", () => {
  it("exposes name, description, label, parameters, and execute on the returned tool", () => {
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

  it("forwards executionMode so mutating tools can serialise against the batch", () => {
    const mutating = defineToolHandler({
      name: "apply_command",
      description: "Mutates the report",
      label: "Apply Command",
      executionMode: "sequential",
      parameters: Type.Object({ command: Type.String() }),
      async execute(_id, _params) {
        return { content: [], details: null };
      },
    });

    expect(mutating.executionMode).toBe("sequential");
  });

  it("omits executionMode when not specified (uses pi's loop default)", () => {
    const readonly = defineToolHandler({
      name: "read_table",
      description: "Reads a table",
      label: "Read Table",
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id, _params) {
        return { content: [], details: null };
      },
    });

    expect("executionMode" in readonly).toBe(false);
  });
});
