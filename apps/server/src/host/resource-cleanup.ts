import type { UUID } from "@dashframe/types";
import type { SecretRef } from "@wystack/secret-vault";
import type { HostContext } from "./context";

/** Drain committed cleanup records; retain failures for a later pass or restart. */
export class HostResourceCleanup {
  private active: Promise<void> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  constructor(private readonly ctx: HostContext) {}

  async recoverPendingBatches(): Promise<void> {
    let cursor: string | null = null;
    for (;;) {
      const page = await this.ctx.metadata.listPendingHostBatches({
        paginationOpts: { cursor, numItems: 100 },
      });
      for (const batch of page.page) {
        await this.ctx.metadata.settleHostBatch({
          operationId: batch.operationId,
          principal: batch.principal,
          requestHash: batch.requestHash,
          stagedRefs: batch.stagedRefs,
        });
      }
      if (page.isDone) return;
      cursor = page.continueCursor;
    }
  }

  start(): void {
    this.timer = setInterval(() => this.run(), 1000);
    this.timer.unref();
  }
  run(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (!this.active) {
      this.active = this.drain()
        .catch(() => {
          console.warn(
            "[dashframe] Resource cleanup deferred; durable records retained",
          );
        })
        .finally(() => {
          this.active = undefined;
        });
    }
    return this.active;
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }
  private async drain(): Promise<void> {
    let cursor: string | null = null;
    for (;;) {
      const page = await this.ctx.metadata.listCleanup({
        paginationOpts: { cursor, numItems: 100 },
      });
      for (const candidate of page.page) {
        await this.clean(candidate.cleanupId);
      }
      if (page.isDone) return;
      cursor = page.continueCursor;
    }
  }
  private async clean(cleanupId: string): Promise<void> {
    try {
      const job = await this.ctx.metadata.claimCleanup({
        cleanupId: cleanupId,
      });
      if (!job) return;
      if (job.kind === "frame") {
        if (!this.ctx.dataFrameStorage) return;
        await this.ctx.dataPlaneRuntime?.unregisterTable?.(
          `df_${job.resourceId.replaceAll("-", "_")}`,
        );
        await this.ctx.dataFrameStorage.delete(job.resourceId as UUID);
      } else {
        if (!this.ctx.vault) return;
        await this.ctx.vault.delete(job.resourceId as SecretRef);
      }
      await this.ctx.metadata.ackCleanup({
        cleanupId: job.cleanupId,
        claimToken: job.claimToken,
      });
    } catch {
      console.warn(
        "[dashframe] Resource cleanup deferred; durable record retained",
      );
    }
  }
}
