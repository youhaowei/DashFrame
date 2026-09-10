import { expect, it, vi } from "vite-plus/test";

import { NativeTableLifecycle } from "./native-tables";
import { stubQueryEngine } from "./query-engine.fixture";

it.each([
  "registerArrowTable",
  "registerArrowStream",
  "registerArrowBatches",
] as const)(
  "protects a newer cross-case %s from cleanup queued during registration",
  async (method) => {
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const register = vi.fn(async (_name: string) => {
      started();
      await blocked;
    });
    const unregisterTable = vi.fn(async () => {});
    const lifecycle = new NativeTableLifecycle(
      stubQueryEngine({
        registerArrowTable: register,
        registerArrowStream: register,
        registerArrowBatches: register,
        unregisterTable,
      }),
    );
    const source = async function* () {
      yield new Uint8Array([1]);
    };
    const registration =
      method === "registerArrowTable"
        ? lifecycle.engine.registerArrowTable("Sales", new Uint8Array([1]))
        : lifecycle.engine[method]("Sales", source());
    await entered;
    const cleanup = lifecycle.engine.unregisterTable("sales");
    release();
    await Promise.all([registration, cleanup]);
    expect(register.mock.calls[0]?.[0]).toBe("Sales");
    expect(unregisterTable).not.toHaveBeenCalled();
    await lifecycle.engine.unregisterTable("sALES");
    expect(unregisterTable).toHaveBeenCalledWith("sALES");
    lifecycle.close();
  },
);

it("refuses to start or terminate the process-wide engine on behalf of one request", async () => {
  // The server composition owns the engine it constructed. A request handler
  // calling these would reach past its own request into a resource other
  // requests are using, so the facade rejects rather than delegating.
  const calls = {
    initialize: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
  const lifecycle = new NativeTableLifecycle(stubQueryEngine(calls));

  await expect(lifecycle.engine.initialize()).rejects.toThrow(
    "ENGINE_LIFECYCLE_NOT_OWNED",
  );
  await expect(lifecycle.engine.dispose()).rejects.toThrow(
    "ENGINE_LIFECYCLE_NOT_OWNED",
  );
  expect(calls.initialize).not.toHaveBeenCalled();
  expect(calls.dispose).not.toHaveBeenCalled();
});

it("declares itself the in-process native binding", () => {
  // Every backing implements every method, so method presence can no longer
  // tell the materializer which side of the plane it is on. This flag is what
  // does, and only the native binding sets it.
  const lifecycle = new NativeTableLifecycle(stubQueryEngine());
  expect(lifecycle.engine.nativeTransfer).toBe(true);
});
