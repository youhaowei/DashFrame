/**
 * Unit tests for the PostHog event queue.
 *
 * These tests verify that analytics events are properly queued before PostHog
 * is initialized and correctly flushed once initialization completes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  PostHogEventQueue,
  getEventQueue,
  resetEventQueue,
  queueCapture,
  queueIdentify,
  flushEventQueue,
} from "../event-queue";
import type { PostHog } from "posthog-js";

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

  describe("capture", () => {
    it("should queue a capture event with event name", () => {
      queue.capture("test_event");

      expect(queue.size()).toBe(1);
      const events = queue.getQueue();
      expect(events[0].type).toBe("capture");
      expect((events[0] as { eventName: string }).eventName).toBe("test_event");
    });

    it("should queue a capture event with properties", () => {
      queue.capture("test_event", { page: "/home", button: "signup" });

      const events = queue.getQueue();
      expect(events[0].type).toBe("capture");
      const captureEvent = events[0] as {
        properties?: Record<string, unknown>;
      };
      expect(captureEvent.properties).toEqual({
        page: "/home",
        button: "signup",
      });
    });

    it("should store timestamp with the event", () => {
      const before = Date.now();
      queue.capture("test_event");
      const after = Date.now();

      const events = queue.getQueue();
      expect(events[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(events[0].timestamp).toBeLessThanOrEqual(after);
    });

    it("should queue multiple capture events in order", () => {
      queue.capture("event_1");
      queue.capture("event_2");
      queue.capture("event_3");

      expect(queue.size()).toBe(3);
      const events = queue.getQueue();
      expect((events[0] as { eventName: string }).eventName).toBe("event_1");
      expect((events[1] as { eventName: string }).eventName).toBe("event_2");
      expect((events[2] as { eventName: string }).eventName).toBe("event_3");
    });
  });

  describe("identify", () => {
    it("should queue an identify event with distinct ID", () => {
      queue.identify("user_123");

      expect(queue.size()).toBe(1);
      const events = queue.getQueue();
      expect(events[0].type).toBe("identify");
      expect((events[0] as { distinctId: string }).distinctId).toBe("user_123");
    });

    it("should queue an identify event with properties", () => {
      queue.identify("user_123", {
        email: "test@example.com",
        name: "Test User",
      });

      const events = queue.getQueue();
      const identifyEvent = events[0] as {
        properties?: Record<string, unknown>;
      };
      expect(identifyEvent.properties).toEqual({
        email: "test@example.com",
        name: "Test User",
      });
    });

    it("should store timestamp with identify event", () => {
      const before = Date.now();
      queue.identify("user_123");
      const after = Date.now();

      const events = queue.getQueue();
      expect(events[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(events[0].timestamp).toBeLessThanOrEqual(after);
    });
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

      queue.capture("event_1", { prop: "value" });

      queue.flush(mockPostHog);

      expect(mockPostHog.capture).toHaveBeenCalledWith(
        "event_1",
        expect.objectContaining({
          prop: "value",
          queued_at: expect.any(Number),
        }),
      );
    });

    it("should preserve original properties when flushing", () => {
      const mockPostHog = createMockPostHog();

      queue.identify("user_123", { name: "Test", plan: "pro" });
      queue.flush(mockPostHog);

      expect(mockPostHog.identify).toHaveBeenCalledWith(
        "user_123",
        expect.objectContaining({
          name: "Test",
          plan: "pro",
          queued_at: expect.any(Number),
        }),
      );
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

    it("should clear the queue after flushing", () => {
      const mockPostHog = createMockPostHog();

      queue.capture("event_1");
      queue.capture("event_2");

      queue.flush(mockPostHog);

      expect(queue.size()).toBe(0);
    });

    it("should mark queue as flushed", () => {
      const mockPostHog = createMockPostHog();

      expect(queue.isFlushed()).toBe(false);
      queue.flush(mockPostHog);
      expect(queue.isFlushed()).toBe(true);
    });

    it("should not flush again if already flushed", () => {
      const mockPostHog = createMockPostHog();

      queue.capture("event_1");
      queue.flush(mockPostHog);
      queue.capture("event_2");
      queue.flush(mockPostHog);

      expect(mockPostHog.capture).toHaveBeenCalledTimes(1);
    });
  });

  describe("events after flush", () => {
    it("should not queue events after flush", () => {
      const mockPostHog = createMockPostHog();

      queue.capture("before_flush");
      queue.flush(mockPostHog);
      queue.capture("after_flush");

      expect(queue.size()).toBe(0);
      // Verify the first event was flushed but nothing queued after
      expect(mockPostHog.capture).toHaveBeenCalledTimes(1);
    });

    it("should not queue identify after flush", () => {
      const mockPostHog = createMockPostHog();

      queue.flush(mockPostHog);
      queue.identify("user_123");

      expect(queue.size()).toBe(0);
      expect(mockPostHog.identify).not.toHaveBeenCalled();
    });
  });

  describe("reset", () => {
    it("should clear all queued events", () => {
      queue.capture("event_1");
      queue.capture("event_2");

      queue.reset();

      expect(queue.size()).toBe(0);
      expect(queue.getQueue()).toEqual([]);
    });

    it("should reset flushed state", () => {
      const mockPostHog = createMockPostHog();

      queue.flush(mockPostHog);
      expect(queue.isFlushed()).toBe(true);

      queue.reset();
      expect(queue.isFlushed()).toBe(false);
    });

    it("should allow queueing events after reset", () => {
      const mockPostHog = createMockPostHog();

      queue.capture("event_1");
      queue.flush(mockPostHog);
      queue.reset();

      queue.capture("event_2");

      expect(queue.size()).toBe(1);
      const events = queue.getQueue();
      expect((events[0] as { eventName: string }).eventName).toBe("event_2");
    });
  });

  describe("getQueue", () => {
    it("should return a copy of the queue", () => {
      queue.capture("event_1");

      const events1 = queue.getQueue();
      const events2 = queue.getQueue();

      expect(events1).toEqual(events2);
      expect(events1).not.toBe(events2);
    });

    it("should not allow mutation of internal queue", () => {
      queue.capture("event_1");

      const events = queue.getQueue();
      events.push({
        type: "capture",
        eventName: "hacked",
        timestamp: 0,
      } as never);

      expect(queue.size()).toBe(1);
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
    it("should reset the singleton instance", () => {
      const queue1 = getEventQueue();
      queue1.capture("event_1");

      resetEventQueue();
      const queue2 = getEventQueue();

      expect(queue2.size()).toBe(0);
    });

    it("should create new instance after reset", () => {
      const queue1 = getEventQueue();
      resetEventQueue();
      const queue2 = getEventQueue();

      expect(queue1).not.toBe(queue2);
    });

    it("should handle reset when no instance exists", () => {
      // Should not throw
      expect(() => resetEventQueue()).not.toThrow();
    });
  });

  describe("queueCapture", () => {
    it("should queue capture event using singleton", () => {
      queueCapture("test_event", { prop: "value" });

      const queue = getEventQueue();
      expect(queue.size()).toBe(1);

      const events = queue.getQueue();
      expect(events[0].type).toBe("capture");
      expect((events[0] as { eventName: string }).eventName).toBe("test_event");
    });
  });

  describe("queueIdentify", () => {
    it("should queue identify event using singleton", () => {
      queueIdentify("user_123", { email: "test@example.com" });

      const queue = getEventQueue();
      expect(queue.size()).toBe(1);

      const events = queue.getQueue();
      expect(events[0].type).toBe("identify");
      expect((events[0] as { distinctId: string }).distinctId).toBe("user_123");
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
