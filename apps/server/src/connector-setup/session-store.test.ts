import { openArtifactDb, schema } from "@dashframe/server-core";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { functions } from "../functions";
import { wy } from "../wystack";
import {
  CONNECTOR_SETUP_INFLIGHT_GRACE_MS,
  CONNECTOR_SETUP_TERMINAL_RETENTION_MS,
  ConnectorSetupGateError,
  consumeCallback,
  effectiveState,
  markConnected,
  markVerifying,
  oauthStateFor,
  publicResumeInfo,
  startSession,
  sweep,
} from "./session-store";

const { connectorSetupSessions, dataSources } = schema;

/**
 * Wrap a tracked database handle so every SELECT it lowers is recorded.
 *
 * The session store's handle is `Pick<DrizzleTracker, "from" | "into">`, which
 * is small enough to stand in for — that is what makes it possible to assert
 * what SQL a code path actually issues, rather than only what it returns.
 * `toSql()` is captured at the moment a read executes, since clause methods
 * return copies rather than mutating the builder.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test double mirrors the builder's dynamic surface */
function recordingDb(tracked: any): { db: any; selects: string[] } {
  const selects: string[] = [];
  const wrap = (builder: any): any =>
    new Proxy(builder, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (prop === "first" || prop === "all") {
            selects.push(target.toSql().sql);
          }
          const result = value.apply(target, args);
          const isBuilder =
            result !== null &&
            typeof result === "object" &&
            typeof (result as { where?: unknown }).where === "function";
          return isBuilder ? wrap(result) : result;
        };
      },
    });
  return {
    selects,
    db: {
      into: (table: unknown) => tracked.into(table),
      from: (table: unknown) => wrap(tracked.from(table)),
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("connector setup session store", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: Awaited<ReturnType<typeof wy.build>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-connector-session-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await wy.build({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Derived, not hardcoded: these offsets only mean anything relative to the
  // grace window, so retuning CONNECTOR_SETUP_INFLIGHT_GRACE_MS must move them
  // too. Literals would leave the tests passing while asserting the wrong side
  // of the boundary.
  const SWEEP_NOW = new Date("2026-08-05T12:00:00Z");
  const ABANDONED_AT = new Date(
    SWEEP_NOW.getTime() - CONNECTOR_SETUP_INFLIGHT_GRACE_MS - 1_000,
  );
  const STILL_LIVE_AT = new Date(
    SWEEP_NOW.getTime() - Math.floor(CONNECTOR_SETUP_INFLIGHT_GRACE_MS / 4),
  );

  async function pending(now = new Date("2026-08-05T12:00:00Z")) {
    return startSession(app.createTracked(), {
      connectorId: "googleAnalytics",
      requestedName: "GA4",
      scopes: ["analytics.readonly"],
      now,
    });
  }

  it("consumes a callback exactly once with a conditional database transition", async () => {
    const issuance = await pending();
    const state = oauthStateFor(issuance.stateNonce);

    const attempts = await Promise.allSettled([
      consumeCallback(
        app.createTracked(),
        state,
        new Date("2026-08-05T12:01:00Z"),
      ),
      consumeCallback(
        app.createTracked(),
        state,
        new Date("2026-08-05T12:01:00Z"),
      ),
    ]);

    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
    const [row] = await db
      .select()
      .from(connectorSetupSessions)
      .where(eq(connectorSetupSessions.id, issuance.session.id));
    expect(row?.state).toBe("exchanging");
  });

  it("rejects a wrong nonce without changing the pending row", async () => {
    const issuance = await pending();
    await expect(
      consumeCallback(
        app.createTracked(),
        oauthStateFor("w".repeat(43)),
        new Date("2026-08-05T12:01:00Z"),
      ),
    ).rejects.toMatchObject({
      code: "state-mismatch",
    } satisfies Partial<ConnectorSetupGateError>);
    const [row] = await db
      .select()
      .from(connectorSetupSessions)
      .where(eq(connectorSetupSessions.id, issuance.session.id));
    expect(row?.state).toBe("awaiting-user-auth");
  });

  it("rejects an unmatched state when no session exists", async () => {
    await expect(
      consumeCallback(
        app.createTracked(),
        oauthStateFor("w".repeat(43)),
        new Date("2026-08-05T12:01:00Z"),
      ),
    ).rejects.toMatchObject({
      code: "state-mismatch",
    } satisfies Partial<ConnectorSetupGateError>);
  });

  it("rejects a matching state after the session has left the pending state", async () => {
    const issuance = await pending();
    await db
      .update(connectorSetupSessions)
      .set({ state: "failed" })
      .where(eq(connectorSetupSessions.id, issuance.session.id));

    await expect(
      consumeCallback(
        app.createTracked(),
        oauthStateFor(issuance.stateNonce),
        new Date("2026-08-05T12:01:00Z"),
      ),
    ).rejects.toMatchObject({
      code: "session-not-awaiting",
    } satisfies Partial<ConnectorSetupGateError>);
  });

  it("expires a matching callback before consuming it", async () => {
    const issuance = await pending();
    await expect(
      consumeCallback(
        app.createTracked(),
        oauthStateFor(issuance.stateNonce),
        new Date("2026-08-05T12:16:00Z"),
      ),
    ).rejects.toMatchObject({
      code: "session-expired",
    } satisfies Partial<ConnectorSetupGateError>);
    const [row] = await db
      .select()
      .from(connectorSetupSessions)
      .where(eq(connectorSetupSessions.id, issuance.session.id));
    expect(row?.state).toBe("expired");
  });

  it("lazily expires an awaiting session and never issues a new authorize nonce", async () => {
    const issuance = await pending();
    const resumed = await publicResumeInfo(
      app.createTracked(),
      issuance.session.id,
      new Date("2026-08-05T12:16:00Z"),
    );
    expect(resumed.session.state).toBe("expired");
    expect("stateNonce" in resumed).toBe(false);
  });

  it("allows only one concurrent resume request to rotate the authorization state", async () => {
    const issuance = await pending();
    // Pin the clock. `pending()` mints the session against a fixed date, so
    // letting publicResumeInfo default to the wall clock makes the session
    // expired for all but a 15-minute window on one particular day — and the
    // expiry branch returns normally for both callers, so the race this test
    // exists to check never runs.
    const attempts = await Promise.allSettled([
      publicResumeInfo(
        app.createTracked(),
        issuance.session.id,
        new Date("2026-08-05T12:01:00Z"),
      ),
      publicResumeInfo(
        app.createTracked(),
        issuance.session.id,
        new Date("2026-08-05T12:01:00Z"),
      ),
    ]);

    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
  });

  it("expires an in-flight exchange instead of reissuing after its TTL", async () => {
    const issuance = await pending();
    await db
      .update(connectorSetupSessions)
      .set({ state: "exchanging" })
      .where(eq(connectorSetupSessions.id, issuance.session.id));

    const resumed = await publicResumeInfo(
      app.createTracked(),
      issuance.session.id,
      new Date("2026-08-05T12:16:00Z"),
      true,
      true,
    );

    expect(resumed.session.state).toBe("expired");
    expect("stateNonce" in resumed).toBe(false);
  });

  // Each of these closes a mutant that survived the suite: the boundary
  // comparisons and the compare-and-swap preconditions could all be weakened
  // without a single test going red.
  describe("boundaries a reader must not get wrong", () => {
    it("reports a session as expired at the instant its TTL elapses, not after", async () => {
      const { session } = await pending();
      const deadline = session.expiresAt;

      expect(effectiveState(session, new Date(deadline.getTime() - 1))).toBe(
        "awaiting-user-auth",
      );
      // Exactly at expiresAt the session is already gone. `<` instead of `<=`
      // here would keep a session usable for one more millisecond than the
      // callback gate allows, so a resume issued on this boundary would mint an
      // authorize URL that consumeCallback then rejects as expired.
      expect(effectiveState(session, deadline)).toBe("expired");
      expect(effectiveState(session, new Date(deadline.getTime() + 1))).toBe(
        "expired",
      );
    });

    it("refuses a callback that arrives exactly on the expiry instant", async () => {
      const issuance = await pending();
      const deadline = issuance.session.expiresAt;

      // The gate and effectiveState have to agree on which side of `expiresAt`
      // is still usable. `<` here would accept a callback for a session the
      // resume path already reports as expired, so a code exchange would run
      // against a row no reader considers live.
      await expect(
        consumeCallback(
          app.createTracked(),
          oauthStateFor(issuance.stateNonce),
          deadline,
        ),
      ).rejects.toMatchObject({ code: "session-expired" });
      const [row] = await db
        .select()
        .from(connectorSetupSessions)
        .where(eq(connectorSetupSessions.id, issuance.session.id));
      expect(row?.state).toBe("expired");
    });

    it("accepts a callback one millisecond before the expiry instant", async () => {
      const issuance = await pending();
      await expect(
        consumeCallback(
          app.createTracked(),
          oauthStateFor(issuance.stateNonce),
          new Date(issuance.session.expiresAt.getTime() - 1),
        ),
      ).resolves.toMatchObject({ state: "exchanging" });
    });

    it("refuses to re-enter verification for a session already verifying", async () => {
      const { session } = await pending();
      const first = crypto.randomUUID();
      await db
        .update(connectorSetupSessions)
        .set({ state: "exchanging" })
        .where(eq(connectorSetupSessions.id, session.id));
      await markVerifying(app.createTracked(), session.id, first, SWEEP_NOW);

      // Only an `exchanging` row may enter verification. Dropping that term
      // would let a retried exchange run a second verification probe, minting
      // a second data source and overwriting the first id — orphaning a row
      // nothing ever cleans up.
      await expect(
        markVerifying(
          app.createTracked(),
          session.id,
          crypto.randomUUID(),
          SWEEP_NOW,
        ),
      ).rejects.toThrow("Connector setup transition rejected");
      const [row] = await db
        .select()
        .from(connectorSetupSessions)
        .where(eq(connectorSetupSessions.id, session.id));
      expect(row).toMatchObject({ state: "verifying", dataSourceId: first });
    });

    it("refuses to connect a session to a source it was not verifying", async () => {
      const { session } = await pending();
      const intended = crypto.randomUUID();
      const other = crypto.randomUUID();
      await db
        .update(connectorSetupSessions)
        .set({ state: "exchanging" })
        .where(eq(connectorSetupSessions.id, session.id));
      await markVerifying(app.createTracked(), session.id, intended, SWEEP_NOW);

      // The dataSourceId term in the compare-and-swap is the only thing tying a
      // connect to the source its own verification probe created. Without it a
      // concurrent flow's id could be written into this session, pointing the
      // user's finished connector at someone else's data source.
      await expect(
        markConnected(app.createTracked(), session.id, other, SWEEP_NOW),
      ).rejects.toThrow("Connector setup transition rejected");
      const [row] = await db
        .select()
        .from(connectorSetupSessions)
        .where(eq(connectorSetupSessions.id, session.id));
      expect(row).toMatchObject({ state: "verifying", dataSourceId: intended });
    });
  });

  it("recovers abandoned in-flight rows, expires stale rows, and deletes old terminals", async () => {
    const now = SWEEP_NOW;
    const exchanging = await pending(ABANDONED_AT);
    const verifying = await pending(ABANDONED_AT);
    const stale = await pending(new Date("2026-08-05T11:40:00Z"));
    const terminal = await pending(new Date("2026-08-03T00:00:00Z"));
    await db
      .update(connectorSetupSessions)
      // updatedAt is set explicitly: the sweep only recovers rows that have
      // sat untouched past CONNECTOR_SETUP_INFLIGHT_GRACE_MS, and the schema's
      // $onUpdate would otherwise stamp these with the real clock.
      .set({
        state: "exchanging",
        updatedAt: ABANDONED_AT,
      })
      .where(eq(connectorSetupSessions.id, exchanging.session.id));
    await db
      .update(connectorSetupSessions)
      .set({ state: "verifying", updatedAt: ABANDONED_AT })
      .where(eq(connectorSetupSessions.id, verifying.session.id));
    await db
      .update(connectorSetupSessions)
      .set({
        state: "connected",
        updatedAt: new Date(
          now.getTime() - CONNECTOR_SETUP_TERMINAL_RETENTION_MS - 1,
        ),
      })
      .where(eq(connectorSetupSessions.id, terminal.session.id));

    await expect(sweep(app.createTracked(), now)).resolves.toEqual({
      recovered: 2,
      expired: 1,
      deleted: 1,
    });
    const rows = await db.select().from(connectorSetupSessions);
    expect(rows.find((row) => row.id === exchanging.session.id)?.state).toBe(
      "awaiting-user-auth",
    );
    expect(rows.find((row) => row.id === verifying.session.id)?.state).toBe(
      "awaiting-user-auth",
    );
    expect(rows.find((row) => row.id === stale.session.id)?.state).toBe(
      "expired",
    );
    expect(rows.some((row) => row.id === terminal.session.id)).toBe(false);
  });

  it("leaves a still-live in-flight session alone", async () => {
    // sweepConnectorSetupSessions is an ordinary mutation any client can call,
    // including during the seconds between markVerifying and markConnected.
    // Recovering there would rotate the nonce and clear dataSourceId under a
    // live handler, failing its compare-and-swap and reporting failure for a
    // connection that actually succeeded.
    const now = SWEEP_NOW;
    const issuance = await pending(STILL_LIVE_AT);
    const sourceId = crypto.randomUUID();
    await db
      .update(connectorSetupSessions)
      .set({
        state: "verifying",
        dataSourceId: sourceId,
        updatedAt: STILL_LIVE_AT,
      })
      .where(eq(connectorSetupSessions.id, issuance.session.id));

    await expect(sweep(app.createTracked(), now)).resolves.toEqual({
      recovered: 0,
      expired: 0,
      deleted: 0,
    });
    const [row] = await db
      .select()
      .from(connectorSetupSessions)
      .where(eq(connectorSetupSessions.id, issuance.session.id));
    expect(row?.state).toBe("verifying");
    expect(row?.dataSourceId).toBe(sourceId);
    expect(row?.stateNonceHash).toBe(issuance.session.stateNonceHash);
  });

  it("waives the grace window at boot so a fast restart strands nothing", async () => {
    // The grace window assumes a live handler may own an in-flight row. After a
    // crash that assumption is false, and honouring it here would be permanent:
    // the boot pass is the only sweep scheduled, so a row younger than the
    // window would sit in `verifying` forever while the browser polled it to
    // its own 15-minute timeout and reported a failure for a live connection.
    const issuance = await pending(STILL_LIVE_AT);
    await db
      .update(connectorSetupSessions)
      .set({ state: "exchanging", updatedAt: STILL_LIVE_AT })
      .where(eq(connectorSetupSessions.id, issuance.session.id));

    await expect(
      sweep(app.createTracked(), SWEEP_NOW, 0),
    ).resolves.toMatchObject({ recovered: 1 });
    const [row] = await db
      .select()
      .from(connectorSetupSessions)
      .where(eq(connectorSetupSessions.id, issuance.session.id));
    expect(row?.state).toBe("awaiting-user-auth");
  });

  it("reconciles a verifying session whose planned source was already created", async () => {
    const issuance = await pending();
    const sourceId = crypto.randomUUID();
    await db.insert(dataSources).values({
      id: sourceId,
      name: "GA4",
      kind: "googleAnalytics",
      storage: "live",
      config: {},
      createdBy: { kind: "user" },
    });
    await db
      .update(connectorSetupSessions)
      .set({
        state: "verifying",
        dataSourceId: sourceId,
        updatedAt: ABANDONED_AT,
      })
      .where(eq(connectorSetupSessions.id, issuance.session.id));

    await expect(sweep(app.createTracked(), SWEEP_NOW)).resolves.toEqual({
      recovered: 1,
      expired: 0,
      deleted: 0,
    });
    const [row] = await db
      .select()
      .from(connectorSetupSessions)
      .where(eq(connectorSetupSessions.id, issuance.session.id));
    expect(row).toMatchObject({ state: "connected", dataSourceId: sourceId });
  });

  // The OAuth callback endpoint is unauthenticated: anyone who can reach the
  // callback URL can drive it, and the same caller can inflate the number of
  // live sessions. Resolving the presented nonce by reading the table therefore
  // makes per-callback cost grow with session count — a denial-of-service lever.
  describe("callback state lookup", () => {
    it("resolves the presented nonce through the unique index, not a table read", async () => {
      const issuance = await pending();
      const { db: recorded, selects } = recordingDb(app.createTracked());

      await consumeCallback(
        recorded,
        oauthStateFor(issuance.stateNonce),
        new Date("2026-08-05T12:01:00Z"),
      );

      // Every SELECT on the callback path is constrained by the nonce hash.
      // An unconstrained read of connector_setup_sessions is exactly the scan
      // this graft removes, so its absence is the assertion.
      expect(selects.length).toBeGreaterThan(0);
      for (const sql of selects) {
        expect(sql).toContain("state_nonce_hash");
        expect(sql).toContain("where");
      }
    });

    it("still resolves the right session, and rejects a wrong nonce, with many sessions present", async () => {
      const target = await pending();
      const others = await Promise.all(
        Array.from({ length: 200 }, () => pending()),
      );

      const consumed = await consumeCallback(
        app.createTracked(),
        oauthStateFor(target.stateNonce),
        new Date("2026-08-05T12:01:00Z"),
      );
      expect(consumed.id).toBe(target.session.id);

      // A nonce that matches no stored hash is rejected, and the sessions that
      // were not addressed are untouched.
      await expect(
        consumeCallback(
          app.createTracked(),
          oauthStateFor("w".repeat(43)),
          new Date("2026-08-05T12:01:00Z"),
        ),
      ).rejects.toMatchObject({
        code: "state-mismatch",
      } satisfies Partial<ConnectorSetupGateError>);

      const rows = await db.select().from(connectorSetupSessions);
      const untouched = rows.filter(
        (row) => row.state === "awaiting-user-auth",
      );
      expect(untouched).toHaveLength(others.length);
    });
  });

  // Reactive invalidation and snapshot freshness are driven entirely by a
  // tracker's tablesRead / tablesWritten sets. A read or write this module
  // performs without recording its table is invisible to them: subscribers keep
  // serving state that has already changed, with nothing to mark it stale.
  // These tests pin the recording itself, which no behavioural assertion above
  // can catch — every one of them passes with tracking completely absent.
  describe("reactive tracking", () => {
    it("records the data_sources read that decides an in-flight recovery", async () => {
      const issuance = await pending();
      const sourceId = crypto.randomUUID();
      await db.insert(dataSources).values({
        id: sourceId,
        name: "GA4",
        kind: "googleAnalytics",
        storage: "live",
        config: {},
        createdBy: { kind: "user" },
      });
      await db
        .update(connectorSetupSessions)
        .set({
          state: "verifying",
          dataSourceId: sourceId,
          updatedAt: ABANDONED_AT,
        })
        .where(eq(connectorSetupSessions.id, issuance.session.id));

      const tracker = app.createTracked();
      await sweep(tracker, SWEEP_NOW);

      // The sweep's outcome depends on this row's `kind`, so a later write to
      // data_sources must invalidate anything derived from the sweep.
      expect([...tracker.tablesRead]).toContain("data_sources");
      expect([...tracker.tablesWritten]).toContain("connector_setup_sessions");
    });

    it("records the session write on the reissue, callback, and failure paths", async () => {
      // Each write tags through the tracked builder at the point of the write,
      // rather than through a single end-of-function call gated on counters the
      // module computes for itself — a path that writes without incrementing
      // one of those counters silently loses its tag.
      const consumed = await pending();
      const consumeTracker = app.createTracked();
      await consumeCallback(
        consumeTracker,
        oauthStateFor(consumed.stateNonce),
        new Date("2026-08-05T12:01:00Z"),
      );
      expect([...consumeTracker.tablesWritten]).toContain(
        "connector_setup_sessions",
      );

      const resumed = await pending();
      const resumeTracker = app.createTracked();
      await publicResumeInfo(
        resumeTracker,
        resumed.session.id,
        new Date("2026-08-05T12:01:00Z"),
      );
      expect([...resumeTracker.tablesWritten]).toContain(
        "connector_setup_sessions",
      );

      const stale = await pending(new Date("2026-08-05T11:40:00Z"));
      const sweepTracker = app.createTracked();
      await sweep(sweepTracker, SWEEP_NOW);
      expect([...sweepTracker.tablesWritten]).toContain(
        "connector_setup_sessions",
      );
      const [staleRow] = await db
        .select()
        .from(connectorSetupSessions)
        .where(eq(connectorSetupSessions.id, stale.session.id));
      expect(staleRow?.state).toBe("expired");
    });
  });
});
