"use client";

import dynamic from "next/dynamic";
import { use } from "react";

/**
 * Skeleton loading state rendered during SSR.
 * The actual content is loaded client-side only to avoid IndexedDB access during SSR.
 */
function DataSourceSkeleton() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <p className="text-sm text-muted-foreground">Loading data source...</p>
      </div>
    </div>
  );
}

/**
 * Dynamically import the content component with SSR disabled.
 * This prevents @dashframe/core (IndexedDB) from being evaluated during SSR.
 */
const DataSourcePageContent = dynamic(
  () => import("./_components/DataSourcePageContent"),
  {
    ssr: false,
    loading: () => <DataSourceSkeleton />,
  },
);

interface PageProps {
  params: Promise<{ sourceId: string }>;
}

export default function DataSourcePage({ params }: PageProps) {
  const { sourceId } = use(params);

  return <DataSourcePageContent sourceId={sourceId} />;
}
