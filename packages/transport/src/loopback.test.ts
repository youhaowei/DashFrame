import { describe, expect, test } from "bun:test";

import { TransportError } from "./errors";
import { createLoopbackTransport, LoopbackTransport } from "./loopback";
import { Router } from "./router";

// Router.open defers handler setup via Promise.resolve().then(...) so
// callbacks fire on the microtask queue. Two ticks lets the handler run
// AND the returned teardown be wired up.
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("LoopbackTransport.invoke", () => {
  test("should round-trip handler value", async () => {
    const router = new Router();
    router.invoke("project.info", () => ({ name: "demo" }));
    const t = createLoopbackTransport(router);
    expect(await t.invoke("project.info")).toEqual({ name: "demo" });
  });

  test("should reject with TransportError on handler failure", async () => {
    const router = new Router();
    router.invoke("fail", () => {
      throw new Error("nope");
    });
    const t = new LoopbackTransport(router);
    let caught: TransportError | undefined;
    try {
      await t.invoke("fail");
    } catch (err) {
      caught = err as TransportError;
    }
    expect(caught).toBeInstanceOf(TransportError);
    expect(caught?.code).toBe("internal");
    expect(caught?.message).toBe("nope");
  });

  test("should reject with not_found for unknown path", async () => {
    const router = new Router();
    const t = new LoopbackTransport(router);
    await expect(t.invoke("nope")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  test("should expose loopback as the source tag", async () => {
    const router = new Router();
    router.invoke("src", (_args, ctx) => ctx.source);
    const t = new LoopbackTransport(router);
    expect(await t.invoke("src")).toBe("loopback");
  });
});

describe("LoopbackTransport.subscribe", () => {
  test("should deliver next/complete events from handler", async () => {
    const router = new Router();
    router.subscription("counter", (_args, handle) => {
      handle.next(1);
      handle.next(2);
      handle.complete();
    });
    const t = new LoopbackTransport(router);

    const received: unknown[] = [];
    let completed = false;
    let errored: unknown = null;
    const sub = t.subscribe("counter", undefined, {
      next: (v) => received.push(v),
      error: (e) => {
        errored = e;
      },
      complete: () => {
        completed = true;
      },
    });
    // Allow the router's microtask boundary to flush.
    await flush();
    expect(received).toEqual([1, 2]);
    expect(completed).toBe(true);
    expect(errored).toBeNull();
    expect(sub.closed).toBe(true);
  });

  test("should run teardown when caller closes the subscription", async () => {
    const router = new Router();
    let tornDown = false;
    router.subscription("hot", (_args, _handle) => {
      return () => {
        tornDown = true;
      };
    });
    const t = new LoopbackTransport(router);
    const sub = t.subscribe("hot", undefined, {
      next: () => {},
      error: () => {},
      complete: () => {},
    });
    await flush();
    sub.close();
    expect(tornDown).toBe(true);
    expect(sub.closed).toBe(true);

    // Idempotent close.
    sub.close();
    expect(sub.closed).toBe(true);
  });

  test("should propagate handler error as RpcError event", async () => {
    const router = new Router();
    router.subscription("broken", () => {
      throw new Error("setup failed");
    });
    const t = new LoopbackTransport(router);
    let received: unknown = null;
    const sub = t.subscribe("broken", undefined, {
      next: () => {},
      error: (e) => {
        received = e;
      },
      complete: () => {},
    });
    await flush();
    expect(received).toMatchObject({
      code: "internal",
      message: "setup failed",
    });
    expect(sub.closed).toBe(true);
  });

  test("should drop next() after caller close", async () => {
    const router = new Router();
    const ctl: { push?: (v: unknown) => void } = {};
    router.subscription("manual", (_args, handle) => {
      ctl.push = (v) => handle.next(v);
    });
    const t = new LoopbackTransport(router);
    const seen: unknown[] = [];
    const sub = t.subscribe("manual", undefined, {
      next: (v) => seen.push(v),
      error: () => {},
      complete: () => {},
    });
    await flush();
    ctl.push?.("a");
    sub.close();
    ctl.push?.("b");
    expect(seen).toEqual(["a"]);
  });

  test("should surface not_found via observer.error for unknown sub path", async () => {
    const router = new Router();
    const t = new LoopbackTransport(router);
    let received: unknown = null;
    const sub = t.subscribe("ghost", undefined, {
      next: () => {},
      error: (e) => {
        received = e;
      },
      complete: () => {},
    });
    expect(received).toMatchObject({ code: "not_found" });
    expect(sub.closed).toBe(true);
  });
});
