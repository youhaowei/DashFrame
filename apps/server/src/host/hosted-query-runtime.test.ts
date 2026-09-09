import { expect, it, vi } from "vite-plus/test";
import { createHostedQueryRuntime } from "./hosted-query-runtime";
import { stubQueryEngine } from "./query-engine.fixture";

it("shares one coalescing identity across request-scoped wrappers", () => {
  const engine = stubQueryEngine({
    queryArrow: vi.fn(async () => new Uint8Array()),
    registerArrowTable: vi.fn(async () => {}),
    unregisterTable: vi.fn(async () => {}),
  });
  const first = createHostedQueryRuntime(engine);
  const second = createHostedQueryRuntime(engine);

  expect(first.coalescingIdentity).toBe(engine);
  expect(second.coalescingIdentity).toBe(engine);
});

it("keeps accepted shared work independent of any caller cancellation", async () => {
  const pending: Array<{
    resolve: (value: Uint8Array) => void;
    reject: (reason: unknown) => void;
  }> = [];
  const calls = {
    queryArrow: vi.fn(
      (_sql: string, _params?: readonly unknown[], signal?: AbortSignal) =>
        new Promise<Uint8Array>((resolve, reject) => {
          pending.push({ resolve, reject });
          signal?.addEventListener("abort", () => {
            for (const request of pending)
              request.reject(new Error("shared engine terminated"));
          });
        }),
    ),
    registerArrowTable: vi.fn(async () => {}),
    unregisterTable: vi.fn(async () => {}),
  };
  const engine = stubQueryEngine(calls);
  const first = createHostedQueryRuntime(engine).queryArrow("select 1", []);
  const sibling = createHostedQueryRuntime(engine).queryArrow("select 2", []);
  pending[0]!.resolve(new Uint8Array([1]));
  pending[1]!.resolve(new Uint8Array([2]));
  await expect(first).resolves.toEqual(new Uint8Array([1]));
  await expect(sibling).resolves.toEqual(new Uint8Array([2]));
  expect(calls.queryArrow).toHaveBeenNthCalledWith(1, "select 1", []);
  expect(calls.queryArrow).toHaveBeenNthCalledWith(2, "select 2", []);
});

it("permits accepted work and cleanup to settle", async () => {
  const calls = {
    queryArrow: vi.fn(async () => new Uint8Array()),
    registerArrowTable: vi.fn(async () => {}),
    unregisterTable: vi.fn(async () => {}),
  };
  const runtime = createHostedQueryRuntime(stubQueryEngine(calls));
  await expect(runtime.queryArrow("select 1")).resolves.toEqual(
    new Uint8Array(),
  );
  await expect(
    runtime.registerArrowTable("frame", new Uint8Array([1])),
  ).resolves.toBeUndefined();
  await expect(runtime.unregisterTable("frame")).resolves.toBeUndefined();
  expect(calls.queryArrow).toHaveBeenCalledWith("select 1", undefined);
  expect(calls.registerArrowTable).toHaveBeenCalledWith(
    "frame",
    new Uint8Array([1]),
  );
  expect(calls.unregisterTable).toHaveBeenCalledWith("frame");
});

it("refuses to start or terminate the shared engine on behalf of one request", async () => {
  // Engine lifetime belongs to the workspace pool that created it. A request
  // handler calling these would start or kill an engine serving other
  // requests, so the facade rejects rather than delegating.
  const calls = {
    initialize: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
  const runtime = createHostedQueryRuntime(stubQueryEngine(calls));
  await expect(runtime.initialize()).rejects.toThrow(
    "ENGINE_LIFECYCLE_NOT_OWNED",
  );
  await expect(runtime.dispose()).rejects.toThrow("ENGINE_LIFECYCLE_NOT_OWNED");
  expect(calls.initialize).not.toHaveBeenCalled();
  expect(calls.dispose).not.toHaveBeenCalled();
});
