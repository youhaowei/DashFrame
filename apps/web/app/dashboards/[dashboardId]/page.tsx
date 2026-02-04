import DashboardDetailContent from "./_components/DashboardDetailContent";

/**
 * Force static generation - no serverless function.
 * Data lives in IndexedDB (browser), so server rendering is meaningless.
 */
export const dynamic = "force-static";
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ dashboardId: string }>;
}

export default async function DashboardDetailPage({ params }: PageProps) {
  const { dashboardId } = await params;
  return <DashboardDetailContent dashboardId={dashboardId} />;
}
