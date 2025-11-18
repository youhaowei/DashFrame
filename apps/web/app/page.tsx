"use client";

import { useState } from "react";
import {
  VisualizationTabs,
  VisualizationControls,
  VisualizationDisplay,
  CreateVisualizationModal,
} from "@/components/visualizations";
import { Navigation } from "@/components/navigation";

export default function HomePage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,hsl(var(--primary)/0.08),transparent_45%),radial-gradient(circle_at_80%_0%,hsl(var(--muted-foreground)/0.12),transparent_35%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,hsl(var(--background))_0%,transparent_30%,transparent_70%,hsl(var(--background))_100%)]" />

      <Navigation />

      <div className="relative flex flex-1 flex-col gap-4 px-4 pb-6 pt-4 sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4">
          <VisualizationTabs onCreateClick={() => setIsCreateModalOpen(true)} />

          <section className="grid flex-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="min-h-0 rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/60">
              <VisualizationControls />
            </aside>

            <main className="min-h-0 rounded-2xl border border-border/60 bg-card/75 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/60">
              <VisualizationDisplay />
            </main>
          </section>
        </div>
      </div>

      <CreateVisualizationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
}
