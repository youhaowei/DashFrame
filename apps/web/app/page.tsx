"use client";

import { useState } from "react";
import {
  VisualizationTabs,
  VisualizationControls,
  VisualizationDisplay,
  CreateVisualizationModal,
} from "../components/visualizations";

export default function HomePage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="text-xl font-semibold text-gray-900">DashFrame</h1>
      </header>

      {/* Visualization Tabs */}
      <VisualizationTabs onCreateClick={() => setIsCreateModalOpen(true)} />

      {/* Main Content: Controls + Display */}
      <section className="flex flex-1 overflow-hidden">
        {/* Left Panel: Controls */}
        <aside className="w-80 border-r border-gray-200 bg-white">
          <VisualizationControls />
        </aside>

        {/* Right Panel: Display */}
        <main className="flex-1 overflow-auto bg-gray-50">
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
