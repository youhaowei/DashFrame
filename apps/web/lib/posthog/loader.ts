import type { PostHog } from "posthog-js";

/**
 * PostHog configuration options passed during initialization.
 */
export interface PostHogConfig {
  apiKey: string;
  apiHost: string;
  personProfiles?: "identified_only" | "always";
  capturePageview?: boolean;
  capturePageleave?: boolean;
}

/**
 * Result of loading PostHog, includes the instance and module.
 */
export interface PostHogLoadResult {
  posthog: PostHog;
}

// Track loading state to prevent multiple initializations
let loadingPromise: Promise<PostHogLoadResult> | null = null;
let loadedInstance: PostHog | null = null;

/**
 * Cross-browser requestIdleCallback with setTimeout fallback.
 * Safari doesn't support requestIdleCallback, so we fall back to setTimeout.
 *
 * @remarks
 * This function returns early without invoking the callback when `window` is undefined
 * (i.e., during SSR). This means `waitForIdle()` would hang if called during SSR.
 * This is acceptable since `loadPostHog` is only called from client-side effects.
 *
 * @param callback - Function to invoke when the browser becomes idle
 */
function scheduleIdleCallback(callback: () => void): void {
  if (typeof window === "undefined") {
    return;
  }

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: 2000 });
  } else {
    // Fallback for Safari and older browsers
    // Use setTimeout with 1ms to defer to next event loop tick
    setTimeout(callback, 1);
  }
}

/**
 * Returns a promise that resolves after the page becomes idle.
 * Uses requestIdleCallback when available, setTimeout as fallback.
 *
 * @remarks
 * This function will hang indefinitely if called during SSR (when `window` is undefined).
 * Only call this from client-side code. See `scheduleIdleCallback` for details.
 */
function waitForIdle(): Promise<void> {
  return new Promise((resolve) => {
    scheduleIdleCallback(resolve);
  });
}

/**
 * Dynamically imports and initializes PostHog after the page becomes idle.
 * This defers the loading of posthog-js to improve initial page load performance.
 *
 * @param config - PostHog configuration options
 * @returns Promise resolving to the PostHog instance once loaded and initialized
 */
export async function loadPostHog(
  config: PostHogConfig,
): Promise<PostHogLoadResult> {
  // Return existing instance if already loaded
  if (loadedInstance) {
    return { posthog: loadedInstance };
  }

  // Return existing promise if already loading
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    // Wait for browser idle time before loading
    await waitForIdle();

    // Dynamically import posthog-js
    const posthogModule = await import("posthog-js");
    const posthog = posthogModule.default;

    // Initialize PostHog with the provided config
    posthog.init(config.apiKey, {
      api_host: config.apiHost,
      person_profiles: config.personProfiles ?? "identified_only",
      capture_pageview: config.capturePageview ?? false,
      capture_pageleave: config.capturePageleave ?? true,
    });

    loadedInstance = posthog;

    return { posthog };
  })();

  return loadingPromise;
}

/**
 * Returns the PostHog instance if already loaded, or null if not yet loaded.
 * Use this for synchronous access when you need to check if PostHog is available.
 */
export function getPostHogInstance(): PostHog | null {
  return loadedInstance;
}

/**
 * Returns true if PostHog has been loaded and initialized.
 */
export function isPostHogLoaded(): boolean {
  return loadedInstance !== null;
}

/**
 * Resets the loader state. Primarily useful for testing.
 * Properly cleans up the PostHog SDK instance (listeners/timers) before resetting state.
 */
export async function resetPostHogLoader(): Promise<void> {
  if (loadedInstance) {
    try {
      // Clean up listeners and timers by calling reset()
      // This clears user data and resets the instance state
      loadedInstance.reset();

      // Also try to call destroy() if available at runtime for additional cleanup
      // (destroy() may exist but not be in the type definitions)
      const instanceWithDestroy = loadedInstance as unknown as {
        destroy?: () => void | Promise<void>;
      };
      if (typeof instanceWithDestroy.destroy === "function") {
        const destroyResult = instanceWithDestroy.destroy();
        // Await if destroy() returns a promise (handles both sync and async cases)
        if (destroyResult instanceof Promise) {
          await destroyResult;
        }
      }
    } catch (error) {
      // Silently handle cleanup errors to ensure state is always reset
      console.warn("Error cleaning up PostHog instance:", error);
    }
  }

  // Reset state variables after cleanup
  loadingPromise = null;
  loadedInstance = null;
}
