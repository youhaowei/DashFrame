import { describe, expect, it } from "vite-plus/test";

import {
  createDevProxy,
  DEV_API_PROXY_KEY,
  DEV_DATA_PROXY_KEY,
} from "./dev-proxy";

const TARGET = "http://127.0.0.1:4000";

/**
 * Vite's own context matcher, transcribed from
 * `doesProxyContextMatchUrl` in its proxy middleware: a key starting with `^`
 * is a RegExp tested against `req.url` (query string included), and every key
 * is also tried as a literal prefix. Encoding the rule here — rather than
 * asserting the key strings — is what makes these tests fail against the old
 * plain `"/data"` key.
 */
function doesProxyContextMatchUrl(context: string, url: string): boolean {
  return (
    (context[0] === "^" && new RegExp(context).test(url)) ||
    url.startsWith(context)
  );
}

function matchProxyKey(url: string): string | undefined {
  const proxy = createDevProxy(TARGET);
  return Object.keys(proxy).find((key) => doesProxyContextMatchUrl(key, url));
}

describe("createDevProxy", () => {
  it("points every entry at the API target", () => {
    const proxy = createDevProxy(TARGET);
    expect(Object.values(proxy).every((e) => e.target === TARGET)).toBe(true);
    expect(proxy[DEV_API_PROXY_KEY]?.ws).toBe(true);
  });

  it.each([
    "/data/frames/frame-1/mosaic",
    "/data/frames/frame-1/tables/orders",
    "/data",
    "/data?limit=10",
    "/data/frames/frame-1/mosaic?format=json",
  ])("proxies the API data path %s", (url) => {
    expect(matchProxyKey(url)).toBe(DEV_DATA_PROXY_KEY);
  });

  it.each([
    "/data-sources",
    "/data-sources/local",
    "/data-frames",
    "/data-frames?tab=preview",
    "/dataframes",
  ])("leaves the SPA route %s to the app", (url) => {
    expect(matchProxyKey(url)).toBeUndefined();
  });

  it.each(["/api/ws", "/api/projects", "/api/ws?token=abc"])(
    "proxies %s to the API",
    (url) => {
      expect(matchProxyKey(url)).toBe(DEV_API_PROXY_KEY);
    },
  );

  it("leaves app routes alone", () => {
    for (const url of ["/", "/dashboards", "/insights", "/visualizations"]) {
      expect(matchProxyKey(url)).toBeUndefined();
    }
  });
});
