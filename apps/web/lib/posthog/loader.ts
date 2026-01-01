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
  config: PostHogConfig
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
 */
export function resetPostHogLoader(): void {
  loadingPromise = null;
  loadedInstance = null;
}
