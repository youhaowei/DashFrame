"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, Suspense, useRef } from "react";
import { useDeferredPostHog } from "@/hooks/useDeferredPostHog";

function PostHogPageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { capture } = useDeferredPostHog();

  // Track which URLs we've already captured to prevent duplicate pageviews
  const capturedUrls = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!pathname) return;

    // Build the full URL
    let url = window.origin + pathname;
    if (searchParams.toString()) {
      url = url + `?${searchParams.toString()}`;
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
  }, [pathname, searchParams, capture]);

  return null;
}

// Wrap in Suspense because useSearchParams() needs it in App Router
export function PostHogPageView() {
  return (
    <Suspense fallback={null}>
      <PostHogPageViewTracker />
    </Suspense>
  );
}
