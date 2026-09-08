import { expect, it, vi } from "vite-plus/test";
import { HostedWorkspacePool } from "./hosted-workspace-pool";

function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it("shares startup, binds owners, limits allocation, and drains accepted work", async () => {
  const opening = barrier();
  const running = barrier();
  const entered = barrier();
  const close = vi.fn(async () => {});
  const resources = {};
  const open = vi.fn(async () => {
    await opening.promise;
    return { resources, close };
  });
  const pool = new HostedWorkspacePool(1, open);
  const first = pool.run("workspace-a", "owner-a", async (value) => {
    expect(value).toBe(resources);
    entered.release();
    await running.promise;
    return "first";
  });
  const second = pool.run("workspace-a", "owner-a", async (value) => value);
  await expect(
    pool.run("workspace-a", "owner-b", async () => null),
  ).rejects.toThrow("FORBIDDEN");
  await expect(
    pool.run("workspace-b", "owner-b", async () => null),
  ).rejects.toThrow("capacity");
  expect(open).toHaveBeenCalledTimes(1);
  const shutdown = pool.close();
  expect(pool.close()).toBe(shutdown);
  await expect(
    pool.run("workspace-a", "owner-a", async () => null),
  ).rejects.toThrow("shutting down");
  opening.release();
  await entered.promise;
  await expect(second).resolves.toBe(resources);
  expect(close).not.toHaveBeenCalled();
  running.release();
  await expect(first).resolves.toBe("first");
  await shutdown;
  expect(close).toHaveBeenCalledOnce();
});

it("retains failed closes for retry and never reopens a draining pool", async () => {
  const closeA = vi
    .fn()
    .mockRejectedValueOnce(new Error("worker still alive"))
    .mockResolvedValue(undefined);
  const closeB = vi.fn(async () => {});
  const pool = new HostedWorkspacePool(2, async (id) => ({
    resources: id,
    close: id === "a" ? closeA : closeB,
  }));
  await pool.run("a", "owner", async () => null);
  await pool.run("b", "owner", async () => null);
  await expect(pool.close()).rejects.toThrow("shutdown failed");
  await expect(pool.run("c", "owner", async () => null)).rejects.toThrow(
    "shutting down",
  );
  await pool.close();
  expect(closeA).toHaveBeenCalledTimes(2);
  expect(closeB).toHaveBeenCalledOnce();
});

it("evicts failed startup but keeps resources after a request failure", async () => {
  const close = vi.fn(async () => {});
  const open = vi
    .fn()
    .mockRejectedValueOnce(new Error("startup cleaned up"))
    .mockResolvedValue({ resources: "ready", close });
  const pool = new HostedWorkspacePool(1, open);
  await expect(pool.run("a", "owner", async () => null)).rejects.toThrow(
    "startup cleaned up",
  );
  await expect(
    pool.run("a", "owner", async () => {
      throw new Error("query failed");
    }),
  ).rejects.toThrow("query failed");
  await expect(pool.run("a", "owner", async (value) => value)).resolves.toBe(
    "ready",
  );
  expect(open).toHaveBeenCalledTimes(2);
  await pool.close();
  expect(close).toHaveBeenCalledOnce();
});

it("keeps a workspace active until a streamed response drains", async () => {
  const remaining = barrier();
  let consumerSignal: AbortSignal | undefined;
  const close = vi.fn(async () => {});
  const pool = new HostedWorkspacePool(1, async () => ({
    resources: {},
    close,
  }));
  const response = await pool.runRequest(
    "workspace-a",
    "owner-a",
    new Request("https://app.invalid/api/runtime"),
    Date.now() + 10_000,
    async (_resources, signal) => {
      consumerSignal = signal;
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("first"));
            await remaining.promise;
            controller.close();
          },
        }),
      );
    },
    10_000,
  );
  const shutdown = pool.close();
  await Promise.resolve();
  expect(close).not.toHaveBeenCalled();
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
  remaining.release();
  expect((await reader.read()).done).toBe(true);
  expect(consumerSignal?.aborted).toBe(true);
  await shutdown;
  expect(close).toHaveBeenCalledOnce();
});

it("aborts the consumer before releasing a cancelled response", async () => {
  let consumerSignal: AbortSignal | undefined;
  const close = vi.fn(async () => {
    expect(consumerSignal?.aborted).toBe(true);
  });
  const pool = new HostedWorkspacePool(1, async () => ({
    resources: {},
    close,
  }));
  const response = await pool.runRequest(
    "workspace-a",
    "owner-a",
    new Request("https://app.invalid/api/runtime"),
    Date.now() + 10_000,
    async (_resources, signal) => {
      consumerSignal = signal;
      return new Response(new ReadableStream({ start() {} }));
    },
    10_000,
  );
  await response.body!.cancel("client disconnected");
  await pool.close();
  expect(consumerSignal?.aborted).toBe(true);
  expect(close).toHaveBeenCalledOnce();
});

it("bounds a response by the verified credential expiry", async () => {
  let consumerSignal: AbortSignal | undefined;
  const pool = new HostedWorkspacePool(1, async () => ({
    resources: {},
    close: async () => {},
  }));
  const response = await pool.runRequest(
    "workspace-a",
    "owner-a",
    new Request("https://app.invalid/api/runtime"),
    Date.now() + 20,
    async (_resources, signal) => {
      consumerSignal = signal;
      return new Response(new ReadableStream({ start() {} }));
    },
    10_000,
  );
  const reader = response.body!.getReader();
  await expect(reader.read()).resolves.toMatchObject({ done: true });
  expect(consumerSignal?.aborted).toBe(true);
  await pool.close();
});

it("does not release a callback that is still settling after its deadline", async () => {
  const settling = barrier();
  let consumerSignal: AbortSignal | undefined;
  const close = vi.fn(async () => {});
  const pool = new HostedWorkspacePool(1, async () => ({
    resources: {},
    close,
  }));
  const response = pool.runRequest(
    "workspace-a",
    "owner-a",
    new Request("https://app.invalid/api/runtime"),
    Date.now() + 20,
    async (_resources, signal) => {
      consumerSignal = signal;
      await settling.promise;
      return new Response("late");
    },
    20,
  );
  const shutdown = pool.close();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(consumerSignal?.aborted).toBe(true);
  expect(close).not.toHaveBeenCalled();
  settling.release();
  await expect(response).rejects.toThrow("deadline");
  await shutdown;
  expect(close).toHaveBeenCalledOnce();
});

it("invalidates the consumer lifetime when an operation rejects", async () => {
  let consumerSignal: AbortSignal | undefined;
  const pool = new HostedWorkspacePool(1, async () => ({
    resources: {},
    close: async () => {},
  }));
  await expect(
    pool.runRequest(
      "workspace-a",
      "owner-a",
      new Request("https://app.invalid/api/runtime"),
      Date.now() + 10_000,
      async (_resources, signal) => {
        consumerSignal = signal;
        throw new Error("operation failed");
      },
      10_000,
    ),
  ).rejects.toThrow("operation failed");
  expect(consumerSignal?.aborted).toBe(true);
  await pool.close();
});

it("surfaces workspace startup failure before a response exists", async () => {
  const pool = new HostedWorkspacePool(1, async () => {
    throw new Error("startup unavailable");
  });
  const request = new Request("https://app.invalid/api/runtime");
  const removeAbortListener = vi.spyOn(request.signal, "removeEventListener");
  await expect(
    pool.runRequest(
      "workspace-a",
      "owner-a",
      request,
      Date.now() + 10_000,
      async () => new Response(),
      10_000,
    ),
  ).rejects.toThrow("startup unavailable");
  expect(removeAbortListener).toHaveBeenCalledWith(
    "abort",
    expect.any(Function),
  );
});
