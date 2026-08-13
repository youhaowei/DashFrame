import { describe, expect, it } from "vitest";

import { createElectronEnvironment, parseViteUrl } from "./dev-helpers";

describe("desktop development launcher", () => {
  it("parses a colorized Vite URL", () => {
    expect(
      parseViteUrl(
        "\u001b[32mâžœ\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m",
      ),
    ).toBe("http://localhost:5173");
  });

  it("launches Electron outside inherited Node-only mode", () => {
    expect(
      createElectronEnvironment(
        { ELECTRON_RUN_AS_NODE: "1", EXISTING_VALUE: "preserved" },
        "http://localhost:5174",
      ),
    ).toEqual({
      DEV_URL: "http://localhost:5174",
      EXISTING_VALUE: "preserved",
    });
  });
});
