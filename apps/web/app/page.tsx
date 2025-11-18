"use client";

import { useState } from "react";
import {
  VisualizationTabs,
  VisualizationControls,
  VisualizationDisplay,
  CreateVisualizationModal,
} from "@/components/visualizations";

export default function HomePage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  return (
    <>
      <VisualizationTabs onCreateClick={() => setIsCreateModalOpen(true)} />

      <section className="grid flex-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="min-h-0 rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <VisualizationControls />
        </aside>

        <main className="min-h-0 rounded-2xl border border-border/60 bg-card/75 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <VisualizationDisplay />
        </main>
      </section>

      <CreateVisualizationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </>
  );
}
