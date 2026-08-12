import { describe, expect, it } from "vitest";

import {
  assertTrustedRendererUrl,
  isTrustedRendererUrl,
} from "./renderer-trust";

const productionFile = "/Applications/DashFrame/renderer/index.html";

describe("desktop renderer trust", () => {
  const developmentUrl = "https://localhost:5173".replace("https", "http");

  it("accepts routes on the configured development origin", () => {
    expect(
      isTrustedRendererUrl(`${developmentUrl}/insights/example`, {
        dev: true,
        devUrl: developmentUrl,
        productionFile,
      }),
    ).toBe(true);
  });

  it("rejects hostile and origin-confusion development URLs", () => {
    const options = {
      dev: true,
      devUrl: developmentUrl,
      productionFile,
    };
    expect(isTrustedRendererUrl("https://attacker.example", options)).toBe(
      false,
    );
    expect(
      isTrustedRendererUrl(`${developmentUrl}.attacker.example`, options),
    ).toBe(false);
    expect(isTrustedRendererUrl(undefined, options)).toBe(false);
  });

  it("accepts only the packaged renderer file in production", () => {
    const options = {
      dev: false,
      devUrl: developmentUrl,
      productionFile,
    };
    expect(
      isTrustedRendererUrl(
        "file:///Applications/DashFrame/renderer/index.html#/insights/example",
        options,
      ),
    ).toBe(true);
    expect(
      isTrustedRendererUrl(
        "file:///Applications/DashFrame/renderer/other.html",
        options,
      ),
    ).toBe(false);
  });

  it("fails closed for a missing sender frame", () => {
    expect(() =>
      assertTrustedRendererUrl(undefined, {
        dev: false,
        devUrl: developmentUrl,
        productionFile,
      }),
    ).toThrow("Untrusted desktop renderer");
  });
});
