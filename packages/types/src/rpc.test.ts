import { describe, expect, test } from "bun:test";

import { isRpcError } from "./rpc";

describe("isRpcError", () => {
  test("should accept a well-formed error", () => {
    expect(isRpcError({ code: "validation", message: "missing field" })).toBe(
      true,
    );
  });

  test("should reject objects missing required keys", () => {
    expect(isRpcError({ code: "validation" })).toBe(false);
    expect(isRpcError({ message: "x" })).toBe(false);
  });

  test("should reject non-objects", () => {
    expect(isRpcError(null)).toBe(false);
    expect(isRpcError("error")).toBe(false);
    expect(isRpcError(undefined)).toBe(false);
  });
});
