import type { LucideIcon } from "../lib/icons";
import { Button } from "../primitives/button";
import { cn } from "../lib/utils";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: "filled" | "outlined" | "text";
  color?: "primary" | "secondary" | "danger";
  icon?: LucideIcon;
}

export interface EmptyStateProps {
  /** Icon to display (Lucide icon component) */
  icon: LucideIcon;
  /** Main heading text */
  title: string;
  /** Supporting description text */
  description?: string;
  /** Optional action button */
  action?: EmptyStateAction;
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
 * EmptyState - Standardized empty state component
 *
 * Displays a centered empty state with icon, title, description, and optional action.
 * Use for empty data tables, collections, search results, or any no-data scenarios.
 *
 * @example
 * ```tsx
 * // Basic empty state
 * <EmptyState
 *   icon={Database}
 *   title="No data sources"
 *   description="Get started by adding your first data source"
 * />
 *
 * // With action button
 * <EmptyState
 *   icon={FileText}
 *   title="No insights yet"
 *   description="Create an insight to start exploring your data"
 *   action={{
 *     label: "Create insight",
 *     onClick: handleCreateInsight,
 *     icon: Plus
 *   }}
 * />
 *
 * // Compact size
 * <EmptyState
 *   icon={Search}
 *   title="No results"
 *   description="Try adjusting your search"
 *   size="sm"
 * />
 * ```
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  size = "md",
}: EmptyStateProps) {
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
    >
      <Icon
        className={cn(config.icon, "text-muted-foreground mb-4")}
        aria-hidden="true"
      />
      <h3 className={cn(config.title, "mb-2 font-medium")}>{title}</h3>
      {description && (
        <p className={cn(config.description, "text-muted-foreground mb-4")}>
          {description}
        </p>
      )}
      {action && (
        <Button
          onClick={action.onClick}
          variant={action.variant}
          color={action.color}
          size="sm"
        >
          {action.icon && <action.icon className="mr-2 h-4 w-4" />}
          {action.label}
        </Button>
      )}
    </div>
  );
}
