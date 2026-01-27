/**
 * Security Headers Configuration for DashFrame
 *
 * This module defines comprehensive security headers for the Next.js application,
 * implementing defense-in-depth security measures to protect against common web
 * vulnerabilities including XSS, clickjacking, MIME confusion, and protocol downgrade attacks.
 *
 * The Content Security Policy (CSP) is carefully configured to support DashFrame's
 * technical requirements while maintaining strong security:
 * - DuckDB-WASM execution (blob: workers, jsdelivr CDN, wasm-unsafe-eval)
 * - PostHog analytics integration (configurable via environment variable)
 * - Vega-Lite/vgplot visualization rendering (SVG/Canvas content)
 * - Next.js inline scripts and styles (framework requirement)
 *
 * References:
 * - OWASP Secure Headers Project: https://owasp.org/www-project-secure-headers/
 * - MDN Content Security Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
 * - CSP Evaluator: https://csp-evaluator.withgoogle.com/
 */

/**
 * Generates security headers array for Next.js configuration
 *
 * Returns an array of HTTP security headers that provide defense-in-depth protection
 * against common web vulnerabilities. The configuration is environment-aware to balance
 * security with development experience.
 *
 * Environment-based CSP configuration:
 * - **Development (NODE_ENV=development)**:
 *   - Allows 'unsafe-eval' in script-src for Webpack Hot Module Replacement (HMR) and React DevTools
 *   - Disables upgrade-insecure-requests to support localhost HTTP connections
 *   - Enables faster development workflow without security warnings
 *
 * - **Production (NODE_ENV=production)**:
 *   - Removes 'unsafe-eval' for strict Content Security Policy
 *   - Enables upgrade-insecure-requests to automatically upgrade HTTP to HTTPS
 *   - Maximizes security posture for production deployments
 *
 * @returns {Array<{key: string, value: string}>} Array of header objects with key-value pairs for Next.js config
 *
 * @example
 * // In next.config.mjs:
 * import { getSecurityHeaders } from './lib/security-headers';
 *
 * export default {
 *   async headers() {
 *     return [{
 *       source: '/(.*)',
 *       headers: getSecurityHeaders(),
 *     }];
 *   },
 * };
 */
export function getSecurityHeaders() {
  // Check if we're in development mode for environment-specific CSP rules
  const isDevelopment = process.env.NODE_ENV === "development";

  /**
   * PostHog Analytics Host Configuration
   *
   * PostHog is used for product analytics and requires external script loading and
   * data transmission. The CSP must allow these hosts for:
   * - script-src: Loading the PostHog JavaScript SDK
   * - connect-src: Sending analytics events to PostHog servers
   *
   * Supports both default PostHog SaaS hosts and custom self-hosted instances
   * via NEXT_PUBLIC_POSTHOG_HOST environment variable.
   *
   * Default hosts cover common PostHog SaaS regions:
   * - us.i.posthog.com (US region)
   * - eu.i.posthog.com (EU region)
   * - app.posthog.com (Dashboard access)
   * - *.posthog.com, *.i.posthog.com (Wildcard for all PostHog SaaS domains)
   *
   * @see {@link https://posthog.com/docs/libraries/js PostHog JavaScript Documentation}
   */
  const customPostHogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  const postHogHosts = [
    // Wildcard patterns for PostHog SaaS domains
    "https://*.posthog.com",
    "https://*.i.posthog.com",
    // Default PostHog hosts (US, EU, Dashboard)
    "https://us.i.posthog.com",
    "https://eu.i.posthog.com",
    "https://app.posthog.com",
    // Custom host if configured via NEXT_PUBLIC_POSTHOG_HOST
    customPostHogHost ? customPostHogHost : null,
  ].filter(Boolean);

  /**
   * Content Security Policy (CSP)
   *
   * Primary defense against Cross-Site Scripting (XSS) and data injection attacks.
   * CSP works by defining approved sources for content, preventing execution of
   * unauthorized scripts and loading of malicious resources.
   *
   * Reference: https://owasp.org/www-community/attacks/Content_Security_Policy
   */
  const cspDirectives = [
    /**
     * default-src: Default fallback policy for all fetch directives
     *
     * Set to 'self' to allow resources from same origin by default. Specific
     * directives below override this for their resource types.
     *
     * Security benefit: Prevents loading of resources from unauthorized domains.
     */
    "default-src 'self'",

    /**
     * script-src: Controls JavaScript execution sources
     *
     * This is the most critical CSP directive for XSS prevention. Each source
     * is carefully chosen to support DashFrame's functionality:
     *
     * - 'self': Allow scripts from same origin (Next.js app bundles)
     *
     * - 'unsafe-inline': Required for Next.js inline scripts in _next/static
     *   Security note: Needed for Next.js framework, but limits XSS protection.
     *   Mitigated by other security layers (input sanitization, escaping).
     *
     * - 'unsafe-eval': DEVELOPMENT ONLY - enables eval() for HMR and React DevTools
     *   Production removes this for maximum security. Never use in production!
     *   Why needed: Webpack's HMR uses eval() to hot-reload modules during development.
     *
     * - 'wasm-unsafe-eval': Required for WebAssembly instantiation (DuckDB-WASM)
     *   Why needed: WASM compilation requires compile/instantiate APIs that CSP
     *   blocks by default. This directive specifically allows WASM while still
     *   blocking JavaScript eval().
     *   Security note: More secure than 'unsafe-eval' as it only affects WASM.
     *
     * - blob:: Required for DuckDB worker scripts created from Blob URLs
     *   Why needed: DuckDB-WASM uses createWorkerFromCDN() which creates Web Workers
     *   from blob: URLs. The worker script is downloaded from CDN, converted to a Blob,
     *   and instantiated as a worker. This pattern avoids CORS issues and allows
     *   dynamic worker creation.
     *   Reference: @duckdb/duckdb-wasm createWorkerFromCDN implementation
     *
     * - cdn.jsdelivr.net: DuckDB WASM bundles and dependencies from jsDelivr CDN
     *   Why needed: DuckDB's WASM files (duckdb-mvp.wasm, duckdb-eh.wasm) are loaded
     *   from jsDelivr CDN for better performance and caching. The library doesn't
     *   bundle WASM files directly.
     *
     * - PostHog hosts: Analytics SDK loading
     *   Why needed: PostHog JavaScript SDK must be loaded from PostHog servers.
     *   Supports custom NEXT_PUBLIC_POSTHOG_HOST for self-hosted instances.
     */
    [
      "script-src 'self'",
      "'unsafe-inline'", // Next.js inline scripts
      isDevelopment ? "'unsafe-eval'" : "", // Development: HMR/DevTools | Production: removed
      "'wasm-unsafe-eval'", // DuckDB WASM
      "blob:",
      "https://cdn.jsdelivr.net",
      ...postHogHosts, // PostHog analytics hosts
    ]
      .filter(Boolean)
      .join(" "),

    /**
     * style-src: Controls CSS stylesheet sources
     *
     * - 'self': Allow stylesheets from same origin (Next.js CSS)
     *
     * - 'unsafe-inline': Required for Next.js inline styles and CSS-in-JS libraries
     *   Why needed: Next.js injects critical CSS inline for performance, and many
     *   React component libraries (styled-components, emotion) use inline styles.
     *   Security note: Less risky than script 'unsafe-inline' as CSS can't execute JavaScript.
     */
    "style-src 'self' 'unsafe-inline'",

    /**
     * worker-src: Controls Web Worker and Service Worker sources
     *
     * - 'self': Allow workers from same origin
     *
     * - blob:: Required for DuckDB workers created via Blob URLs
     *   Why needed: DuckDB-WASM's createWorkerFromCDN() creates workers from blob: URLs.
     *   The worker script is fetched from CDN, converted to a Blob object, then
     *   instantiated using new Worker(URL.createObjectURL(blob)). This allows
     *   loading workers from external CDNs without CORS issues.
     */
    "worker-src 'self' blob:",

    /**
     * connect-src: Controls fetch/XHR/WebSocket/EventSource connections
     *
     * Governs which servers the application can connect to for data exchange.
     *
     * - 'self': Allow connections to same origin (Next.js API routes, tRPC endpoints)
     *
     * - blob:: Required for DuckDB worker communication
     *   Why needed: Workers created from blob: URLs communicate with the main thread
     *   via MessageChannel/postMessage. The worker URL itself is a blob: URL.
     *
     * - cdn.jsdelivr.net: DuckDB WASM module loading
     *   Why needed: DuckDB's WASM bundles are fetched from jsDelivr CDN at runtime.
     *
     * - PostHog hosts: Analytics event tracking
     *   Why needed: PostHog SDK sends analytics events to PostHog servers via fetch/XHR.
     *   Supports custom NEXT_PUBLIC_POSTHOG_HOST for self-hosted deployments.
     */
    ["connect-src 'self' blob: https://cdn.jsdelivr.net", ...postHogHosts]
      .filter(Boolean)
      .join(" "),

    /**
     * img-src: Controls image sources
     *
     * - 'self': Allow images from same origin
     *
     * - data:: Allow data URLs for inline images (base64-encoded images)
     *   Why needed: Common for small icons, logos, and dynamically generated images.
     *
     * - blob:: Allow blob URLs for dynamically generated images
     *   Why needed: Canvas.toBlob(), chart libraries may generate images as blobs.
     */
    "img-src 'self' data: blob:",

    /**
     * font-src: Controls web font loading
     *
     * - 'self': Allow fonts from same origin
     *
     * - data:: Allow data URLs for inline fonts
     *   Why needed: Some fonts may be embedded as base64 data URLs for performance.
     */
    "font-src 'self' data:",

    /**
     * object-src: Controls <object>, <embed>, and <applet> elements
     *
     * - 'none': Completely disable legacy plugin content (Flash, Java applets)
     *   Security benefit: Prevents exploitation of legacy plugin vulnerabilities.
     *   Modern web apps don't need these deprecated technologies.
     */
    "object-src 'none'",

    /**
     * base-uri: Restricts URLs that can be used in <base> element
     *
     * - 'self': Only allow <base> tags pointing to same origin
     *   Security benefit: Prevents base tag injection attacks where attackers
     *   inject <base href="evil.com"> to redirect all relative URLs.
     */
    "base-uri 'self'",

    /**
     * form-action: Restricts where forms can be submitted
     *
     * - 'self': Only allow form submissions to same origin
     *   Security benefit: Prevents forms from being hijacked to send data to
     *   attacker-controlled servers.
     */
    "form-action 'self'",

    /**
     * frame-ancestors: Controls which sites can embed this site in frames/iframes
     *
     * - 'none': Prevent all framing of this site
     *   Security benefit: Prevents clickjacking attacks where attackers embed
     *   your site in an invisible iframe and trick users into clicking.
     *   Note: This is the CSP equivalent of X-Frame-Options: DENY.
     */
    "frame-ancestors 'none'",

    /**
     * upgrade-insecure-requests: Automatically upgrades HTTP requests to HTTPS
     *
     * PRODUCTION ONLY: Development disables this to support localhost HTTP.
     *
     * Security benefit: Ensures all resources are loaded over HTTPS, preventing
     * man-in-the-middle attacks and mixed content warnings.
     *
     * Why disabled in development: Localhost development typically uses HTTP.
     * Enabling this would break local development workflow.
     */
    !isDevelopment ? "upgrade-insecure-requests" : "",

    /**
     * report-uri: CSP violation reporting endpoint (placeholder for future implementation)
     *
     * When implemented, CSP violations will be sent to this endpoint for monitoring
     * and alerting. This helps detect attempted attacks and CSP misconfigurations.
     *
     * To implement:
     * 1. Create API route at /api/csp-report that accepts POST requests
     * 2. Log violation reports to monitoring service (e.g., Sentry, LogRocket)
     * 3. Uncomment the line below
     *
     * Reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/report-uri
     * Modern alternative: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/report-to
     */
    // "report-uri /api/csp-report",
  ]
    .filter(Boolean)
    .join("; ");

  return [
    /**
     * Content-Security-Policy (CSP)
     *
     * Primary defense against Cross-Site Scripting (XSS) and data injection attacks.
     * Defines approved sources for scripts, styles, images, and other resources.
     *
     * Security benefits:
     * - Prevents execution of malicious inline scripts
     * - Blocks loading of scripts from unauthorized domains
     * - Mitigates XSS impact even if injection vulnerabilities exist
     *
     * References:
     * - OWASP CSP Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
     * - MDN CSP Reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
     */
    {
      key: "Content-Security-Policy",
      value: cspDirectives,
    },

    /**
     * X-Frame-Options: DENY
     *
     * Prevents clickjacking attacks by blocking all iframe embedding of this site.
     * Clickjacking tricks users into clicking hidden UI elements by overlaying them
     * on legitimate-looking pages.
     *
     * Security benefits:
     * - Prevents UI redress attacks where site is framed by malicious sites
     * - Protects against clickjacking-based credential theft
     * - Blocks social engineering attacks using transparent iframes
     *
     * Note: The CSP frame-ancestors directive is the modern standard, but
     * X-Frame-Options provides fallback support for older browsers.
     *
     * References:
     * - OWASP Clickjacking Defense: https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html
     * - MDN X-Frame-Options: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options
     */
    {
      key: "X-Frame-Options",
      value: "DENY",
    },

    /**
     * X-Content-Type-Options: nosniff
     *
     * Prevents MIME-type confusion attacks by disabling browser MIME sniffing.
     * Forces browsers to strictly follow the declared Content-Type header.
     *
     * Security benefits:
     * - Prevents browsers from interpreting files as different MIME types
     * - Blocks execution of uploaded files disguised as images (e.g., .jpg with JS code)
     * - Mitigates attacks where attacker uploads malicious content with wrong extension
     *
     * Example attack prevented: Attacker uploads malicious.jpg containing JavaScript.
     * Without nosniff, browser might execute it as JS. With nosniff, browser refuses.
     *
     * References:
     * - OWASP Secure Headers: https://owasp.org/www-project-secure-headers/#x-content-type-options
     * - MDN X-Content-Type-Options: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options
     */
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },

    /**
     * Strict-Transport-Security (HSTS)
     *
     * Enforces HTTPS connections for the entire site and all subdomains.
     * Prevents protocol downgrade attacks and cookie hijacking.
     *
     * Configuration:
     * - max-age=31536000: Enforce HTTPS for 1 year (365 days)
     * - includeSubDomains: Apply HSTS to all subdomains
     * - preload: Eligible for browser HSTS preload list (hardcoded HTTPS enforcement)
     *
     * Security benefits:
     * - Prevents man-in-the-middle attacks via HTTP downgrade
     * - Blocks SSL stripping attacks where HTTPS is downgraded to HTTP
     * - Protects cookies and session tokens from being transmitted over HTTP
     * - First request still uses HTTPS (if preloaded in browser)
     *
     * Important: Only enable preload after registering at hstspreload.org
     * Preload is difficult to undo and affects all subdomains permanently.
     *
     * References:
     * - OWASP HSTS Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html
     * - MDN HSTS: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security
     * - HSTS Preload: https://hstspreload.org/
     */
    {
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains; preload",
    },

    /**
     * Referrer-Policy: strict-origin-when-cross-origin
     *
     * Controls how much referrer information is included in outgoing requests.
     * Balances privacy, analytics needs, and security.
     *
     * Behavior:
     * - Same-origin requests: Send full URL (including path and query string)
     * - Cross-origin HTTPS→HTTPS: Send origin only (no path, no query)
     * - Cross-origin HTTPS→HTTP: Send nothing (prevents leaking HTTPS URLs over HTTP)
     * - Cross-origin HTTP→HTTP: Send origin only
     *
     * Security benefits:
     * - Prevents leaking sensitive URL parameters (tokens, IDs) to third parties
     * - Reduces privacy exposure by limiting referrer data
     * - Protects against HTTPS→HTTP downgrade leaking secure URLs
     *
     * Example: Link to external site only reveals "https://dashframe.app" not
     * "https://dashframe.app/dashboard?secret=abc123"
     *
     * References:
     * - MDN Referrer-Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy
     * - W3C Referrer Policy: https://www.w3.org/TR/referrer-policy/
     */
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },

    /**
     * Permissions-Policy (formerly Feature-Policy)
     *
     * Controls access to browser features and APIs, following principle of least privilege.
     * Disables features not explicitly required by DashFrame.
     *
     * Disabled features:
     * - camera: No webcam access needed
     * - microphone: No audio recording needed
     * - geolocation: No location tracking needed
     * - interest-cohort: Disables FLoC (Google's tracking technology)
     * - payment: No Payment Request API needed
     * - usb: No USB device access needed
     * - magnetometer, gyroscope, accelerometer: No motion sensor access needed
     *
     * Security benefits:
     * - Reduces attack surface by disabling unused browser APIs
     * - Prevents malicious scripts from accessing sensitive hardware
     * - Protects user privacy by blocking tracking technologies (FLoC)
     * - Provides defense-in-depth even if XSS occurs
     *
     * Note: Empty parentheses "()" means "block for all origins including self"
     *
     * References:
     * - MDN Permissions-Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy
     * - W3C Permissions Policy: https://www.w3.org/TR/permissions-policy-1/
     */
    {
      key: "Permissions-Policy",
      value: [
        "camera=()", // No webcam access
        "microphone=()", // No audio recording
        "geolocation=()", // No location tracking
        "interest-cohort=()", // Disable FLoC tracking
        "payment=()", // No payment API
        "usb=()", // No USB devices
        "magnetometer=()", // No magnetometer
        "gyroscope=()", // No gyroscope
        "accelerometer=()", // No accelerometer
      ].join(", "),
    },
  ];
}
