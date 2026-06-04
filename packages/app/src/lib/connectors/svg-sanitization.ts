/**
 * SVG Sanitization Utilities
 *
 * Provides DOMPurify-based SVG sanitization for connector icons.
 * Icons are sanitized at registration time (once) rather than at render time (repeatedly).
 *
 * Security model:
 * - Allowlist of safe SVG tags only (no script, foreignObject, animate, etc.)
 * - Allowlist of safe attributes (no event handlers like onclick, onload)
 * - No href/xlink:href to prevent javascript: URLs
 */
import DOMPurify, { type Config } from "dompurify";

/**
 * DOMPurify configuration for SVG sanitization.
 *
 * IMPORTANT: We do NOT use USE_PROFILES because it merges with our allowlist
 * rather than replacing it. We define the complete allowlist manually for
 * maximum security control.
 *
 * Security notes:
 * - No <image> tag: can load external resources or data: URLs
 * - No <a> tag: can contain javascript: hrefs
 * - No animation tags (animate, animateTransform, set): can trigger scripts
 * - No style attribute: can contain CSS expressions with javascript: URLs
 * - No href/xlink:href attributes: can contain javascript: URLs
 * - No foreignObject: can embed arbitrary HTML including scripts
 */
export const SVG_SANITIZE_CONFIG: Config = {
  // Explicitly list allowed tags - no profiles to avoid unwanted merging
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
    "preserveAspectRatio",
  ],
};

/**
 * Sanitize an SVG string to remove potentially malicious content.
 *
 * @param svg - Raw SVG string from connector
 * @returns Sanitized SVG string safe for dangerouslySetInnerHTML
 *
 * @example
 * ```ts
 * const safeSvg = sanitizeSvg(connector.icon);
 * ```
 */
export function sanitizeSvg(svg: string): string {
  // RETURN_TRUSTED_TYPE: false ensures we get a string, not TrustedHTML
  return DOMPurify.sanitize(svg, {
    ...SVG_SANITIZE_CONFIG,
    RETURN_TRUSTED_TYPE: false,
  }) as string;
}
