import { cn } from "@wystack/ui";
import { useEffect, useMemo, useState } from "react";

import { type PerfSample, usePerfStore } from "./perfStore";
import { type BudgetVerdict, type PerfStage, STAGE_BUDGET_MS } from "./stages";

/**
 * Dev-only performance HUD. Renders nothing outside dev builds — gated on
 * `import.meta.env.DEV` so it is tree-shaken from production. Lives as a row in
 * the nav footer (dev tooling next to Settings, not floating over content);
 * toggle the panel with the row or the `⌥⇧P` (Alt+Shift+P) shortcut.
 *
 * Shows per-stage timings against their budgets (green/amber/red). Stages with
 * no budget (unowned waits like connector fetches) render neutrally — for them
 * the deliverable is attribution, not a verdict. Data is in-memory and
 * local-only; nothing is persisted or transmitted.
 */
export function PerfHud() {
  // Hard gate: never render in production. Vite constant-folds `import.meta.env
  // .DEV` to `false` in prod so the whole component (and its store wiring) drops
  // out of the bundle; the optional chain keeps non-Vite imports from throwing.
  if (!import.meta.env?.DEV) return null;
  return <PerfHudInner />;
}

const VERDICT_DOT: Record<BudgetVerdict, string> = {
  ok: "bg-palette-success",
  warn: "bg-palette-warning",
  over: "bg-palette-danger",
  unowned: "bg-neutral-bg-strongest",
};

const VERDICT_TEXT: Record<BudgetVerdict, string> = {
  ok: "text-palette-success",
  warn: "text-palette-warning",
  over: "text-palette-danger",
  unowned: "text-neutral-fg-subtle",
};

interface StageRollup {
  stage: PerfStage;
  count: number;
  lastMs: number;
  p95Ms: number;
  budgetMs?: number;
  verdict: BudgetVerdict;
}

function rollup(samples: PerfSample[]): StageRollup[] {
  const byStage = new Map<PerfStage, PerfSample[]>();
  for (const s of samples) {
    const arr = byStage.get(s.stage) ?? [];
    arr.push(s);
    byStage.set(s.stage, arr);
  }
  const rows: StageRollup[] = [];
  for (const [stage, list] of byStage) {
    const sorted = [...list].sort((a, b) => a.durationMs - b.durationMs);
    const p95 =
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const last = list[list.length - 1];
    // `list` is non-empty here (it was built by pushing at least one sample),
    // so `last` and `p95` are defined; fall back to 0 to satisfy the checker.
    rows.push({
      stage,
      count: list.length,
      lastMs: last?.durationMs ?? 0,
      p95Ms: p95?.durationMs ?? 0,
      budgetMs: STAGE_BUDGET_MS[stage],
      // Worst-case verdict across the window communicates risk honestly. Seed
      // from the first sample (not "ok") so a stage with only `unowned` samples
      // reports `unowned` — `ok` and `unowned` share rank 0, so a hardcoded "ok"
      // seed would mask an attribution-only stage as healthy/green.
      verdict: list.reduce<BudgetVerdict>((worst, s) => {
        const rank = { ok: 0, unowned: 0, warn: 1, over: 2 } as const;
        return rank[s.verdict] > rank[worst] ? s.verdict : worst;
      }, list[0]?.verdict ?? "ok"),
    });
  }
  return rows.sort((a, b) => a.stage.localeCompare(b.stage));
}

function PerfHudInner() {
  const [open, setOpen] = useState(false);
  const samples = usePerfStore((s) => s.samples);
  const enabled = usePerfStore((s) => s.enabled);
  const setEnabled = usePerfStore((s) => s.setEnabled);
  const clear = usePerfStore((s) => s.clear);

  const rows = useMemo(() => rollup(samples), [samples]);

  // ⌥⇧P toggles the HUD panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* The panel escapes the nav Dock's overflow-hidden via fixed positioning,
          anchored just above the footer row that toggles it. */}
      {open && (
        <div className="fixed bottom-12 left-3 z-50 w-72 overflow-hidden rounded-xl border border-neutral-border bg-neutral-bg/95 shadow-lg backdrop-blur supports-backdrop-filter:bg-neutral-bg/80">
          <div className="flex items-center justify-between border-b border-neutral-border/60 px-3 py-2">
            <span className="text-xs font-semibold tracking-tight text-neutral-fg">
              Perf
              <span className="ml-1 font-normal text-neutral-fg-subtle">
                dev only
              </span>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEnabled(!enabled)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                  enabled
                    ? "bg-palette-success/15 text-palette-success"
                    : "bg-neutral-bg-muted text-neutral-fg-subtle",
                )}
                title={
                  enabled
                    ? "Recording — click to pause"
                    : "Paused — click to record"
                }
              >
                {enabled ? "rec" : "paused"}
              </button>
              <button
                type="button"
                onClick={clear}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-neutral-fg-subtle transition-colors hover:text-neutral-fg"
                title="Clear samples"
              >
                clear
              </button>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="px-3 py-4 text-xs text-neutral-fg-subtle">
              No samples yet. Interact with an artifact to populate stage
              timings.
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {rows.map((r) => (
                <li
                  key={r.stage}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs"
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      VERDICT_DOT[r.verdict],
                    )}
                    aria-hidden
                  />
                  <span className="flex-1 truncate font-mono text-[11px] text-neutral-fg">
                    {r.stage}
                  </span>
                  <span
                    className={cn("tabular-nums", VERDICT_TEXT[r.verdict])}
                    title={
                      r.budgetMs != null
                        ? `last ${r.lastMs.toFixed(1)}ms · p95 ${r.p95Ms.toFixed(1)}ms · budget ${r.budgetMs}ms`
                        : `last ${r.lastMs.toFixed(1)}ms · p95 ${r.p95Ms.toFixed(1)}ms · unowned (attribution only)`
                    }
                  >
                    {r.p95Ms.toFixed(0)}
                    <span className="text-neutral-fg-subtle">
                      {r.budgetMs != null ? `/${r.budgetMs}` : ""}ms
                    </span>
                  </span>
                  <span className="w-6 text-right tabular-nums text-[10px] text-neutral-fg-subtle">
                    ×{r.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Footer row — same shape as the Settings / Open source rows beside it. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 text-xs text-neutral-fg-subtle transition-colors hover:text-neutral-fg",
          open && "text-neutral-fg",
        )}
        title="Toggle perf HUD (⌥⇧P)"
        aria-pressed={open}
      >
        <span className="flex h-4 w-4 items-center justify-center" aria-hidden>
          <span
            className={cn(
              "size-2 rounded-full",
              enabled ? "bg-palette-success" : "bg-neutral-bg-strongest",
            )}
          />
        </span>
        <span>Perf</span>
      </button>
    </>
  );
}
