import VisualizationPageContent from "./_components/VisualizationPageContent";

/**
 * Force static generation - no serverless function.
 * Data lives in IndexedDB (browser), so server rendering is meaningless.
 */
export const dynamic = "force-static";
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ visualizationId: string }>;
}

export default async function VisualizationPage({ params }: PageProps) {
  const { visualizationId } = await params;
  return <VisualizationPageContent visualizationId={visualizationId} />;
}
