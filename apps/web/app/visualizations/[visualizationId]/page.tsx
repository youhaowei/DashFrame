"use client";

import { Spinner } from "@dashframe/ui";
import dynamic from "next/dynamic";
import { use } from "react";

/**
 * Skeleton loading state rendered during SSR.
 * The actual content is loaded client-side only to avoid IndexedDB access during SSR.
 */
function VisualizationSkeleton() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Loading visualization...
        </p>
      </div>
    </div>
  );
}

/**
 * Dynamically import the content component with SSR disabled.
 * This prevents @dashframe/core (IndexedDB) from being evaluated during SSR.
 */
const VisualizationPageContent = dynamic(
  () => import("./_components/VisualizationPageContent"),
  {
    ssr: false,
    loading: () => <VisualizationSkeleton />,
  },
);

interface PageProps {
  params: Promise<{ visualizationId: string }>;
}

export default function VisualizationPage({ params }: PageProps) {
  const { visualizationId } = use(params);

  return <VisualizationPageContent visualizationId={visualizationId} />;
}
