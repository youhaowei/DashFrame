import { createHash, randomBytes, randomUUID } from "node:crypto";

export const CONNECTOR_SETUP_TTL_MS = 15 * 60 * 1000;
export const CONNECTOR_SETUP_TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
export const CONNECTOR_SETUP_INFLIGHT_GRACE_MS = 2 * 60 * 1000;

export type ConnectorSetupState =
  | "awaiting-user-auth"
  | "exchanging"
  | "verifying"
  | "connected"
  | "failed"
  | "expired";
export interface ConnectorSetupSessionRow {
  id: string;
  connectorId: string;
  requestedName: string;
  state: ConnectorSetupState;
  stateNonceHash: string;
  codeVerifier: string;
  scopes: string[];
  dataSourceId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}
export type SessionExpected = Partial<
  Pick<
    ConnectorSetupSessionRow,
    "state" | "stateNonceHash" | "dataSourceId" | "updatedAt"
  >
>;
export type SessionPatch = Partial<
  Pick<
    ConnectorSetupSessionRow,
    | "state"
    | "stateNonceHash"
    | "codeVerifier"
    | "dataSourceId"
    | "failureCode"
    | "failureMessage"
    | "updatedAt"
  >
>;
/** Each write maps to one native Convex mutation; CAS is never a host-local lock. */
export interface ConnectorSetupStore {
  get(id: string): Promise<ConnectorSetupSessionRow | null>;
  findByNonce(stateNonceHash: string): Promise<ConnectorSetupSessionRow | null>;
  insert(row: ConnectorSetupSessionRow): Promise<void>;
  compareAndSwap(
    id: string,
    expected: SessionExpected,
    patch: SessionPatch,
  ): Promise<ConnectorSetupSessionRow | null>;
  list(cursor: string | null): Promise<{
    page: ConnectorSetupSessionRow[];
    continueCursor: string;
    isDone: boolean;
  }>;
  delete(id: string, updatedBefore: number): Promise<boolean>;
  getDataSourceKind(id: string): Promise<string | null>;
}
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
export function oauthStateFor(stateNonce: string): string {
  return stateNonce;
}

export async function startSession(
  db: ConnectorSetupStore,
  input: StartSessionInput,
): Promise<SessionIssuance> {
  const now = (input.now ?? new Date()).getTime();
  const stateNonce = newStateNonce();
  const session: ConnectorSetupSessionRow = {
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
    expiresAt: now + CONNECTOR_SETUP_TTL_MS,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(session);
  return { session, stateNonce };
}
export async function readSession(
  db: ConnectorSetupStore,
  id: string,
): Promise<ConnectorSetupSessionRow> {
  const row = await db.get(id);
  if (!row) throw new ConnectorSetupGateError("session-not-found");
  return row;
}
export function effectiveState(
  row: ConnectorSetupSessionRow,
  now = new Date(),
): ConnectorSetupState {
  return row.state === "awaiting-user-auth" && row.expiresAt <= now.getTime()
    ? "expired"
    : row.state;
}
export async function publicResumeInfo(
  db: ConnectorSetupStore,
  id: string,
  now = new Date(),
  reissue = true,
  recoverExchange = false,
): Promise<SessionIssuance | { session: ConnectorSetupSessionRow }> {
  let row = await readSession(db, id);
  if (row.state === "awaiting-user-auth" && row.expiresAt <= now.getTime()) {
    return {
      session:
        (await db.compareAndSwap(
          id,
          { state: row.state, stateNonceHash: row.stateNonceHash },
          { state: "expired", updatedAt: now.getTime() },
        )) ?? (await readSession(db, id)),
    };
  }
  if (recoverExchange && row.state === "exchanging") {
    const state =
      row.expiresAt <= now.getTime() ? "expired" : "awaiting-user-auth";
    const recovered = await db.compareAndSwap(
      id,
      { state: row.state, stateNonceHash: row.stateNonceHash },
      { state, updatedAt: now.getTime() },
    );
    if (!recovered) throw new ConnectorSetupGateError("session-raced");
    row = recovered;
    if (state === "expired") return { session: row };
  }
  if (row.state !== "awaiting-user-auth" || !reissue) return { session: row };
  const stateNonce = newStateNonce();
  const session = await db.compareAndSwap(
    id,
    { state: row.state, stateNonceHash: row.stateNonceHash },
    {
      stateNonceHash: hashStateNonce(stateNonce),
      codeVerifier: newCodeVerifier(),
      failureCode: null,
      failureMessage: null,
      updatedAt: now.getTime(),
    },
  );
  if (!session) throw new ConnectorSetupGateError("session-raced");
  return { session, stateNonce };
}
/** Indexed nonce lookup followed by an atomic compare-and-swap consumes a callback once. */
export async function consumeCallback(
  db: ConnectorSetupStore,
  state: string,
  now = new Date(),
): Promise<ConnectorSetupSessionRow> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(state))
    throw new ConnectorSetupGateError("state-mismatch");
  const row = await db.findByNonce(hashStateNonce(state));
  if (!row) throw new ConnectorSetupGateError("state-mismatch");
  if (row.state !== "awaiting-user-auth")
    throw new ConnectorSetupGateError("session-not-awaiting");
  const expected = { state: row.state, stateNonceHash: row.stateNonceHash };
  if (row.expiresAt <= now.getTime()) {
    const expired = await db.compareAndSwap(row.id, expected, {
      state: "expired",
      updatedAt: now.getTime(),
    });
    throw new ConnectorSetupGateError("session-expired", expired ?? row);
  }
  const consumed = await db.compareAndSwap(row.id, expected, {
    state: "exchanging",
    updatedAt: now.getTime(),
  });
  if (!consumed) throw new ConnectorSetupGateError("session-consumed");
  return consumed;
}
export async function markVerifying(
  db: ConnectorSetupStore,
  id: string,
  dataSourceId: string,
  now = new Date(),
  stateNonceHash?: string,
): Promise<ConnectorSetupSessionRow> {
  const row = await db.compareAndSwap(
    id,
    { state: "exchanging", ...(stateNonceHash ? { stateNonceHash } : {}) },
    { state: "verifying", dataSourceId, updatedAt: now.getTime() },
  );
  if (!row) throw new ConnectorSetupGateError("session-raced");
  return row;
}
export async function markConnected(
  db: ConnectorSetupStore,
  id: string,
  dataSourceId: string,
  now = new Date(),
  stateNonceHash?: string,
): Promise<ConnectorSetupSessionRow> {
  const row = await db.compareAndSwap(
    id,
    {
      state: "verifying",
      dataSourceId,
      ...(stateNonceHash ? { stateNonceHash } : {}),
    },
    {
      state: "connected",
      dataSourceId,
      failureCode: null,
      failureMessage: null,
      updatedAt: now.getTime(),
    },
  );
  if (!row) throw new ConnectorSetupGateError("session-raced");
  return row;
}
export async function markFailed(
  db: ConnectorSetupStore,
  id: string,
  failureCode: string,
  failureMessage: string,
  now = new Date(),
  allowedStates: ConnectorSetupState[] = [
    "awaiting-user-auth",
    "exchanging",
    "verifying",
  ],
  stateNonceHash?: string,
): Promise<ConnectorSetupSessionRow> {
  const row = await readSession(db, id);
  if (
    !allowedStates.includes(row.state) ||
    (stateNonceHash && stateNonceHash !== row.stateNonceHash)
  )
    return row;
  return (
    (await db.compareAndSwap(
      id,
      { state: row.state, stateNonceHash: row.stateNonceHash },
      {
        state: "failed",
        failureCode,
        failureMessage,
        updatedAt: now.getTime(),
      },
    )) ?? (await readSession(db, id))
  );
}
async function recover(
  db: ConnectorSetupStore,
  row: ConnectorSetupSessionRow,
  now: number,
  graceMs: number,
): Promise<"recovered" | "expired" | null> {
  if (row.state === "awaiting-user-auth") {
    if (row.expiresAt > now) return null;
    return (await db.compareAndSwap(
      row.id,
      { state: row.state, stateNonceHash: row.stateNonceHash },
      { state: "expired", updatedAt: now },
    ))
      ? "expired"
      : null;
  }
  if (
    (row.state !== "exchanging" && row.state !== "verifying") ||
    now - row.updatedAt < graceMs
  )
    return null;
  const expected = {
    state: row.state,
    stateNonceHash: row.stateNonceHash,
    updatedAt: row.updatedAt,
  };
  if (
    row.state === "verifying" &&
    row.dataSourceId &&
    (await db.getDataSourceKind(row.dataSourceId)) === row.connectorId
  ) {
    return (await db.compareAndSwap(
      row.id,
      { ...expected, dataSourceId: row.dataSourceId },
      { state: "connected", updatedAt: now },
    ))
      ? "recovered"
      : null;
  }
  const state = row.expiresAt <= now ? "expired" : "awaiting-user-auth";
  const updated = await db.compareAndSwap(row.id, expected, {
    state,
    stateNonceHash: hashStateNonce(newStateNonce()),
    codeVerifier: newCodeVerifier(),
    dataSourceId: null,
    updatedAt: now,
  });
  if (!updated) return null;
  return state === "expired" ? "expired" : "recovered";
}
/** Boot alone may pass graceMs=0: no callback handler may be running then. */
export async function sweep(
  db: ConnectorSetupStore,
  now = new Date(),
  graceMs = CONNECTOR_SETUP_INFLIGHT_GRACE_MS,
): Promise<{ recovered: number; expired: number; deleted: number }> {
  const result = { recovered: 0, expired: 0, deleted: 0 };
  let cursor: string | null = null;
  for (;;) {
    const page = await db.list(cursor);
    for (const row of page.page) {
      const outcome = await recover(db, row, now.getTime(), graceMs);
      if (outcome) result[outcome]++;
      if (
        ["connected", "failed", "expired"].includes(row.state) &&
        (await db.delete(
          row.id,
          now.getTime() - CONNECTOR_SETUP_TERMINAL_RETENTION_MS,
        ))
      )
        result.deleted++;
    }
    if (page.isDone) return result;
    cursor = page.continueCursor;
  }
}
