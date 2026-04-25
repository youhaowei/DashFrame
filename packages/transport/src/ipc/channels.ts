/**
 * IPC channel names. Shared between main, preload, and renderer to keep
 * the wire surface in one place. Anything outside this file using a raw
 * channel string is a bug.
 *
 * Single namespaced surface — `dashframe:rpc:*` — replaces the legacy
 * one-off `dashframe:project:info` channel removed in TASK-548.
 */
export const IPC_CHANNELS = {
  /** Renderer → main: one-shot RPC call (request/response). */
  invoke: "dashframe:rpc:invoke",
  /** Renderer → main: open a subscription, returns the assigned id. */
  subscribe: "dashframe:rpc:subscribe",
  /** Renderer → main: close a subscription by id. */
  unsubscribe: "dashframe:rpc:unsubscribe",
  /** Main → renderer: subscription event push (next/error/complete). */
  event: "dashframe:rpc:event",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
