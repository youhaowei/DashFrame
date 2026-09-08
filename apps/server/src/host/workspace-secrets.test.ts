import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { CREDENTIAL_CLASS } from "@dashframe/server-core";
import { createWorkspaceSecrets } from "./workspace-secrets";
import { HostedWorkspacePool } from "./hosted-workspace-pool";
import { loadSecretKeyring } from "../secret-file-backend";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) => rm(dir, { recursive: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "dashframe-workspace-vault-"),
  );
  directories.push(directory);
  const keyring = await loadSecretKeyring({
    DASHFRAME_SECRET_KEY: randomBytes(32).toString("base64"),
  });
  if (!keyring) throw new Error("Synthetic keyring unavailable");
  return {
    directory,
    keyring,
    factory: await createWorkspaceSecrets(directory, keyring),
  };
}

it("cannot read or clean up another workspace's reference, including after restart", async () => {
  const { directory, keyring, factory } = await fixture();
  const [a, b] = await Promise.all([
    factory.forWorkspace("a"),
    factory.forWorkspace("b"),
  ]);
  const ref = await b.store("synthetic-workspace-b-secret", {
    class: CREDENTIAL_CLASS.ConnectorKey,
  });
  expect(await a.has(ref)).toBe(false);
  await expect(a.withSecret(ref, async () => undefined)).rejects.toThrow();
  await a.delete(ref);
  expect(await b.withSecret(ref, async (value) => value)).toBe(
    "synthetic-workspace-b-secret",
  );
  const restarted = await createWorkspaceSecrets(directory, keyring);
  const reopenedA = await restarted.forWorkspace("a");
  const reopenedB = await restarted.forWorkspace("b");
  await reopenedA.delete(ref);
  expect(await reopenedA.has(ref)).toBe(false);
  expect(await reopenedB.withSecret(ref, async (value) => value)).toBe(
    "synthetic-workspace-b-secret",
  );
  for (const workspace of await readdir(directory)) {
    const blobs = path.join(directory, workspace, "blobs");
    const files = await readdir(blobs).catch(() => [] as string[]);
    for (const file of files)
      expect(
        (await readFile(path.join(blobs, file))).includes(
          Buffer.from("synthetic-workspace-b-secret"),
        ),
      ).toBe(false);
  }
});

it("shares one mapping writer for concurrent requests to the same workspace", async () => {
  const { factory } = await fixture();
  const [a, b] = await Promise.all([
    factory.forWorkspace("same"),
    factory.forWorkspace("same"),
  ]);
  expect(a).toBe(b);
  const refs = await Promise.all([
    a.store("one", { class: CREDENTIAL_CLASS.ConnectorKey }),
    b.store("two", { class: CREDENTIAL_CLASS.ConnectorKey }),
  ]);
  expect(await Promise.all(refs.map((ref) => a.has(ref)))).toEqual([
    true,
    true,
  ]);
});

it("rejects invalid workspace identities before creating workspace files", async () => {
  const { directory, factory } = await fixture();
  for (const id of ["", " a", "a\n", "a b", "x".repeat(257)])
    await expect(factory.forWorkspace(id)).rejects.toThrow(
      "Invalid admitted workspace identity",
    );
  expect(await readdir(directory)).toEqual([]);
});

it("drains concurrent pooled vault writes before reopening durable mappings", async () => {
  const { directory, keyring, factory } = await fixture();
  let starts = 0;
  const pool = new HostedWorkspacePool(1, async (workspaceId) => {
    starts++;
    return {
      resources: await factory.forWorkspace(workspaceId),
      close: async () => {},
    };
  });
  const writes = Array.from({ length: 12 }, (_, index) =>
    pool.run("pooled", "owner", (vault) =>
      vault.store(`synthetic-value-${index}`, {
        class: CREDENTIAL_CLASS.ConnectorKey,
      }),
    ),
  );
  const shutdown = pool.close();
  const refs = await Promise.all(writes);
  await shutdown;
  expect(starts).toBe(1);
  const reopened = await (
    await createWorkspaceSecrets(directory, keyring)
  ).forWorkspace("pooled");
  for (const [index, ref] of refs.entries())
    expect(await reopened.withSecret(ref, async (value) => value)).toBe(
      `synthetic-value-${index}`,
    );
});
