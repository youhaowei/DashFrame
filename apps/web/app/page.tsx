"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Papa, { type ParseError, type ParseResult } from "papaparse";
import type { DataFrame } from "@dashframe/dataframe";
import dynamic from "next/dynamic";

import { csvToDataFrame } from "@dashframe/csv";
import { buildVegaLiteSpec, type AxisSelection } from "../lib/spec";

// Dynamically import VegaChart with no SSR to prevent Set serialization issues
const VegaChart = dynamic(
  () => import("../components/VegaChart").then((mod) => mod.VegaChart),
  { ssr: false }
);
import {
  persistDataFrame,
  persistAxisSelection,
  readPersistedDataFrame,
  readPersistedAxisSelection,
} from "../lib/storage";

type AxisOption = {
  label: string;
  value: string;
};

const formatAxisOption = (column: DataFrame["columns"][number]): AxisOption => ({
  value: column.name,
  label: `${column.name} (${column.type})`,
});

export default function HomePage() {
  const [dataFrame, setDataFrame] = useState<DataFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [axisSelection, setAxisSelection] = useState<AxisSelection>({ x: null, y: null });

  const axisOptions = useMemo<AxisOption[]>(
    () => dataFrame?.columns.map(formatAxisOption) ?? [],
    [dataFrame],
  );

  const spec = useMemo(() => (dataFrame ? buildVegaLiteSpec(dataFrame, axisSelection) : null), [
    dataFrame,
    axisSelection,
  ]);


  const resetState = useCallback(() => {
    setDataFrame(null);
    setAxisSelection({ x: null, y: null });
    persistDataFrame(null);
    persistAxisSelection({ x: null, y: null });
  }, []);

  const hydrateFromStorage = useCallback(() => {
    const persistedFrame = readPersistedDataFrame();
    if (!persistedFrame) return;

    setDataFrame(persistedFrame);

    const persistedAxes = readPersistedAxisSelection();
    setAxisSelection({
      x: persistedAxes.x && persistedFrame.columns.some((column) => column.name === persistedAxes.x)
        ? persistedAxes.x
        : persistedFrame.columns[0]?.name ?? null,
      y: persistedAxes.y && persistedFrame.columns.some((column) => column.name === persistedAxes.y)
        ? persistedAxes.y
        : persistedFrame.columns.find((column) => column.type === "number")?.name ??
        persistedFrame.columns[1]?.name ??
        persistedFrame.columns[0]?.name ??
        null,
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      hydrateFromStorage();
    });
  }, [hydrateFromStorage]);

  useEffect(() => {
    if (!dataFrame) return;
    persistDataFrame(dataFrame);
  }, [dataFrame]);

  useEffect(() => {
    if (!dataFrame) return;
    persistAxisSelection(axisSelection);
  }, [dataFrame, axisSelection]);

  const handleFile = useCallback((file: File) => {
    setError(null);

    Papa.parse(file, {
      dynamicTyping: false,
      skipEmptyLines: true,
      complete: (result: ParseResult<string>) => {
        if (result.errors.length) {
          setError(result.errors.map((err: ParseError) => err.message).join("\n"));
          resetState();
          return;
        }

        const parsedDataFrame = csvToDataFrame(result.data);

        if (!parsedDataFrame.columns.length) {
          setError("CSV did not contain any columns.");
          resetState();
          return;
        }

        setDataFrame(parsedDataFrame);
        setAxisSelection({
          x: parsedDataFrame.columns[0]?.name ?? null,
          y:
            parsedDataFrame.columns.find((column) => column.type === "number")?.name ??
            parsedDataFrame.columns[1]?.name ??
            parsedDataFrame.columns[0]?.name ??
            null,
        });
      },
    });
  }, [resetState]);

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-slate-950 p-6 text-slate-100">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">DashFrame</h1>
        <p className="text-sm text-slate-400">
          Upload a CSV file to explore the CSV → DataFrame → Vega-Lite preview pipeline.
        </p>
      </header>

      <section className="grid flex-1 gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-lg">
          <h2 className="text-lg font-medium text-slate-50">Upload CSV</h2>
          <p className="text-sm text-slate-400">
            Choose a CSV file with headers in the first row. The preview automatically infers column types.
          </p>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-slate-600 bg-slate-800/70 p-6 text-center text-sm font-medium text-slate-100 shadow-md transition hover:border-slate-400 hover:bg-slate-800/90">
            <span>Select CSV</span>
            <span className="mt-2 text-xs font-normal text-slate-300">
              Supports .csv files up to 5MB
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </label>
          {error ? (
            <pre className="overflow-auto rounded-md border border-red-500/50 bg-red-500/10 p-3 text-xs text-red-200">
              {error}
            </pre>
          ) : null}

          {dataFrame ? (
            <div className="space-y-4 text-sm text-slate-300">
              <div className="space-y-1">
                <label className="block text-xs font-semibold uppercase text-slate-400">
                  X Axis
                </label>
                <select
                  value={axisSelection.x ?? ""}
                  onChange={(event) =>
                    setAxisSelection((current) => ({ ...current, x: event.target.value || null }))
                  }
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                >
                  {axisOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold uppercase text-slate-400">
                  Y Axis
                </label>
                <select
                  value={axisSelection.y ?? ""}
                  onChange={(event) =>
                    setAxisSelection((current) => ({ ...current, y: event.target.value || null }))
                  }
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                >
                  {axisOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500">
                  Quantitative columns work best on the Y axis. Temporal values render as a line chart.
                </p>
              </div>

              <div className="space-y-2 text-xs text-slate-400">
                <p>
                  <span className="font-semibold text-slate-200">Rows:</span> {dataFrame.rows.length.toLocaleString()}
                </p>
                <p>
                  <span className="font-semibold text-slate-200">Columns:</span> {dataFrame.columns.length}
                </p>
                <div>
                  <span className="font-semibold text-slate-200">Detected types:</span>
                  <ul className="mt-1 space-y-1">
                    {dataFrame.columns.map((column) => (
                      <li key={column.name} className="flex items-center gap-2">
                        <span className="rounded bg-slate-800 px-2 py-1 text-[10px] uppercase text-slate-300">
                          {column.type}
                        </span>
                        <span className="text-slate-200">{column.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}
        </aside>

        <section className="flex min-h-[480px] flex-col gap-4 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40 p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-slate-50">Chart Preview</h2>
            {dataFrame ? (
              <span className="text-xs text-slate-400">
                Rows: {dataFrame.rows.length.toLocaleString()}
              </span>
            ) : null}
          </div>

          {spec && dataFrame ? (
            <VegaChart
              spec={{
                ...spec,
                data: { values: dataFrame.rows }
              }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-slate-700 text-sm text-slate-500">
              Upload a CSV and choose chart axes to render a Vega-Lite preview.
            </div>
          )}
        </section>
      </section>
    </div>
  );
}
