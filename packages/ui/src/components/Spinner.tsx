import { LoaderIcon } from "../lib/icons";
import { cn } from "../lib/utils";

export interface SpinnerProps extends React.ComponentProps<"svg"> {
  /** Size of the spinner - defaults to "md" */
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "size-4",
  md: "size-5",
  lg: "size-8",
};

/**
 * Spinner - Loading indicator component
 *
 * A simple spinning loader icon for indicating loading states.
 * Based on shadcn/ui spinner pattern.
 *
 * @example
 * ```tsx
 * // Default size
 * <Spinner />
 *
 * // Small size
 * <Spinner size="sm" />
 *
 * // Large with custom color
 * <Spinner size="lg" className="text-primary" />
 * ```
 */
export function Spinner({ className, size = "md", ...props }: SpinnerProps) {
  return (
    <LoaderIcon
      role="status"
      aria-label="Loading"
      className={cn("animate-spin", sizeClasses[size], className)}
      {...props}
    />
  );
}
