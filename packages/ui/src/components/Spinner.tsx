import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const spinnerVariants = cva("animate-spin", {
  variants: {
    size: {
      sm: "size-4",
      md: "size-5",
      lg: "size-8",
      xl: "size-12",
    },
    color: {
      current: "text-current",
      primary: "text-primary",
      secondary: "text-muted-foreground",
      warn: "text-amber-600 dark:text-amber-500",
      danger: "text-destructive",
      success: "text-emerald-600 dark:text-emerald-500",
    },
  },
  defaultVariants: {
    size: "md",
    color: "current",
  },
});

export interface SpinnerProps
  extends Omit<React.ComponentProps<"svg">, "color">,
    VariantProps<typeof spinnerVariants> {}

/**
 * Spinner - Loading indicator component
 *
 * A modern, elegant spinning loader with a transparent track and a spinning segment.
 * Supports size and color variants matching the Button component.
 *
 * @example
 * ```tsx
 * // Default (current color, md size)
 * <Spinner />
 *
 * // Primary color, large
 * <Spinner color="primary" size="lg" />
 *
 * // Small, danger color
 * <Spinner color="danger" size="sm" />
 * ```
 */
export function Spinner({ className, size, color, ...props }: SpinnerProps) {
  return (
    <svg
      role="status"
      aria-label="Loading"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(spinnerVariants({ size, color }), className)}
      {...props}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" />
      <path
        className="opacity-75"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20"
        strokeDasharray="40 22"
      />
    </svg>
  );
}
