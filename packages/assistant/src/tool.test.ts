import { describe, expect, it } from "vite-plus/test";
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
// validateToolArgs — the TypeBox boundary check for test/integration use
// ---------------------------------------------------------------------------

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

  it("returns ok: false when raw args cannot be structured-cloned", () => {
    const result = validateToolArgs(QuerySchema, {
      tableId: "orders",
      limit: () => 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isValidationError(result.error)).toBe(true);
      expect(result.error.kind).toBe("validation_error");
      expect(result.error.message).toMatch(/Tool argument validation failed/);
      expect(result.error.errors[0]?.path).toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// AgentTool shape — metadata is preserved
// ---------------------------------------------------------------------------

describe("defineToolHandler — AgentTool shape", () => {
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
});
