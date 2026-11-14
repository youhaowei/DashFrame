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
  getEventQueue,
  queueCapture,
  queueIdentify,
  resetEventQueue,
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

  describe("mixed events", () => {
    it("should queue both capture and identify events in order", () => {
      queue.capture("page_view");
      queue.identify("user_123");
      queue.capture("button_click");

      expect(queue.size()).toBe(3);
      const events = queue.getQueue();
      expect(events[0].type).toBe("capture");
      expect(events[1].type).toBe("identify");
      expect(events[2].type).toBe("capture");
    });
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
    it("should flush all events to PostHog", () => {
      const mockPostHog = createMockPostHog();

      queue.capture("event_1", { prop: "value" });
      queue.identify("user_123", { email: "test@example.com" });
      queue.capture("event_2");

      queue.flush(mockPostHog);

      expect(mockPostHog.capture).toHaveBeenCalledTimes(2);
      expect(mockPostHog.identify).toHaveBeenCalledTimes(1);
    });

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

    it("should preserve original properties when flushing", () => {
      const mockPostHog = createMockPostHog();

      const before = Date.now();
      queue.identify("user_123", { name: "Test", plan: "pro" });
      const after = Date.now();
      queue.flush(mockPostHog);

      expect(mockPostHog.identify).toHaveBeenCalledWith(
        "user_123",
        expect.objectContaining({
          name: "Test",
          plan: "pro",
          queued_at: expect.any(Number),
        }),
      );
      const queuedAt = (mockPostHog.identify as ReturnType<typeof vi.fn>).mock
        .calls[0][1].queued_at;
      expect(queuedAt).toBeGreaterThanOrEqual(before);
      expect(queuedAt).toBeLessThanOrEqual(after);
    });

    it("should flush events in timestamp order", () => {
      const mockPostHog = createMockPostHog();

      queue.capture("first");
      queue.capture("second");
      queue.capture("third");

      queue.flush(mockPostHog);

      const calls = (mockPostHog.capture as ReturnType<typeof vi.fn>).mock
        .calls;
      expect(calls[0][0]).toBe("first");
      expect(calls[1][0]).toBe("second");
      expect(calls[2][0]).toBe("third");
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

  describe("reset", () => {
    it("should clear queued events and the flushed state, then queue again", () => {
      const mockPostHog = createMockPostHog();

      queue.capture("event_1");
      queue.reset();
      expect(queue.size()).toBe(0);

      queue.flush(mockPostHog);
      expect(mockPostHog.capture).not.toHaveBeenCalled();
      expect(queue.isFlushed()).toBe(true);
      queue.reset();
      expect(queue.isFlushed()).toBe(false);

      queue.capture("event_2");

      expect(queue.size()).toBe(1);
      const events = queue.getQueue();
      expect((events[0] as { eventName: string }).eventName).toBe("event_2");
    });
  });
});

describe("singleton functions", () => {
  beforeEach(() => {
    resetEventQueue();
  });

  describe("getEventQueue", () => {
    it("should return the same instance on multiple calls", () => {
      const queue1 = getEventQueue();
      const queue2 = getEventQueue();

      expect(queue1).toBe(queue2);
    });
  });

  describe("resetEventQueue", () => {
    it("should create new instance after reset", () => {
      const queue1 = getEventQueue();
      resetEventQueue();
      const queue2 = getEventQueue();

      expect(queue1).not.toBe(queue2);
    });
  });

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
