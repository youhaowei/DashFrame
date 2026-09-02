import { expect, it } from "vite-plus/test";
import { createRendererHistory } from "./renderer-history";
import { isTrustedRendererUrl } from "../../desktop/src/renderer-trust";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { tmpdir } from "node:os";

function browserWindow(href: string): Window {
  let location = new URL(href);
  let state: unknown = null;
  const events = new EventTarget();
  const update = (next: unknown, _title: string, url?: string) => {
    state = next;
    if (url !== undefined) location = new URL(url, location);
  };
  return {
    get location() {
      return location;
    },
    history: {
      get state() {
        return state;
      },
      length: 1,
      pushState: update,
      replaceState: update,
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  } as unknown as Window;
}

it("preserves the trusted packaged document while routing and reloading", () => {
  const productionFile = path.join(
    tmpdir(),
    "Dash Frame",
    "renderer",
    "dist",
    "index.html",
  );
  const target = browserWindow(pathToFileURL(productionFile).href);
  const history = createRendererHistory(target);
  const trust = { dev: false, devUrl: "http://localhost:5173", productionFile };
  history.replace("/");
  history.flush();
  history.push("/insights");
  history.flush();
  expect(target.location.hash).toBe("#/insights");
  expect(isTrustedRendererUrl(target.location.href, trust)).toBe(true);
  history.destroy();
  const reloaded = createRendererHistory(target);
  expect(reloaded.location.pathname).toBe("/insights");
  expect(isTrustedRendererUrl(target.location.href, trust)).toBe(true);
  reloaded.destroy();
});

it("keeps ordinary path navigation for the HTTP development renderer", () => {
  const target = browserWindow("http://localhost:5173/");
  const history = createRendererHistory(target);
  history.push("/insights");
  history.flush();
  expect(target.location.pathname).toBe("/insights");
  expect(target.location.hash).toBe("");
  history.destroy();
});
