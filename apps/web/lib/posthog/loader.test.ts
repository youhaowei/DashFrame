import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { isPostHogLoaded, loadPostHog, resetPostHogLoader } from "./loader";

const config = {
  apiKey: "test-key",
  apiHost: "https://posthog.example.com",
};

describe("PostHog loader lifecycle", () => {
  let idleCallbacks: Array<() => void>;

  beforeEach(async () => {
    await resetPostHogLoader();
    idleCallbacks = [];
    window.requestIdleCallback = vi.fn((callback) => {
      idleCallbacks.push(() =>
        callback({ didTimeout: false, timeRemaining: () => 1 }),
      );
      return idleCallbacks.length;
    });
  });

  afterEach(async () => {
    await resetPostHogLoader();
  });

  it("does not initialize a load invalidated while waiting for idle", async () => {
    const staleLoad = loadPostHog(config);

    await resetPostHogLoader();
    idleCallbacks[0]?.();

    await expect(staleLoad).rejects.toThrow("PostHog load was cancelled");
    expect(isPostHogLoaded()).toBe(false);
  });
});
