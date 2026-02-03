"use client";

import { Spinner } from "@dashframe/ui";
import dynamic from "next/dynamic";
import { use } from "react";

/**
 * Skeleton loading state rendered during SSR.
 * The actual content is loaded client-side only to avoid IndexedDB access during SSR.
 */
function InsightSkeleton() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading insight...</p>
      </div>
    </div>
  );
}

/**
 * Dynamically import the content component with SSR disabled.
 * This prevents @dashframe/core (IndexedDB) from being evaluated during SSR.
 */
const InsightPageContent = dynamic(
  () => import("./_components/InsightPageContent"),
  {
    ssr: false,
    loading: () => <InsightSkeleton />,
  },
);

interface PageProps {
  params: Promise<{ insightId: string }>;
}

export default function InsightPage({ params }: PageProps) {
  const { insightId } = use(params);

  return <InsightPageContent insightId={insightId} />;
}
