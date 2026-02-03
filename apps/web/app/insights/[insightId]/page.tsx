"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
// Import directly to avoid loading InsightView which imports @dashframe/core
import { LoadingView } from "./_components/LoadingView";

/**
 * Dynamically import the insight content component with SSR disabled.
 * This prevents IndexedDB access during static site generation.
 */
const InsightPageContent = dynamic(
  () => import("./_components/InsightPageContent"),
  {
    ssr: false,
    loading: () => <LoadingView />,
  },
);

/**
 * Insight Page
 *
 * Uses dynamic import with ssr: false to ensure IndexedDB operations
 * only happen in the browser, not during static site generation.
 * Uses useParams instead of server params to avoid server-side execution.
 */
export default function InsightPage() {
  const params = useParams<{ insightId: string }>();
  const insightId = params?.insightId;

  if (!insightId) {
    return <LoadingView />;
  }

  return <InsightPageContent insightId={insightId} />;
}
