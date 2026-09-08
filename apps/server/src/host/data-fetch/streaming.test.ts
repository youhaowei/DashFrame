import { describe, expect, it } from "vite-plus/test";
import type { HostContext } from "../context";
import {
  CoalescedOperation,
  STREAM_BATCH_BYTES,
  STREAM_TOTAL_BYTES,
  StreamingBudget,
} from "./streaming";

it("preserves buffered payloads above the batch cap while enforcing total bytes", () => {
  const budget = new StreamingBudget({} as HostContext, 0);
  expect(() => budget.acceptBuffered(STREAM_BATCH_BYTES + 1, 1)).not.toThrow();
  expect(() => budget.acceptBuffered(STREAM_TOTAL_BYTES, 1)).toThrow(
    "SOURCE_RESULT_TOO_LARGE",
  );
});

describe("coalesced materialization cancellation", () => {
  it("keeps acquisition alive for a remaining consumer", async () => {
    let finish!: () => void;
    let operationSignal!: AbortSignal;
    const operation = new CoalescedOperation((signal) => {
      operationSignal = signal;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const first = new AbortController();
    const second = new AbortController();
    const a = operation.wait(first.signal);
    const b = operation.wait(second.signal);
    first.abort(new Error("first left"));
    await expect(a).rejects.toThrow("first left");
    expect(operationSignal.aborted).toBe(false);
    finish();
    await b;
  });

  it("waits for rollback when the final consumer cancels", async () => {
    let clean!: () => void;
    const operation = new CoalescedOperation(async (signal) => {
      await new Promise<void>((resolve) => {
        clean = resolve;
      });
      signal.throwIfAborted();
    });
    const controller = new AbortController();
    const result = operation.wait(controller.signal);
    controller.abort(new Error("cancelled"));
    clean();
    await expect(result).rejects.toThrow("cancelled");
  });
});
