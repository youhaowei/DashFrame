import { execFile } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vite-plus/test";
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
  claims: Record<string, string>,
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
    // oxlint-disable-next-line preserve-caught-error -- the original error carries the admin key and instance secret that the message above redacts
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
  "verifies signed admission authority and atomically allocates a workspace that survives restart",
  { skip: process.env.DASHFRAME_CONVEX_INTEGRATION !== "1", timeout: 180_000 },
  async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "dashframe-admission-runtime-"),
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
      const local = token(runtimeKeys, {
        sub: "user:local",
        principalKind: "user",
        userId: "local",
        workspaceId: "local",
      });
      expect((await call(backend.url, "app:listDataSources", local)).ok).toBe(
        true,
      );
      await configureHosted(backend, directory, runtimeKeys, operatorKeys);
      const hostClaims = {
        sub: "user:user_a",
        userId: "user_a",
        authority: "host",
      };
      const host = token(runtimeKeys, hostClaims);
      const operatorClaims = {
        iss: operatorIssuer,
        aud: "dashframe-operator",
        sub: "operator:test",
        authority: "operator",
      };
      const operator = token(operatorKeys, operatorClaims);
      const subject = { subject: "user_a" };
      const invoke = (
        operation: string,
        bearer: string,
        args: Record<string, unknown> = {},
        type = "query",
      ) => call(backend!.url, operation, bearer, args, type);

      expect(
        (await invoke("admission:resolve", host, {}, "mutation")).value,
      ).toEqual({ status: "pending", workspaceId: null });
      expect(
        (await invoke("admission:status", token(wrongKeys, hostClaims))).ok,
      ).toBe(false);
      expect(
        (
          await invoke(
            "admission:status",
            token(runtimeKeys, { ...hostClaims, aud: "wrong" }),
          )
        ).ok,
      ).toBe(false);
      expect(
        (
          await invoke(
            "admission:status",
            token(runtimeKeys, { ...hostClaims, iss: `${runtimeIssuer}/` }),
          )
        ).ok,
      ).toBe(false);
      expect(
        (await invoke("admission:grant", host, subject, "mutation")).ok,
      ).toBe(false);
      expect(
        (
          await invoke(
            "admission:grant",
            token(runtimeKeys, operatorClaims),
            subject,
            "mutation",
          )
        ).ok,
      ).toBe(false);
      expect(
        (await invoke("admission:grant", operator, subject, "mutation")).ok,
      ).toBe(true);

      for (const sub of [
        "user:test",
        "service:test",
        "operator:",
        "operator: ",
        "operator:test user",
        "operator:test\n",
        "operator:\u0000test",
        "operator:test\u007f",
        "operator:test\u0080",
        "operator:test\u009f",
      ]) {
        const invalidOperator = token(operatorKeys, { ...operatorClaims, sub });
        expect(
          (
            await invoke(
              "admission:grant",
              invalidOperator,
              { subject: "other" },
              "mutation",
            )
          ).ok,
          `grant rejects ${JSON.stringify(sub)}`,
        ).toBe(false);
        expect(
          (
            await invoke(
              "admission:revoke",
              invalidOperator,
              subject,
              "mutation",
            )
          ).ok,
          `revoke rejects ${JSON.stringify(sub)}`,
        ).toBe(false);
      }

      // These are concurrent HTTP mutations against the actual native database,
      // exercising OCC; convex-test identities alone do not prove this behavior.
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          invoke("admission:resolve", host, {}, "mutation"),
        ),
      );
      const first = results[0]!;
      expect(first).toMatchObject({
        ok: true,
        value: { status: "admitted", workspaceId: expect.any(String) },
      });
      for (const result of results) expect(result).toEqual(first);
      const { workspaceId } = first.value as { workspaceId: string };
      const browser = token(runtimeKeys, {
        ...hostClaims,
        authority: "browser",
        principalKind: "user",
        workspaceId,
      });
      expect((await invoke("app:listDataSources", browser)).ok).toBe(true);
      expect(
        (await invoke("admission:revoke", operator, subject, "mutation")).ok,
      ).toBe(true);
      expect((await invoke("app:listDataSources", browser)).ok).toBe(false);
      expect(
        (await invoke("admission:grant", operator, subject, "mutation")).ok,
      ).toBe(true);
      await backend.stop();
      backend = undefined;
      backend = await startLocalConvex(options);
      await configureHosted(backend, directory, runtimeKeys, operatorKeys);
      expect(await invoke("admission:resolve", host, {}, "mutation")).toEqual(
        first,
      );
    } finally {
      await backend?.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
