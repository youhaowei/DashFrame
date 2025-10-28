"use client";

export function PreviewPanel() {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 shadow-lg">
      <h2 className="text-xl font-semibold text-slate-50">Chart Preview</h2>
      <div className="mt-4 flex h-full min-h-[320px] items-center justify-center rounded-md border border-dashed border-slate-700 text-sm text-slate-500">
        Visualizations appear here after uploading a CSV.
      </div>
    </section>
  );
}
