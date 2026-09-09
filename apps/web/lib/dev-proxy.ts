/**
 * Dev-server proxy map for the web app.
 *
 * Vite treats a proxy key as a *prefix* unless it starts with `^`, in which
 * case the key is a regular expression matched against `req.url`. A plain
 * `"/data"` key therefore also captures the SPA routes `/data-sources` and
 * `/data-frames`, which the API answers with a bare `404 Not Found` — so a
 * direct load or reload of those URLs never reaches the app. The regex key
 * below matches only the real API surface.
 *
 * `req.url` carries the query string, and the API router is mounted at `/data`
 * itself, so `?` has to be part of the boundary alternation: without it,
 * `/data?…` would stop being proxied.
 */
export const DEV_API_PROXY_KEY = "/api";
export const DEV_DATA_PROXY_KEY = "^/data(/|\\?|$)";

export interface DevProxyEntry {
  target: string;
  changeOrigin: boolean;
  ws?: boolean;
}

export function createDevProxy(target: string): Record<string, DevProxyEntry> {
  return {
    [DEV_API_PROXY_KEY]: {
      target,
      changeOrigin: true,
      ws: true,
    },
    [DEV_DATA_PROXY_KEY]: {
      target,
      changeOrigin: true,
    },
  };
}
