"use client";

import dynamic from "next/dynamic";
import { LoadingView } from "./LoadingView";

/**
 * Dynamically import the insight content component with SSR disabled.
 * This prevents IndexedDB access during static site generation.
 */
const InsightPageContent = dynamic(() => import("./InsightPageContent"), {
  ssr: false,
  loading: () => <LoadingView />,
});

interface InsightPageClientProps {
  insightId: string;
}

/**
 * Client-side insight page wrapper.
 *
 * Receives insightId from the server component and renders
 * the content with SSR disabled to prevent IndexedDB access.
 */
export function InsightPageClient({ insightId }: InsightPageClientProps) {
  return <InsightPageContent insightId={insightId} />;
}
