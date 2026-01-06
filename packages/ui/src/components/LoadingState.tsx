import { LoaderIcon } from "../lib/icons";
import { cn } from "../lib/utils";

export interface LoadingStateProps {
  /** Main heading text */
  title: string;
  /** Supporting description text */
  description?: string;
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
 * LoadingState - Standardized loading state component
 *
 * Displays a centered loading state with animated spinner, title, and optional description.
 * Use for data loading, chart rendering, table loading, or any async operations.
 *
 * @example
 * ```tsx
 * // Basic loading state
 * <LoadingState
 *   title="Loading data..."
 * />
 *
 * // With description
 * <LoadingState
 *   title="Loading data sources"
 *   description="Please wait while we fetch your data"
 * />
 *
 * // Compact size
 * <LoadingState
 *   title="Loading..."
 *   size="sm"
 * />
 * ```
 */
export function LoadingState({
  title,
  description,
  className,
  size = "md",
}: LoadingStateProps) {
  const config = sizeConfig[size];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        config.container,
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <LoaderIcon
        className={cn(config.icon, "mb-4 animate-spin text-muted-foreground")}
        aria-hidden="true"
      />
      <h3 className={cn(config.title, "mb-2 font-medium")}>{title}</h3>
      {description && (
        <p className={cn(config.description, "mb-4 text-muted-foreground")}>
          {description}
        </p>
      )}
    </div>
  );
}
