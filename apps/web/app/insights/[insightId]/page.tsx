"use client";

import dynamic from "next/dynamic";
import { use } from "react";
import { LoadingView } from "./_components";

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

interface PageProps {
  params: Promise<{ insightId: string }>;
}

/**
 * Insight Page
 *
 * Uses dynamic import with ssr: false to ensure IndexedDB operations
 * only happen in the browser, not during static site generation.
 */
export default function InsightPage({ params }: PageProps) {
  const { insightId } = use(params);

  return <InsightPageContent insightId={insightId} />;
}
