/**
 * Renderer-side `Transport` singleton. Built once at module load by
 * wrapping the preload bridge — `window.dashframe.transport`, populated
 * by `apps/desktop/src/preload.ts`.
 *
 * Renderer code uses this to call `project.info`, future query/mutation
 * paths, and (eventually) live subscriptions. Treat it as the only door
 * to the main process.
 */
import type { Transport } from "@dashframe/transport";
import { createIpcRendererTransport } from "@dashframe/transport/ipc/renderer";

const bridge = window.dashframe?.transport;
if (!bridge) {
  throw new Error(
    "[dashframe] preload bridge missing — window.dashframe.transport is undefined",
  );
}

export const transport: Transport = createIpcRendererTransport(bridge);
