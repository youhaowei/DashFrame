import { describe, expect, it } from "vite-plus/test";

import { isServerFrameEngineLoss } from "./server-frame-engine-loss";

describe("isServerFrameEngineLoss", () => {
  it.each([
    "Chart query timed out",
    "Chart query failed with status 503",
    "GET /data/frames/019fedcf-ed6b-79e3-bae1-2d5485d0c964/mosaic failed",
    "Failed to fetch",
  ])("recognizes the server-frame failure boundary: %s", (message) => {
    expect(isServerFrameEngineLoss(message)).toBe(true);
  });

  it.each([
    "failed to upload Arrow data",
    "POST /data/tables failed",
    "ordinary application bug",
  ])(
    "does not retain a legacy upload or unrelated error path: %s",
    (message) => {
      expect(isServerFrameEngineLoss(message)).toBe(false);
    },
  );
});
