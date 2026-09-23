import {
  CHANGE_COLORS,
  CHANGE_LABELS,
  FLAG_LABELS,
  KIND_LABELS,
  formatValue,
  getChangeDetails,
} from "@/components/preview-diff/PreviewDiffRenderer";
import { OverlayScrollArea, WorkbenchPaneHeader } from "@dashframe/ui";
import { Badge, Button } from "@wystack/ui-react";
import { useState, type ReactNode } from "react";
import { describePath, type DraftChange } from "./draft-review";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] text-neutral-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-xs break-words text-neutral-fg">
        {children}
      </dd>
    </div>
  );
}

interface Step {
  commandIndex: number;
  summary: string;
}

function stepsOf(change: DraftChange): Step[] {
  if (change.type === "step") {
    return [
      { commandIndex: change.commandIndex, summary: describePath(change.path) },
    ];
  }
  return change.node.intent.map(({ commandIndex, summary }) => ({
    commandIndex,
    summary,
  }));
}

export interface ChangeInspectorProps {
  change: DraftChange;
  busy: boolean;
  /** Takes one command out of the draft. */
  onRemoveStep: (commandIndex: number) => Promise<boolean>;
}

/**
 * The right pane of a draft: what one change does to its artifact, what else
 * it reaches, and the steps behind it — each removable from the draft.
 */
export function ChangeInspector({
  change,
  busy,
  onRemoveStep,
}: ChangeInspectorProps) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const details = change.type === "node" ? getChangeDetails(change.node) : [];
  const steps = stepsOf(change);

  return (
    <div className="flex h-full flex-col bg-neutral-bg text-xs">
      <WorkbenchPaneHeader title="Change">{null}</WorkbenchPaneHeader>
      <OverlayScrollArea className="min-h-0 flex-1">
        <dl className="space-y-4 px-3.5 pb-4">
          {change.type === "node" ? (
            <Row label={KIND_LABELS[change.node.kind]}>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">
                  {change.node.name || change.node.nodeId}
                </span>
                <Badge
                  variant="soft"
                  color={CHANGE_COLORS[change.node.change]}
                  className="text-xs"
                >
                  {CHANGE_LABELS[change.node.change]}
                </Badge>
              </span>
            </Row>
          ) : (
            <Row label="Status">
              <span className="text-palette-warning">
                {change.failing
                  ? "This change can't be applied. Remove it to publish the rest."
                  : "Not previewed — an earlier change can't be applied."}
              </span>
            </Row>
          )}

          {details.length > 0 && (
            <Row label="Before → after">
              <ul className="space-y-1.5">
                {details.map((detail, index) => (
                  <li key={`${detail.key}-${index}`} className="break-all">
                    <span className="block text-neutral-fg-subtle">
                      {detail.key}
                    </span>
                    <span>
                      {`${formatValue(detail.before)} → ${formatValue(detail.after)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </Row>
          )}

          {change.lateBound.length > 0 && (
            <Row label="Needs a value">
              <span className="text-palette-warning">
                {change.lateBound
                  .map((entry) => entry.label ?? entry.kind)
                  .join(", ")}
              </span>
            </Row>
          )}

          {change.type === "node" && change.downstream.length > 0 && (
            <Row label="Also affects">
              <ul className="space-y-0.5">
                {change.downstream.map((node) => (
                  <li key={`${node.kind}:${node.nodeId}`}>
                    {node.name || node.nodeId}
                    <span className="text-neutral-fg-subtle">
                      {" "}
                      · {FLAG_LABELS[node.flag]}
                    </span>
                  </li>
                ))}
              </ul>
            </Row>
          )}

          {steps.length > 0 && (
            <Row label={steps.length === 1 ? "Step" : "Steps"}>
              <ul className="space-y-1.5">
                {steps.map((step) => (
                  <li
                    key={step.commandIndex}
                    aria-label={step.summary}
                    className="space-y-1.5"
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">{step.summary}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        label="Remove"
                        disabled={busy}
                        onClick={() => setConfirming(step.commandIndex)}
                      />
                    </span>
                    {confirming === step.commandIndex && (
                      <span className="flex flex-col gap-2 rounded-md bg-neutral-bg-subtle px-2.5 py-2">
                        <span>Remove this change from the draft?</span>
                        <span className="flex justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            label="Cancel"
                            disabled={busy}
                            onClick={() => setConfirming(null)}
                          />
                          <Button
                            color="danger"
                            size="sm"
                            label="Remove change"
                            disabled={busy}
                            onClick={async () => {
                              if (await onRemoveStep(step.commandIndex))
                                setConfirming(null);
                            }}
                          />
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Row>
          )}
        </dl>
      </OverlayScrollArea>
    </div>
  );
}
