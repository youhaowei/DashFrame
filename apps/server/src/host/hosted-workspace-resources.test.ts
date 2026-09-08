import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { CREDENTIAL_CLASS } from "@dashframe/server-core";
import type { UUID } from "@dashframe/types";
import { loadSecretKeyring } from "../secret-file-backend";
import { createHostedWorkspaceResourceFactory } from "./hosted-workspace-resources";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function options() {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "hosted-resources-"));
  directories.push(dataRoot);
  const keyring = await loadSecretKeyring({
    DASHFRAME_SECRET_KEY: randomBytes(32).toString("base64"),
  });
  if (!keyring) throw new Error("Missing synthetic keyring");
  return {
    dataRoot,
    keyring,
    sandbox: {
      launcher: "/unused/launcher",
      runtime: "/unused/node",
      worker: "/unused/worker",
      readPaths: [],
      uid: 65534,
      gid: 65534,
      addressSpaceBytes: 1024,
      cpuSeconds: 1,
      uidTaskLimit: 32,
    },
  };
}

// The broker is synthetic; disk storage and encrypted vaults are real.
function engine() {
  return {
    initialize: vi.fn(async () => {}),
    queryArrow: vi.fn(async () => new Uint8Array()),
    registerArrowTable: vi.fn(async () => {}),
    unregisterTable: vi.fn(async () => {}),
  };
}

it("keeps frame bytes and vault references workspace scoped across reopening", async () => {
  const configuration = await options();
  const broker = () => ({
    forWorkspace: () => engine(),
    dispose: async () => {},
  });
  const open = await createHostedWorkspaceResourceFactory(
    configuration,
    broker,
  );
  const a = await open("workspace-a");
  const b = await open("workspace-b");
  const id = randomUUID() as UUID;
  const bytes = new Uint8Array([1, 2, 3]);
  await a.resources.dataFrameStorage.save(id, bytes);
  const ref = await a.resources.vault.store("synthetic-secret", {
    class: CREDENTIAL_CLASS.ConnectorKey,
  });
  expect(await b.resources.dataFrameStorage.load(id)).toBeNull();
  expect(await b.resources.vault.has(ref)).toBe(false);
  await b.resources.vault.delete(ref);
  await Promise.all([a.close(), b.close()]);
  const reopen = await createHostedWorkspaceResourceFactory(
    configuration,
    broker,
  );
  const restored = await reopen("workspace-a");
  expect(await restored.resources.dataFrameStorage.load(id)).toEqual(bytes);
  expect(
    await restored.resources.vault.withSecret(ref, async (value) => value),
  ).toBe("synthetic-secret");
  await restored.close();
});

it("asks the broker for a current engine and rejects acquisition after close", async () => {
  const first = engine();
  const replacement = engine();
  let current = first;
  const dispose = vi.fn(async () => {});
  const open = await createHostedWorkspaceResourceFactory(
    await options(),
    () => ({
      forWorkspace: () => current,
      dispose,
    }),
  );
  const workspace = await open("workspace");
  current = replacement;
  expect(await workspace.resources.getEngine()).toBe(replacement);
  expect(replacement.initialize).toHaveBeenCalledOnce();
  await workspace.close();
  await expect(workspace.resources.getEngine()).rejects.toThrow("closed");
  expect(dispose).toHaveBeenCalledOnce();
});

it("waits for broker disposal before reporting failed startup", async () => {
  const failed = engine();
  failed.initialize.mockRejectedValue(new Error("startup failed"));
  let finishDisposal!: () => void;
  const disposal = new Promise<void>((resolve) => {
    finishDisposal = resolve;
  });
  const dispose = vi.fn(() => disposal);
  const open = await createHostedWorkspaceResourceFactory(
    await options(),
    () => ({ forWorkspace: () => failed, dispose }),
  );
  let settled = false;
  const opening = open("workspace").finally(() => {
    settled = true;
  });
  const rejection = expect(opening).rejects.toThrow("startup failed");
  await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
  expect(settled).toBe(false);
  finishDisposal();
  await rejection;
});
