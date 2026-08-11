import { describe, expect, it } from "vitest";
import {
  MAX_LOCAL_ARROW_BYTES,
  localArrowSizeIsAllowed,
} from "./local-file-limits";

describe("local Arrow ingestion limit", () => {
  it("accepts the exact shared boundary and rejects empty or oversized data", () => {
    expect(localArrowSizeIsAllowed(MAX_LOCAL_ARROW_BYTES)).toBe(true);
    expect(localArrowSizeIsAllowed(MAX_LOCAL_ARROW_BYTES + 1)).toBe(false);
    expect(localArrowSizeIsAllowed(0)).toBe(false);
  });
});
