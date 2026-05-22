import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { DashFrameApi, ProjectInfo } from "@dashframe/desktop-types";
import type {
  ClientTransportMessage,
  ServerTransportMessage,
} from "@dashframe/transport";

/**
 * IPC surface exposed to the renderer. Keep the shape narrow and serializable:
 * the main process owns filesystem access and the artifact DB. The renderer
 * asks for actions via named channels instead of receiving raw project paths.
 */
const api: DashFrameApi = {
  project: {
    getInfo: (): Promise<ProjectInfo> =>
      ipcRenderer.invoke("dashframe:project:info"),
    revealFolder: (): Promise<void> =>
      ipcRenderer.invoke("dashframe:project:reveal"),
  },
  transport: {
    send: (message: ClientTransportMessage): Promise<void> =>
      ipcRenderer.invoke("dashframe:transport:send", message),
    onMessage: (
      handler: (message: ServerTransportMessage) => void,
    ): (() => void) => {
      const listener = (_event: IpcRendererEvent, message: unknown) => {
        handler(message as ServerTransportMessage);
      };
      ipcRenderer.on("dashframe:transport:message", listener);
      return () => {
        ipcRenderer.removeListener("dashframe:transport:message", listener);
      };
    },
  },
} as const;

contextBridge.exposeInMainWorld("dashframe", api);
