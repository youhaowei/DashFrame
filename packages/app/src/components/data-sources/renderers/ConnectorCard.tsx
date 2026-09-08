import type { BaseConnector, FileSourceConnector } from "@dashframe/engine";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldError,
} from "@wystack/ui-react";
import { lazy, Suspense } from "react";

const ConnectorIcon = lazy(() =>
  import("./ConnectorIcon").then((mod) => ({ default: mod.ConnectorIcon })),
);

interface ConnectorCardProps {
  /** The connector to render */
  connector: BaseConnector;
  /** Called when a file is selected (file connectors only) */
  onFileSelect?: (file: File) => void;
  /** Called when connect button is clicked (remote-api connectors only) */
  onConnect?: () => void;
  /** Whether an action is in progress */
  isLoading?: boolean;
  /** Disable this connector while another connector owns onboarding. */
  disabled?: boolean;
  /** Error message to display */
  submitError?: string | null;
  /** Form fields to render (passed as children from TanStack Form) */
  children?: React.ReactNode;
}

/**
 * Generic connector card component - pure UI, no hooks.
 * Renders the connector's icon, name, description, form fields, and action button.
 *
 * @example
 * ```tsx
 * <ConnectorCard
 *   connector={csvConnector}
 *   onFileSelect={(file) => handleFile(file)}
 *   isLoading={isSubmitting}
 * >
 *   {formFields}
 * </ConnectorCard>
 * ```
 */
export function ConnectorCard({
  connector,
  onFileSelect,
  onConnect,
  isLoading,
  disabled,
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

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Suspense fallback={<span className="inline-block h-5 w-5" />}>
            <ConnectorIcon svg={connector.icon} className="h-5 w-5" />
          </Suspense>
          {connector.name}
        </CardTitle>
        {connector.description && (
          <CardDescription>{connector.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Form fields passed as children (TanStack Form Field components) */}
        {children}

        {/* File input for file connectors */}
        {isFileConnector && (
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-neutral-border bg-neutral-bg-muted/50 p-6 text-center text-sm font-medium transition hover:border-palette-primary hover:bg-neutral-bg-muted">
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
              disabled={isLoading || disabled}
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
            disabled={isLoading || disabled}
            className="w-full"
          />
        )}

        {/* Submit-level error */}
        {submitError && <FieldError errors={[{ message: submitError }]} />}
      </CardContent>
    </Card>
  );
}
