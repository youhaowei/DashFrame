"use client";

import { sanitizeSvg } from "@/lib/connectors/svg-sanitization";

interface ConnectorIconProps {
  /** SVG string to render (will be sanitized) */
  svg: string;
  /** CSS class name for sizing/styling */
  className?: string;
}

/**
 * Renders a connector icon safely by sanitizing the SVG with DOMPurify.
 *
 * Note: Connector icons are defined in code by developers, so sanitization
 * is defense-in-depth rather than a critical security boundary. The shared
 * config in svg-sanitization.ts ensures consistent sanitization rules.
 *
 * @example
 * ```tsx
 * <ConnectorIcon svg={connector.icon} className="h-5 w-5" />
 * ```
 */
export function ConnectorIcon({
  svg,
  className = "h-5 w-5",
}: ConnectorIconProps) {
  const sanitizedSvg = sanitizeSvg(svg);

  return (
    <span
      className={`${className} [&>svg]:h-full [&>svg]:w-full`}
      dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
    />
  );
}
