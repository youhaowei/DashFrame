"use client";

import { DataSourcesPanel } from "../components/DataSourcesPanel";
import { VisualizationPanel } from "../components/VisualizationPanel";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col gap-6 bg-slate-950 p-6 text-slate-100">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">DashFrame</h1>
        <p className="text-sm text-slate-400">
          Import data from CSV or Notion to create interactive visualizations.
        </p>
      </header>

      <section className="grid flex-1 gap-6 lg:grid-cols-[360px_1fr]">
        <DataSourcesPanel />
        <VisualizationPanel />
      </section>
    </div>
  );
}
