import { isPrincipal, type Principal } from "@wystack/identity";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

const AUDIENCE = "dashframe";
const TOKEN_LIFETIME_SECONDS = 60;

/** Host-only JWT issuer. Convex receives the public key; renderers receive short-lived JWTs. */
export async function createConvexIdentity(
  directory: string,
  workspaceId: string,
) {
  if (!workspaceId)
    throw new Error("A workspace is required for Convex identity");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const keyPath = path.join(directory, "convex-identity.pem");
  let privatePem: string;
  try {
    privatePem = await readFile(keyPath, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const generated = pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const temporary = path.join(directory, `.identity.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(generated);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, keyPath);
      if (process.platform !== "win32") {
        const directoryHandle = await open(directory, "r");
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      }
    } catch (writeError) {
      if (
        !(
          writeError instanceof Error &&
          "code" in writeError &&
          writeError.code === "EEXIST"
        )
      )
        throw writeError;
    } finally {
      await rm(temporary, { force: true });
    }
    privatePem = await readFile(keyPath, "utf8");
  }
  const privateKey = createPrivateKey(privatePem);
  const publicKey = createPublicKey(privateKey);
  const kid = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("base64url");
  const issuer = `https://dashframe.local/workspaces/${encodeURIComponent(workspaceId)}`;
  const jwks = {
    keys: [
      { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" },
    ],
  };
  const jwksDataUri = `data:application/json;base64,${Buffer.from(JSON.stringify(jwks)).toString("base64")}`;
  return {
    issuer,
    audience: AUDIENCE as "dashframe",
    jwksDataUri,
    issue(principal: Principal, now = Date.now()) {
      if (!isPrincipal(principal))
        throw new Error("A verified host principal is required");
      const issuedAt = Math.floor(now / 1000);
      const subject =
        principal.kind === "user"
          ? `user:${principal.userId}`
          : `service:${principal.credentialId}`;
      const header = Buffer.from(
        JSON.stringify({ alg: "RS256", typ: "JWT", kid }),
      ).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          iss: issuer,
          aud: AUDIENCE,
          sub: subject,
          iat: issuedAt,
          exp: issuedAt + TOKEN_LIFETIME_SECONDS,
          workspaceId,
          principalKind: principal.kind,
          ...(principal.kind === "service"
            ? { credentialId: principal.credentialId }
            : { userId: principal.userId }),
        }),
      ).toString("base64url");
      const input = `${header}.${payload}`;
      return {
        token: `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`,
        expiresAt: (issuedAt + TOKEN_LIFETIME_SECONDS) * 1000,
      };
    },
  };
}

export type ConvexIdentity = Awaited<ReturnType<typeof createConvexIdentity>>;
