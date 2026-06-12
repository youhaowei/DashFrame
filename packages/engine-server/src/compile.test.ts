import { describe, expect, it } from "vitest";

import { hashCompiledQuery } from "./compile";

describe("hashCompiledQuery — content-addressing boundary (Stage 1)", () => {
  it("byte-identical {sql, params} produce the same hash (cache sharing)", () => {
    const a = hashCompiledQuery({ sql: "SELECT 1 WHERE x = ?", params: [42] });
    const b = hashCompiledQuery({ sql: "SELECT 1 WHERE x = ?", params: [42] });
    expect(a).toBe(b);
  });

  it("different SQL produces a different hash", () => {
    const a = hashCompiledQuery({ sql: "SELECT 1", params: [] });
    const b = hashCompiledQuery({ sql: "SELECT 2", params: [] });
    expect(a).not.toBe(b);
  });

  it("different params produce a different hash", () => {
    const a = hashCompiledQuery({ sql: "SELECT ? ", params: [1] });
    const b = hashCompiledQuery({ sql: "SELECT ? ", params: [2] });
    expect(a).not.toBe(b);
  });

  it("param order is significant (positional binding)", () => {
    const a = hashCompiledQuery({ sql: "SELECT ?, ?", params: [1, 2] });
    const b = hashCompiledQuery({ sql: "SELECT ?, ?", params: [2, 1] });
    expect(a).not.toBe(b);
  });

  it("does not let sql/params boundary collide (NUL-separated)", () => {
    // "ab" + [] must differ from "a" + ["b"] — without a separator a naive
    // concat would collide.
    const a = hashCompiledQuery({ sql: "ab", params: [] });
    const b = hashCompiledQuery({ sql: "a", params: ["b"] });
    expect(a).not.toBe(b);
  });
});
