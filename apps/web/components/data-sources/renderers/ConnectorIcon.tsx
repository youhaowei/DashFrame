"use client";

import DOMPurify from "isomorphic-dompurify";

interface ConnectorIconProps {
  /** SVG string to render */
  svg: string;
  /** CSS class name for sizing/styling */
  className?: string;
}

/**
 * Renders a connector icon safely by sanitizing the SVG with DOMPurify.
 * No icon registry needed - connectors define their own SVG strings.
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
  const sanitizedSvg = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ALLOWED_TAGS: [
      "svg",
      "path",
      "circle",
      "rect",
      "line",
      "polyline",
      "polygon",
      "g",
      "defs",
      "use",
      "ellipse",
      "text",
      "tspan",
    ],
    ALLOWED_ATTR: [
      "viewBox",
      "d",
      "fill",
      "stroke",
      "stroke-width",
      "stroke-linecap",
      "stroke-linejoin",
      "cx",
      "cy",
      "r",
      "rx",
      "ry",
      "x",
      "y",
      "x1",
      "y1",
      "x2",
      "y2",
      "width",
      "height",
      "points",
      "transform",
      "class",
      "xmlns",
      "fill-rule",
      "clip-rule",
    ],
  });

  return (
    <span
      className={`${className} [&>svg]:h-full [&>svg]:w-full`}
      dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
    />
  );
}
