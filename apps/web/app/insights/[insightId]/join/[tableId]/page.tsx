import JoinConfigureContent from "./_components/JoinConfigureContent";

/**
 * Force static generation - no serverless function.
 * Data lives in IndexedDB (browser), so server rendering is meaningless.
 */
export const dynamic = "force-static";
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ insightId: string; tableId: string }>;
}

export default async function JoinConfigurePage({ params }: PageProps) {
  const { insightId, tableId } = await params;
  return <JoinConfigureContent insightId={insightId} tableId={tableId} />;
}
