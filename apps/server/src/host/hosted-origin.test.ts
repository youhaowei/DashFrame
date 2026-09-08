import { expect, it } from "vite-plus/test";
import { isHostedOriginAllowed } from "./hosted-origin";

it("allows ordinary same-origin reads without weakening write origin checks", () => {
  const origin = "https://dashframe.example.test";
  for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE"]) {
    const request = (source?: string) =>
      new Request(`${origin}/data/frame`, {
        method,
        headers: source === undefined ? {} : { origin: source },
      });
    expect(isHostedOriginAllowed(request(), origin)).toBe(
      method === "GET" || method === "HEAD",
    );
    expect(isHostedOriginAllowed(request(origin), origin)).toBe(true);
    expect(
      isHostedOriginAllowed(request("https://foreign.example.test"), origin),
    ).toBe(false);
    expect(isHostedOriginAllowed(request("null"), origin)).toBe(false);
  }
});
