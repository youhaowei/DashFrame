import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { deriveKeyId } from "../secret-file-backend";
import {
  hashStateNonce,
  sweep,
  type ConnectorSetupSessionRow,
} from "./session-store";
import {
  createHostedConnectorSessionDocument,
  createHostedConnectorSessionStore,
} from "./hosted-session-store";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))),
);
const key = Buffer.alloc(32, 3);
const keyring = {
  activeKeyId: deriveKeyId(key),
  keys: new Map([[deriveKeyId(key), key]]),
};
async function fixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "dashframe-hosted-connectors-"),
  );
  roots.push(root);
  const document = createHostedConnectorSessionDocument(
    root,
    "workspace-a",
    keyring,
  );
  const kind = vi.fn(async () => null as string | null);
  return {
    root,
    alice: createHostedConnectorSessionStore({
      document,
      ownerSubject: "alice",
      getDataSourceKind: kind,
    }),
    bob: createHostedConnectorSessionStore({
      document,
      ownerSubject: "bob",
      getDataSourceKind: kind,
    }),
    kind,
  };
}
function row(
  id: string,
  state: "awaiting-user-auth" | "verifying" = "awaiting-user-auth",
) {
  return {
    id,
    connectorId: "google-sheets",
    requestedName: "Sheet",
    state,
    stateNonceHash: hashStateNonce(`nonce-${id}`),
    codeVerifier: `verifier-${"x".repeat(64)}-${id}`,
    scopes: ["read"],
    dataSourceId: state === "verifying" ? `source-${id}` : null,
    failureCode: null,
    failureMessage: null,
    expiresAt: 2_000,
    createdAt: 1_000,
    updatedAt: 1_000,
  } satisfies ConnectorSetupSessionRow;
}

it("binds every operation to the current owner and persists across restart", async () => {
  const f = await fixture();
  await f.alice.insert(row("a"));
  expect(await f.bob.get("a")).toBeNull();
  expect(await f.bob.findByNonce(row("a").stateNonceHash)).toBeNull();
  expect(await f.bob.compareAndSwap("a", {}, { state: "failed" })).toBeNull();
  expect((await f.bob.list(null)).page).toEqual([]);
  const restarted = createHostedConnectorSessionStore({
    document: createHostedConnectorSessionDocument(
      f.root,
      "workspace-a",
      keyring,
    ),
    ownerSubject: "alice",
    getDataSourceKind: f.kind,
  });
  expect((await restarted.get("a"))?.codeVerifier).toBe(row("a").codeVerifier);
});

it("serializes competing compare-and-swap transitions", async () => {
  const f = await fixture();
  await f.alice.insert(row("a"));
  const outcomes = await Promise.all([
    f.alice.compareAndSwap(
      "a",
      { state: "awaiting-user-auth" },
      { state: "exchanging" },
    ),
    f.alice.compareAndSwap(
      "a",
      { state: "awaiting-user-auth" },
      { state: "failed" },
    ),
  ]);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  expect(["exchanging", "failed"]).toContain((await f.alice.get("a"))?.state);
});

it("rejects untyped identity patches before they can overwrite owner or ID", async () => {
  const f = await fixture();
  await f.alice.insert(row("a"));
  await expect(
    f.alice.compareAndSwap("a", {}, { ownerSubject: "bob" } as never),
  ).rejects.toThrow();
  await expect(
    f.alice.compareAndSwap("a", {}, { id: "replacement" } as never),
  ).rejects.toThrow();
  expect(await f.alice.get("a")).toMatchObject({ id: "a" });
  expect(await f.bob.get("a")).toBeNull();
});

it("uses one code-unit order for pagination across mixed IDs", async () => {
  const f = await fixture();
  const ids = [
    ...Array.from(
      { length: 99 },
      (_, index) => `m-${String(index).padStart(3, "0")}`,
    ),
    "A-upper",
    "a-lower",
    "!punctuation",
  ];
  await Promise.all(ids.map((id) => f.alice.insert(row(id))));
  const first = await f.alice.list(null);
  const second = await f.alice.list(first.continueCursor);
  const expected = [...ids].sort();
  expect([...first.page, ...second.page].map(({ id }) => id)).toEqual(expected);
  expect(first.isDone).toBe(false);
  expect(second.isDone).toBe(true);
});

it("recovers scoped verifying sessions and expires stale sessions", async () => {
  const f = await fixture();
  await f.alice.insert(row("verified", "verifying"));
  await f.alice.insert(row("expired"));
  f.kind.mockResolvedValueOnce("google-sheets");
  expect(await sweep(f.alice, new Date(3_000), 0)).toMatchObject({
    recovered: 1,
    expired: 1,
  });
  expect((await f.alice.get("verified"))?.state).toBe("connected");
  expect((await f.alice.get("expired"))?.state).toBe("expired");
});
