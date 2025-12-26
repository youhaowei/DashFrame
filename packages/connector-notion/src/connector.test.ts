/**
 * Unit tests for NotionConnector
 *
 * Tests cover:
 * - Form field configuration (API key input)
 * - Validation logic (required field, secret_ prefix)
 * - Static properties (id, name, icon)
 *
 * Note: connect() and query() methods require server-side proxy due to CORS,
 * so they are tested via integration tests with the tRPC router.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NotionConnector, notionConnector } from "./connector";

describe("NotionConnector", () => {
  let connector: NotionConnector;

  beforeEach(() => {
    connector = new NotionConnector();
  });

  describe("static properties", () => {
    it("should have correct id", () => {
      expect(connector.id).toBe("notion");
    });

    it("should have correct name", () => {
      expect(connector.name).toBe("Notion");
    });

    it("should have description", () => {
      expect(connector.description).toBeTruthy();
      expect(typeof connector.description).toBe("string");
    });

    it("should have SVG icon", () => {
      expect(connector.icon).toContain("<svg");
      expect(connector.icon).toContain("</svg>");
    });

    it("should have preserveAspectRatio in icon for proper scaling", () => {
      expect(connector.icon).toContain("preserveAspectRatio");
    });
  });

  describe("getFormFields", () => {
    it("should return exactly one field for API key", () => {
      const fields = connector.getFormFields();
      expect(fields).toHaveLength(1);
    });

    it("should have apiKey field with correct configuration", () => {
      const fields = connector.getFormFields();
      const apiKeyField = fields[0];

      expect(apiKeyField.name).toBe("apiKey");
      expect(apiKeyField.label).toBe("API Key");
      expect(apiKeyField.type).toBe("password");
      expect(apiKeyField.required).toBe(true);
    });

    it("should have placeholder suggesting secret_ prefix", () => {
      const fields = connector.getFormFields();
      const apiKeyField = fields[0];

      expect(apiKeyField.placeholder).toContain("secret_");
    });

    it("should have hint about local storage", () => {
      const fields = connector.getFormFields();
      const apiKeyField = fields[0];

      expect(apiKeyField.hint).toBeTruthy();
      expect(apiKeyField.hint).toContain("locally");
    });
  });

  describe("validate", () => {
    describe("missing API key", () => {
      it("should return invalid when apiKey is undefined", () => {
        const result = connector.validate({});
        expect(result.valid).toBe(false);
        expect(result.errors?.apiKey).toBe("API key is required");
      });

      it("should return invalid when apiKey is empty string", () => {
        const result = connector.validate({ apiKey: "" });
        expect(result.valid).toBe(false);
        expect(result.errors?.apiKey).toBe("API key is required");
      });

      it("should return invalid when apiKey is null", () => {
        const result = connector.validate({ apiKey: null });
        expect(result.valid).toBe(false);
        expect(result.errors?.apiKey).toBe("API key is required");
      });
    });

    describe("invalid API key format", () => {
      it("should reject API keys without secret_ prefix", () => {
        const result = connector.validate({ apiKey: "ntn_abc123" });
        expect(result.valid).toBe(false);
        expect(result.errors?.apiKey).toContain('start with "secret_"');
      });

      it("should reject API keys with wrong prefix", () => {
        const result = connector.validate({ apiKey: "private_abc123" });
        expect(result.valid).toBe(false);
        expect(result.errors?.apiKey).toContain('start with "secret_"');
      });

      it("should reject API keys with similar but incorrect prefix", () => {
        const result = connector.validate({ apiKey: "secrets_abc123" });
        expect(result.valid).toBe(false);
        expect(result.errors?.apiKey).toContain('start with "secret_"');
      });

      it("should reject API keys with uppercase prefix", () => {
        const result = connector.validate({ apiKey: "SECRET_abc123" });
        expect(result.valid).toBe(false);
        expect(result.errors?.apiKey).toContain('start with "secret_"');
      });
    });

    describe("valid API key", () => {
      it("should accept API keys with secret_ prefix", () => {
        const result = connector.validate({ apiKey: "secret_abc123" });
        expect(result.valid).toBe(true);
        expect(result.errors).toBeUndefined();
      });

      it("should accept long API keys with secret_ prefix", () => {
        const longKey =
          "secret_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdefghijklmnopqrstuvwxyz";
        const result = connector.validate({ apiKey: longKey });
        expect(result.valid).toBe(true);
      });

      it("should accept API keys with just secret_ prefix", () => {
        const result = connector.validate({ apiKey: "secret_" });
        // This is technically valid format, even if the API would reject it
        expect(result.valid).toBe(true);
      });
    });

    describe("extra form data", () => {
      it("should ignore extra fields in form data", () => {
        const result = connector.validate({
          apiKey: "secret_abc123",
          extraField: "should be ignored",
          anotherField: 12345,
        });
        expect(result.valid).toBe(true);
      });
    });
  });

  describe("singleton instance", () => {
    it("should export a singleton notionConnector instance", () => {
      expect(notionConnector).toBeInstanceOf(NotionConnector);
    });

    it("singleton should have the same properties as a new instance", () => {
      expect(notionConnector.id).toBe(connector.id);
      expect(notionConnector.name).toBe(connector.name);
    });

    it("singleton should return same form fields", () => {
      const singletonFields = notionConnector.getFormFields();
      const instanceFields = connector.getFormFields();

      expect(singletonFields).toHaveLength(instanceFields.length);
      expect(singletonFields[0].name).toBe(instanceFields[0].name);
    });
  });
});
