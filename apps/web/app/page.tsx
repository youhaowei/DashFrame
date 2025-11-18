"use client";

import { useState } from "react";
import {
  VisualizationTabs,
  VisualizationControls,
  VisualizationDisplay,
  CreateVisualizationModal,
} from "../components/visualizations";
import { Navigation } from "../components/navigation";

export default function HomePage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <Navigation />

      {/* Visualization Tabs */}
      <VisualizationTabs onCreateClick={() => setIsCreateModalOpen(true)} />

      {/* Main Content: Controls + Display */}
      <section className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Panel: Controls */}
        <aside className="w-80 border-r border-border bg-card overflow-y-auto">
          <VisualizationControls />
        </aside>

        {/* Right Panel: Display */}
        <main className="flex-1 overflow-y-auto bg-background">
          <VisualizationDisplay />
        </main>
      </section>

      {/* Create Visualization Modal */}
      <CreateVisualizationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
}
