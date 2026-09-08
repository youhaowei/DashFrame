import { createHash } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { CREDENTIAL_CLASS, FileMappingStore } from "@dashframe/server-core";
import { SecretRegistry, SecretVault } from "@wystack/secret-vault";
import {
  ENCRYPTED_FILE_BACKEND_NAME,
  EncryptedFileSecretBackend,
  type SecretKeyringConfig,
} from "../secret-file-backend";

/**
 * One factory per exclusively owned hosted data root. Call only with workspace
 * identity resolved by admission; this factory does not authenticate callers.
 * Keep the returned vault inside that workspace's runtime and cleanup worker.
 */
export async function createWorkspaceSecrets(
  dataRoot: string,
  keyring: SecretKeyringConfig,
) {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const root = await realpath(dataRoot);
  // Retain one vault per admitted workspace for the factory lifetime; pooled
  // engine retirement does not evict these shared credential handles.
  const pending = new Map<string, Promise<SecretVault>>();

  async function open(workspaceId: string): Promise<SecretVault> {
    if (
      !workspaceId ||
      workspaceId.trim() !== workspaceId ||
      workspaceId.length > 256 ||
      /[\s\p{Cc}]/u.test(workspaceId)
    )
      throw new Error("Invalid admitted workspace identity");
    // Opaque identifiers never become path segments supplied by a request.
    const name = createHash("sha256")
      .update("dashframe-workspace-secrets\0")
      .update(workspaceId)
      .digest("hex");
    const directory = path.join(root, name);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(directory)).isDirectory())
      throw new Error("Workspace secret directory must not be a symlink");
    const registry = new SecretRegistry();
    registry.register(
      ENCRYPTED_FILE_BACKEND_NAME,
      new EncryptedFileSecretBackend(path.join(directory, "blobs"), keyring),
    );
    for (const credentialClass of Object.values(CREDENTIAL_CLASS))
      registry.setClassDefault(credentialClass, ENCRYPTED_FILE_BACKEND_NAME);
    return new SecretVault(
      registry,
      new FileMappingStore(path.join(directory, "mappings.json")),
    );
  }

  return {
    forWorkspace(workspaceId: string): Promise<SecretVault> {
      const existing = pending.get(workspaceId);
      if (existing) return existing;
      const created = open(workspaceId).catch((error: unknown) => {
        pending.delete(workspaceId);
        throw error;
      });
      pending.set(workspaceId, created);
      return created;
    },
  };
}
