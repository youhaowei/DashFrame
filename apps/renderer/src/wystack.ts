/**
 * WyStack client setup for the DashFrame renderer (YW-69 / T7).
 *
 * Wires the Electron IPC transport into a custom WyStackClient-compatible
 * object. The standard `createClient` from `@wystack/client` uses HTTP + WS,
 * which is wrong for Electron — queries must go over IPC, not HTTP.
 *
 * Design:
 *   - Queries/mutations are sent as `call` frames over the IPC pipe and
 *     resolved via a per-call correlator (id → {resolve, reject}).
 *   - The `ws` field is a no-op WsManager: non-reactive slice only — live
 *     invalidation is gated off until YW-62.
 *   - Query refs are manually typed so `useQuery` gets the correct arg/return
 *     types without needing to pull `@wystack/server` into the renderer bundle.
 *
 * NOTE: The call→result correlator over IPC is hand-rolled here because
 * `@wystack/client` has no built-in IPC call transport — the client engine
 * only owns the reactive (subscribe/invalidate) tier. A proper IPC call
 * transport should land in `@wystack/client` as follow-up work.
 */
import type { ProjectInfo } from "@dashframe/desktop-types";
import type { MutationRef, QueryRef, WyStackClient } from "@wystack/client";
import { WyStackProvider, useQuery as useWyQuery } from "@wystack/client";
import { createElectronPipe } from "@wystack/client/electron";

// Re-export for consumers that only need the provider/hook
export { WyStackProvider, useWyQuery as useQuery };

// ---------------------------------------------------------------------------
// Typed query refs — manually branded for the `projectInfo` query.
// Using the QueryRef phantom type so useQuery gets proper TReturn inference.
// ---------------------------------------------------------------------------

// Unique brand symbol for this module's refs (not exported — internal only)
declare const QueryBrand: unique symbol;
/** A typed reference to a WyStack query in the DashFrame function registry. */
type TypedQueryRef<TArgs, TReturn> = {
  readonly _path: string;
  readonly [QueryBrand]: { args: TArgs; return: TReturn };
};

function queryRef<TArgs, TReturn>(path: string): TypedQueryRef<TArgs, TReturn> {
  return { _path: path } as TypedQueryRef<TArgs, TReturn>;
}

// DashFrame function registry refs
export const api = {
  /** Fetches project info from the WyStack server over IPC. */
  projectInfo: queryRef<Record<string, never>, ProjectInfo>("projectInfo"),
} as const;

// ---------------------------------------------------------------------------
// IPC call/result correlator
// ---------------------------------------------------------------------------

let callSeq = 0;
function nextCallId(): string {
  return `call_${++callSeq}`;
}

type PendingCall = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
};

const pending = new Map<string, PendingCall>();

// ---------------------------------------------------------------------------
// Build the IPC pipe and attach the result dispatcher
// ---------------------------------------------------------------------------

const pipe = createElectronPipe({ ipcRenderer: window.wysIpc });

// Listen for result/error frames and dispatch to waiting correlators.
// The server sends `{ type: 'result', id, data }` for success,
// `{ type: 'error', id, error }` for failure.
pipe.onMessage((msg) => {
  if (msg.type === "result") {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      p.resolve(msg.data);
    }
  } else if (msg.type === "error" && msg.id) {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      p.reject(new Error(msg.error));
    }
  }
  // authenticated / subscribed / invalidate frames are no-ops in this slice.
});

// ---------------------------------------------------------------------------
// Call helper — sends a `call` frame and awaits the `result` response
// ---------------------------------------------------------------------------

function ipcCall(
  funcPath: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextCallId();
    pending.set(id, { resolve, reject });
    pipe.send({ type: "call", id, path: funcPath, args });
  });
}

// ---------------------------------------------------------------------------
// No-op WsManager — non-reactive; subscribe/unsubscribe are stubs until YW-62
// ---------------------------------------------------------------------------

const noopWs: WyStackClient["ws"] = {
  connect() {},
  disconnect() {},
  subscribe() {},
  unsubscribe() {},
  isConnected: () => false,
};

// ---------------------------------------------------------------------------
// Custom WyStackClient over IPC (satisfies the WyStackClient interface).
// query/mutate use `as unknown as` cast because `ipcCall` returns
// `Promise<unknown>` — the runtime value IS the correct type but TypeScript
// can't prove it. The cast is safe: the server handler returns `ProjectInfo`.
// ---------------------------------------------------------------------------

export const ipcClient: WyStackClient = {
  url: "ipc://electron",
  prefix: "",
  ws: noopWs,
  query: ((ref: QueryRef, args?: unknown) =>
    ipcCall(
      ref._path,
      (args ?? {}) as Record<string, unknown>,
    )) as WyStackClient["query"],
  mutate: ((ref: MutationRef, args?: unknown) =>
    ipcCall(
      ref._path,
      (args ?? {}) as Record<string, unknown>,
    )) as WyStackClient["mutate"],
};

// ---------------------------------------------------------------------------
// useProjectInfo — convenience hook for the projectInfo WyStack query
// ---------------------------------------------------------------------------

export function useProjectInfo() {
  return useWyQuery(
    // TypedQueryRef is structurally compatible with QueryRef from @wystack/client
    api.projectInfo as unknown as QueryRef<Record<string, never>, ProjectInfo>,
  );
}
