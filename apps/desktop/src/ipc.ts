import {
  ARTIFACTS_DB_FILENAME,
  attachTransportDispatcher,
  type ProjectHandle,
} from "@dashframe/server-core";
import type {
  ClientTransportMessage,
  TransportEndpoint,
  TransportMessage,
  TransportMessageHandler,
} from "@dashframe/transport";
import { BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";

function projectInfo(handle: ProjectHandle) {
  return {
    projectId: handle.meta.projectId,
    name: handle.meta.name,
    version: handle.meta.version,
    schemaVersion: handle.meta.schemaVersion,
    createdAt: handle.meta.createdAt.toISOString(),
    createdBy: handle.meta.createdBy,
  };
}

function createDesktopTransportEndpoint(): TransportEndpoint {
  const handlers = new Set<TransportMessageHandler>();

  ipcMain.handle(
    "dashframe:transport:send",
    (_event, message: ClientTransportMessage) => {
      for (const handler of handlers) {
        handler(message);
      }
    },
  );

  return {
    send(message: TransportMessage) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("dashframe:transport:message", message);
      }
    },
    onMessage(handler: TransportMessageHandler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close() {
      handlers.clear();
      ipcMain.removeHandler("dashframe:transport:send");
    },
  };
}

export function registerDesktopIpc(handle: ProjectHandle): void {
  ipcMain.handle("dashframe:project:info", () => projectInfo(handle));
  ipcMain.handle("dashframe:project:reveal", () => {
    shell.showItemInFolder(path.join(handle.dir, ARTIFACTS_DB_FILENAME));
  });

  attachTransportDispatcher(createDesktopTransportEndpoint(), {
    queries: {
      "project.info": () => ({
        data: projectInfo(handle),
        tablesRead: ["project"],
      }),
    },
    mutations: {
      "project.revealFolder": () => {
        shell.showItemInFolder(path.join(handle.dir, ARTIFACTS_DB_FILENAME));
        return {
          data: { ok: true },
          tablesWritten: [],
        };
      },
    },
  });
}
