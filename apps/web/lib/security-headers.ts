/**
 * Security Headers Configuration for DashFrame
 *
 * This module defines comprehensive security headers for the Next.js application,
 * including Content Security Policy (CSP) that supports:
 * - DuckDB-WASM execution (blob: workers, jsdelivr CDN, wasm-unsafe-eval)
 * - PostHog analytics integration
 * - Vega-Lite/vgplot visualization rendering
 * - Next.js inline scripts and styles
 *
 * References:
 * - CSP: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
 * - OWASP Secure Headers: https://owasp.org/www-project-secure-headers/
 */

/**
 * Generates security headers array for Next.js configuration
 * @returns Array of header objects with key-value pairs
 */
export function getSecurityHeaders() {
  // Check if we're in development mode for environment-specific CSP rules
  const isDevelopment = process.env.NODE_ENV === "development";

  /**
   * Content Security Policy (CSP)
   * Prevents XSS attacks by controlling which resources can be loaded
   */
  const cspDirectives = [
    // Default fallback for all fetch directives
    "default-src 'self'",

    /**
     * script-src: Controls JavaScript execution
     * - 'self': Allow scripts from same origin
     * - 'unsafe-inline': Required for Next.js inline scripts (_next/static)
     * - 'unsafe-eval': Development only - enables HMR and React DevTools
     * - 'wasm-unsafe-eval': Required for DuckDB-WASM execution
     * - blob:: Required for DuckDB worker scripts
     * - cdn.jsdelivr.net: DuckDB WASM bundles and dependencies
     * - *.posthog.com: PostHog analytics SDK
     */
    [
      "script-src 'self'",
      "'unsafe-inline'", // Next.js inline scripts
      isDevelopment ? "'unsafe-eval'" : "", // Development HMR only
      "'wasm-unsafe-eval'", // DuckDB WASM
      "blob:",
      "https://cdn.jsdelivr.net",
      "https://*.posthog.com",
      "https://us.i.posthog.com",
      "https://eu.i.posthog.com",
      "https://app.posthog.com",
    ]
      .filter(Boolean)
      .join(" "),

    /**
     * style-src: Controls CSS loading
     * - 'self': Allow stylesheets from same origin
     * - 'unsafe-inline': Required for Next.js inline styles and styled-components
     */
    "style-src 'self' 'unsafe-inline'",

    /**
     * worker-src: Controls Web Worker and Service Worker sources
     * - 'self': Allow workers from same origin
     * - blob:: Required for DuckDB workers created via Blob URLs
     */
    "worker-src 'self' blob:",

    /**
     * connect-src: Controls fetch/XHR/WebSocket/EventSource connections
     * - 'self': Allow connections to same origin (API routes)
     * - blob:: Required for DuckDB worker communication
     * - cdn.jsdelivr.net: WASM module loading
     * - *.posthog.com: PostHog event tracking
     */
    "connect-src 'self' blob: https://cdn.jsdelivr.net https://*.posthog.com https://us.i.posthog.com https://eu.i.posthog.com https://app.posthog.com",

    /**
     * img-src: Controls image sources
     * - 'self': Allow images from same origin
     * - data:: Allow data URLs for inline images
     * - blob:: Allow blob URLs for dynamically generated images
     */
    "img-src 'self' data: blob:",

    /**
     * font-src: Controls font loading
     * - 'self': Allow fonts from same origin
     * - data:: Allow data URLs for inline fonts
     */
    "font-src 'self' data:",

    /**
     * object-src: Disable Flash and other legacy plugins
     */
    "object-src 'none'",

    /**
     * base-uri: Restrict <base> tag to prevent base tag injection attacks
     */
    "base-uri 'self'",

    /**
     * form-action: Restrict form submission targets
     */
    "form-action 'self'",

    /**
     * frame-ancestors: Control who can embed this site in frames
     * Same as X-Frame-Options but for CSP
     */
    "frame-ancestors 'none'",

    /**
     * upgrade-insecure-requests: Automatically upgrade HTTP to HTTPS
     * Disabled in development to support localhost
     */
    !isDevelopment ? "upgrade-insecure-requests" : "",
  ]
    .filter(Boolean)
    .join("; ");

  return [
    /**
     * Content-Security-Policy
     * Primary defense against XSS and data injection attacks
     */
    {
      key: "Content-Security-Policy",
      value: cspDirectives,
    },

    /**
     * X-Frame-Options: DENY
     * Prevents clickjacking by blocking iframe embedding
     * Note: frame-ancestors CSP directive is preferred, but this provides fallback
     * Reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options
     */
    {
      key: "X-Frame-Options",
      value: "DENY",
    },

    /**
     * X-Content-Type-Options: nosniff
     * Prevents MIME-type confusion attacks by blocking MIME sniffing
     * Forces browsers to respect declared Content-Type
     * Reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options
     */
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },

    /**
     * Strict-Transport-Security (HSTS)
     * Enforces HTTPS connections and prevents protocol downgrade attacks
     * - max-age=31536000: Enforce HTTPS for 1 year
     * - includeSubDomains: Apply to all subdomains
     * - preload: Eligible for browser HSTS preload list
     * Reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security
     */
    {
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains; preload",
    },

    /**
     * Referrer-Policy: strict-origin-when-cross-origin
     * Controls how much referrer information is sent with requests
     * - Same-origin: Send full URL
     * - Cross-origin HTTPS: Send origin only
     * - Cross-origin HTTP: Send nothing
     * Reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy
     */
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },

    /**
     * Permissions-Policy
     * Controls which browser features and APIs can be used
     * Restrictive defaults - disable features not explicitly needed
     * Reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy
     */
    {
      key: "Permissions-Policy",
      value: [
        "camera=()",
        "microphone=()",
        "geolocation=()",
        "interest-cohort=()", // Disable FLoC
        "payment=()",
        "usb=()",
        "magnetometer=()",
        "gyroscope=()",
        "accelerometer=()",
      ].join(", "),
    },
  ];
}
