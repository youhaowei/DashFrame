import { execFile } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vite-plus/test";
import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "@dashframe/convex-backend/api";
import { startLocalConvex, type LocalConvex } from "@dashframe/convex-local";
import { cmd } from "@dashframe/types";
import { createHostedMetadata } from "./hosted-convex-metadata";

const runtimeIssuer = "https://runtime.metadata-test.invalid";
const operatorIssuer = "https://operator.metadata-test.invalid";
const functionsDirectory = fileURLToPath(
  new URL("../../../../packages/convex-backend/", import.meta.url),
);
function keys(kid: string) {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey,
    kid,
    jwks: `data:application/json;base64,${Buffer.from(JSON.stringify({ keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] })).toString("base64")}`,
  };
}
// Synthetic signer for this test only; production signing remains injected.
function token(key: ReturnType<typeof keys>, claims: Record<string, string>) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ typ: "JWT", alg: "RS256", kid: key.kid })}.${encode({ iss: runtimeIssuer, aud: "dashframe", iat: now, exp: now + 300, ...claims })}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), key.privateKey).toString("base64url")}`;
}

/** Test-only deployment/fixture authority, restricted to this owned loopback backend. */
async function localFixtureCli(
  backend: LocalConvex,
  directory: string,
  args: string[],
) {
  expect(new URL(backend.url).hostname).toBe("127.0.0.1");
  const config = JSON.parse(
    await readFile(path.join(directory, ".convex/config.json"), "utf8"),
  ) as { adminKey: string; instanceSecret: string };
  const envFile = path.join(directory, "test-deploy.env");
  await writeFile(
    envFile,
    `CONVEX_SELF_HOSTED_URL=${backend.url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${config.adminKey}\n`,
    { mode: 0o600 },
  );
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
      [cli, ...args, "--env-file", envFile],
      { cwd: functionsDirectory, env, timeout: 120_000 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Disposable fixture command failed";
    throw new Error(
      message
        .replaceAll(config.adminKey, "[redacted]")
        .replaceAll(config.instanceSecret, "[redacted]"),
    );
  } finally {
    await rm(envFile, { force: true });
  }
}
async function configureHosted(
  backend: LocalConvex,
  directory: string,
  runtime: ReturnType<typeof keys>,
  operator: ReturnType<typeof keys>,
) {
  expect(new URL(backend.url).hostname).toBe("127.0.0.1");
  const config = JSON.parse(
    await readFile(path.join(directory, ".convex/config.json"), "utf8"),
  ) as { adminKey: string };
  const changes = {
    DASHFRAME_DEPLOYMENT_MODE: "hosted",
    DASHFRAME_AUTH_ISSUER: runtimeIssuer,
    DASHFRAME_AUTH_JWKS: runtime.jwks,
    DASHFRAME_OPERATOR_AUTH_ISSUER: operatorIssuer,
    DASHFRAME_OPERATOR_AUTH_JWKS: operator.jwks,
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
  await localFixtureCli(backend, directory, [
    "deploy",
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
  ]);
}

it(
  "enforces signed host-metadata assertions and live tenant/credential revocation through the real Bearer adapter",
  { skip: process.env.DASHFRAME_CONVEX_INTEGRATION !== "1", timeout: 180_000 },
  async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "dashframe-hosted-metadata-runtime-"),
    );
    const runtime = keys("runtime"),
      operator = keys("operator");
    let backend: LocalConvex | undefined;
    try {
      backend = await startLocalConvex({
        projectDir: directory,
        functionsDirectory,
        auth: {
          issuer: runtimeIssuer,
          jwksDataUri: runtime.jwks,
          audience: "dashframe",
        },
      });
      await configureHosted(backend, directory, runtime, operator);
      const operatorClient = new ConvexHttpClient(backend.url);
      operatorClient.setAuth(
        token(operator, {
          iss: operatorIssuer,
          aud: "dashframe-operator",
          sub: "operator:test",
          authority: "operator",
        }),
      );
      const control = (subject: string) => {
        const client = new ConvexHttpClient(backend!.url);
        client.setAuth(
          token(runtime, {
            sub: `user:${subject}`,
            userId: subject,
            authority: "host",
          }),
        );
        return client;
      };
      const workspaces: string[] = [];
      for (const subject of ["a", "b"]) {
        await operatorClient.mutation(api.admission.grant, { subject });
        const resolved = await control(subject).mutation(
          api.admission.resolve,
          {},
        );
        if (!resolved.workspaceId)
          throw new Error("Expected admitted workspace");
        workspaces.push(resolved.workspaceId);
      }
      const userClaims = (subject: string, workspaceId: string) => ({
        sub: `user:${subject}`,
        userId: subject,
        principalKind: "user",
        authority: "host",
        purpose: "host-metadata",
        workspaceId,
      });
      const metadata = (
        claims: Record<string, string>,
        signingKeys = runtime,
      ) => {
        const assertion = token(signingKeys, claims);
        return createHostedMetadata({
          deploymentUrl: backend!.url,
          allowInsecureLoopbackForTests: true,
          getToken: async () => assertion,
        });
      };
      const a = metadata(userClaims("a", workspaces[0]!)),
        b = metadata(userClaims("b", workspaces[1]!));
      const sourceId = crypto.randomUUID(),
        tableId = crypto.randomUUID();
      await a.commitBatch([
        cmd("CreateDataSource", {
          id: sourceId,
          name: "Synthetic",
          type: "csv",
        }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "Synthetic",
          table: "synthetic.csv",
        }),
      ]);
      expect((await a.getDataTable(tableId))?.id).toBe(tableId);
      expect(await b.getDataTable(tableId)).toBeNull();
      const provenance = { connectorKind: "local", bindingVersion: "v1" };
      const frameId = crypto.randomUUID(),
        resultId = crypto.randomUUID();
      await a.publishMaterialization({
        sources: [
          {
            source: {
              table: {
                id: tableId,
                dataSourceId: sourceId,
                table: "synthetic.csv",
                name: "Synthetic",
              },
              provenance,
            },
            frame: { id: frameId, rowCount: 0, fieldIds: [], schema: [] },
          },
        ],
        target: { kind: "ephemeral" },
        result: { id: resultId, rowCount: 0, fieldIds: [], schema: [] },
        definitionFingerprint: "synthetic",
        provenance,
        fetchedAt: 1,
      });
      expect(await a.listDataFrames()).toHaveLength(2);
      expect(await b.listDataFrames()).toEqual([]);
      expect(await a.getOperation(`materialize:${resultId}`)).not.toBeNull();
      expect(await b.getOperation(`materialize:${resultId}`)).toBeNull();
      await expect(
        metadata(userClaims("a", workspaces[1]!)).listDataFrames(),
      ).rejects.toThrow();
      await expect(
        metadata({
          ...userClaims("a", workspaces[0]!),
          purpose: "admission",
        }).listDataFrames(),
      ).rejects.toThrow();
      await expect(
        metadata(
          userClaims("a", workspaces[0]!),
          keys("wrong"),
        ).listDataFrames(),
      ).rejects.toThrow();
      await expect(
        metadata({
          ...userClaims("a", workspaces[0]!),
          authority: "browser",
        }).listDataFrames(),
      ).rejects.toThrow();

      // Ownership provisioning is not a runtime host capability in this slice.
      // Seed only this disposable database through its test fixture authority.
      const ownersFile = path.join(directory, "credential-owners.json");
      await writeFile(
        ownersFile,
        JSON.stringify([
          {
            credentialId: "credential-a",
            subject: "a",
            workspaceId: workspaces[0],
          },
        ]),
        { mode: 0o600 },
      );
      await localFixtureCli(backend, directory, [
        "import",
        "--append",
        "--table",
        "credentialOwners",
        "--format",
        "jsonArray",
        ownersFile,
      ]);
      const service = metadata({
        sub: "service:credential-a",
        credentialId: "credential-a",
        principalKind: "service",
        authority: "host",
        purpose: "host-metadata",
        workspaceId: workspaces[0]!,
      });
      expect((await service.getDataTable(tableId))?.id).toBe(tableId);
      await service.draftBatch([]);
      await expect(service.commitBatch([])).rejects.toThrow();
      await backend.internalClient.mutation(internal.host.revokeCredential, {
        workspaceId: workspaces[0]!,
        credentialId: "credential-a",
      });
      await expect(service.getDataTable(tableId)).rejects.toThrow();
      await expect(service.draftBatch([])).rejects.toThrow();
      await operatorClient.mutation(api.admission.revoke, { subject: "a" });
      await expect(a.getDataTable(tableId)).rejects.toThrow();
      await expect(a.commitBatch([])).rejects.toThrow();
      expect(await b.listDataFrames()).toEqual([]);
    } finally {
      await backend?.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
