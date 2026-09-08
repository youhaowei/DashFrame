import { expect, it, vi } from "vite-plus/test";
import { createHostedQueryRuntime } from "./hosted-query-runtime";

it("keeps a sibling query alive when one request is cancelled and discards the cancelled result", async () => {
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
  const a = new AbortController();
  const b = new AbortController();
  const cancelled = createHostedQueryRuntime(engine, a.signal).queryArrow(
    "select 1",
    [],
  );
  const sibling = createHostedQueryRuntime(engine, b.signal).queryArrow(
    "select 2",
    [],
  );
  a.abort(new Error("request cancelled"));
  pending[0]!.resolve(new Uint8Array([1]));
  pending[1]!.resolve(new Uint8Array([2]));
  await expect(cancelled).rejects.toThrow("request cancelled");
  await expect(sibling).resolves.toEqual(new Uint8Array([2]));
  expect(engine.queryArrow).toHaveBeenNthCalledWith(1, "select 1", []);
  expect(engine.queryArrow).toHaveBeenNthCalledWith(2, "select 2", []);
});

it("rejects new operations after the request lifetime ends", async () => {
  const engine = {
    queryArrow: vi.fn(async () => new Uint8Array()),
    registerArrowTable: vi.fn(async () => {}),
    unregisterTable: vi.fn(async () => {}),
  };
  const controller = new AbortController();
  const runtime = createHostedQueryRuntime(engine, controller.signal);
  controller.abort(new Error("expired"));
  await expect(runtime.queryArrow("select 1")).rejects.toThrow("expired");
  await expect(
    runtime.registerArrowTable!("frame", new Uint8Array([1])),
  ).rejects.toThrow("expired");
  await expect(runtime.unregisterTable!("frame")).rejects.toThrow("expired");
  expect(engine.queryArrow).not.toHaveBeenCalled();
  expect(engine.registerArrowTable).not.toHaveBeenCalled();
  expect(engine.unregisterTable).not.toHaveBeenCalled();
});
