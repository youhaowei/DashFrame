const SERVER_FRAME_FAILURE =
  /native engine|loopback server|local server|127\.0\.0\.1:\d+|data\/frames\/[0-9a-f-]+\/mosaic|chart query timed out|chart query failed|failed to fetch/i;

export function isServerFrameEngineLoss(reason: unknown): boolean {
  const message =
    reason instanceof Error ? reason.message : String(reason ?? "unknown");
  return SERVER_FRAME_FAILURE.test(message);
}
