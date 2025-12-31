import { AlertCircleIcon, RefreshIcon } from "../lib/icons";
import { Button } from "../primitives/button";
import { cn } from "../lib/utils";

export interface ErrorStateAction {
  /** Button label */
  label: string;
  /** Click handler */
  onClick: () => void;
}

export interface ErrorStateProps {
  /** Main heading text */
  title: string;
  /** Supporting description text */
  description?: string;
  /** Optional retry action button */
  retryAction?: ErrorStateAction;
  /** Additional CSS classes */
  className?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

const sizeConfig = {
  sm: {
    container: "p-6",
    icon: "h-10 w-10",
    title: "text-base",
    description: "text-xs",
  },
  md: {
    container: "p-8",
    icon: "h-12 w-12",
    title: "text-lg",
    description: "text-sm",
  },
  lg: {
    container: "p-12",
    icon: "h-16 w-16",
    title: "text-xl",
    description: "text-base",
  },
} as const;

/**
 * ErrorState - Standardized error state component
 *
 * Displays a centered error state with alert icon, title, description, and optional retry action.
 * Use for network errors, data loading failures, or any error scenarios.
 *
 * @example
 * ```tsx
 * // Basic error state
 * <ErrorState
 *   title="Failed to load data"
 *   description="An error occurred while fetching the data"
 * />
 *
 * // With retry action
 * <ErrorState
 *   title="Connection error"
 *   description="Unable to connect to the server"
 *   retryAction={{
 *     label: "Try again",
 *     onClick: handleRetry,
 *   }}
 * />
 *
 * // Compact size
 * <ErrorState
 *   title="Error"
 *   description="Something went wrong"
 *   size="sm"
 * />
 * ```
 */
export function ErrorState({
  title,
  description,
  retryAction,
  className,
  size = "md",
}: ErrorStateProps) {
  const config = sizeConfig[size];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        config.container,
        className,
      )}
      role="alert"
      aria-live="assertive"
    >
      <AlertCircleIcon
        className={cn(config.icon, "text-destructive mb-4")}
        aria-hidden="true"
      />
      <h3 className={cn(config.title, "mb-2 font-medium")}>{title}</h3>
      {description && (
        <p className={cn(config.description, "text-muted-foreground mb-4")}>
          {description}
        </p>
      )}
      {retryAction && (
        <Button onClick={retryAction.onClick} variant="outlined" size="sm">
          <RefreshIcon className="mr-2 h-4 w-4" />
          {retryAction.label}
        </Button>
      )}
    </div>
  );
}
