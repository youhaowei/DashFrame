/**
 * Unit tests for the PostHog event queue.
 *
 * These tests verify that analytics events are properly queued before PostHog
 * is initialized and correctly flushed once initialization completes.
 */
import type { PostHog } from "posthog-js";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  PostHogEventQueue,
  flushEventQueue,
  queueCapture,
  queueIdentify,
} from "../event-queue";

/**
 * Creates a mock PostHog instance for testing.
 */
function createMockPostHog(): PostHog {
  return {
    capture: vi.fn(),
    identify: vi.fn(),
  } as unknown as PostHog;
}

describe("PostHogEventQueue", () => {
  let queue: PostHogEventQueue;

  beforeEach(() => {
    queue = new PostHogEventQueue();
  });

  describe("max queue size", () => {
    it("should drop oldest event when queue exceeds max size", () => {
      // Default max size is 100
      for (let i = 0; i < 105; i++) {
        queue.capture(`event_${i}`);
      }

      expect(queue.size()).toBe(100);
      const events = queue.getQueue();
      // First 5 events should have been dropped
      expect((events[0] as { eventName: string }).eventName).toBe("event_5");
      expect((events[99] as { eventName: string }).eventName).toBe("event_104");
    });
  });

  describe("flush", () => {
    it("should include queued_at timestamp in flushed events", () => {
      const mockPostHog = createMockPostHog();

      const before = Date.now();
      queue.capture("event_1", { prop: "value" });
      const after = Date.now();

      queue.flush(mockPostHog);

      expect(mockPostHog.capture).toHaveBeenCalledWith(
        "event_1",
        expect.objectContaining({
          prop: "value",
          queued_at: expect.any(Number),
        }),
      );
      const queuedAt = (mockPostHog.capture as ReturnType<typeof vi.fn>).mock
        .calls[0][1].queued_at;
      expect(queuedAt).toBeGreaterThanOrEqual(before);
      expect(queuedAt).toBeLessThanOrEqual(after);
    });

    it("should empty the queue on flush, then ignore later events and flushes", () => {
      const mockPostHog = createMockPostHog();

      queue.capture("event_1");
      expect(queue.isFlushed()).toBe(false);
      queue.flush(mockPostHog);
      expect(queue.isFlushed()).toBe(true);
      expect(queue.size()).toBe(0);

      queue.capture("event_2");
      queue.identify("user_123");
      expect(queue.size()).toBe(0);
      queue.flush(mockPostHog);

      expect(mockPostHog.capture).toHaveBeenCalledTimes(1);
      expect(mockPostHog.identify).not.toHaveBeenCalled();
    });
  });
});

describe("singleton functions", () => {
  describe("flushEventQueue", () => {
    it("should flush events from singleton queue", () => {
      const mockPostHog = createMockPostHog();

      queueCapture("event_1");
      queueIdentify("user_123");
      flushEventQueue(mockPostHog);

      expect(mockPostHog.capture).toHaveBeenCalledTimes(1);
      expect(mockPostHog.identify).toHaveBeenCalledTimes(1);
    });
  });
});
