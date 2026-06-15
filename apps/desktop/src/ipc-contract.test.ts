/**
 * IPC-contract regression test.
 *
 * The renderer reaches the main process only through named IPC channels: every
 * `ipcRenderer.invoke("X")` in preload.ts must have a matching
 * `ipcMain.handle("X")` in main.ts. A channel renamed on one side but not the
 * other compiles cleanly (the strings are opaque to the type system) and fails
 * silently at runtime — the renderer's `invoke` hangs / returns undefined.
 *
 * This test reads the two source files and asserts the channel sets are equal,
 * so breaking the wiring on either side fails the test. It deliberately parses
 * source rather than importing the modules: both pull in Electron at import
 * time, and the contract we care about is the literal channel strings, not
 * runtime behaviour.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcDir = path.dirname(fileURLToPath(import.meta.url));

function read(file: string): string {
  return readFileSync(path.join(srcDir, file), "utf8");
}

/** All string literals passed to `ipcMain.handle(...)` in the given source. */
function handledChannels(source: string): Set<string> {
  return matchChannels(source, /ipcMain\.handle\(\s*["']([^"']+)["']/g);
}

/** All string literals passed to `ipcRenderer.invoke(...)` in the given source. */
function invokedChannels(source: string): Set<string> {
  return matchChannels(source, /ipcRenderer\.invoke\(\s*["']([^"']+)["']/g);
}

function matchChannels(source: string, pattern: RegExp): Set<string> {
  const channels = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    if (match[1]) channels.add(match[1]);
  }
  return channels;
}

describe("IPC channel contract: preload ↔ main", () => {
  const mainSource = read("main.ts");
  const preloadSource = read("preload.ts");

  it("every channel the preload invokes is handled in main (no orphan invoke)", () => {
    const handled = handledChannels(mainSource);
    const invoked = invokedChannels(preloadSource);

    expect(invoked.size).toBeGreaterThan(0);
    for (const channel of invoked) {
      expect(
        handled,
        `preload invokes "${channel}" with no handler in main`,
      ).toContain(channel);
    }
  });

  it("every channel main handles is invoked by the preload (no dead handler)", () => {
    const handled = handledChannels(mainSource);
    const invoked = invokedChannels(preloadSource);

    expect(handled.size).toBeGreaterThan(0);
    for (const channel of handled) {
      expect(
        invoked,
        `main handles "${channel}" but no preload caller invokes it`,
      ).toContain(channel);
    }
  });

  it("the contract is exactly the three documented desktop channels", () => {
    // Pin the surface so an accidental new channel (or a dropped one) is a
    // visible, reviewed change rather than a silent drift.
    const handled = handledChannels(mainSource);
    expect([...handled].sort()).toEqual([
      "dashframe:project:info",
      "dashframe:project:reveal",
      "dashframe:server:info",
    ]);
  });
});
