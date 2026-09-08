import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { ApiAccessCredentials } from "@dashframe/server-core";
import { loadSecretKeyring } from "../secret-file-backend";
import { createWorkspaceSecrets } from "./workspace-secrets";
import { createHostedAccessCredentials } from "./hosted-access-credentials";

it("publishes ownership before exposing a token and retires tokens after ambiguous registration failure", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "hosted-credential-issue-"),
  );
  try {
    const keyring = await loadSecretKeyring({
      DASHFRAME_SECRET_KEY: randomBytes(32).toString("base64"),
    });
    if (!keyring) throw new Error("Missing synthetic keyring");
    const vault = await (
      await createWorkspaceSecrets(path.join(directory, "vaults"), keyring)
    ).forWorkspace("a");
    const store = new ApiAccessCredentials(vault, directory);
    const registered = new Set<string>();
    let loseAcknowledgement = false;
    const credentials = createHostedAccessCredentials(store, {
      async register(credentialId) {
        registered.add(credentialId);
        if (loseAcknowledgement)
          throw new Error("Registration acknowledgement lost");
        return { credentialId, subject: "a", workspaceId: "workspace-a" };
      },
    });
    const issued = await credentials.issue("working");
    expect(registered.has(issued.credential.id)).toBe(true);
    expect(await store.authenticate(issued.token)).toBe(issued.credential.id);
    loseAcknowledgement = true;
    await expect(credentials.issue("lost acknowledgement")).rejects.toThrow(
      "acknowledgement lost",
    );
    const failed = (await store.list()).find(
      (item) => item.name === "lost acknowledgement",
    );
    expect(failed?.revokedAt).toBeDefined();
    expect(registered.has(failed!.id)).toBe(true);
    expect(await store.authenticate(issued.token)).toBe(issued.credential.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
