import { execFile } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vite-plus/test";
import { internal } from "../../convex-backend/convex/_generated/api";
import { createHostedCredentialOwnership } from "../../../apps/server/src/host/hosted-credential-ownership";
import { startLocalConvex, type LocalConvex } from "./runtime.js";

const runtimeIssuer = "https://runtime.admission-test.invalid";
const operatorIssuer = "https://operator.admission-test.invalid";
const functionsDirectory = fileURLToPath(
  new URL("../../convex-backend/", import.meta.url),
);

function keySet(kid: string) {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKey = {
    ...pair.publicKey.export({ format: "jwk" }),
    kid,
    alg: "RS256",
    use: "sig",
  };
  return {
    privateKey: pair.privateKey,
    kid,
    jwks: `data:application/json;base64,${Buffer.from(JSON.stringify({ keys: [publicKey] })).toString("base64")}`,
  };
}

function token(
  keys: ReturnType<typeof keySet>,
  claims: Record<string, string | number>,
) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ typ: "JWT", alg: "RS256", kid: keys.kid })}.${encode({ iss: runtimeIssuer, aud: "dashframe", iat: now, exp: now + 300, ...claims })}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), keys.privateKey).toString("base64url")}`;
}

async function call(
  url: string,
  operation: string,
  bearer: string,
  args: Record<string, unknown> = {},
  type = "query",
) {
  const response = await fetch(`${url}/api/${type}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ path: operation, args: [args], format: "json" }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = (await response.json()) as { status: string; value?: unknown };
  return {
    ok: response.ok && result.status === "success",
    value: result.value,
  };
}

/** Test-only deployment authority for this owned temporary loopback backend. */
async function configureHosted(
  backend: LocalConvex,
  directory: string,
  runtimeKeys: ReturnType<typeof keySet>,
  operatorKeys: ReturnType<typeof keySet>,
) {
  expect(new URL(backend.url).hostname).toBe("127.0.0.1");
  const config = JSON.parse(
    await readFile(path.join(directory, ".convex/config.json"), "utf8"),
  ) as { adminKey: string; instanceSecret: string };
  const changes = {
    DASHFRAME_DEPLOYMENT_MODE: "hosted",
    DASHFRAME_AUTH_ISSUER: runtimeIssuer,
    DASHFRAME_AUTH_JWKS: runtimeKeys.jwks,
    DASHFRAME_OPERATOR_AUTH_ISSUER: operatorIssuer,
    DASHFRAME_OPERATOR_AUTH_JWKS: operatorKeys.jwks,
  };
  const response = await fetch(
    `${backend.url}/api/update_environment_variables`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Convex ${config.adminKey}`,
      },
      body: JSON.stringify({
        changes: Object.entries(changes).map(([name, value]) => ({
          name,
          value,
        })),
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  await response.body?.cancel();
  expect(response.ok).toBe(true);
  const envFile = path.join(directory, "test-deploy.env");
  await writeFile(
    envFile,
    `CONVEX_SELF_HOSTED_URL=${backend.url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${config.adminKey}\n`,
    { mode: 0o600 },
  );
  // An explicit env file and cleared inherited selectors prevent Cloud access.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    SENTRY_DSN: "",
  };
  for (const name of Object.keys(env))
    if (name.startsWith("CONVEX_")) delete env[name];
  env.CONVEX_AGENT_MODE = "anonymous";
  env.CONVEX_DISABLE_TELEMETRY = "1";
  const require = createRequire(import.meta.url);
  const cli = path.join(
    path.dirname(require.resolve("convex/package.json")),
    "bin/main.js",
  );
  try {
    await promisify(execFile)(
      process.execPath,
      [
        cli,
        "deploy",
        "--env-file",
        envFile,
        "--typecheck",
        "disable",
        "--codegen",
        "disable",
      ],
      { cwd: functionsDirectory, env, timeout: 120_000 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Disposable deployment failed";
    throw new Error(
      message
        .replaceAll(config.adminKey, "[redacted]")
        .replaceAll(config.instanceSecret, "[redacted]"),
    );
  } finally {
    await rm(envFile, { force: true });
  }
}

it(
  "persists signed credential ownership across restart and rejects replay, rebind, and revoked assertions",
  { skip: process.env.DASHFRAME_CONVEX_INTEGRATION !== "1", timeout: 180_000 },
  async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "dashframe-credentials-runtime-"),
    );
    const runtimeKeys = keySet("runtime-test");
    const operatorKeys = keySet("operator-test");
    const wrongKeys = keySet("runtime-test");
    const options = {
      projectDir: directory,
      functionsDirectory,
      auth: {
        issuer: runtimeIssuer,
        jwksDataUri: runtimeKeys.jwks,
        audience: "dashframe" as const,
      },
    };
    let backend: LocalConvex | undefined;
    try {
      backend = await startLocalConvex(options);
      await configureHosted(backend, directory, runtimeKeys, operatorKeys);
      const operator = token(operatorKeys, {
        iss: operatorIssuer,
        aud: "dashframe-operator",
        sub: "operator:test",
        authority: "operator",
      });
      const invoke = (
        operation: string,
        bearer: string,
        args: Record<string, unknown> = {},
        type = "query",
      ) => call(backend!.url, operation, bearer, args, type);
      async function admit(userId: string) {
        expect(
          (
            await invoke(
              "admission:grant",
              operator,
              { subject: userId },
              "mutation",
            )
          ).ok,
        ).toBe(true);
        const result = await invoke(
          "admission:resolve",
          token(runtimeKeys, {
            sub: `user:${userId}`,
            userId,
            authority: "host",
          }),
          {},
          "mutation",
        );
        expect(result).toMatchObject({
          ok: true,
          value: { workspaceId: expect.any(String) },
        });
        return (result.value as { workspaceId: string }).workspaceId;
      }
      const a = await admit("a");
      const b = await admit("b");
      expect(a).not.toBe(b);
      const claims = (userId: string, workspaceId: string) => ({
        sub: `user:${userId}`,
        userId,
        workspaceId,
        authority: "host",
        purpose: "host-credentials",
        principalKind: "user",
      });
      // The actual adapter creates independent HTTP clients and invokes the
      // deployed functions; named ownership is never seeded with admin authority.
      const adapter = (userId: string, workspaceId: string) =>
        createHostedCredentialOwnership({
          deploymentUrl: backend!.url,
          allowInsecureLoopbackForTests: true,
          getToken: async () => token(runtimeKeys, claims(userId, workspaceId)),
        });
      const ownerA = adapter("a", a);
      const ownerB = adapter("b", b);
      const credentialId = randomUUID();
      const serviceClaims = {
        sub: `service:${credentialId}`,
        principalKind: "service",
        credentialId,
        authority: "service",
        workspaceId: a,
      };
      const existingService = token(runtimeKeys, serviceClaims);
      expect((await invoke("app:listDataSources", existingService)).ok).toBe(
        false,
      );
      const binding = { credentialId, subject: "a", workspaceId: a };
      expect(await ownerA.register(credentialId)).toEqual(binding);
      expect(await ownerA.register(credentialId)).toEqual(binding);
      expect((await invoke("app:listDataSources", existingService)).ok).toBe(
        true,
      );
      expect(
        (
          await invoke(
            "app:listDataSources",
            token(runtimeKeys, { ...serviceClaims, workspaceId: b }),
          )
        ).ok,
      ).toBe(false);
      await expect(ownerB.register(credentialId)).rejects.toThrow();
      await expect(ownerB.revoke(credentialId)).rejects.toThrow();

      for (const bearer of [
        operator,
        existingService,
        token(runtimeKeys, { ...claims("a", a), authority: "browser" }),
        token(runtimeKeys, { ...claims("a", a), principalKind: "service" }),
        token(runtimeKeys, { ...claims("a", a), purpose: "host-metadata" }),
        token(runtimeKeys, { sub: "user:a", userId: "a", authority: "host" }),
        token(runtimeKeys, claims("a", b)),
        token(wrongKeys, claims("a", a)),
        token(runtimeKeys, { ...claims("a", a), aud: "wrong" }),
        token(runtimeKeys, { ...claims("a", a), exp: 1 }),
      ]) {
        expect(
          (
            await invoke(
              "hostedCredentials:register",
              bearer,
              { credentialId },
              "mutation",
            )
          ).ok,
        ).toBe(false);
        expect(
          (
            await invoke(
              "hostedCredentials:revoke",
              bearer,
              { credentialId },
              "mutation",
            )
          ).ok,
        ).toBe(false);
      }
      expect(
        (
          await invoke(
            "hostedCredentials:register",
            token(runtimeKeys, claims("a", a)),
            { credentialId: randomUUID(), workspaceId: b, subject: "b" },
            "mutation",
          )
        ).ok,
      ).toBe(false);

      // Simulate the historical local-host path which could revoke an ID before
      // credentialOwners existed. Its tombstone must block both A and B.
      const historicalId = randomUUID();
      await backend.internalClient.mutation(internal.host.revokeCredential, {
        workspaceId: a,
        credentialId: historicalId,
      });
      await expect(ownerA.register(historicalId)).rejects.toThrow();
      await expect(ownerB.register(historicalId)).rejects.toThrow();

      // Native transactional OCC must select exactly one global owner.
      const racedId = randomUUID();
      const raced = await Promise.allSettled([
        ownerA.register(racedId),
        ownerB.register(racedId),
      ]);
      expect(
        raced.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        raced.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const winner = raced[0]!.status === "fulfilled" ? ownerA : ownerB;
      const retries = await Promise.all([
        winner.register(racedId),
        winner.register(racedId),
        winner.register(racedId),
      ]);
      expect(retries[0]).toEqual(retries[1]);
      expect(retries[1]).toEqual(retries[2]);

      await backend.stop();
      backend = undefined;
      backend = await startLocalConvex(options);
      await configureHosted(backend, directory, runtimeKeys, operatorKeys);
      expect(await adapter("a", a).register(credentialId)).toEqual(binding);
      await expect(adapter("b", b).register(credentialId)).rejects.toThrow();
      expect((await invoke("app:listDataSources", existingService)).ok).toBe(
        true,
      );
      await adapter("a", a).revoke(credentialId);
      await adapter("a", a).revoke(credentialId);
      expect((await invoke("app:listDataSources", existingService)).ok).toBe(
        false,
      );
      await expect(adapter("a", a).register(credentialId)).rejects.toThrow();
      expect(
        (
          await invoke(
            "admission:revoke",
            operator,
            { subject: "a" },
            "mutation",
          )
        ).ok,
      ).toBe(true);
      await expect(adapter("a", a).register(randomUUID())).rejects.toThrow();
      await expect(adapter("b", b).register(credentialId)).rejects.toThrow();
      expect(
        (
          await invoke(
            "admission:grant",
            operator,
            { subject: "a" },
            "mutation",
          )
        ).ok,
      ).toBe(true);

      await backend.stop();
      backend = undefined;
      backend = await startLocalConvex(options);
      await configureHosted(backend, directory, runtimeKeys, operatorKeys);
      expect((await invoke("app:listDataSources", existingService)).ok).toBe(
        false,
      );
      await expect(adapter("a", a).register(credentialId)).rejects.toThrow();
    } finally {
      await backend?.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
