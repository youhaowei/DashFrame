"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
} from "react";
import type { PostHog } from "posthog-js";
import { loadPostHog, getPostHogInstance } from "@/lib/posthog/loader";
import { flushEventQueue } from "@/lib/posthog/event-queue";

/**
 * Context value for the deferred PostHog provider.
 * Exposes loading state and PostHog instance for components.
 */
interface PostHogContextValue {
  /** The PostHog instance, null while loading or if disabled */
  posthog: PostHog | null;
  /** Whether PostHog has been loaded and initialized */
  isLoaded: boolean;
  /** Whether PostHog is currently loading */
  isLoading: boolean;
}

const PostHogContext = createContext<PostHogContextValue>({
  posthog: null,
  isLoaded: false,
  isLoading: false,
});

/**
 * PostHog provider with deferred loading.
 *
 * This provider dynamically imports posthog-js after the page becomes idle
 * (using requestIdleCallback or setTimeout fallback for Safari), improving
 * initial page load performance by not blocking the critical rendering path.
 *
 * Events captured before PostHog loads are queued and automatically flushed
 * once initialization completes.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PostHogContextValue>({
    posthog: null,
    isLoaded: false,
    isLoading: false,
  });
  const initRef = useRef(false);

  useEffect(() => {
    // Skip if no API key configured
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      return;
    }

    // Prevent multiple initialization attempts
    if (initRef.current) return;
    initRef.current = true;

    // Check if already loaded (e.g., from another provider instance)
    const existingInstance = getPostHogInstance();
    if (existingInstance) {
      setState({
        posthog: existingInstance,
        isLoaded: true,
        isLoading: false,
      });
      return;
    }

    // Start loading
    setState((prev) => ({ ...prev, isLoading: true }));

    loadPostHog({
      apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
      apiHost:
        process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      personProfiles: "identified_only",
      capturePageview: false, // We'll capture manually for better SPA support
      capturePageleave: true,
    })
      .then(({ posthog }) => {
        // Flush any events that were queued before PostHog loaded
        flushEventQueue(posthog);

        setState({
          posthog,
          isLoaded: true,
          isLoading: false,
        });
      })
      .catch((error) => {
        // PostHog loading failed - analytics will be unavailable
        // This is non-critical, so we just log and continue
        console.warn("Failed to load PostHog analytics:", error);
        setState({
          posthog: null,
          isLoaded: false,
          isLoading: false,
        });
      });
  }, []);

  // If PostHog is not configured, render children without context wrapper
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return <>{children}</>;
  }

  return (
    <PostHogContext.Provider value={state}>{children}</PostHogContext.Provider>
  );
}

/**
 * Hook to access the deferred PostHog context.
 *
 * Returns the PostHog instance (if loaded), loading state, and initialization state.
 * Use this hook in components that need to track analytics events.
 */
export function usePostHogContext(): PostHogContextValue {
  return useContext(PostHogContext);
}

/**
 * Export the context for advanced use cases (e.g., testing).
 */
export { PostHogContext };
