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
