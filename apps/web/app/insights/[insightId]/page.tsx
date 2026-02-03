import { InsightPageClient } from "./_components/InsightPageClient";

/**
 * Force static generation - no serverless function.
 * Data lives in IndexedDB (browser), so server rendering is meaningless.
 */
export const dynamic = "force-static";
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ insightId: string }>;
}

/**
 * Insight Page (Server Component shell)
 *
 * This is a minimal server component that:
 * 1. Forces static generation (no serverless function)
 * 2. Passes params to a client component for rendering
 *
 * All IndexedDB access happens in the client component.
 */
export default async function InsightPage({ params }: PageProps) {
  const { insightId } = await params;
  return <InsightPageClient insightId={insightId} />;
}
