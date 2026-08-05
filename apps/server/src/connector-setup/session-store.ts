import { schema } from "@dashframe/server-core";
import { eq, lt, type DrizzleTracker } from "@wystack/db";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

const { connectorSetupSessions, dataSources } = schema;

export const CONNECTOR_SETUP_TTL_MS = 15 * 60 * 1000;
export const CONNECTOR_SETUP_TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * The only database surface this module may touch.
 *
 * Deliberately NOT `DrizzleTracker`: narrowing to `from` / `into` makes `raw`
 * unreachable from here, so every read and write in this file goes through the
 * tracked builder and self-records `tablesRead` / `tablesWritten`. That is a
 * correctness requirement, not a style preference — reactive invalidation and
 * snapshot freshness are driven entirely by those two sets, and an untracked
 * write is invisible to them: subscribers keep serving a stale session state
 * with nothing to indicate it went stale. Widening this type back to
 * `DrizzleTracker` re-opens that hole silently, because `raw` compiles fine.
 */
type Db = Pick<DrizzleTracker, "from" | "into">;

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

export function hashStateNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

function newStateNonce(): string {
  return randomBytes(32).toString("base64url");
}

function newCodeVerifier(): string {
  return randomBytes(64).toString("base64url");
}

function matchesStateNonce(nonce: string, expectedHex: string): boolean {
  const actual = Buffer.from(hashStateNonce(nonce), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Rows returned by a tracked `update()` / `delete()`, which lowers to RETURNING *. */
function returnedRows(rows: unknown): ConnectorSetupSessionRow[] {
  return rows as ConnectorSetupSessionRow[];
}

export function oauthStateFor(stateNonce: string): string {
  return stateNonce;
}

export async function startSession(
  db: Db,
  input: StartSessionInput,
): Promise<SessionIssuance> {
  const now = input.now ?? new Date();
  const stateNonce = newStateNonce();
  const [session] = (await db.into(connectorSetupSessions).insert({
    id: randomUUID(),
    connectorId: input.connectorId,
    requestedName: input.requestedName,
    state: "awaiting-user-auth",
    stateNonceHash: hashStateNonce(stateNonce),
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
 * Read one session without touching it.
 *
 * Kept separate from `publicResumeInfo` because that function writes on three
 * different paths (expiry, exchange recovery, reissue). A caller that only
 * wants to look at a session must not go through it.
 */
export async function readSession(
  db: Db,
  sessionId: string,
): Promise<ConnectorSetupSessionRow> {
  const row = (await db
    .from(connectorSetupSessions)
    .where(eq("id", sessionId))
    .first()) as ConnectorSetupSessionRow | undefined;
  if (!row) throw new ConnectorSetupGateError("session-not-found");
  return row;
}

/**
 * The state a reader should be shown, derived rather than stored.
 *
 * An awaiting session past its TTL is expired in every sense a caller cares
 * about, but persisting that is a write, and reads must not write. Deriving it
 * here lets the read path report the truth while staying a pure query; the row
 * itself is flipped by the reissue path, the callback gate, or the sweep.
 */
export function effectiveState(
  row: ConnectorSetupSessionRow,
  now = new Date(),
): ConnectorSetupState {
  return row.state === "awaiting-user-auth" &&
    row.expiresAt.getTime() <= now.getTime()
    ? "expired"
    : (row.state as ConnectorSetupState);
}

/**
 * Resolve a resume capability. Awaiting sessions rotate both PKCE and state so
 * every resume issuance kills the previous authorize URL automatically.
 *
 * Writes on every path that is not an immediate return, so it may only be
 * called from a mutation.
 */
export async function publicResumeInfo(
  db: Db,
  sessionId: string,
  now = new Date(),
  reissue = true,
  recoverExchange = false,
): Promise<SessionIssuance | { session: ConnectorSetupSessionRow }> {
  let row = (await db
    .from(connectorSetupSessions)
    .where(eq("id", sessionId))
    .first()) as ConnectorSetupSessionRow | undefined;
  if (!row) throw new ConnectorSetupGateError("session-not-found");

  if (
    row.state === "awaiting-user-auth" &&
    row.expiresAt.getTime() <= now.getTime()
  ) {
    const [expired] = returnedRows(
      await db
        .from(connectorSetupSessions)
        .where([eq("id", row.id), eq("state", "awaiting-user-auth")])
        .update({ state: "expired", updatedAt: now }),
    );
    return { session: expired ?? row };
  }

  if (recoverExchange && row.state === "exchanging") {
    const isExpired = row.expiresAt.getTime() <= now.getTime();
    const [recovered] = returnedRows(
      await db
        .from(connectorSetupSessions)
        .where([eq("id", row.id), eq("state", "exchanging")])
        .update({
          state: isExpired ? "expired" : "awaiting-user-auth",
          updatedAt: now,
        }),
    );
    if (!recovered) throw new ConnectorSetupGateError("session-raced");
    row = recovered;
    if (isExpired) return { session: row };
  }

  if (row.state !== "awaiting-user-auth" || !reissue) {
    return { session: row };
  }

  const stateNonce = newStateNonce();
  const [reissued] = returnedRows(
    await db
      .from(connectorSetupSessions)
      .where([
        eq("id", row.id),
        eq("state", "awaiting-user-auth"),
        eq("stateNonceHash", row.stateNonceHash),
      ])
      .update({
        stateNonceHash: hashStateNonce(stateNonce),
        codeVerifier: newCodeVerifier(),
        failureCode: null,
        failureMessage: null,
        updatedAt: now,
      }),
  );
  if (!reissued) throw new ConnectorSetupGateError("session-raced");
  return { session: reissued, stateNonce };
}

/**
 * Apply all callback gates and consume the pending state with one conditional
 * database update. No process-local lock participates in the single-use guard.
 */
export async function consumeCallback(
  db: Db,
  state: string,
  now = new Date(),
): Promise<ConnectorSetupSessionRow> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(state)) {
    throw new ConnectorSetupGateError("state-mismatch");
  }
  // State carries only the nonce, never the session capability. Hash the
  // presented nonce and look it up through
  // connector_setup_sessions_state_nonce_hash_idx, which is UNIQUE — so this
  // resolves to at most one candidate row instead of reading the table.
  //
  // This endpoint is unauthenticated: anyone who can reach the callback URL can
  // drive it. A full scan here therefore hands out a denial-of-service lever
  // whose cost grows with the number of live setup sessions, which the same
  // caller can inflate. The index makes the work per callback independent of
  // how many sessions exist.
  //
  // The constant-time digest comparison stays, and still does the deciding: the
  // index lookup narrows to a candidate, and `matchesStateNonce` is what
  // accepts it. Only after that gate succeeds does the callback learn which
  // session exists.
  const candidate = (await db
    .from(connectorSetupSessions)
    .where(eq("stateNonceHash", hashStateNonce(state)))
    .first()) as ConnectorSetupSessionRow | undefined;
  const row =
    candidate && matchesStateNonce(state, candidate.stateNonceHash)
      ? candidate
      : undefined;
  if (!row) {
    throw new ConnectorSetupGateError("state-mismatch");
  }
  if (row.state !== "awaiting-user-auth") {
    throw new ConnectorSetupGateError("session-not-awaiting");
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    const expired = returnedRows(
      await db
        .from(connectorSetupSessions)
        .where([eq("id", row.id), eq("state", "awaiting-user-auth")])
        .update({ state: "expired", updatedAt: now }),
    );
    throw new ConnectorSetupGateError("session-expired", expired[0] ?? row);
  }

  const consumed = returnedRows(
    await db
      .from(connectorSetupSessions)
      .where([
        eq("id", row.id),
        eq("state", "awaiting-user-auth"),
        eq("stateNonceHash", row.stateNonceHash),
      ])
      .update({ state: "exchanging", updatedAt: now }),
  );
  if (consumed.length !== 1) {
    throw new ConnectorSetupGateError("session-consumed");
  }
  return consumed[0]!;
}

export async function markVerifying(
  db: Db,
  sessionId: string,
  dataSourceId: string,
  now = new Date(),
): Promise<ConnectorSetupSessionRow> {
  const rows = returnedRows(
    await db
      .from(connectorSetupSessions)
      .where([eq("id", sessionId), eq("state", "exchanging")])
      .update({ state: "verifying", dataSourceId, updatedAt: now }),
  );
  if (rows.length !== 1) throw new Error("Connector setup transition rejected");
  return rows[0]!;
}

export async function markConnected(
  db: Db,
  sessionId: string,
  dataSourceId: string,
  now = new Date(),
): Promise<ConnectorSetupSessionRow> {
  const rows = returnedRows(
    await db
      .from(connectorSetupSessions)
      .where([
        eq("id", sessionId),
        eq("state", "verifying"),
        eq("dataSourceId", dataSourceId),
      ])
      .update({
        state: "connected",
        dataSourceId,
        failureCode: null,
        failureMessage: null,
        updatedAt: now,
      }),
  );
  if (rows.length !== 1) throw new Error("Connector setup transition rejected");
  return rows[0]!;
}

export async function markFailed(
  db: Db,
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
    .where(eq("id", sessionId))
    .first()) as ConnectorSetupSessionRow | undefined;
  if (!row) throw new Error("Connector setup session not found");
  if (["connected", "failed", "expired"].includes(row.state)) return row;
  if (!allowedStates.includes(row.state as ConnectorSetupState)) return row;
  const [failed] = returnedRows(
    await db
      .from(connectorSetupSessions)
      .where([eq("id", sessionId), eq("state", row.state)])
      .update({
        state: "failed",
        dataSourceId: null,
        failureCode,
        failureMessage,
        updatedAt: now,
      }),
  );
  if (failed) return failed;
  const raced = (await db
    .from(connectorSetupSessions)
    .where(eq("id", sessionId))
    .first()) as ConnectorSetupSessionRow | undefined;
  if (!raced) throw new Error("Connector setup session not found");
  return raced;
}

async function expireAwaiting(
  db: Db,
  row: ConnectorSetupSessionRow,
  now: Date,
): Promise<boolean> {
  if (row.expiresAt.getTime() > now.getTime()) return false;
  const updated = returnedRows(
    await db
      .from(connectorSetupSessions)
      .where([eq("id", row.id), eq("state", "awaiting-user-auth")])
      .update({ state: "expired", updatedAt: now }),
  );
  return updated.length > 0;
}

async function recoverInFlight(
  db: Db,
  row: ConnectorSetupSessionRow,
  now: Date,
): Promise<"recovered" | "expired" | undefined> {
  if (row.state !== "exchanging" && row.state !== "verifying") {
    return undefined;
  }
  const isExpired = row.expiresAt.getTime() <= now.getTime();
  if (row.state === "verifying" && row.dataSourceId) {
    // Tracked read: this decides the recovery outcome, so the sweep's result
    // depends on data_sources and must invalidate when data_sources changes.
    const source = (await db
      .from(dataSources)
      .select("kind")
      .where(eq("id", row.dataSourceId))
      .first()) as { kind: string } | undefined;
    if (source?.kind === row.connectorId) {
      const connected = returnedRows(
        await db
          .from(connectorSetupSessions)
          .where([
            eq("id", row.id),
            eq("state", "verifying"),
            eq("dataSourceId", row.dataSourceId),
          ])
          .update({ state: "connected", updatedAt: now }),
      );
      if (connected.length > 0) return "recovered";
      return undefined;
    }
  }
  const updated = returnedRows(
    await db
      .from(connectorSetupSessions)
      .where([eq("id", row.id), eq("state", row.state)])
      .update({
        state: isExpired ? "expired" : "awaiting-user-auth",
        stateNonceHash: hashStateNonce(newStateNonce()),
        codeVerifier: newCodeVerifier(),
        dataSourceId: null,
        updatedAt: now,
      }),
  );
  if (updated.length === 0) return undefined;
  return isExpired ? "expired" : "recovered";
}

export async function sweep(
  db: Db,
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
    const removed = returnedRows(
      await db
        .from(connectorSetupSessions)
        .where([eq("id", id), lt("updatedAt", cutoff)])
        .delete(),
    );
    deleted += removed.length;
  }
  return { recovered, expired, deleted };
}
