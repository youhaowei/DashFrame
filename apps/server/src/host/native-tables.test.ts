import { expect, it, vi } from "vite-plus/test";

import { NativeTableLifecycle } from "./native-tables";
import { stubQueryEngine } from "./query-engine.fixture";

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
