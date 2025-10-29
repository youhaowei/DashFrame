"use client";

export function FormPanel() {
  return (
    <aside className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-lg">
      <h2 className="text-xl font-semibold text-slate-50">Upload CSV</h2>
      <p className="mt-2 text-sm text-slate-400">
        Provide a CSV file to convert it into a DataFrame and explore it
        visually.
      </p>
      <div className="mt-6 rounded-md border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
        CSV upload controls coming soon.
      </div>
    </aside>
  );
}
