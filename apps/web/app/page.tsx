"use client";

import { useEffect, useState } from "react";
import {
  VisualizationTabs,
  VisualizationControls,
  VisualizationDisplay,
  CreateVisualizationModal,
  EmptyState,
} from "@/components/visualizations";
import { WorkbenchLayout } from "@/components/layouts/WorkbenchLayout";
import { Panel } from "@/components/shared/Panel";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";

export default function HomePage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  const visualizations = useVisualizationsStore((state) => state.visualizations);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Show empty state if no visualizations exist (only after hydration)
  const showEmptyState = isHydrated && visualizations.size === 0;

  return (
    <>
      {showEmptyState ? (
        <EmptyState onCreateClick={() => { }} />
      ) : (
        <WorkbenchLayout
          selector={
            <VisualizationTabs onCreateClick={() => setIsCreateModalOpen(true)} />
          }
          leftPanel={<VisualizationControls />}
        >
          <Panel>
            <VisualizationDisplay />
          </Panel>
        </WorkbenchLayout>
      )}

      <CreateVisualizationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </>
  );
}
