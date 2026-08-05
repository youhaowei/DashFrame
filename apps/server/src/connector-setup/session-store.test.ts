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
    const attempts = await Promise.allSettled([
      publicResumeInfo(app.createTracked(), issuance.session.id),
      publicResumeInfo(app.createTracked(), issuance.session.id),
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
});
