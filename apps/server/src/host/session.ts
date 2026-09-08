/**
 * Signed browser session cookies for the hosted surface.
 *
 * Desktop and loopback web authenticate with a bearer token the host handed to
 * the renderer over IPC. A browser on a public origin has no such channel, so
 * it carries a cookie instead. The cookie is a signed statement of *who* the
 * request is, and nothing else: no server-side session table, no lookup, no
 * shared mutable state to keep consistent across restarts.
 *
 * Deliberately parameterised by `subject` rather than hard-wired to one
 * identity. The identity/tenancy model for the hosted deployment is still being
 * decided; whatever it resolves to, it resolves to a subject string, and this
 * module does not need to change when it does.
 *
 * Threat model, stated plainly:
 *   - The cookie is HttpOnly, so script on the page cannot read it.
 *   - It is stateless, so signing out clears the browser's copy but cannot
 *     invalidate a copy an attacker already exfiltrated. That copy stays valid
 *     until `expiresAt`. Rotating the signing key invalidates every outstanding
 *     session at once, and is the remediation for a suspected theft.
 *   - It is not a CSRF defence on its own. `SameSite=Lax` withholds it from
 *     cross-site POSTs, and the host separately rejects requests carrying a
 *     disallowed `Origin`. Both are required; neither is sufficient.
 */
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  type BinaryLike,
} from "node:crypto";
import { chmod, link, mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

/** Version tag. Bumping it invalidates every cookie signed by an older format. */
const FORMAT = "v1";
export const SESSION_COOKIE_NAME = "dashframe_session";
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 32 bytes of key material, matching the HMAC-SHA256 block security level. */
const SESSION_KEY_BYTES = 32;

export interface SessionClaims {
  /** Opaque identity the cookie asserts. */
  subject: string;
  /** Epoch milliseconds. */
  issuedAt: number;
  /** Epoch milliseconds; the cookie is worthless at or after this instant. */
  expiresAt: number;
}

function base64url(value: Buffer): string {
  return value.toString("base64url");
}

function sign(secret: BinaryLike, payload: string): string {
  return base64url(createHmac("sha256", secret).update(payload).digest());
}

/**
 * Compare two signatures without leaking their difference through timing.
 *
 * `timingSafeEqual` throws on a length mismatch, which is itself an oracle for
 * the signature *length* — harmless here, since the length is a constant of the
 * format, but the guard keeps a malformed cookie from throwing out of the
 * verifier instead of returning "invalid".
 */
function signatureMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Produce the cookie value asserting `claims`. */
export function signSession(secret: BinaryLike, claims: SessionClaims): string {
  const payload = base64url(Buffer.from(JSON.stringify(claims), "utf8"));
  const body = `${FORMAT}.${payload}`;
  return `${body}.${sign(secret, body)}`;
}

/**
 * Return the claims a cookie value carries, or `undefined` for anything that is
 * not a currently-valid cookie signed by this key.
 *
 * Every rejection path returns `undefined` rather than throwing or
 * distinguishing itself: a caller cannot accidentally treat "expired" as a
 * different, softer outcome than "forged".
 */
export function verifySession(
  secret: BinaryLike,
  value: string | undefined,
  now: number,
): SessionClaims | undefined {
  if (!value) return undefined;
  const parts = value.split(".");
  if (parts.length !== 3) return undefined;
  const [format, payload, signature] = parts as [string, string, string];
  if (format !== FORMAT) return undefined;
  if (!signatureMatches(sign(secret, `${format}.${payload}`), signature))
    return undefined;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!claims || typeof claims !== "object") return undefined;
  const { subject, issuedAt, expiresAt } = claims as Partial<SessionClaims>;
  if (typeof subject !== "string" || !subject) return undefined;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt))
    return undefined;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt))
    return undefined;
  if (now >= expiresAt) return undefined;
  return { subject, issuedAt, expiresAt };
}

export interface CookieAttributes {
  /** Send only over TLS. False is for loopback development only. */
  secure: boolean;
  maxAgeSeconds?: number;
  path?: string;
}

/**
 * Serialize a `Set-Cookie` value.
 *
 * `SameSite=Lax` rather than `Strict` on purpose: the app is reached by
 * top-level navigation (including the return leg of a connector OAuth flow),
 * and `Strict` would drop the cookie on arrival and bounce the user to a login
 * screen they had already passed. Lax still withholds the cookie from
 * cross-site POST, which is the case CSRF actually needs.
 */
export function serializeSessionCookie(
  name: string,
  value: string,
  attributes: CookieAttributes,
): string {
  const parts = [
    `${name}=${value}`,
    `Path=${attributes.path ?? "/"}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (attributes.secure) parts.push("Secure");
  if (attributes.maxAgeSeconds !== undefined)
    parts.push(`Max-Age=${Math.max(0, Math.floor(attributes.maxAgeSeconds))}`);
  return parts.join("; ");
}

/** The `Set-Cookie` value that removes a session cookie from the browser. */
export function clearedSessionCookie(
  name: string,
  attributes: CookieAttributes,
): string {
  return `${serializeSessionCookie(name, "", { ...attributes, maxAgeSeconds: 0 })}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/**
 * Read one cookie out of a `Cookie` header.
 *
 * Returns the FIRST match. A request can legitimately carry two cookies of the
 * same name (different Domain or Path scopes) and browsers do not tell the
 * server which is which; taking the first is what every cookie parser does, and
 * a forged duplicate still has to survive signature verification.
 */
export function readCookie(
  header: string | undefined | null,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    if (pair.slice(0, index).trim() !== name) continue;
    return pair.slice(index + 1).trim();
  }
  return undefined;
}

/**
 * Load the session signing key, generating and persisting one on first use.
 *
 * Durability is the point. The key lives beside the host's other local state,
 * which on a hosted deployment is an attached volume, so a redeploy does not
 * silently sign every user out. A key supplied through the environment wins, so
 * an operator who wants to rotate — or to hold the key outside the volume — can.
 *
 * Written privately with mode 0600, then published with an exclusive hard link.
 * Concurrent starts can only read a complete key; the loser uses the winner's
 * published key rather than replacing it.
 */
export async function loadOrCreateSessionKey(
  dataDir: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Buffer> {
  const configured = environment.DASHFRAME_SESSION_KEY?.trim();
  if (configured) {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.length !== SESSION_KEY_BYTES) {
      throw new Error(
        `DASHFRAME_SESSION_KEY must be base64 of ${SESSION_KEY_BYTES} bytes`,
      );
    }
    return decoded;
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(dataDir, "session.key");
  const readExisting = async () => {
    const existing = await readFile(keyPath);
    if (existing.length === SESSION_KEY_BYTES) {
      await chmod(keyPath, 0o600);
      return existing;
    }
    throw new Error(
      `Session key at ${keyPath} is not ${SESSION_KEY_BYTES} bytes. Remove it to regenerate; every signed-in browser will be signed out.`,
    );
  };
  try {
    return await readExisting();
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const generated = randomBytes(SESSION_KEY_BYTES);
  const temporary = `${keyPath}.${randomBytes(16).toString("hex")}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(generated);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, keyPath);
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
    }
    return await readExisting();
  } finally {
    await rm(temporary, { force: true });
  }
}
