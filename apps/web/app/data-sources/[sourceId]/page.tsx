import DataSourcePageContent from "./_components/DataSourcePageContent";

/**
 * Force static generation - no serverless function.
 * Data lives in IndexedDB (browser), so server rendering is meaningless.
 */
export const dynamic = "force-static";
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ sourceId: string }>;
}

export default async function DataSourcePage({ params }: PageProps) {
  const { sourceId } = await params;
  return <DataSourcePageContent sourceId={sourceId} />;
}
