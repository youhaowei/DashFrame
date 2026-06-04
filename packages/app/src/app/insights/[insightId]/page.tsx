import InsightPageContent from "./_components/InsightPageContent";

/**
 * Force static generation - no serverless function.
 * Data lives in IndexedDB (browser), so server rendering is meaningless.
 */
export const dynamic = "force-static";
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ insightId: string }>;
}

export default async function InsightPage({ params }: PageProps) {
  const { insightId } = await params;
  return <InsightPageContent insightId={insightId} />;
}
