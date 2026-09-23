import { api } from "@dashframe/convex-backend/api";
import { useQuery_experimental as useQuery } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { useRenderPerf } from "@/lib/perf";

import { Spinner } from "@wystack/ui-react";
import { InsightView } from "./InsightView";
import { NotFoundView } from "./NotFoundView";

interface InsightPageContentProps {
  insightId: string;
  visualizeIntent?: boolean;
  reportId?: string;
}

/**
 * Insight page content, imported directly by the Insight route.
 * Subscribes to Convex metadata and renders the server-backed Insight view.
 */
export default function InsightPageContent({
  insightId,
  visualizeIntent = false,
  reportId,
}: InsightPageContentProps) {
  const { data: insight, isLoading } = queryStatus(
    useQuery({ query: api.app.getInsight, args: { id: insightId } }),
  );

  // Instrument the artifact render boundary (cleared on unmount). Runs
  // unconditionally — hooks before the loading/not-found early returns.
  useRenderPerf(`insight:${insightId}`);

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

  return (
    <InsightView
      insight={insight}
      visualizeIntent={visualizeIntent}
      reportId={reportId}
    />
  );
}
