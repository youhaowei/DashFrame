import {
  createBrowserHistory,
  createHashHistory,
} from "@tanstack/react-router";

/** Keep packaged navigation on the exact document allowed by the IPC trust gate. */
export function createRendererHistory(target: Window = window) {
  return target.location.protocol === "file:"
    ? createHashHistory({ window: target })
    : createBrowserHistory({ window: target });
}
