"use client";

import type { BaseConnector, FileSourceConnector } from "@dashframe/engine";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  PrimitiveButton,
  FieldError,
} from "@dashframe/ui";
import dynamic from "next/dynamic";

const ConnectorIcon = dynamic(
  () => import("./ConnectorIcon").then((mod) => mod.ConnectorIcon),
  { ssr: false },
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
  submitError,
  children,
}: ConnectorCardProps) {
  const isFileConnector = connector.sourceType === "file";
  const fileConnector = isFileConnector
    ? (connector as FileSourceConnector)
    : null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ConnectorIcon svg={connector.icon} className="h-5 w-5" />
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
          <label className="border-input bg-muted/50 hover:border-primary hover:bg-muted flex cursor-pointer flex-col items-center justify-center rounded-xl border p-6 text-center text-sm font-medium transition">
            <span className="text-foreground">Select {connector.name}</span>
            {fileConnector?.helperText && (
              <span className="text-muted-foreground mt-2 text-xs font-normal">
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
                if (file) onFileSelect?.(file);
              }}
            />
          </label>
        )}

        {/* Connect button for remote-api connectors */}
        {connector.sourceType === "remote-api" && (
          <PrimitiveButton
            onClick={onConnect}
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? "Connecting..." : "Connect"}
          </PrimitiveButton>
        )}

        {/* Submit-level error */}
        {submitError && <FieldError errors={[{ message: submitError }]} />}
      </CardContent>
    </Card>
  );
}
