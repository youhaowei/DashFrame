import { describe, expect, it } from "vite-plus/test";

import { supportsDefinitions } from "./base";

describe("definition connector capability", () => {
  it("requires all three definition operations", () => {
    const base = { sourceType: "remote-api" };
    expect(supportsDefinitions(base as never)).toBe(false);
    expect(
      supportsDefinitions({
        ...base,
        queryDefinition: () => undefined,
        listFields: () => undefined,
        checkDefinition: () => undefined,
      } as never),
    ).toBe(true);
  });
});
