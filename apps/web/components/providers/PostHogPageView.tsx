import { useDeferredPostHog } from "@/hooks/useDeferredPostHog";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

function PostHogPageViewTracker() {
  const location = useLocation();
  const { capture } = useDeferredPostHog();

  // Track which URLs we've already captured to prevent duplicate pageviews
  const capturedUrls = useRef<Set<string>>(new Set());

  useEffect(() => {
    const pathname = location.pathname;
    if (!pathname) return;

    // Build the full URL
    let url = window.origin + pathname;
    const searchString = location.search
      ? new URLSearchParams(
          location.search as Record<string, string>,
        ).toString()
      : "";
    if (searchString) {
      url = url + `?${searchString}`;
    }

    // Prevent duplicate captures for the same URL within the same navigation
    // This can happen if the component re-renders while PostHog is loading
    if (capturedUrls.current.has(url)) {
      return;
    }

    // Mark this URL as captured
    capturedUrls.current.add(url);

    // Capture the pageview - this will queue if PostHog isn't loaded yet
    capture("$pageview", { $current_url: url });

    // Clean up old URLs to prevent memory growth
    // Keep only the current URL in the set after capture
    capturedUrls.current = new Set([url]);
  }, [location, capture]);

  return null;
}

/**
 * Renders the PostHog page view tracker.
 * Exported for use by other parts of the app.
 *
 * @returns JSX.Element
 */
export function PostHogPageView() {
  return <PostHogPageViewTracker />;
}
