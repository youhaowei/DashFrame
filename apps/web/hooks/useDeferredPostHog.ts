"use client";

import { useCallback } from "react";
import { usePostHogContext } from "@/components/providers/PostHogProvider";
import { queueCapture, queueIdentify } from "@/lib/posthog/event-queue";

/**
 * Return type for the useDeferredPostHog hook.
 * Provides analytics methods that work regardless of PostHog loading state.
 */
interface UseDeferredPostHogResult {
  /**
   * Capture an analytics event. If PostHog isn't loaded yet,
   * the event will be queued and sent once PostHog initializes.
   */
  capture: (eventName: string, properties?: Record<string, unknown>) => void;

  /**
   * Identify a user. If PostHog isn't loaded yet,
   * the identify call will be queued and sent once PostHog initializes.
   */
  identify: (distinctId: string, properties?: Record<string, unknown>) => void;

  /**
   * The raw PostHog instance, if loaded. Use with caution - this may be null.
   * For most use cases, prefer the capture/identify methods instead.
   */
  posthog: ReturnType<typeof usePostHogContext>["posthog"];

  /** Whether PostHog has been loaded and initialized */
  isLoaded: boolean;

  /** Whether PostHog is currently loading */
  isLoading: boolean;
}

/**
 * Hook for tracking analytics with PostHog, handling deferred loading gracefully.
 *
 * This hook provides a consistent API for analytics tracking regardless of
 * whether PostHog has finished loading. If PostHog isn't loaded yet, events
 * are automatically queued and sent once initialization completes.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { capture, identify } = useDeferredPostHog();
 *
 *   const handleButtonClick = () => {
 *     // This works whether PostHog is loaded or not
 *     capture('button_clicked', { buttonId: 'cta' });
 *   };
 *
 *   return <button onClick={handleButtonClick}>Click me</button>;
 * }
 * ```
 */
export function useDeferredPostHog(): UseDeferredPostHogResult {
  const { posthog, isLoaded, isLoading } = usePostHogContext();

  /**
   * Capture an analytics event, queuing if PostHog isn't ready.
   */
  const capture = useCallback(
    (eventName: string, properties?: Record<string, unknown>) => {
      if (posthog && isLoaded) {
        // PostHog is loaded, send directly
        posthog.capture(eventName, properties);
      } else {
        // PostHog not loaded yet, queue the event
        queueCapture(eventName, properties);
      }
    },
    [posthog, isLoaded],
  );

  /**
   * Identify a user, queuing if PostHog isn't ready.
   */
  const identify = useCallback(
    (distinctId: string, properties?: Record<string, unknown>) => {
      if (posthog && isLoaded) {
        // PostHog is loaded, send directly
        posthog.identify(distinctId, properties);
      } else {
        // PostHog not loaded yet, queue the identify
        queueIdentify(distinctId, properties);
      }
    },
    [posthog, isLoaded],
  );

  return {
    capture,
    identify,
    posthog,
    isLoaded,
    isLoading,
  };
}
