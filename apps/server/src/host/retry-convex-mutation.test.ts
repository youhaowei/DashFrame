import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { retryConvexMutation } from "./retry-convex-mutation";

afterEach(() => vi.useRealTimers());

describe("retryConvexMutation", () => {
  it("retries transient 429 failures", async () => {
    vi.useFakeTimers();
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Convex request failed (429)"))
      .mockResolvedValue(undefined);
    const result = retryConvexMutation(run);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-throttling failure", async () => {
    const error = new Error("invalid legacy row");
    await expect(retryConvexMutation(() => Promise.reject(error))).rejects.toBe(
      error,
    );
  });

  it("returns the successful mutation result", async () => {
    await expect(
      retryConvexMutation(async () => ({ repaired: 2 })),
    ).resolves.toEqual({ repaired: 2 });
  });
});
