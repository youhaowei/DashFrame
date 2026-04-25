import { describe, expect, test } from "bun:test";

import { TransportError } from "./errors";
import { Router } from "./router";

describe("Router.dispatch", () => {
  test("should resolve invoke handler return value", async () => {
    const router = new Router();
    router.invoke("ping", () => "pong");
    const result = await router.dispatch("ping", undefined, {
      source: "test",
    });
    expect(result).toBe("pong");
  });

  test("should pass args + ctx through to handler", async () => {
    const router = new Router();
    router.invoke("echo", (args, ctx) => ({ args, source: ctx.source }));
    const result = await router.dispatch(
      "echo",
      { hi: 1 },
      {
        source: "loopback",
      },
    );
    expect(result).toEqual({ args: { hi: 1 }, source: "loopback" });
  });

  test("should throw not_found TransportError for unknown route", async () => {
    const router = new Router();
    let caught: unknown;
    try {
      await router.dispatch("missing", undefined, { source: "test" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TransportError);
    expect((caught as TransportError).code).toBe("not_found");
  });

  test("should wrap handler exceptions in TransportError(internal)", async () => {
    const router = new Router();
    router.invoke("boom", () => {
      throw new Error("kaboom");
    });
    let caught: TransportError | undefined;
    try {
      await router.dispatch("boom", undefined, { source: "test" });
    } catch (err) {
      caught = err as TransportError;
    }
    expect(caught?.code).toBe("internal");
    expect(caught?.message).toBe("kaboom");
  });

  test("should preserve TransportError code from handler", async () => {
    const router = new Router();
    router.invoke("badargs", () => {
      throw new TransportError({
        code: "validation",
        message: "missing field",
        details: { field: "name" },
      });
    });
    let caught: TransportError | undefined;
    try {
      await router.dispatch("badargs", undefined, { source: "test" });
    } catch (err) {
      caught = err as TransportError;
    }
    expect(caught?.code).toBe("validation");
    expect(caught?.details).toEqual({ field: "name" });
  });

  test("should reject duplicate invoke registration", () => {
    const router = new Router();
    router.invoke("dup", () => 1);
    expect(() => router.invoke("dup", () => 2)).toThrow(/already registered/);
  });

  test("should reject calling subscription via dispatch", async () => {
    const router = new Router();
    router.subscription("stream", () => {});
    let caught: TransportError | undefined;
    try {
      await router.dispatch("stream", undefined, { source: "test" });
    } catch (err) {
      caught = err as TransportError;
    }
    expect(caught?.code).toBe("transport");
  });
});
