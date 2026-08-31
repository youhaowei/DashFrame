import {
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { CREDENTIAL_CLASS } from "./credential-classes";
import { FileMappingStore } from "./mapping-store";

describe("FileMappingStore", () => {
  let dir: string;
  let mappingPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-file-mapping-store-"));
    mappingPath = join(dir, "mappings.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists a vault mapping independently of the project database", async () => {
    const backend = new TestBackend();
    const registry = new SecretRegistry();
    registry.register("test", backend, { fallback: true });
    registry.setClassDefault(CREDENTIAL_CLASS.ServeToken, "test");

    const ref = await new SecretVault(
      registry,
      new FileMappingStore(mappingPath),
    ).store("workspace-token", { class: CREDENTIAL_CLASS.ServeToken });

    const reopened = new SecretVault(
      registry,
      new FileMappingStore(mappingPath),
    );
    expect(await reopened.has(ref)).toBe(true);
    expect(await reopened.withSecret(ref, async (value) => value)).toBe(
      "workspace-token",
    );
  });
});
