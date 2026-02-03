"use client";

import { Spinner } from "@dashframe/ui";
import dynamic from "next/dynamic";
import { use } from "react";

/**
 * Skeleton loading state rendered during SSR.
 * The actual content is loaded client-side only to avoid IndexedDB access during SSR.
 */
function JoinConfigureSkeleton() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Loading join configuration...
        </p>
      </div>
    </div>
  );
}

/**
 * Dynamically import the content component with SSR disabled.
 * This prevents @dashframe/core (IndexedDB) from being evaluated during SSR.
 */
const JoinConfigureContent = dynamic(
  () => import("./_components/JoinConfigureContent"),
  {
    ssr: false,
    loading: () => <JoinConfigureSkeleton />,
  },
);

interface PageProps {
  params: Promise<{ insightId: string; tableId: string }>;
}

export default function JoinConfigurePage({ params }: PageProps) {
  const { insightId, tableId } = use(params);

  return <JoinConfigureContent insightId={insightId} tableId={tableId} />;
}
