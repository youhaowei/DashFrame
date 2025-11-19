"use client";

import { useState } from "react";
import {
  VisualizationTabs,
  VisualizationControls,
  VisualizationDisplay,
  CreateVisualizationModal,
} from "@/components/visualizations";
import { WorkbenchLayout } from "@/components/layouts/WorkbenchLayout";
import { SidePanel } from "@/components/shared/SidePanel";

export default function HomePage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  return (
    <>
      <WorkbenchLayout
        selector={<VisualizationTabs onCreateClick={() => setIsCreateModalOpen(true)} />}
        leftPanel={<VisualizationControls />}
      >
        <SidePanel className="shadow-lg bg-card/75">
          <VisualizationDisplay />
        </SidePanel>
      </WorkbenchLayout>

      <CreateVisualizationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </>
  );
}
