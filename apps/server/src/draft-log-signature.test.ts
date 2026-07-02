/**
 * `computeLogSignature` — the drift guard's content check.
 *
 * The only property that matters here is DETERMINISM: the same logical log
 * must always produce the same signature, and a logically different log must
 * produce a different one. `draft_command_log.args` is `jsonb`, which does
 * not preserve object key insertion order across a write/read round trip, so
 * key-order independence is the load-bearing contract — not an edge case.
 */
import type { Command } from "@wystack/server";
import { describe, expect, it } from "vitest";

import { computeLogSignature } from "./draft-log-signature";

describe("computeLogSignature", () => {
  it("is independent of object key insertion order in args", () => {
    const a: Command[] = [
      { path: "createDataSource", args: { id: "1", type: "csv", name: "S" } },
    ];
    const b: Command[] = [
      { path: "createDataSource", args: { name: "S", id: "1", type: "csv" } },
    ];
    expect(computeLogSignature(a)).toBe(computeLogSignature(b));
  });

  it("is independent of key order in nested objects", () => {
    const a: Command[] = [
      {
        path: "setDataSourceConfig",
        args: { id: "1", config: { host: "h", port: 5432 } },
      },
    ];
    const b: Command[] = [
      {
        path: "setDataSourceConfig",
        args: { config: { port: 5432, host: "h" }, id: "1" },
      },
    ];
    expect(computeLogSignature(a)).toBe(computeLogSignature(b));
  });

  it("is sensitive to array order (position is semantic, unlike object keys)", () => {
    const a: Command[] = [{ path: "reorder", args: { ids: ["1", "2"] } }];
    const b: Command[] = [{ path: "reorder", args: { ids: ["2", "1"] } }];
    expect(computeLogSignature(a)).not.toBe(computeLogSignature(b));
  });

  it("is sensitive to command order (replay order matters)", () => {
    const a: Command[] = [
      { path: "createDataSource", args: { id: "1" } },
      { path: "createDataSource", args: { id: "2" } },
    ];
    const b: Command[] = [
      { path: "createDataSource", args: { id: "2" } },
      { path: "createDataSource", args: { id: "1" } },
    ];
    expect(computeLogSignature(a)).not.toBe(computeLogSignature(b));
  });

  it("is sensitive to a changed argument value", () => {
    const a: Command[] = [
      { path: "createDataSource", args: { id: "1", name: "Original" } },
    ];
    const b: Command[] = [
      { path: "createDataSource", args: { id: "1", name: "Renamed" } },
    ];
    expect(computeLogSignature(a)).not.toBe(computeLogSignature(b));
  });

  it("ignores id/compactionKey/kind — only path+args determine publish's effect", () => {
    const a: Command[] = [{ path: "createDataSource", args: { id: "1" } }];
    const b = [
      {
        path: "createDataSource",
        args: { id: "1" },
        id: "corr-1",
        compactionKey: "createDataSource:1",
        kind: "create" as const,
      },
    ];
    expect(computeLogSignature(a)).toBe(computeLogSignature(b));
  });

  it("is sensitive to a differing __proto__-named argument key (prototype-pollution regression)", () => {
    // args is attacker-influenced JSON parsed from `jsonb` storage. A key
    // literally named `__proto__` assigned via bracket notation on a normal
    // object invokes the legacy prototype SETTER rather than creating an
    // enumerable own property, so a naive canonicalizer would silently drop
    // it — a drifted log differing only in this field would wrongly hash the
    // same as the reviewed one. Parse from JSON (not an object literal) so
    // the key is genuinely an own `__proto__` property, matching how
    // `readLog` reconstructs args from stored jsonb.
    const a: Command[] = [
      {
        path: "createDataSource",
        args: JSON.parse('{"__proto__": {"evil": true}, "id": "1"}') as unknown,
      },
    ];
    const b: Command[] = [
      {
        path: "createDataSource",
        args: JSON.parse(
          '{"__proto__": {"evil": false}, "id": "1"}',
        ) as unknown,
      },
    ];
    expect(computeLogSignature(a)).not.toBe(computeLogSignature(b));
  });

  it("returns the empty-log signature for an empty log, distinct from any non-empty log", () => {
    expect(computeLogSignature([])).toBe(computeLogSignature([]));
    expect(computeLogSignature([])).not.toBe(
      computeLogSignature([{ path: "noop", args: {} }]),
    );
  });
});
