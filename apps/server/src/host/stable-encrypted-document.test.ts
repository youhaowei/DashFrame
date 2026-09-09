import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { deriveKeyId } from "../secret-file-backend";
import { StableEncryptedDocument } from "./stable-encrypted-document";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))),
);
const key = (byte: number) => Buffer.alloc(32, byte);
const ring = (active: Buffer, previous: Buffer[] = []) => ({
  activeKeyId: deriveKeyId(active),
  keys: new Map(
    [active, ...previous].map((value) => [deriveKeyId(value), value]),
  ),
});
const codec = {
  empty: () => ({ version: 1 as const, count: 0 }),
  parse(value: unknown) {
    if (
      typeof value !== "object" ||
      value === null ||
      (value as { version?: unknown }).version !== 1 ||
      !Number.isInteger((value as { count?: unknown }).count)
    )
      throw new Error("Invalid document");
    return value as { version: 1; count: number };
  },
};
async function directory() {
  const root = await mkdtemp(path.join(tmpdir(), "dashframe-stable-document-"));
  roots.push(root);
  return root;
}

it("encrypts stable snapshots and binds them to workspace identity", async () => {
  const root = await directory();
  const first = new StableEncryptedDocument(
    root,
    "workspace-a",
    ring(key(1)),
    codec,
  );
  await first.update(() => ({ value: { version: 1, count: 7 }, result: null }));
  const blob = await readFile(path.join(root, "connector-sessions.dfsd"));
  expect(blob.toString()).not.toContain('"count":7');
  await expect(
    new StableEncryptedDocument(root, "workspace-b", ring(key(1)), codec).read(
      (value) => value,
    ),
  ).rejects.toThrow();
});

it("reloads committed state after an uncertain error and supports key rotation", async () => {
  const root = await directory();
  let fail = true;
  const subject = new StableEncryptedDocument(
    root,
    "workspace-a",
    ring(key(1)),
    codec,
    {
      afterRename: async () => {
        if (fail) {
          fail = false;
          throw new Error("uncertain write");
        }
      },
    },
  );
  await expect(
    subject.update(() => ({ value: { version: 1, count: 1 }, result: null })),
  ).rejects.toThrow("uncertain write");
  expect(await subject.read((value) => value.count)).toBe(1);

  const rotated = new StableEncryptedDocument(
    root,
    "workspace-a",
    ring(key(2), [key(1)]),
    codec,
  );
  expect(await rotated.read((value) => value.count)).toBe(1);
  await rotated.update((value) => ({
    value: { ...value, count: 2 },
    result: null,
  }));
  expect(
    await new StableEncryptedDocument(
      root,
      "workspace-a",
      ring(key(2)),
      codec,
    ).read((value) => value.count),
  ).toBe(2);
});

it("fails closed on tampering", async () => {
  const root = await directory();
  const subject = new StableEncryptedDocument(
    root,
    "workspace-a",
    ring(key(1)),
    codec,
  );
  await subject.update(() => ({
    value: { version: 1, count: 1 },
    result: null,
  }));
  const file = path.join(root, "connector-sessions.dfsd");
  const blob = await readFile(file);
  blob[blob.length - 1] = blob[blob.length - 1]! ^ 1;
  await writeFile(file, blob, { mode: 0o600 });
  await expect(
    new StableEncryptedDocument(root, "workspace-a", ring(key(1)), codec).read(
      (value) => value,
    ),
  ).rejects.toThrow();
});

it("rechecks directory safety before writing a cached document", async () => {
  const root = await directory();
  const subject = new StableEncryptedDocument(
    root,
    "workspace-a",
    ring(key(1)),
    codec,
  );
  expect(await subject.read((value) => value.count)).toBe(0);
  await chmod(root, 0o755);
  await expect(
    subject.update((value) => ({
      value: { ...value, count: 1 },
      result: null,
    })),
  ).rejects.toThrow("directory is unsafe");
  await chmod(root, 0o700);
});
