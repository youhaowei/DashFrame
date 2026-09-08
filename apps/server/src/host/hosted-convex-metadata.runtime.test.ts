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
import { cmd, type Field } from "@dashframe/types";
import { CREDENTIAL_CLASS } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { createHostedProviderMetadata } from "./hosted-convex-provider-metadata";
import { createHostedSourceMetadata } from "./hosted-convex-source-operations";

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
  "enforces signed metadata and lifecycle capabilities, atomic recovery, and live revocation through the real Bearer adapter",
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
        return createHostedSourceMetadata({
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
      const batch = {
        operationId: "synthetic-batch",
        requestHash: "a".repeat(64),
      };
      const stagedRef = `secret:${crypto.randomUUID()}`;
      await service.prepareHostBatch({
        ...batch,
        commands: [],
        mode: "draft",
        stagedRefs: [stagedRef],
      });
      await expect(
        service.recoverHostBatch({ operationId: batch.operationId }),
      ).rejects.toThrow();
      await expect(a.executeHostBatch(batch)).rejects.toThrow();
      const paging = { paginationOpts: { cursor: null, numItems: 100 } };
      expect((await a.listRecoverableHostBatches(paging)).page).toEqual([
        { operationId: batch.operationId },
      ]);
      expect(await b.recoverHostBatch({ operationId: batch.operationId })).toBe(
        "missing",
      );
      expect(await a.recoverHostBatch({ operationId: batch.operationId })).toBe(
        "cancelled",
      );
      expect(await a.recoverHostBatch({ operationId: batch.operationId })).toBe(
        "cancelled",
      );
      const job = (await a.listCleanup(paging)).page.find(
        (item) => item.resourceId === stagedRef,
      );
      expect(job).toBeDefined();
      const claim = await a.claimCleanup({ cleanupId: job!.cleanupId });
      expect(claim).toMatchObject({
        resourceId: stagedRef,
        claimToken: expect.any(String),
      });
      expect(await b.claimCleanup({ cleanupId: job!.cleanupId })).toBeNull();
      await a.ackCleanup({
        cleanupId: job!.cleanupId,
        claimToken: claim!.claimToken,
      });
      expect((await a.listCleanup(paging)).page).not.toContainEqual(job);

      // Native optimistic transactions serialize completion/cancellation: neither
      // terminal result may be overwritten when the competing request retries.
      const racing = { ...batch, operationId: "racing-batch" };
      await a.prepareHostBatch({
        ...racing,
        commands: [],
        mode: "commit",
        stagedRefs: [],
      });
      const [executed, recovered] = await Promise.all([
        a.executeHostBatch(racing),
        a.recoverHostBatch({ operationId: racing.operationId }),
      ]);
      const terminal = await a.getHostBatch(racing);
      expect(["completed", "cancelled"]).toContain(terminal?.status);
      expect(executed.status).toBe(terminal?.status);
      expect(recovered).toBe(terminal?.status);
      const completed = { ...batch, operationId: "completed-batch" };
      await a.prepareHostBatch({
        ...completed,
        commands: [],
        mode: "commit",
        stagedRefs: [],
      });
      const outcome = await a.executeHostBatch(completed);
      expect(
        await a.recoverHostBatch({ operationId: completed.operationId }),
      ).toBe("completed");
      expect(await a.getHostBatch(completed)).toEqual(outcome);

      const imported = {
        operationId: "synthetic-import",
        requestHash: "b".repeat(64),
      };
      await expect(service.beginLocalImport(imported)).rejects.toThrow();
      const importClaim = await a.beginLocalImport(imported);
      expect(await a.beginLocalImport(imported)).toEqual(importClaim);
      expect(await b.getLocalImport(imported)).toBeNull();
      const importInput = {
        ...imported,
        expectedDataSourceRevision: 1,
        dataSourceId: sourceId,
        dataTableId: tableId,
        expectedDataFrameId: frameId,
        frameRow: {
          id: importClaim.frameId,
          name: "Synthetic imported frame",
          fieldIds: [],
          storage: { type: "file", key: importClaim.frameId },
          rowCount: 3,
          columnCount: 0,
          lastRefreshedAt: importClaim.fetchedAt,
        },
        tableUpdate: {
          dataFrameId: importClaim.frameId,
          lastFetchedAt: importClaim.fetchedAt,
        },
      };
      await a.commitImportedFrame(importInput);
      await a.commitImportedFrame(importInput);
      expect(await a.getLocalImport(imported)).toMatchObject({
        status: "complete",
        result: { dataFrameId: importClaim.frameId, rowCount: 3 },
      });
      expect(await a.cancelLocalImport(imported)).toBe(false);
      const abandoned = { ...imported, operationId: "abandoned-import" };
      const abandonedClaim = await a.beginLocalImport(abandoned);
      expect(await a.cancelLocalImport(abandoned)).toBe(true);
      expect((await a.listCleanup(paging)).page).toContainEqual({
        cleanupId: expect.any(String),
        kind: "frame",
        resourceId: abandonedClaim.frameId,
      });
      const oldRef = `secret:${crypto.randomUUID()}`,
        nextRef = `secret:${crypto.randomUUID()}`;
      const originalConfig = (await a.getDataSource(sourceId))!.config ?? {};
      const boundaryClient = new ConvexHttpClient(backend.url);
      boundaryClient.setAuth(token(runtime, userClaims("a", workspaces[0]!)));
      for (const key of ["password", "token"])
        for (const slot of ["config", "expectedConfig"] as const)
          await expect(
            boundaryClient.mutation(
              api.hostedSourceOperations.replaceDataSourceConfig,
              {
                id: sourceId,
                config: {},
                expectedConfig: {},
                [slot]: { [key]: "synthetic-plaintext" },
              } as never,
            ),
          ).rejects.toThrow();
      expect((await a.getDataSource(sourceId))!.config).toEqual(originalConfig);
      await a.replaceDataSourceConfig({
        id: sourceId,
        expectedConfig: originalConfig,
        config: { apiKey: oldRef },
      });
      await a.replaceDataSourceConfig({
        id: sourceId,
        expectedConfig: { apiKey: oldRef },
        config: { apiKey: nextRef },
      });
      await expect(
        a.replaceDataSourceConfig({
          id: sourceId,
          expectedConfig: { apiKey: oldRef },
          config: { apiKey: `secret:${crypto.randomUUID()}` },
        }),
      ).rejects.toThrow();
      expect((await a.getDataSource(sourceId))!.config).toEqual({
        apiKey: nextRef,
      });
      expect(
        (await a.listCleanup(paging)).page.some(
          (job) => job.resourceId === oldRef,
        ),
      ).toBe(true);
      expect(
        (await a.listCleanup(paging)).page.some(
          (job) => job.resourceId === nextRef,
        ),
      ).toBe(false);
      await expect(
        b.replaceDataSourceConfig({
          id: sourceId,
          expectedConfig: { apiKey: nextRef },
          config: {},
        }),
      ).rejects.toThrow();
      const remoteFields = [
        {
          id: crypto.randomUUID(),
          tableId,
          name: "Value",
          columnName: "value",
          type: "number",
        },
      ] satisfies Field[];
      expect(
        await a.prepareRemoteDataTable({
          id: tableId,
          dataSourceId: sourceId,
          table: "synthetic.csv",
          fields: remoteFields,
        }),
      ).toEqual(remoteFields);
      for (const denied of [
        () =>
          service.replaceDataSourceConfig({
            id: sourceId,
            expectedConfig: { apiKey: nextRef },
            config: {},
          }),
        () =>
          service.prepareRemoteDataTable({
            id: tableId,
            dataSourceId: sourceId,
            table: "synthetic.csv",
            fields: remoteFields,
          }),
        () => service.removeDataFrame(importClaim.frameId),
        () => service.clearAllData(),
      ])
        await expect(denied()).rejects.toThrow();
      await b.removeDataFrame(importClaim.frameId);
      expect(await a.getDataFrame(importClaim.frameId)).not.toBeNull();
      await a.removeDataFrame(importClaim.frameId);
      expect(await a.getDataFrame(importClaim.frameId)).toBeNull();
      expect(await a.getDataTable(tableId)).toMatchObject({
        dataFrameId: null,
      });
      expect(
        (await a.listCleanup(paging)).page.some(
          (job) => job.resourceId === importClaim.frameId,
        ),
      ).toBe(true);
      const survivingSourceId = crypto.randomUUID();
      await b.commitBatch([
        cmd("CreateDataSource", {
          id: survivingSourceId,
          name: "Workspace B survives",
          type: "csv",
        }),
      ]);
      await a.clearAllData();
      expect(await b.getDataSource(survivingSourceId)).toMatchObject({
        id: survivingSourceId,
        name: "Workspace B survives",
      });
      expect(await a.getDataSource(sourceId)).toBeNull();
      expect(
        (await a.listCleanup(paging)).page.some(
          (job) => job.resourceId === nextRef,
        ),
      ).toBe(true);

      const workspaceVault = () => {
        const registry = new SecretRegistry();
        registry.register("test", new TestBackend(), { fallback: true });
        return new SecretVault(registry, new InMemoryMappingStore());
      };
      const vaultA = workspaceVault(),
        vaultB = workspaceVault();
      const providerRefA = await vaultA.store("provider-a", {
          class: CREDENTIAL_CLASS.AssistantProvider,
        }),
        providerRefB = await vaultB.store("provider-b", {
          class: CREDENTIAL_CLASS.AssistantProvider,
        });
      const providerMetadata = (
        claims: Record<string, string>,
        credentialVault: SecretVault,
      ) =>
        createHostedProviderMetadata({
          deploymentUrl: backend!.url,
          allowInsecureLoopbackForTests: true,
          credentialVault,
          getToken: async () => token(runtime, claims),
        });
      const providersA = providerMetadata(
          userClaims("a", workspaces[0]!),
          vaultA,
        ),
        providersB = providerMetadata(userClaims("b", workspaces[1]!), vaultB);
      const providerRow = {
        id: crypto.randomUUID(),
        providerId: "openai",
        displayLabel: "OpenAI",
        authKind: "api-key" as const,
        baseUrl: "https://api.openai.com/v1",
        credentialRef: providerRefA,
        defaultModel: "gpt-5",
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      };
      await expect(
        providersA.saveAssistantProviderConfig({
          row: { ...providerRow, credentialRef: providerRefB },
          expected: null,
        }),
      ).rejects.toThrow("unavailable in this workspace");
      expect(
        await providersA.saveAssistantProviderConfig({
          row: providerRow,
          expected: null,
        }),
      ).toEqual(providerRow);
      expect(await providersA.listAssistantProviderConfigs()).toEqual([
        providerRow,
      ]);
      expect(
        await providersB.getAssistantProviderConfig(providerRow.id),
      ).toBeNull();
      await expect(
        providerMetadata(
          {
            sub: "service:credential-a",
            credentialId: "credential-a",
            principalKind: "service",
            authority: "host",
            purpose: "host-metadata",
            workspaceId: workspaces[0]!,
          },
          vaultA,
        ).listAssistantProviderConfigs(),
      ).rejects.toThrow();
      await expect(service.commitBatch([])).rejects.toThrow();
      await backend.internalClient.mutation(internal.host.revokeCredential, {
        workspaceId: workspaces[0]!,
        credentialId: "credential-a",
      });
      await expect(service.getHostBatch(batch)).rejects.toThrow();
      await expect(service.getDataTable(tableId)).rejects.toThrow();
      await expect(service.draftBatch([])).rejects.toThrow();
      await operatorClient.mutation(api.admission.revoke, { subject: "a" });
      await expect(providersA.listAssistantProviderConfigs()).rejects.toThrow();
      await expect(a.clearAllData()).rejects.toThrow();
      await expect(a.listCleanup(paging)).rejects.toThrow();
      await expect(
        a.recoverHostBatch({ operationId: "missing" }),
      ).rejects.toThrow();
      await expect(a.getLocalImport(imported)).rejects.toThrow();
      await expect(a.getDataTable(tableId)).rejects.toThrow();
      await expect(a.commitBatch([])).rejects.toThrow();
      expect(await b.listDataFrames()).toEqual([]);
    } finally {
      await backend?.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
