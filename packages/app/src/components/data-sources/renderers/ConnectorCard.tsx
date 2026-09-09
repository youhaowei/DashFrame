import type { BaseConnector, FileSourceConnector } from "@dashframe/engine";
import { Button, FieldError } from "@wystack/ui-react";
import { ChevronDownIcon, ChevronRightIcon } from "@wystack/ui-react/icons";
import { lazy, Suspense } from "react";

const ConnectorIcon = lazy(() =>
  import("./ConnectorIcon").then((mod) => ({ default: mod.ConnectorIcon })),
);

interface ConnectorCardProps {
  /** The connector to render */
  connector: BaseConnector;
  /** Whether this connector's setup form is open. */
  expanded?: boolean;
  /**
   * Toggle handler for the disclosure header. Omit to render a static row —
   * the header stops being a button and only the icon, name and description
   * show. That is what the panel does once a connector has been picked: the
   * row still says what is being set up, but it is no longer a choice.
   */
  onToggle?: () => void;
  /** Called when a file is selected (file connectors only) */
  onFileSelect?: (file: File) => void;
  /** Called when connect button is clicked (remote-api connectors only) */
  onConnect?: () => void;
  /** Whether an action is in progress */
  isLoading?: boolean;
  /** Error message to display */
  submitError?: string | null;
  /** Form fields to render (passed as children from TanStack Form) */
  children?: React.ReactNode;
}

/**
 * One connector in the "add data" list: a row you can open.
 *
 * The setup form lives behind the disclosure on purpose. Rendering every
 * connector's credential fields at once turns first run into a wall of API-key
 * and connection-string inputs before the reader has chosen anything, and a
 * form for a source you are not using answers no question — picking the source
 * is the decision, filling it in is the next one.
 *
 * @example
 * ```tsx
 * <ConnectorCard
 *   connector={csvConnector}
 *   expanded={openId === csvConnector.id}
 *   onToggle={() => setOpenId(csvConnector.id)}
 *   onFileSelect={(file) => handleFile(file)}
 * >
 *   {formFields}
 * </ConnectorCard>
 * ```
 */
export function ConnectorCard({
  connector,
  expanded = false,
  onToggle,
  onFileSelect,
  onConnect,
  isLoading,
  submitError,
  children,
}: ConnectorCardProps) {
  const isFileConnector = connector.sourceType === "file";
  const fileConnector = isFileConnector
    ? (connector as FileSourceConnector)
    : null;
  let connectButtonLabel = "Connect";
  if (connector.authKind === "oauth") {
    connectButtonLabel = "Sign in with Google";
  }
  if (isLoading) {
    connectButtonLabel =
      connector.authKind === "oauth"
        ? "Waiting for Google..."
        : "Connecting...";
  }

  const identity = (
    <>
      <Suspense fallback={<span className="inline-block h-5 w-5 shrink-0" />}>
        <ConnectorIcon svg={connector.icon} className="h-5 w-5 shrink-0" />
      </Suspense>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-neutral-fg">
          {connector.name}
        </span>
        {connector.description && (
          <span className="block truncate text-xs text-neutral-fg-subtle">
            {connector.description}
          </span>
        )}
      </span>
    </>
  );

  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div className="rounded-[var(--surface-radius)] bg-neutral-bg-muted/40">
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex w-full items-center gap-3 rounded-[var(--surface-radius)] px-3 py-2.5 text-left transition hover:bg-neutral-bg-muted"
        >
          {identity}
          <Chevron className="h-4 w-4 shrink-0 text-neutral-fg-subtle" />
        </button>
      ) : (
        <div className="flex w-full items-center gap-3 px-3 py-2.5">
          {identity}
        </div>
      )}

      {expanded && (
        <div className="space-y-4 px-3 pb-3">
          {/* Form fields passed as children (TanStack Form Field components) */}
          {children}

          {/* File input for file connectors */}
          {isFileConnector && (
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-[var(--surface-radius)] bg-neutral-bg p-6 text-center text-sm font-medium transition hover:bg-neutral-bg-subtle">
              <span className="text-neutral-fg">Select {connector.name}</span>
              {fileConnector?.helperText && (
                <span className="mt-2 text-xs font-normal text-neutral-fg-subtle">
                  {fileConnector.helperText}
                </span>
              )}
              <input
                type="file"
                accept={fileConnector?.accept}
                className="hidden"
                disabled={isLoading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onFileSelect?.(file);
                    e.target.value = "";
                  }
                }}
              />
            </label>
          )}

          {/* Connect button for remote-api connectors */}
          {connector.sourceType === "remote-api" && (
            <Button
              label={connectButtonLabel}
              onClick={onConnect}
              disabled={isLoading}
              className="w-full"
            />
          )}

          {/* Submit-level error */}
          {submitError && <FieldError errors={[{ message: submitError }]} />}
        </div>
      )}
    </div>
  );
}
