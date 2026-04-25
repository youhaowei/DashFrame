/**
 * Electron main-side IPC adapter. Registers handlers on `ipcMain` for the
 * three request channels and pushes subscription events back to the
 * renderer via the `dashframe:rpc:event` channel.
 *
 * Single subscription registry per main process. Subscriptions are keyed
 * by their server-assigned `subId` AND associated with the originating
 * `WebContents` — when a renderer reloads or a window closes the
 * registry tears down everything tied to that target. This is the
 * subscription-cleanup-on-renderer-reload guarantee called out in the AC.
 *
 * Phase 1 leaves out: per-frame backpressure, queue draining for offline
 * renderers, retry. The renderer is in-process and the IPC channel is
 * effectively reliable; deferring is fine until the WS adapter ships and
 * those concerns become real.
 */
import type { IpcMain, WebContents } from "electron";

import type {
  RpcError,
  RpcRequest,
  RpcResponse,
  RpcSubscribeRequest,
  RpcSubscriptionEvent,
} from "@dashframe/types";
// Imported types: `RpcRequest` for the type guard return; `RpcSubscribeRequest`
// for the narrowed subscribe arg; the rest are wire-frame shapes used in
// handler signatures.

import { toTransportError } from "../errors";
import type { Router, SubscriptionHandle } from "../router";
import { IPC_CHANNELS } from "./channels";

interface RegisteredSub {
  handle: SubscriptionHandle;
  webContents: WebContents;
}

export interface IpcMainTransportOptions {
  ipcMain: IpcMain;
  router: Router;
  /** Source tag forwarded into router context. Defaults to `"ipc"`. */
  source?: string;
}

export interface IpcMainTransport {
  /** Tear down: removes all `ipcMain` listeners and closes live subs. */
  dispose(): void;
}

export function registerIpcMainTransport(
  options: IpcMainTransportOptions,
): IpcMainTransport {
  const { ipcMain, router } = options;
  const source = options.source ?? "ipc";

  const subs = new Map<string, RegisteredSub>();
  let nextSubId = 0;

  function makeSubId(): string {
    return `ipc_${nextSubId++}`;
  }

  function clearSubsForContents(wc: WebContents): void {
    for (const [id, sub] of subs) {
      if (sub.webContents === wc) {
        sub.handle.complete();
        subs.delete(id);
      }
    }
  }

  function pushEvent(wc: WebContents, payload: RpcSubscriptionEvent): void {
    if (wc.isDestroyed()) return;
    wc.send(IPC_CHANNELS.event, payload);
  }

  // --- invoke ---
  const invokeHandler = async (
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown,
  ): Promise<RpcResponse> => {
    if (!isRpcRequest(raw)) {
      const fallbackId =
        typeof (raw as { id?: unknown })?.id === "string"
          ? (raw as { id: string }).id
          : "<unknown>";
      return malformed(fallbackId, "invalid invoke request");
    }
    const req = raw;
    try {
      const data = await router.dispatch(req.path, req.args, { source });
      return { id: req.id, ok: true, data };
    } catch (err) {
      return {
        id: req.id,
        ok: false,
        error: toTransportError(err),
      };
    }
  };
  ipcMain.handle(IPC_CHANNELS.invoke, invokeHandler);

  // --- subscribe ---
  const subscribeHandler = async (
    event: Electron.IpcMainInvokeEvent,
    raw: unknown,
  ): Promise<RpcResponse> => {
    if (!isRpcRequest(raw)) {
      const fallbackId =
        typeof (raw as { id?: unknown })?.id === "string"
          ? (raw as { id: string }).id
          : "<unknown>";
      return malformed(fallbackId, "invalid subscribe request");
    }
    const req: RpcSubscribeRequest = raw;
    const wc = event.sender;
    const subId = makeSubId();
    const handle = router.open(
      req.path,
      req.args,
      { source },
      {
        next: (data) => pushEvent(wc, { subId, kind: "next", data }),
        error: (error) => {
          subs.delete(subId);
          pushEvent(wc, { subId, kind: "error", error });
        },
        complete: () => {
          subs.delete(subId);
          pushEvent(wc, { subId, kind: "complete" });
        },
      },
      subId,
    );
    if (handle.closed) {
      // Setup synchronously failed — the failure was already pushed via
      // the error observer; respond with the assigned id so the renderer
      // can correlate any observer events that fired before the resolve.
      return { id: req.id, ok: true, data: { subId } };
    }
    subs.set(subId, { handle, webContents: wc });
    // Track per-WebContents teardown once. `destroyed` covers reloads
    // (the old WebContents is destroyed before the new one mounts) AND
    // window-close.
    wc.once("destroyed", () => clearSubsForContents(wc));
    return { id: req.id, ok: true, data: { subId } };
  };
  ipcMain.handle(IPC_CHANNELS.subscribe, subscribeHandler);

  // --- unsubscribe ---
  const unsubscribeHandler = (
    _event: Electron.IpcMainInvokeEvent,
    raw: unknown,
  ): RpcResponse => {
    const payload = raw as { id?: unknown; subId?: unknown } | null;
    if (typeof payload?.id !== "string" || typeof payload?.subId !== "string") {
      const fallbackId =
        typeof payload?.id === "string" ? payload.id : "<unknown>";
      return malformed(fallbackId, "invalid unsubscribe");
    }
    const sub = subs.get(payload.subId);
    if (sub) {
      subs.delete(payload.subId);
      sub.handle.complete();
    }
    return { id: payload.id, ok: true, data: null };
  };
  ipcMain.handle(IPC_CHANNELS.unsubscribe, unsubscribeHandler);

  return {
    dispose() {
      ipcMain.removeHandler(IPC_CHANNELS.invoke);
      ipcMain.removeHandler(IPC_CHANNELS.subscribe);
      ipcMain.removeHandler(IPC_CHANNELS.unsubscribe);
      for (const [, sub] of subs) sub.handle.complete();
      subs.clear();
    },
  };
}

function isRpcRequest(req: unknown): req is RpcRequest {
  if (typeof req !== "object" || req === null) return false;
  const r = req as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.path === "string";
}

function malformed(id: string, message: string): RpcResponse {
  const error: RpcError = { code: "transport", message };
  return { id, ok: false, error };
}
