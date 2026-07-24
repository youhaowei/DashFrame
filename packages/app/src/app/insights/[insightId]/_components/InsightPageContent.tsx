import { useBindArtifact } from "@/components/assistant/artifact-context";
import { useInsight } from "@/data";
import { useRenderPerf } from "@/lib/perf";
import { Spinner } from "@wystack/ui-react";
import { InsightView } from "./InsightView";
import { NotFoundView } from "./NotFoundView";

interface InsightPageContentProps {
  insightId: string;
  visualizeIntent?: boolean;
}

/**
 * Insight page content - handles data fetching and rendering.
 *
 * This component is dynamically imported with ssr: false to ensure
 * IndexedDB operations only happen in the browser.
 */
export default function InsightPageContent({
  insightId,
  visualizeIntent = false,
}: InsightPageContentProps) {
  const { data: insight, isLoading } = useInsight(insightId);

  // Instrument the artifact render boundary and bind the assistant to this
  // insight (cleared on unmount). Both run unconditionally — hooks before the
  // loading/not-found early returns.
  useRenderPerf(`insight:${insightId}`);
  useBindArtifact(
    insight ? { kind: "insight", id: insightId, title: insight.name } : null,
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Spinner size="lg" className="text-neutral-fg-subtle" />
          <p className="text-sm text-neutral-fg-subtle">Loading insight...</p>
        </div>
      </div>
    );
  }

  if (!insight) {
    return <NotFoundView type="insight" />;
  }

  return <InsightView insight={insight} visualizeIntent={visualizeIntent} />;
}
