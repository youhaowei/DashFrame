import { createHash } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { FileDataFrameStorage } from "@dashframe/engine-server/file-dataframe-storage";
import { ApiAccessCredentials } from "@dashframe/server-core";
import {
  WorkspaceQueryEngines,
  type QuerySandboxConfiguration,
  type WorkspaceQueryEngine,
} from "@dashframe/engine-server/query-sandbox";
import { createHostedConnectorSessionDocument } from "../connector-setup/hosted-session-store";
import type { SecretKeyringConfig } from "../secret-file-backend";
import { createWorkspaceSecrets } from "./workspace-secrets";

type Engine = Pick<
  WorkspaceQueryEngine,
  "initialize" | "queryArrow" | "registerArrowTable" | "unregisterTable"
>;
interface Broker {
  forWorkspace(workspaceId: string): Engine;
  dispose(): Promise<void>;
}

/** Admission, pool coalescing and exclusive whole-volume ownership are caller preconditions. */
export async function createHostedWorkspaceResourceFactory(
  options: {
    dataRoot: string;
    keyring: SecretKeyringConfig;
    sandbox: QuerySandboxConfiguration;
  },
  createBroker: (configuration: QuerySandboxConfiguration) => Broker = (
    configuration,
  ) => new WorkspaceQueryEngines(configuration, 1),
) {
  if (
    !Number.isSafeInteger(options.sandbox.uid) ||
    options.sandbox.uid < 1 ||
    !Number.isSafeInteger(options.sandbox.gid) ||
    options.sandbox.gid < 1
  )
    throw new Error("Hosted sandbox requires an explicit non-root identity");
  await mkdir(options.dataRoot, { recursive: true, mode: 0o700 });
  const root = await realpath(options.dataRoot);
  const secrets = await createWorkspaceSecrets(
    path.join(root, "secrets"),
    options.keyring,
  );
  const workspaces = await privateDirectory(path.join(root, "workspaces"));
  const stores = new Map<string, Promise<ApiAccessCredentials>>();
  const workspaceDirectory = (workspaceId: string) => {
    if (
      !workspaceId ||
      workspaceId.length > 256 ||
      workspaceId.trim() !== workspaceId ||
      /[\s\p{Cc}]/u.test(workspaceId)
    )
      throw new Error("Invalid admitted workspace identity");
    const name = createHash("sha256")
      .update("dashframe-workspace-resources\0")
      .update(workspaceId)
      .digest("hex");
    return path.join(workspaces, name);
  };
  const credentials = (workspaceId: string) => {
    const directory = workspaceDirectory(workspaceId);
    let store = stores.get(workspaceId);
    if (!store) {
      store = secrets
        .forWorkspace(workspaceId)
        .then(
          (vault) =>
            new ApiAccessCredentials(vault, path.join(directory, "access")),
        );
      stores.set(workspaceId, store);
      store.catch(() => {
        if (stores.get(workspaceId) === store) stores.delete(workspaceId);
      });
    }
    return store;
  };
  const open = async (workspaceId: string) => {
    const directory = await privateDirectory(workspaceDirectory(workspaceId));
    const broker = createBroker(options.sandbox);
    let closed = false;
    const getEngine = async () => {
      if (closed) throw new Error("Hosted workspace is closed");
      const engine = broker.forWorkspace(workspaceId);
      await engine.initialize();
      if (closed) throw new Error("Hosted workspace is closed");
      return engine;
    };
    try {
      const vault = await secrets.forWorkspace(workspaceId);
      const frames = await privateDirectory(path.join(directory, "frames"));
      const connectorSessionDocument = createHostedConnectorSessionDocument(
        directory,
        workspaceId,
        options.keyring,
      );
      await getEngine();
      return {
        resources: {
          directory,
          vault,
          accessCredentials: await credentials(workspaceId),
          dataFrameStorage: new FileDataFrameStorage(frames),
          connectorSessionDocument,
          getEngine,
        },
        async close() {
          closed = true;
          await broker.dispose();
        },
      };
    } catch (error) {
      closed = true;
      await broker.dispose();
      throw error;
    }
  };
  return Object.assign(open, {
    /** Verify only existing workspace stores; never allocate a query worker. */
    async authenticateCredential(workspaceId: string, token: string) {
      const directory = workspaceDirectory(workspaceId);
      try {
        if (!(await lstat(directory)).isDirectory()) return null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
      return (await credentials(workspaceId)).authenticate(token);
    },
  });
}

async function privateDirectory(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory())
    throw new Error("Hosted workspace directory must not be a symlink");
  return realpath(directory);
}
