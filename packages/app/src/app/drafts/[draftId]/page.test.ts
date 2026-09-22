import { describe, expect, it } from "vite-plus/test";
import { draftReportId } from "./page";

describe("draftReportId", () => {
  it("names the report when a draft edits exactly one", () => {
    expect(
      draftReportId([
        { kind: "dashboard", nodeId: "report-a" },
        { kind: "visualization", nodeId: "viz-1" },
      ]),
    ).toBe("report-a");
  });

  it("names no report when a draft edits none or several", () => {
    expect(draftReportId([{ kind: "insight", nodeId: "q-1" }])).toBeUndefined();
    expect(
      draftReportId([
        { kind: "dashboard", nodeId: "report-a" },
        { kind: "dashboard", nodeId: "report-b" },
      ]),
    ).toBeUndefined();
  });
});
