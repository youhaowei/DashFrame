import type { PostHog } from "posthog-js";

/**
 * Types of analytics events that can be queued before PostHog is initialized.
 */
export type QueuedEventType = "capture" | "identify" | "page_leave";

/**
 * Base interface for all queued events.
 */
interface BaseQueuedEvent {
  timestamp: number;
  type: QueuedEventType;
}

/**
 * Capture event for custom analytics events and pageviews.
 */
interface CaptureEvent extends BaseQueuedEvent {
  type: "capture";
  eventName: string;
  properties?: Record<string, unknown>;
}

/**
 * Identify event for associating a user with their actions.
 */
interface IdentifyEvent extends BaseQueuedEvent {
  type: "identify";
  distinctId: string;
  properties?: Record<string, unknown>;
}

/**
 * Page leave event (captured automatically by PostHog when enabled).
 */
interface PageLeaveEvent extends BaseQueuedEvent {
  type: "page_leave";
}

/**
 * Union type for all queued events.
 */
export type QueuedEvent = CaptureEvent | IdentifyEvent | PageLeaveEvent;

/**
 * Event queue for storing analytics events before PostHog is initialized.
 * Events are stored with timestamps and flushed in order once PostHog loads.
 */
class PostHogEventQueue {
  private queue: QueuedEvent[] = [];
  private flushed = false;
  private maxQueueSize = 100;

  /**
   * Queue a capture event (for custom events or pageviews).
   */
  capture(eventName: string, properties?: Record<string, unknown>): void {
    this.addEvent({
      type: "capture",
      timestamp: Date.now(),
      eventName,
      properties,
    });
  }

  /**
   * Queue an identify event to associate a user with their actions.
   */
  identify(distinctId: string, properties?: Record<string, unknown>): void {
    this.addEvent({
      type: "identify",
      timestamp: Date.now(),
      distinctId,
      properties,
    });
  }

  /**
   * Add an event to the queue if not yet flushed.
   */
  private addEvent(event: QueuedEvent): void {
    if (this.flushed) {
      return;
    }

    // Prevent queue from growing unbounded
    if (this.queue.length >= this.maxQueueSize) {
      // Drop oldest event to make room
      this.queue.shift();
    }

    this.queue.push(event);
  }

  /**
   * Flush all queued events to PostHog in order.
   * Events are replayed with their original timestamps preserved in properties.
   */
  flush(posthog: PostHog): void {
    if (this.flushed) {
      return;
    }

    this.flushed = true;

    // Sort by timestamp to ensure correct order (should already be ordered, but ensures consistency)
    const events = [...this.queue].sort((a, b) => a.timestamp - b.timestamp);

    for (const event of events) {
      switch (event.type) {
        case "capture":
          posthog.capture(event.eventName, {
            ...event.properties,
            $queued_at: event.timestamp,
          });
          break;

        case "identify":
          posthog.identify(event.distinctId, {
            ...event.properties,
            $queued_at: event.timestamp,
          });
          break;

        case "page_leave":
          // Page leave is handled automatically by PostHog
          // We don't need to replay this event
          break;
      }
    }

    // Clear the queue after flushing
    this.queue = [];
  }

  /**
   * Get the current number of queued events.
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Check if the queue has been flushed.
   */
  isFlushed(): boolean {
    return this.flushed;
  }

  /**
   * Get a copy of the current queue (for testing/debugging).
   */
  getQueue(): QueuedEvent[] {
    return [...this.queue];
  }

  /**
   * Reset the queue state. Primarily useful for testing.
   */
  reset(): void {
    this.queue = [];
    this.flushed = false;
  }
}

// Singleton instance for the application
let eventQueueInstance: PostHogEventQueue | null = null;

/**
 * Get the singleton PostHog event queue instance.
 */
export function getEventQueue(): PostHogEventQueue {
  if (!eventQueueInstance) {
    eventQueueInstance = new PostHogEventQueue();
  }
  return eventQueueInstance;
}

/**
 * Reset the event queue instance. Primarily useful for testing.
 */
export function resetEventQueue(): void {
  if (eventQueueInstance) {
    eventQueueInstance.reset();
  }
  eventQueueInstance = null;
}

/**
 * Queue a capture event if PostHog isn't loaded yet.
 * Convenience function that uses the singleton instance.
 */
export function queueCapture(
  eventName: string,
  properties?: Record<string, unknown>
): void {
  getEventQueue().capture(eventName, properties);
}

/**
 * Queue an identify event if PostHog isn't loaded yet.
 * Convenience function that uses the singleton instance.
 */
export function queueIdentify(
  distinctId: string,
  properties?: Record<string, unknown>
): void {
  getEventQueue().identify(distinctId, properties);
}

/**
 * Flush all queued events to PostHog.
 * Convenience function that uses the singleton instance.
 */
export function flushEventQueue(posthog: PostHog): void {
  getEventQueue().flush(posthog);
}

export { PostHogEventQueue };
