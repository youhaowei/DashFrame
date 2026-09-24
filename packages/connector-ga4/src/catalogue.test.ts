import { describe, expect, it } from "vite-plus/test";
import { build } from "vite";

describe("GA4 catalogue export", () => {
  it("bundles for a browser without Arrow, Buffer, or Node-only imports", async () => {
    const result = await build({
      logLevel: "silent",
      build: {
        write: false,
        lib: {
          entry: new URL("./catalogue.ts", import.meta.url).pathname,
          formats: ["es"],
        },
      },
    });
    const outputs = "output" in result ? result.output : result[0]?.output;
    const output = (outputs ?? [])
      .filter((item) => item.type === "chunk")
      .map((item) => item.code)
      .join("\n");
    expect(output).toContain("daily-overview");
    expect(output).not.toContain("apache-arrow");
    expect(output).not.toContain("Buffer");
    expect(output).not.toMatch(/node:/u);
  });
});
