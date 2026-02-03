"use client";

import dynamic from "next/dynamic";
import { use } from "react";

/**
 * Skeleton loading state rendered during SSR.
 * The actual content is loaded client-side only to avoid IndexedDB access during SSR.
 */
function DashboardSkeleton() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading dashboard...</p>
    </div>
  );
}

/**
 * Dynamically import the content component with SSR disabled.
 * This prevents @dashframe/core (IndexedDB) from being evaluated during SSR.
 */
const DashboardDetailContent = dynamic(
  () => import("./_components/DashboardDetailContent"),
  {
    ssr: false,
    loading: () => <DashboardSkeleton />,
  },
);

export default function DashboardDetailPage({
  params,
}: {
  params: Promise<{ dashboardId: string }>;
}) {
  const { dashboardId } = use(params);

  return <DashboardDetailContent dashboardId={dashboardId} />;
}
