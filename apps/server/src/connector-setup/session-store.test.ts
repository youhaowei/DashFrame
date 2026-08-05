import { openArtifactDb, schema } from "@dashframe/server-core";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { functions } from "../functions";
import { wy } from "../wystack";
import {
  CONNECTOR_SETUP_TERMINAL_RETENTION_MS,
  ConnectorSetupGateError,
  consumeCallback,
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

  it("boot sweep recovers in-flight rows, expires stale rows, and deletes old terminals", async () => {
    const now = new Date("2026-08-05T12:00:00Z");
    const exchanging = await pending(new Date("2026-08-05T11:55:00Z"));
    const verifying = await pending(new Date("2026-08-05T11:56:00Z"));
    const stale = await pending(new Date("2026-08-05T11:40:00Z"));
    const terminal = await pending(new Date("2026-08-03T00:00:00Z"));
    await db
      .update(connectorSetupSessions)
      .set({ state: "exchanging" })
      .where(eq(connectorSetupSessions.id, exchanging.session.id));
    await db
      .update(connectorSetupSessions)
      .set({ state: "verifying" })
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
      .set({ state: "verifying", dataSourceId: sourceId })
      .where(eq(connectorSetupSessions.id, issuance.session.id));

    await expect(
      sweep(app.createTracked(), new Date("2026-08-05T12:01:00Z")),
    ).resolves.toEqual({ recovered: 1, expired: 0, deleted: 0 });
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
        .set({ state: "verifying", dataSourceId: sourceId })
        .where(eq(connectorSetupSessions.id, issuance.session.id));

      const tracker = app.createTracked();
      await sweep(tracker, new Date("2026-08-05T12:01:00Z"));

      // The sweep's outcome depends on this row's `kind`, so a later write to
      // data_sources must invalidate anything derived from the sweep.
      expect([...tracker.tablesRead]).toContain("data_sources");
      expect([...tracker.tablesWritten]).toContain("connector_setup_sessions");
    });

    it("records the session write on every mutating path", async () => {
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
      await sweep(sweepTracker, new Date("2026-08-05T12:00:00Z"));
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
