import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import schema from "../../../../packages/convex-backend/convex/schema";
import { internal } from "../../../../packages/convex-backend/convex/_generated/api";
import {
  CONNECTOR_SETUP_INFLIGHT_GRACE_MS,
  CONNECTOR_SETUP_TERMINAL_RETENTION_MS,
  consumeCallback,
  effectiveState,
  markConnected,
  markFailed,
  markVerifying,
  publicResumeInfo,
  readSession,
  startSession,
  sweep,
  type ConnectorSetupStore,
} from "./session-store";

const modules = import.meta.glob(
  "../../../../packages/convex-backend/convex/**/*.ts",
);
const WORKSPACE = "test-workspace";
const NOW = new Date("2026-08-05T12:00:00Z");
function fixture(workspaceId = WORKSPACE) {
  const t = convexTest(schema, modules);
  const sources = new Map<string, string>();
  const db: ConnectorSetupStore = {
    get: (id) => t.query(internal.connectorSetup.get, { workspaceId, id }),
    findByNonce: (stateNonceHash) =>
      t.query(internal.connectorSetup.findByNonce, {
        workspaceId,
        stateNonceHash,
      }),
    insert: async (row) => {
      await t.mutation(internal.connectorSetup.insert, { workspaceId, row });
    },
    compareAndSwap: (id, expected, patch) =>
      t.mutation(internal.connectorSetup.compareAndSwap, {
        workspaceId,
        id,
        expected,
        patch,
      }),
    list: (cursor) =>
      t.query(internal.connectorSetup.list, {
        workspaceId,
        paginationOpts: { cursor, numItems: 100 },
      }),
    delete: (id, updatedBefore) =>
      t.mutation(internal.connectorSetup.remove, {
        workspaceId,
        id,
        updatedBefore,
      }),
    getDataSourceKind: async (id) => sources.get(id) ?? null,
  };
  return {
    t,
    db,
    sources,
    pending: (now = NOW) =>
      startSession(db, {
        connectorId: "googleAnalytics",
        requestedName: "GA4",
        scopes: ["analytics.readonly"],
        now,
      }),
  };
}

describe("native Convex connector setup sessions", () => {
  it("consumes a callback exactly once across concurrent callers", async () => {
    const { db, pending } = fixture();
    const issuance = await pending();
    const results = await Promise.allSettled([
      consumeCallback(db, issuance.stateNonce, NOW),
      consumeCallback(db, issuance.stateNonce, NOW),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect((await readSession(db, issuance.session.id)).state).toBe(
      "exchanging",
    );
  });
  it("rotates state and PKCE together, invalidating the old authorize URL", async () => {
    const { db, pending } = fixture();
    const first = await pending();
    const second = await publicResumeInfo(db, first.session.id, NOW);
    expect(second.session.codeVerifier).not.toBe(first.session.codeVerifier);
    expect(second.session.stateNonceHash).not.toBe(
      first.session.stateNonceHash,
    );
    await expect(
      consumeCallback(db, first.stateNonce, NOW),
    ).rejects.toMatchObject({ code: "state-mismatch" });
    if (!("stateNonce" in second)) throw new Error("Expected reissued session");
    await expect(
      consumeCallback(db, second.stateNonce, NOW),
    ).resolves.toMatchObject({ state: "exchanging" });
  });
  it("rejects malformed callback state before looking up a session", async () => {
    const { db } = fixture();
    await expect(
      consumeCallback(db, "not-a-capability", NOW),
    ).rejects.toMatchObject({ code: "state-mismatch" });
  });
  it("commits expiry before rejecting a stale callback", async () => {
    const { db, pending } = fixture();
    const issuance = await pending();
    await expect(
      consumeCallback(
        db,
        issuance.stateNonce,
        new Date(issuance.session.expiresAt),
      ),
    ).rejects.toMatchObject({ code: "session-expired" });
    expect((await readSession(db, issuance.session.id)).state).toBe("expired");
  });
  it("derives expiry on reads without rotating or changing persisted state", async () => {
    const { db, pending } = fixture();
    const issuance = await pending();
    expect(
      effectiveState(
        await readSession(db, issuance.session.id),
        new Date(issuance.session.expiresAt),
      ),
    ).toBe("expired");
    expect(await readSession(db, issuance.session.id)).toEqual(
      issuance.session,
    );
  });
  it("does not allow cancel to interrupt a consumed callback", async () => {
    const { db, pending } = fixture();
    const issuance = await pending();
    await consumeCallback(db, issuance.stateNonce, NOW);
    await markFailed(db, issuance.session.id, "cancelled", "Cancelled", NOW, [
      "awaiting-user-auth",
    ]);
    expect((await readSession(db, issuance.session.id)).state).toBe(
      "exchanging",
    );
  });
  it("matches the source and attempt before completing verification", async () => {
    const { db, pending } = fixture();
    const issuance = await pending();
    await consumeCallback(db, issuance.stateNonce, NOW);
    await markVerifying(
      db,
      issuance.session.id,
      "source-a",
      NOW,
      issuance.session.stateNonceHash,
    );
    await expect(
      markConnected(
        db,
        issuance.session.id,
        "source-b",
        NOW,
        issuance.session.stateNonceHash,
      ),
    ).rejects.toMatchObject({ code: "session-raced" });
    expect(
      (
        await markConnected(
          db,
          issuance.session.id,
          "source-a",
          NOW,
          issuance.session.stateNonceHash,
        )
      ).state,
    ).toBe("connected");
  });
  it("preserves the source reference on a failed verification", async () => {
    const { db, pending } = fixture();
    const issuance = await pending();
    await consumeCallback(db, issuance.stateNonce, NOW);
    await markVerifying(db, issuance.session.id, "source-a", NOW);
    expect(
      await markFailed(db, issuance.session.id, "probe-failed", "Failed", NOW),
    ).toMatchObject({ state: "failed", dataSourceId: "source-a" });
  });
  it("preserves live verification but boot recovery recognizes a committed source", async () => {
    const { db, pending, sources } = fixture();
    const issuance = await pending();
    await consumeCallback(db, issuance.stateNonce, NOW);
    await markVerifying(db, issuance.session.id, "source-a", NOW);
    sources.set("source-a", "googleAnalytics");
    expect(await sweep(db, new Date(NOW.getTime() + 1000))).toEqual({
      recovered: 0,
      expired: 0,
      deleted: 0,
    });
    expect((await readSession(db, issuance.session.id)).state).toBe(
      "verifying",
    );
    expect(await sweep(db, new Date(NOW.getTime() + 1000), 0)).toEqual({
      recovered: 1,
      expired: 0,
      deleted: 0,
    });
    expect((await readSession(db, issuance.session.id)).state).toBe(
      "connected",
    );
  });
  it("an abandoned callback cannot advance a subsequently reissued attempt", async () => {
    const { db, pending } = fixture();
    const first = await pending();
    await consumeCallback(db, first.stateNonce, NOW);
    const later = new Date(
      NOW.getTime() + CONNECTOR_SETUP_INFLIGHT_GRACE_MS + 1000,
    );
    await sweep(db, later);
    const next = await publicResumeInfo(db, first.session.id, later);
    if (!("stateNonce" in next)) throw new Error("Expected reissued session");
    await consumeCallback(db, next.stateNonce, later);
    await expect(
      markVerifying(
        db,
        first.session.id,
        "old-source",
        later,
        first.session.stateNonceHash,
      ),
    ).rejects.toMatchObject({ code: "session-raced" });
  });
  it("native lookup never crosses workspace scope", async () => {
    const { t, pending } = fixture();
    const issuance = await pending();
    expect(
      await t.query(internal.connectorSetup.get, {
        workspaceId: "other",
        id: issuance.session.id,
      }),
    ).toBeNull();
    expect(
      await t.query(internal.connectorSetup.findByNonce, {
        workspaceId: "other",
        stateNonceHash: issuance.session.stateNonceHash,
      }),
    ).toBeNull();
  });
  it("sweeps more than one page and only deletes old terminal sessions", async () => {
    const { db, pending } = fixture();
    for (let i = 0; i < 105; i++) {
      const issuance = await pending();
      await markFailed(db, issuance.session.id, "cancelled", "Cancelled", NOW);
    }
    const later = new Date(
      NOW.getTime() + CONNECTOR_SETUP_TERMINAL_RETENTION_MS + 1000,
    );
    const live = await pending(later);
    const outcome = await sweep(db, later);
    expect(outcome.deleted).toBe(105);
    expect(await readSession(db, live.session.id)).toEqual(live.session);
  });
});
