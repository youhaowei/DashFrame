import { Textarea, cn } from "@wystack/ui";
import {
  ChartIcon,
  LightbulbIcon,
  SparklesIcon,
  TableIcon,
} from "@wystack/ui-icons";

import { type ArtifactContextValue } from "./artifact-context";

/**
 * The empty conversation surface. No agent turns, no message plumbing — that is
 * gated on the pi-agent. This surface's only job is to *communicate what the
 * assistant will be*: an input method onto the current artifact, not a chat the
 * app is built around.
 *
 * It adapts its copy to the bound artifact (or its absence) so the empty state
 * reads as "I act on *this*", reinforcing the artifact-center thesis.
 */
export function AssistantEmptyState({
  artifact,
}: {
  artifact: ArtifactContextValue | null;
}) {
  const suggestions = suggestionsFor(artifact);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-5 text-center">
        <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-palette-primary/10 text-palette-primary">
          <SparklesIcon className="size-6" />
        </span>
        <h2 className="text-sm font-semibold tracking-tight text-neutral-fg">
          {artifact
            ? `Ask about this ${kindLabel(artifact.kind)}`
            : "Your assistant"}
        </h2>
        <p className="mt-1.5 max-w-[15rem] text-pretty text-xs leading-relaxed text-neutral-fg-subtle">
          {artifact
            ? "Describe a change and the assistant proposes it as a draft on the artifact — you review the preview, then publish."
            : "Open an artifact, then ask the assistant to shape it. It works on the object in the center, never in a chat transcript."}
        </p>

        {suggestions.length > 0 && (
          <ul className="mt-5 flex w-full max-w-[16rem] flex-col gap-1.5">
            {suggestions.map((s) => (
              <li key={s.label}>
                <button
                  type="button"
                  disabled
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-xl border border-neutral-border/60 bg-neutral-bg/60 px-3 py-2 text-left text-xs text-neutral-fg-subtle",
                    // Disabled until the agent lands — communicates intent
                    // without implying a working input.
                    "cursor-not-allowed opacity-80",
                  )}
                  aria-disabled
                  title="Available when the assistant agent ships"
                >
                  <s.icon className="size-3.5 shrink-0 text-palette-primary/70" />
                  <span className="truncate">{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Composer — present but inert. The seam where agent input will land. */}
      <div className="border-t border-neutral-border/60 p-3">
        <div className="rounded-xl border border-neutral-border/60 bg-neutral-bg/60 p-1.5 opacity-70">
          <Textarea
            disabled
            rows={2}
            placeholder={
              artifact
                ? `Ask the assistant to change this ${kindLabel(artifact.kind)}…`
                : "Open an artifact to begin…"
            }
            className="resize-none border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
            aria-label="Message the assistant"
          />
        </div>
        <p className="mt-2 px-0.5 text-[10px] leading-relaxed text-neutral-fg-subtle">
          Conversation arrives with the assistant agent. The artifact stays the
          source of truth — proposals land as a reviewable draft.
        </p>
      </div>
    </div>
  );
}

type Suggestion = { label: string; icon: typeof SparklesIcon };

function suggestionsFor(artifact: ArtifactContextValue | null): Suggestion[] {
  switch (artifact?.kind) {
    case "insight":
      return [
        { label: "Summarize what this insight shows", icon: LightbulbIcon },
        { label: "Add a breakdown by category", icon: TableIcon },
        { label: "Chart this as a trend over time", icon: ChartIcon },
      ];
    case "visualization":
      return [
        { label: "Change the chart type", icon: ChartIcon },
        { label: "Filter to the last 30 days", icon: TableIcon },
      ];
    case "dashboard":
      return [
        { label: "Add a tile for top sources", icon: ChartIcon },
        { label: "Explain what's trending", icon: LightbulbIcon },
      ];
    case "data-source":
      return [
        { label: "Profile the columns in this table", icon: TableIcon },
        { label: "Suggest insights from this data", icon: LightbulbIcon },
      ];
    default:
      return [];
  }
}

function kindLabel(kind: ArtifactContextValue["kind"]): string {
  return kind === "data-source" ? "data source" : kind;
}
