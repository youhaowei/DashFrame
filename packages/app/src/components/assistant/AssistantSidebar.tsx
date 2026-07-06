import { useEffect, useRef, useState } from "react";

import { runAssistantPrompt } from "@dashframe/core";
import { Button, Textarea, cn } from "@wystack/ui";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CloseIcon,
  LoaderIcon,
  SparklesIcon,
  TerminalIcon,
} from "@wystack/ui-icons";

import {
  type AssistantTurn,
  useAssistantStore,
} from "@/lib/stores/assistant-store";

import { AssistantModelPicker } from "./AssistantModelPicker";
import { DraftReviewPanel } from "./DraftReviewPanel";
import { useArtifactContext } from "./artifact-context";

/**
 * The assistant panel body — rendered inside the shared right Dock, which owns
 * the panel chrome (surface, width).
 *
 * Slack-assistant shape: summonable, contextual to the current artifact,
 * dismissable. The artifact (center) stays primary; this is an input method
 * onto it. The live run transcript stays in this persistent rail; review stays
 * human-gated through the draft panel.
 */
export function AssistantSidebar() {
  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      role="complementary"
      aria-label="Assistant"
    >
      <AssistantPanelBody />
    </div>
  );
}

function AssistantPanelBody() {
  const artifact = useArtifactContext();
  const close = useAssistantStore((s) => s.close);
  const pendingDraftId = useAssistantStore((s) => s.pendingDraftId);
  const beginRun = useAssistantStore((s) => s.beginRun);
  const receiveRunEvent = useAssistantStore((s) => s.receiveRunEvent);
  const failRun = useAssistantStore((s) => s.failRun);
  const abortRun = useAssistantStore((s) => s.abortRun);
  const turns = useAssistantStore((s) => s.turns);
  const streamingText = useAssistantStore((s) => s.streamingText);
  const runStatus = useAssistantStore((s) => s.runStatus);
  const error = useAssistantStore((s) => s.error);
  const selectedProviderConfigId = useAssistantStore(
    (s) => s.selectedProviderConfigId,
  );
  const selectedModelId = useAssistantStore((s) => s.selectedModelId);
  const [prompt, setPrompt] = useState("");
  const isRunning = runStatus === "running";

  // Cancels the in-flight run when the rail is dismissed mid-run so a
  // stalled stream can't leave the store stuck in "running". The Dock keeps
  // the closed rail mounted (extent 0), so this keys on the store's isOpen —
  // plus an unmount guard for route-level teardown. The run's mutations live
  // in a draft, so cancelling loses nothing unreviewed.
  const isOpen = useAssistantStore((s) => s.isOpen);
  const runAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!isOpen) runAbortRef.current?.abort();
  }, [isOpen]);
  useEffect(
    () => () => {
      runAbortRef.current?.abort();
    },
    [],
  );

  async function submitPrompt() {
    const text = prompt.trim();
    if (!text || isRunning) return;
    setPrompt("");
    beginRun(text);
    const controller = new AbortController();
    runAbortRef.current = controller;
    try {
      await runAssistantPrompt({
        prompt: text,
        artifact,
        provider: selectedProviderConfigId ?? undefined,
        modelId: selectedModelId ?? undefined,
        signal: controller.signal,
        onEvent: receiveRunEvent,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        abortRun();
        return;
      }
      failRun(err instanceof Error ? err.message : String(err));
    } finally {
      if (runAbortRef.current === controller) runAbortRef.current = null;
    }
  }

  return (
    <>
      {/* Header — names the bound artifact; the assistant is contextual to it. */}
      <header className="flex shrink-0 items-center gap-2 border-b border-neutral-border/60 px-3 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-palette-primary/10 text-palette-primary">
          <SparklesIcon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-semibold tracking-tight text-neutral-fg">
            Assistant
          </span>
          <span className="truncate text-[11px] text-neutral-fg-subtle">
            {artifact ? artifact.title : "No artifact in focus"}
          </span>
        </div>
        <AssistantModelPicker />
        <Button
          variant="ghost"
          icon={CloseIcon}
          iconOnly
          size="sm"
          label="Dismiss assistant"
          tooltip="Dismiss (⌘J)"
          onClick={close}
          className="size-7 shrink-0 text-neutral-fg-subtle hover:text-neutral-fg"
        />
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <AssistantTimeline
          turns={turns}
          streamingText={streamingText}
          artifactTitle={artifact?.title ?? null}
          error={error}
        />

        {pendingDraftId && (
          <div className="shrink-0 bg-neutral-bg/70 shadow-[inset_0_1px_0_var(--neutral-border)]">
            <DraftReviewPanel draftId={pendingDraftId} compact />
          </div>
        )}

        <div className="shrink-0 p-3 shadow-[inset_0_1px_0_var(--neutral-border)]">
          <div className="flex items-end gap-2 rounded-[var(--surface-radius)] bg-neutral-bg/70 p-1.5 shadow-[var(--surface-shadow)]">
            <Textarea
              rows={2}
              value={prompt}
              disabled={isRunning}
              placeholder={
                artifact
                  ? `Ask the assistant to change ${artifact.title}...`
                  : "Ask the assistant to draft a change..."
              }
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void submitPrompt();
                }
              }}
              className="min-h-16 resize-none border-0 bg-transparent text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              aria-label="Message the assistant"
            />
            <Button
              label={isRunning ? "Running" : "Send"}
              icon={isRunning ? LoaderIcon : ArrowRightIcon}
              iconOnly
              size="sm"
              disabled={!prompt.trim() || isRunning}
              onClick={() => void submitPrompt()}
              className="mb-0.5 size-8 shrink-0"
              tooltip={isRunning ? "Assistant is running" : "Send"}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function AssistantTimeline({
  turns,
  streamingText,
  artifactTitle,
  error,
}: {
  turns: AssistantTurn[];
  streamingText: string;
  artifactTitle: string | null;
  error: string | null;
}) {
  const hasContent = turns.length > 0 || streamingText.trim() || error;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {!hasContent ? (
        <div className="flex h-full flex-col items-center justify-center px-3 text-center">
          <span className="mb-3 flex size-10 items-center justify-center rounded-2xl bg-palette-primary/10 text-palette-primary">
            <SparklesIcon className="size-5" />
          </span>
          <h2 className="text-sm font-semibold text-neutral-fg">
            {artifactTitle ? "Draft with the assistant" : "Assistant ready"}
          </h2>
          <p className="mt-1.5 max-w-[15rem] text-xs leading-relaxed text-neutral-fg-subtle">
            {artifactTitle
              ? "Ask for a change. Commands stream here, then the draft appears for review after the first mutation lands."
              : "Open an artifact or ask for a project-level draft. Nothing publishes without review."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {turns.map((turn) => (
            <AssistantTurnRow key={turn.id} turn={turn} />
          ))}
          {streamingText.trim() && (
            <AssistantTurnRow
              turn={{
                id: "streaming",
                kind: "assistant",
                text: streamingText,
                status: "running",
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function AssistantTurnRow({ turn }: { turn: AssistantTurn }) {
  return (
    <div
      className={cn(
        "rounded-[var(--surface-radius)] bg-neutral-bg/65 px-3 py-2 text-xs text-neutral-fg shadow-[var(--surface-shadow)]",
        turn.kind === "user" && "bg-neutral-bg-subtle",
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase text-neutral-fg-subtle">
        <TurnIcon turn={turn} />
        <span>{turnLabel(turn)}</span>
      </div>
      <p className="whitespace-pre-wrap break-words leading-relaxed">
        {turn.text}
      </p>
    </div>
  );
}

function TurnIcon({ turn }: { turn: AssistantTurn }) {
  if (turn.kind === "command" || turn.kind === "tool") {
    return <TerminalIcon className="size-3" />;
  }
  if (turn.status === "running") {
    return <LoaderIcon className="size-3" />;
  }
  if (turn.kind === "assistant") {
    return <SparklesIcon className="size-3" />;
  }
  return <CheckCircleIcon className="size-3" />;
}

function turnLabel(turn: AssistantTurn): string {
  if (turn.kind === "user") return "You";
  if (turn.kind === "command") {
    if (turn.status === "running") return "Command";
    return turn.status === "error" ? "Command failed" : "Command applied";
  }
  if (turn.kind === "tool") return "Tool";
  if (turn.kind === "status") return "Status";
  return turn.status === "running" ? "Assistant streaming" : "Assistant";
}
