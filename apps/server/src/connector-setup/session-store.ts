import { schema } from "@dashframe/server-core";
import { eq as trackedEq, type DrizzleTracker } from "@wystack/db";
import { and, getTableName, lt, eq as sqlEq } from "drizzle-orm";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

const { connectorSetupSessions, dataSources } = schema;

export const CONNECTOR_SETUP_TTL_MS = 15 * 60 * 1000;
export const CONNECTOR_SETUP_TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;

export type ConnectorSetupState =
  | "awaiting-user-auth"
  | "exchanging"
  | "verifying"
  | "connected"
  | "failed"
  | "expired";

export type ConnectorSetupSessionRow =
  typeof connectorSetupSessions.$inferSelect;

export interface StartSessionInput {
  connectorId: string;
  requestedName: string;
  scopes: string[];
  now?: Date;
}

export interface SessionIssuance {
  session: ConnectorSetupSessionRow;
  stateNonce: string;
}

export class ConnectorSetupGateError extends Error {
  constructor(
    readonly code: string,
    readonly session?: ConnectorSetupSessionRow,
  ) {
    super("Connector setup callback rejected");
  }
}

function nonceHash(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

function newStateNonce(): string {
  return randomBytes(32).toString("base64url");
}

function newCodeVerifier(): string {
  return randomBytes(64).toString("base64url");
}

function matchesStateNonce(nonce: string, expectedHex: string): boolean {
  const actual = Buffer.from(nonceHash(nonce), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function trackWrite(db: DrizzleTracker): void {
  db.tablesWritten.add(getTableName(connectorSetupSessions));
}

export function oauthStateFor(stateNonce: string): string {
  return stateNonce;
}

export async function startSession(
  db: DrizzleTracker,
  input: StartSessionInput,
): Promise<SessionIssuance> {
  const now = input.now ?? new Date();
  const stateNonce = newStateNonce();
  const [session] = (await db.into(connectorSetupSessions).insert({
    id: randomUUID(),
    connectorId: input.connectorId,
    requestedName: input.requestedName,
    state: "awaiting-user-auth",
    stateNonceHash: nonceHash(stateNonce),
    codeVerifier: newCodeVerifier(),
    scopes: input.scopes,
    dataSourceId: null,
    failureCode: null,
    failureMessage: null,
    expiresAt: new Date(now.getTime() + CONNECTOR_SETUP_TTL_MS),
    createdAt: now,
    updatedAt: now,
  })) as ConnectorSetupSessionRow[];
  if (!session) throw new Error("Connector setup session insert failed");
  return { session, stateNonce };
}

/**
 * Resolve a resume capability. Awaiting sessions rotate both PKCE and state so
 * every resume issuance kills the previous authorize URL automatically.
 */
export async function publicResumeInfo(
  db: DrizzleTracker,
  sessionId: string,
  now = new Date(),
  reissue = true,
  recoverExchange = false,
): Promise<SessionIssuance | { session: ConnectorSetupSessionRow }> {
  let row = (await db
    .from(connectorSetupSessions)
    .where(trackedEq("id", sessionId))
    .first()) as ConnectorSetupSessionRow | undefined;
  if (!row) throw new ConnectorSetupGateError("session-not-found");

  if (
    row.state === "awaiting-user-auth" &&
    row.expiresAt.getTime() <= now.getTime()
  ) {
    const [expired] = await db.raw
      .update(connectorSetupSessions)
      .set({ state: "expired", updatedAt: now })
      .where(
        and(
          sqlEq(connectorSetupSessions.id, row.id),
          sqlEq(connectorSetupSessions.state, "awaiting-user-auth"),
        ),
      )
      .returning();
    if (expired) trackWrite(db);
    return { session: (expired ?? row) as ConnectorSetupSessionRow };
  }

  if (recoverExchange && row.state === "exchanging") {
    const isExpired = row.expiresAt.getTime() <= now.getTime();
    const [recovered] = await db.raw
      .update(connectorSetupSessions)
      .set({
        state: isExpired ? "expired" : "awaiting-user-auth",
        updatedAt: now,
      })
      .where(
        and(
          sqlEq(connectorSetupSessions.id, row.id),
          sqlEq(connectorSetupSessions.state, "exchanging"),
        ),
      )
      .returning();
    if (!recovered) throw new ConnectorSetupGateError("session-raced");
    trackWrite(db);
    row = recovered as ConnectorSetupSessionRow;
    if (isExpired) return { session: row };
  }

  if (row.state !== "awaiting-user-auth" || !reissue) {
    return { session: row };
  }

  const stateNonce = newStateNonce();
  const [reissued] = await db.raw
    .update(connectorSetupSessions)
    .set({
      stateNonceHash: nonceHash(stateNonce),
      codeVerifier: newCodeVerifier(),
      failureCode: null,
      failureMessage: null,
      updatedAt: now,
    })
    .where(
      and(
        sqlEq(connectorSetupSessions.id, row.id),
        sqlEq(connectorSetupSessions.state, "awaiting-user-auth"),
        sqlEq(connectorSetupSessions.stateNonceHash, row.stateNonceHash),
      ),
    )
    .returning();
  if (!reissued) throw new ConnectorSetupGateError("session-raced");
  trackWrite(db);
  return { session: reissued as ConnectorSetupSessionRow, stateNonce };
}

/**
 * Apply all callback gates and consume the pending state with one conditional
 * database update. No process-local lock participates in the single-use guard.
 */
export async function consumeCallback(
  db: DrizzleTracker,
  state: string,
  now = new Date(),
): Promise<ConnectorSetupSessionRow> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(state)) {
    throw new ConnectorSetupGateError("state-mismatch");
  }
  // State carries only the nonce, never the session capability. Scan the small
  // setup-session table and perform every digest comparison in constant time;
  // only after that gate succeeds does the callback learn which session exists.
  const rows = (await db
    .from(connectorSetupSessions)
    .all()) as ConnectorSetupSessionRow[];
  let row: ConnectorSetupSessionRow | undefined;
  for (const candidate of rows) {
    if (matchesStateNonce(state, candidate.stateNonceHash)) row = candidate;
  }
  if (!row) {
    throw new ConnectorSetupGateError("state-mismatch");
  }
  if (row.state !== "awaiting-user-auth") {
    throw new ConnectorSetupGateError("session-not-awaiting");
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    const expired = await db.raw
      .update(connectorSetupSessions)
      .set({ state: "expired", updatedAt: now })
      .where(
        and(
          sqlEq(connectorSetupSessions.id, row.id),
          sqlEq(connectorSetupSessions.state, "awaiting-user-auth"),
        ),
      )
      .returning();
    if (expired.length > 0) trackWrite(db);
    const expiredRow = expired[0] as ConnectorSetupSessionRow | undefined;
    throw new ConnectorSetupGateError("session-expired", expiredRow ?? row);
  }

  const consumed = await db.raw
    .update(connectorSetupSessions)
    .set({ state: "exchanging", updatedAt: now })
    .where(
      and(
        sqlEq(connectorSetupSessions.id, row.id),
        sqlEq(connectorSetupSessions.state, "awaiting-user-auth"),
        sqlEq(connectorSetupSessions.stateNonceHash, row.stateNonceHash),
      ),
    )
    .returning();
  if (consumed.length !== 1) {
    throw new ConnectorSetupGateError("session-consumed");
  }
  trackWrite(db);
  return consumed[0] as ConnectorSetupSessionRow;
}

export async function markVerifying(
  db: DrizzleTracker,
  sessionId: string,
  dataSourceId: string,
  now = new Date(),
): Promise<ConnectorSetupSessionRow> {
  const rows = await db.raw
    .update(connectorSetupSessions)
    .set({ state: "verifying", dataSourceId, updatedAt: now })
    .where(
      and(
        sqlEq(connectorSetupSessions.id, sessionId),
        sqlEq(connectorSetupSessions.state, "exchanging"),
      ),
    )
    .returning();
  if (rows.length !== 1) throw new Error("Connector setup transition rejected");
  trackWrite(db);
  return rows[0] as ConnectorSetupSessionRow;
}

export async function markConnected(
  db: DrizzleTracker,
  sessionId: string,
  dataSourceId: string,
  now = new Date(),
): Promise<ConnectorSetupSessionRow> {
  const rows = await db.raw
    .update(connectorSetupSessions)
    .set({
      state: "connected",
      dataSourceId,
      failureCode: null,
      failureMessage: null,
      updatedAt: now,
    })
    .where(
      and(
        sqlEq(connectorSetupSessions.id, sessionId),
        sqlEq(connectorSetupSessions.state, "verifying"),
        sqlEq(connectorSetupSessions.dataSourceId, dataSourceId),
      ),
    )
    .returning();
  if (rows.length !== 1) throw new Error("Connector setup transition rejected");
  trackWrite(db);
  return rows[0] as ConnectorSetupSessionRow;
}

export async function markFailed(
  db: DrizzleTracker,
  sessionId: string,
  failureCode: string,
  failureMessage: string,
  now = new Date(),
  allowedStates: ConnectorSetupState[] = [
    "awaiting-user-auth",
    "exchanging",
    "verifying",
  ],
): Promise<ConnectorSetupSessionRow> {
  const row = (await db
    .from(connectorSetupSessions)
    .where(trackedEq("id", sessionId))
    .first()) as ConnectorSetupSessionRow | undefined;
  if (!row) throw new Error("Connector setup session not found");
  if (["connected", "failed", "expired"].includes(row.state)) return row;
  if (!allowedStates.includes(row.state as ConnectorSetupState)) return row;
  const [failed] = await db.raw
    .update(connectorSetupSessions)
    .set({
      state: "failed",
      dataSourceId: null,
      failureCode,
      failureMessage,
      updatedAt: now,
    })
    .where(
      and(
        sqlEq(connectorSetupSessions.id, sessionId),
        sqlEq(connectorSetupSessions.state, row.state),
      ),
    )
    .returning();
  if (failed) {
    trackWrite(db);
    return failed as ConnectorSetupSessionRow;
  }
  const raced = (await db
    .from(connectorSetupSessions)
    .where(trackedEq("id", sessionId))
    .first()) as ConnectorSetupSessionRow | undefined;
  if (!raced) throw new Error("Connector setup session not found");
  return raced;
}

async function expireAwaiting(
  db: DrizzleTracker,
  row: ConnectorSetupSessionRow,
  now: Date,
): Promise<boolean> {
  if (row.expiresAt.getTime() > now.getTime()) return false;
  const updated = await db.raw
    .update(connectorSetupSessions)
    .set({ state: "expired", updatedAt: now })
    .where(
      and(
        sqlEq(connectorSetupSessions.id, row.id),
        sqlEq(connectorSetupSessions.state, "awaiting-user-auth"),
      ),
    )
    .returning({ id: connectorSetupSessions.id });
  return updated.length > 0;
}

async function recoverInFlight(
  db: DrizzleTracker,
  row: ConnectorSetupSessionRow,
  now: Date,
): Promise<"recovered" | "expired" | undefined> {
  if (row.state !== "exchanging" && row.state !== "verifying") {
    return undefined;
  }
  const isExpired = row.expiresAt.getTime() <= now.getTime();
  if (row.state === "verifying" && row.dataSourceId) {
    const [source] = await db.raw
      .select({ kind: dataSources.kind })
      .from(dataSources)
      .where(sqlEq(dataSources.id, row.dataSourceId));
    if (source?.kind === row.connectorId) {
      const connected = await db.raw
        .update(connectorSetupSessions)
        .set({ state: "connected", updatedAt: now })
        .where(
          and(
            sqlEq(connectorSetupSessions.id, row.id),
            sqlEq(connectorSetupSessions.state, "verifying"),
            sqlEq(connectorSetupSessions.dataSourceId, row.dataSourceId),
          ),
        )
        .returning({ id: connectorSetupSessions.id });
      if (connected.length > 0) return "recovered";
      return undefined;
    }
  }
  const updated = await db.raw
    .update(connectorSetupSessions)
    .set({
      state: isExpired ? "expired" : "awaiting-user-auth",
      stateNonceHash: nonceHash(newStateNonce()),
      codeVerifier: newCodeVerifier(),
      dataSourceId: null,
      updatedAt: now,
    })
    .where(
      and(
        sqlEq(connectorSetupSessions.id, row.id),
        sqlEq(connectorSetupSessions.state, row.state),
      ),
    )
    .returning({ id: connectorSetupSessions.id });
  if (updated.length === 0) return undefined;
  return isExpired ? "expired" : "recovered";
}

export async function sweep(
  db: DrizzleTracker,
  now = new Date(),
): Promise<{ recovered: number; expired: number; deleted: number }> {
  const rows = (await db
    .from(connectorSetupSessions)
    .all()) as ConnectorSetupSessionRow[];
  let recovered = 0;
  let expired = 0;
  for (const row of rows) {
    if (row.state === "awaiting-user-auth") {
      if (await expireAwaiting(db, row, now)) expired += 1;
      continue;
    }
    const outcome = await recoverInFlight(db, row, now);
    if (outcome === "expired") expired += 1;
    if (outcome === "recovered") recovered += 1;
  }

  const cutoff = new Date(
    now.getTime() - CONNECTOR_SETUP_TERMINAL_RETENTION_MS,
  );
  const terminalIds = rows
    .filter(
      (row) =>
        ["connected", "failed", "expired"].includes(row.state) &&
        row.updatedAt.getTime() < cutoff.getTime(),
    )
    .map((row) => row.id);
  let deleted = 0;
  for (const id of terminalIds) {
    const removed = await db.raw
      .delete(connectorSetupSessions)
      .where(
        and(
          sqlEq(connectorSetupSessions.id, id),
          lt(connectorSetupSessions.updatedAt, cutoff),
        ),
      )
      .returning({ id: connectorSetupSessions.id });
    deleted += removed.length;
  }
  if (recovered + expired + deleted > 0) trackWrite(db);
  return { recovered, expired, deleted };
}
