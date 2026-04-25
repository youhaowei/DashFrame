/**
 * Integration test for the Electron IPC adapter. We don't spin up Electron
 * here — that's expensive and brittle in CI. Instead we wire a fake
 * `ipcMain` + `ipcRenderer` pair that mirrors Electron's invoke/event
 * semantics: `ipcRenderer.invoke(ch, payload)` calls the handler registered
 * on `ipcMain` and resolves with its return; `webContents.send(ch, payload)`
 * delivers an event to listeners on `ipcRenderer.on(ch, ...)`.
 *
 * This proves the full path:
 *   renderer Transport → preload bridge → ipcMain → Router → handler
 *   handler → SubscriptionHandle → webContents.send → ipcRenderer event →
 *     renderer observer
 *
 * Renderer-reload teardown (subscription cleanup on `destroyed`) is covered
 * by emitting the `destroyed` event on the fake WebContents.
 */
import { EventEmitter } from "node:events";

import { describe, expect, test } from "bun:test";

import type {
  IpcMain,
  IpcMainInvokeEvent,
  IpcRenderer,
  WebContents,
} from "electron";

import { Router } from "../router";
import { registerIpcMainTransport } from "./main";
import { createPreloadBridge } from "./preload";
import { createIpcRendererTransport } from "./renderer";

interface Wired {
  ipcMain: IpcMain;
  ipcRenderer: IpcRenderer;
  webContents: FakeWebContents;
  /** Trigger a renderer reload (destroys WebContents). */
  reload: () => void;
}

class FakeWebContents extends EventEmitter {
  destroyed = false;
  // The preload bridge listens for `dashframe:rpc:event`; we pump pushes
  // into the fake ipcRenderer.
  constructor(private readonly rendererBus: EventEmitter) {
    super();
  }
  send(channel: string, payload: unknown): void {
    if (this.destroyed) return;
    this.rendererBus.emit(channel, /* event */ {}, payload);
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("destroyed");
  }
}

function wire(): Wired {
  type Handler = (
    event: IpcMainInvokeEvent,
    ...args: unknown[]
  ) => unknown | Promise<unknown>;
  const handlers = new Map<string, Handler>();
  const rendererBus = new EventEmitter();

  const wc = new FakeWebContents(rendererBus);

  const ipcMain = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel: string) {
      handlers.delete(channel);
    },
  } as unknown as IpcMain;

  const ipcRenderer = {
    async invoke(channel: string, ...args: unknown[]) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`no handler: ${channel}`);
      // Synthesize an event with our fake sender.
      const event = {
        sender: wc as unknown as WebContents,
      } as IpcMainInvokeEvent;
      return handler(event, ...args);
    },
    on(channel: string, listener: (...args: unknown[]) => void) {
      rendererBus.on(channel, listener);
    },
    removeListener(channel: string, listener: (...args: unknown[]) => void) {
      rendererBus.removeListener(channel, listener);
    },
  } as unknown as IpcRenderer;

  return {
    ipcMain,
    ipcRenderer,
    webContents: wc,
    reload: () => wc.destroy(),
  };
}

describe("Electron IPC transport", () => {
  test("should invoke a query through the full bridge", async () => {
    const router = new Router();
    router.invoke("project.info", () => ({ name: "test-project" }));

    const { ipcMain, ipcRenderer } = wire();
    registerIpcMainTransport({ ipcMain, router });
    const transport = createIpcRendererTransport(
      createPreloadBridge(ipcRenderer),
    );

    const result = await transport.invoke("project.info");
    expect(result).toEqual({ name: "test-project" });
  });

  test("should surface handler errors as TransportError", async () => {
    const router = new Router();
    router.invoke("fail", () => {
      throw new Error("oh no");
    });

    const { ipcMain, ipcRenderer } = wire();
    registerIpcMainTransport({ ipcMain, router });
    const transport = createIpcRendererTransport(
      createPreloadBridge(ipcRenderer),
    );

    await expect(transport.invoke("fail")).rejects.toMatchObject({
      name: "TransportError",
      code: "internal",
      message: "oh no",
    });
  });

  test("should deliver subscription events end-to-end", async () => {
    const router = new Router();
    const ctl: {
      pushNext?: (v: unknown) => void;
      pushComplete?: () => void;
    } = {};
    router.subscription("counter", (_args, handle) => {
      ctl.pushNext = (v) => handle.next(v);
      ctl.pushComplete = () => handle.complete();
    });

    const { ipcMain, ipcRenderer } = wire();
    registerIpcMainTransport({ ipcMain, router });
    const transport = createIpcRendererTransport(
      createPreloadBridge(ipcRenderer),
    );

    const seen: unknown[] = [];
    let completed = false;
    transport.subscribe("counter", undefined, {
      next: (v) => seen.push(v),
      error: () => {},
      complete: () => {
        completed = true;
      },
    });

    // Wait for subscribe round-trip to land.
    await new Promise((r) => setTimeout(r, 0));

    ctl.pushNext?.(1);
    ctl.pushNext?.(2);
    ctl.pushComplete?.();

    expect(seen).toEqual([1, 2]);
    expect(completed).toBe(true);
  });

  test("should tear down subscriptions when WebContents is destroyed", async () => {
    const router = new Router();
    let tornDown = false;
    router.subscription("hot", (_args, _handle) => {
      return () => {
        tornDown = true;
      };
    });

    const { ipcMain, ipcRenderer, reload } = wire();
    registerIpcMainTransport({ ipcMain, router });
    const transport = createIpcRendererTransport(
      createPreloadBridge(ipcRenderer),
    );

    let completedFromHost = false;
    transport.subscribe("hot", undefined, {
      next: () => {},
      error: () => {},
      complete: () => {
        completedFromHost = true;
      },
    });
    await new Promise((r) => setTimeout(r, 0));

    reload();
    // Teardown ran on main side (host complete pushed but renderer is gone).
    expect(tornDown).toBe(true);
    // The renderer observer never sees `complete` because the WebContents
    // is destroyed before the event is sent — that's the actual behavior
    // we want under reload.
    expect(completedFromHost).toBe(false);
  });

  test("should support caller-driven unsubscribe", async () => {
    const router = new Router();
    let tornDown = false;
    router.subscription("hot", (_args, _handle) => {
      return () => {
        tornDown = true;
      };
    });

    const { ipcMain, ipcRenderer } = wire();
    registerIpcMainTransport({ ipcMain, router });
    const transport = createIpcRendererTransport(
      createPreloadBridge(ipcRenderer),
    );

    const sub = transport.subscribe("hot", undefined, {
      next: () => {},
      error: () => {},
      complete: () => {},
    });
    await new Promise((r) => setTimeout(r, 0));
    sub.close();
    // Allow unsubscribe round-trip.
    await new Promise((r) => setTimeout(r, 0));
    expect(tornDown).toBe(true);
  });
});
