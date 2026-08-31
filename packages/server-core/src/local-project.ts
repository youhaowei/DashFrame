import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveProjectDir,
  type ResolveProjectDirOptions,
} from "./project-dir";

/** Host directory identity. Artifact metadata lives exclusively in Convex. */
export interface LocalProjectHandle {
  dir: string;
  dataSourcesDir: string;
  workspaceId: string;
  name: string;
  close(): Promise<void>;
}

export async function openLocalProject(
  options: ResolveProjectDirOptions & { name?: string } = {},
): Promise<LocalProjectHandle> {
  const dir = resolveProjectDir(options);
  const stateDir = path.join(dir, ".convex");
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const identityFile = path.join(stateDir, "project-id");
  let workspaceId: string;
  try {
    workspaceId = (await fs.readFile(identityFile, "utf8")).trim();
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    const temporary = path.join(stateDir, `.project-id.${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${randomUUID()}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(temporary, identityFile);
      if (process.platform !== "win32") {
        const directory = await fs.open(stateDir, "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
    } finally {
      await fs.rm(temporary, { force: true });
    }
    workspaceId = (await fs.readFile(identityFile, "utf8")).trim();
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      workspaceId,
    )
  ) {
    throw new Error("Invalid local project identity; refusing to replace it");
  }
  const dataSourcesDir = path.join(dir, "data", "sources");
  await fs.mkdir(dataSourcesDir, { recursive: true, mode: 0o700 });
  return {
    dir,
    dataSourcesDir,
    workspaceId,
    name: options.name ?? path.basename(dir),
    close: async () => {},
  };
}
