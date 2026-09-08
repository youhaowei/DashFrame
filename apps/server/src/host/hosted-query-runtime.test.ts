import { expect, it, vi } from "vite-plus/test";
import { createHostedQueryRuntime } from "./hosted-query-runtime";

it("shares one coalescing identity across request-scoped wrappers", () => {
  const engine = {
    queryArrow: vi.fn(async () => new Uint8Array()),
    registerArrowTable: vi.fn(async () => {}),
    unregisterTable: vi.fn(async () => {}),
  };
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
  const engine = {
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
  const first = createHostedQueryRuntime(engine).queryArrow("select 1", []);
  const sibling = createHostedQueryRuntime(engine).queryArrow("select 2", []);
  pending[0]!.resolve(new Uint8Array([1]));
  pending[1]!.resolve(new Uint8Array([2]));
  await expect(first).resolves.toEqual(new Uint8Array([1]));
  await expect(sibling).resolves.toEqual(new Uint8Array([2]));
  expect(engine.queryArrow).toHaveBeenNthCalledWith(1, "select 1", []);
  expect(engine.queryArrow).toHaveBeenNthCalledWith(2, "select 2", []);
});

it("permits accepted work and cleanup to settle", async () => {
  const engine = {
    queryArrow: vi.fn(async () => new Uint8Array()),
    registerArrowTable: vi.fn(async () => {}),
    unregisterTable: vi.fn(async () => {}),
  };
  const runtime = createHostedQueryRuntime(engine);
  await expect(runtime.queryArrow("select 1")).resolves.toEqual(
    new Uint8Array(),
  );
  await expect(
    runtime.registerArrowTable!("frame", new Uint8Array([1])),
  ).resolves.toBeUndefined();
  await expect(runtime.unregisterTable!("frame")).resolves.toBeUndefined();
  expect(engine.queryArrow).toHaveBeenCalledWith("select 1", undefined);
  expect(engine.registerArrowTable).toHaveBeenCalledWith(
    "frame",
    new Uint8Array([1]),
  );
  expect(engine.unregisterTable).toHaveBeenCalledWith("frame");
});
