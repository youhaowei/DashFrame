import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ContainerProps {
  /** Child elements to contain */
  children: ReactNode;
  /** Maximum width constraint */
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
  /** Horizontal padding */
  padding?: "none" | "sm" | "md" | "lg";
  /** Additional CSS classes */
  className?: string;
  /** HTML element to render as */
  as?: "div" | "section" | "article" | "main" | "aside";
}

const maxWidthMap = {
  sm: "max-w-3xl",
  md: "max-w-5xl",
  lg: "max-w-7xl",
  xl: "max-w-[1400px]",
  "2xl": "max-w-[1600px]",
  full: "max-w-full",
} as const;

const paddingMap = {
  none: "px-0",
  sm: "px-4",
  md: "px-6",
  lg: "px-8",
} as const;

/**
 * Container - Max-width content container with consistent padding
 *
 * Provides responsive container with centered content and consistent horizontal padding.
 * Use for page-level content to maintain readable line lengths and consistent margins.
 *
 * @example
 * ```tsx
 * // Standard page container
 * <Container maxWidth="lg" padding="md">
 *   <PageContent />
 * </Container>
 *
 * // Wide dashboard container
 * <Container maxWidth="2xl" padding="lg">
 *   <Dashboard />
 * </Container>
 *
 * // Narrow content (articles, forms)
 * <Container maxWidth="sm" padding="md">
 *   <ArticleContent />
 * </Container>
 *
 * // Full width with padding
 * <Container maxWidth="full" padding="md">
 *   <FullWidthContent />
 * </Container>
 * ```
 */
export function Container({
  children,
  maxWidth = "lg",
  padding = "md",
  className,
  as: Component = "div",
}: ContainerProps) {
  return (
    <Component
      className={cn(
        "mx-auto w-full",
        maxWidthMap[maxWidth],
        paddingMap[padding],
        className,
      )}
    >
      {children}
    </Component>
  );
}
