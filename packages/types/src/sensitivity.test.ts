import { describe, expect, it } from "vitest";
import type { StringAnalysis } from "./column-analysis";
import {
  buildSensitivityUpdate,
  getFieldSensitivity,
  isFieldRestricted,
} from "./field";
import {
  suggestSensitivityFromAnalysis,
  suggestSensitivityFromName,
  suggestSensitivityReasons,
} from "./sensitivity";

describe("fail-closed sensitivity marker", () => {
  it("should read absent sensitivity as unclassified", () => {
    expect(getFieldSensitivity({})).toBe("unclassified");
    expect(getFieldSensitivity({ sensitivity: undefined })).toBe(
      "unclassified",
    );
  });

  it("should restrict every state except an explicit cleared", () => {
    expect(isFieldRestricted({})).toBe(true);
    expect(isFieldRestricted({ sensitivity: "unclassified" })).toBe(true);
    expect(isFieldRestricted({ sensitivity: "sensitive" })).toBe(true);
    expect(isFieldRestricted({ sensitivity: "cleared" })).toBe(false);
  });
});

describe("suggestSensitivityFromName", () => {
  it.each([
    ["email", "email addresses"],
    ["Email Address", "email addresses"],
    ["phone_number", "phone numbers"],
    ["first_name", "personal names"],
    ["Full Name", "personal names"],
    ["name", "personal names"],
    ["home_address", "physical addresses"],
    ["zip_code", "physical addresses"],
    ["ssn", "government identifiers"],
    ["date_of_birth", "dates of birth"],
    ["salary", "financial details"],
    ["password", "credentials or secrets"],
    ["api_key", "credentials or secrets"],
    ["gender", "demographic attributes"],
    ["ip_address", "IP addresses"],
  ])("should flag %s", (name, reasonFragment) => {
    const reasons = suggestSensitivityFromName(name);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join(" ")).toContain(reasonFragment);
  });

  it.each([
    "id",
    "amount",
    "status",
    "created_at",
    "username",
    "company_name",
    "hostname",
    "filename",
    "country",
    "order_total",
    "secretary",
  ])("should not flag %s", (name) => {
    expect(suggestSensitivityFromName(name)).toEqual([]);
  });

  it("should not double-fire the physical-address rule on email/IP addresses", () => {
    expect(suggestSensitivityFromName("email_address")).toEqual([
      "Column name suggests email addresses",
    ]);
    expect(suggestSensitivityFromName("ip_address")).toEqual([
      "Column name suggests IP addresses",
    ]);
  });
});

describe("suggestSensitivityFromAnalysis", () => {
  const baseString: StringAnalysis = {
    columnName: "col",
    cardinality: 100,
    uniqueness: 0.9,
    nullCount: 0,
    sampleValues: [],
    dataType: "string",
    semantic: "categorical",
  };

  it("should flag email-semantic columns", () => {
    const reasons = suggestSensitivityFromAnalysis({
      ...baseString,
      semantic: "email",
    });
    expect(reasons.join(" ")).toContain("email addresses");
  });

  it("should flag columns whose values look like phone numbers", () => {
    const reasons = suggestSensitivityFromAnalysis({
      ...baseString,
      sampleValues: [
        "+1 (555) 123-4567",
        "555-987-6543",
        "020 7946 0958",
        "+49 30 901820",
        "(212) 555-0142",
      ],
    });
    expect(reasons.join(" ")).toContain("phone numbers");
  });

  it("should not flag date-shaped strings as phone numbers", () => {
    const reasons = suggestSensitivityFromAnalysis({
      ...baseString,
      sampleValues: [
        "2023-01-15",
        "2022-12-31",
        "15.01.2023",
        "1/15/2023",
        "20230115",
      ],
    });
    expect(reasons).toEqual([]);
  });

  it("should not flag short numeric ID codes as phone numbers", () => {
    const reasons = suggestSensitivityFromAnalysis({
      ...baseString,
      sampleValues: ["12345", "98765", "54321"],
    });
    expect(reasons).toEqual([]);
  });

  it("should flag long free-text columns as a PII risk", () => {
    const reasons = suggestSensitivityFromAnalysis({
      ...baseString,
      semantic: "text",
      avgLength: 80,
      sampleValues: ["a long customer complaint about their experience"],
    });
    expect(reasons.join(" ")).toContain("Free-text");
  });

  it("should not flag short free-text columns", () => {
    const reasons = suggestSensitivityFromAnalysis({
      ...baseString,
      semantic: "text",
      avgLength: 10,
      sampleValues: ["abc", "def"],
    });
    expect(reasons).toEqual([]);
  });
});

describe("suggestSensitivityReasons", () => {
  it("should combine name and analysis signals without duplicates", () => {
    const analysis: StringAnalysis = {
      columnName: "field_x",
      cardinality: 50,
      uniqueness: 1,
      nullCount: 0,
      sampleValues: ["alice@example.com", "bob@example.com"],
      dataType: "string",
      semantic: "email",
    };
    const reasons = suggestSensitivityReasons({
      name: "customer_email",
      analysis,
    });
    expect(reasons).toContain("Column name suggests email addresses");
    expect(reasons).toContain("Values look like email addresses");
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it("should return no reasons for an innocuous column", () => {
    expect(suggestSensitivityReasons({ name: "order_total" })).toEqual([]);
  });
});

describe("buildSensitivityUpdate", () => {
  it("should record a confirmed classifier suggestion with its reasons", () => {
    expect(
      buildSensitivityUpdate("sensitive", ["reason a", "reason b"]),
    ).toEqual({
      sensitivity: "sensitive",
      sensitivityReason: "reason a; reason b",
      sensitivitySource: "classifier",
    });
  });

  it.each([
    ["sensitive", "Marked sensitive by you"],
    ["cleared", "Cleared by you"],
    ["unclassified", "Reset to unclassified by you"],
  ] as const)(
    "should record a manual %s marking as user-sourced",
    (s, reason) => {
      expect(buildSensitivityUpdate(s)).toEqual({
        sensitivity: s,
        sensitivityReason: reason,
        sensitivitySource: "user",
      });
    },
  );

  it("should ignore reasons when clearing — clearing is always a user decision", () => {
    expect(buildSensitivityUpdate("cleared", ["reason"])).toEqual({
      sensitivity: "cleared",
      sensitivityReason: "Cleared by you",
      sensitivitySource: "user",
    });
  });
});
