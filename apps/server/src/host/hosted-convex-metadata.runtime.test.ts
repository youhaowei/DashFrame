import { execFile } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { ApiAccessCredentials, CREDENTIAL_CLASS } from "@dashframe/server-core";
import type { SecretVault } from "@wystack/secret-vault";
import { createWorkspaceSecrets } from "./workspace-secrets";
import { loadSecretKeyring } from "../secret-file-backend";
import {
  createHostedConnectorSessionDocument,
  createHostedConnectorSessionStore,
} from "../connector-setup/hosted-session-store";
import {
  startSession,
  consumeCallback,
  markVerifying,
  sweep,
} from "../connector-setup/session-store";
import {
  saveAssistantProviderConfig,
  removeAssistantProviderConfig,
  startAssistantOAuthLogin,
} from "./assistant-providers";
import { createHostedAdmissionService } from "./hosted-admission-service";
import { createHostedServerSurface } from "../hosted";
import { NativeDuckDBEngine } from "@dashframe/engine-server";
import { FileDataFrameStorage } from "@dashframe/engine-server/file-dataframe-storage";
import { tableFromIPC } from "apache-arrow";
import { z } from "zod";
import { createHostedApplication } from "./hosted-application";
import { createHostedServiceAccess } from "./hosted-service-access";
import { bindHostedMetadata } from "./bound-hosted-metadata";
import { HostResourceCleanup } from "./resource-cleanup";
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
    let httpSurface:
      | Awaited<ReturnType<typeof createHostedServerSurface>>
      | undefined;
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
      const sessionKeyring = await loadSecretKeyring({
        DASHFRAME_SECRET_KEY: randomBytes(32).toString("base64"),
      });
      if (!sessionKeyring) throw new Error("Synthetic keyring required");
      const vaultFactory = await createWorkspaceSecrets(
        path.join(directory, "workspace-secrets"),
        sessionKeyring,
      );
      const vaultA = await vaultFactory.forWorkspace(workspaces[0]!);
      const vaultB = await vaultFactory.forWorkspace(workspaces[1]!);
      const metadata = (
        claims: Record<string, string>,
        credentialVault: SecretVault,
        signingKeys = runtime,
      ) => {
        const assertion = token(signingKeys, claims);
        return createHostedSourceMetadata({
          deploymentUrl: backend!.url,
          allowInsecureLoopbackForTests: true,
          getToken: async () => assertion,
          credentialVault,
        });
      };
      const a = metadata(userClaims("a", workspaces[0]!), vaultA),
        b = metadata(userClaims("b", workspaces[1]!), vaultB);
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
        metadata(userClaims("a", workspaces[1]!), vaultA).listDataFrames(),
      ).rejects.toThrow();
      await expect(
        metadata(
          {
            ...userClaims("a", workspaces[0]!),
            purpose: "admission",
          },
          vaultA,
        ).listDataFrames(),
      ).rejects.toThrow();
      await expect(
        metadata(
          userClaims("a", workspaces[0]!),
          vaultA,
          keys("wrong"),
        ).listDataFrames(),
      ).rejects.toThrow();
      await expect(
        metadata(
          {
            ...userClaims("a", workspaces[0]!),
            authority: "browser",
          },
          vaultA,
        ).listDataFrames(),
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
      const service = metadata(
        {
          sub: "service:credential-a",
          credentialId: "credential-a",
          principalKind: "service",
          authority: "host",
          purpose: "host-metadata",
          workspaceId: workspaces[0]!,
        },
        vaultA,
      );
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
      const externalService = metadata(
        {
          sub: "service:credential-a",
          credentialId: "credential-a",
          principalKind: "service",
          authority: "service",
          workspaceId: workspaces[0]!,
        },
        vaultA,
      );
      await expect(
        externalService.recoverHostBatch({ operationId: batch.operationId }),
      ).rejects.toThrow();
      await expect(a.executeHostBatch(batch)).rejects.toThrow();
      const paging = { paginationOpts: { cursor: null, numItems: 100 } };
      expect((await a.listRecoverableHostBatches(paging)).page).toEqual([
        { operationId: batch.operationId },
      ]);
      expect(await b.recoverHostBatch({ operationId: batch.operationId })).toBe(
        "missing",
      );
      const startupCleanup = new HostResourceCleanup({ metadata: service });
      await startupCleanup.recoverPendingBatches();
      expect((await a.listRecoverableHostBatches(paging)).page).toEqual([]);
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
      const oldRef = await vaultA.store("source-old", {
          class: CREDENTIAL_CLASS.ConnectorKey,
        }),
        nextRef = await vaultA.store("source-next", {
          class: CREDENTIAL_CLASS.ConnectorKey,
        }),
        losingRef = await vaultA.store("source-losing-cas", {
          class: CREDENTIAL_CLASS.ConnectorKey,
        });
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
        expectedRevision: (await a.getDataSource(sourceId))!.revision,
        expectedConfig: originalConfig,
        config: { apiKey: oldRef },
      });
      await a.replaceDataSourceConfig({
        id: sourceId,
        expectedRevision: (await a.getDataSource(sourceId))!.revision,
        expectedConfig: { apiKey: oldRef },
        config: { apiKey: nextRef },
      });
      await expect(
        a.replaceDataSourceConfig({
          expectedRevision: 1,
          id: sourceId,
          expectedConfig: { apiKey: oldRef },
          config: { apiKey: losingRef },
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
          expectedRevision: 1,
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
            expectedRevision: 1,
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
      const sessionDirectory = path.join(directory, "workspace-a-sessions");
      const sessionDocument = createHostedConnectorSessionDocument(
        sessionDirectory,
        workspaces[0]!,
        sessionKeyring,
      );
      const sessionsA = createHostedConnectorSessionStore({
        document: sessionDocument,
        ownerSubject: "a",
        getDataSourceKind: async (id) =>
          (await providersA.getDataSource(id))?.kind ?? null,
      });
      const sessionsB = createHostedConnectorSessionStore({
        document: sessionDocument,
        ownerSubject: "b",
        getDataSourceKind: async (id) =>
          (await providersB.getDataSource(id))?.kind ?? null,
      });
      const boundMetadata = bindHostedMetadata({
        principal: { kind: "user", userId: "a" },
        metadata: providersA,
        connectorSetup: sessionsA,
        credentialOwnership: {
          revoke: async () => {
            throw new Error("Not used by this fixture");
          },
        },
      });
      const boundBatch = {
        operationId: "bound-runtime-batch",
        requestHash: "e".repeat(64),
      };
      const boundPrincipal = { kind: "user" as const, userId: "a" };
      await boundMetadata.prepareHostBatch({
        ...boundBatch,
        principal: boundPrincipal,
        commands: [],
        mode: "commit",
        stagedRefs: [],
      });
      await expect(
        boundMetadata.executeHostBatch({
          ...boundBatch,
          principal: { kind: "user", userId: "b" },
        }),
      ).rejects.toThrow("FORBIDDEN");
      await boundMetadata.executeHostBatch({
        ...boundBatch,
        principal: boundPrincipal,
      });
      expect(
        (
          await boundMetadata.getHostBatch({
            ...boundBatch,
            principal: boundPrincipal,
          })
        )?.status,
      ).toBe("completed");
      await expect(
        boundMetadata.commitBatch({ kind: "user", userId: "b" }, []),
      ).rejects.toThrow("FORBIDDEN");
      await boundMetadata.commitBatch(boundPrincipal, []);
      const issued = (claims: Record<string, string>) => ({
        token: token(runtime, claims),
        expiresAt: Date.now() + 60_000,
      });
      const applicationTokens: Parameters<
        typeof createHostedApplication
      >[0]["tokens"] = {
        metadata: (source, workspaceId) => {
          return source.kind === "user"
            ? issued(userClaims(source.userId, workspaceId))
            : issued({
                sub: `service:${source.credentialId}`,
                credentialId: source.credentialId,
                principalKind: "service",
                authority: "host",
                purpose: "host-metadata",
                workspaceId,
              });
        },
        browser: (user, workspaceId) =>
          issued({
            sub: `user:${user.userId}`,
            userId: user.userId,
            principalKind: "user",
            authority: "browser",
            workspaceId,
          }),
        service: (service, workspaceId) =>
          issued({
            sub: `service:${service.credentialId}`,
            credentialId: service.credentialId,
            principalKind: "service",
            authority: "service",
            workspaceId,
          }),
        credentialOwnership: (user, workspaceId) =>
          issued({
            ...userClaims(user.userId, workspaceId),
            purpose: "host-credentials",
          }),
      };
      const httpCredentials = new ApiAccessCredentials(
        vaultA,
        path.join(directory, "named-credentials"),
      );
      const hostedApplication = createHostedApplication({
        deploymentUrl: backend.url,
        allowInsecureLoopbackForTests: true,
        source: { kind: "user", userId: "a", expiresAt: Date.now() + 120_000 },
        workspaceId: workspaces[0]!,
        workspaceOwnerId: "a",
        resources: {
          vault: vaultA,
          accessCredentials: httpCredentials,
          connectorSetup: sessionsA,
          getServerEndpoint: () => undefined,
        },
        tokens: applicationTokens,
      });
      const ownerContext = hostedApplication.context;
      const credentialSourceId = crypto.randomUUID();
      await a.commitBatch([
        cmd("CreateDataSource", {
          id: credentialSourceId,
          name: "Credential acceptance",
          type: "csv",
        }),
      ]);
      const namedCredential = z
        .object({
          credential: z.object({ id: z.string().uuid() }),
          accessCredential: z.string().min(1),
        })
        .parse(
          await hostedApplication.application.execute("issueAccessCredential", {
            name: "Native hosted agent",
          }),
        );
      const namedService = metadata(
        {
          sub: `service:${namedCredential.credential.id}`,
          credentialId: namedCredential.credential.id,
          principalKind: "service",
          authority: "host",
          purpose: "host-metadata",
          workspaceId: workspaces[0]!,
        },
        vaultA,
      );
      expect((await namedService.getDataSource(credentialSourceId))?.id).toBe(
        credentialSourceId,
      );
      const serviceAccess = createHostedServiceAccess({
        deploymentUrl: backend.url,
        allowInsecureLoopbackForTests: true,
        tokens: {
          metadata: (source, workspaceId) => {
            if (source.kind !== "service")
              throw new Error("Expected service fixture");
            return issued({
              sub: `service:${source.credentialId}`,
              credentialId: source.credentialId,
              principalKind: "service",
              authority: "host",
              purpose: "host-metadata",
              workspaceId,
            });
          },
        },
      });
      const verifiedCredential = {
        credentialId: namedCredential.credential.id,
        expiresAt: Date.now() + 60_000,
      };
      expect(
        await serviceAccess.resolve(workspaces[0]!, verifiedCredential),
      ).toEqual({
        credentialId: namedCredential.credential.id,
        subject: "a",
        workspaceId: workspaces[0],
      });
      await expect(
        serviceAccess.resolve(workspaces[1]!, verifiedCredential),
      ).rejects.toThrow();
      await hostedApplication.application.execute("revokeAccessCredential", {
        id: namedCredential.credential.id,
      });
      await expect(
        namedService.getDataSource(credentialSourceId),
      ).rejects.toThrow();
      await expect(
        serviceAccess.resolve(workspaces[0]!, verifiedCredential),
      ).rejects.toThrow();
      let httpAllocations = 0;
      const queryEngine = new NativeDuckDBEngine();
      const staticDirectory = path.join(directory, "browser");
      await mkdir(staticDirectory);
      await writeFile(
        path.join(staticDirectory, "index.html"),
        "<!doctype html><title>Hosted runtime fixture</title>",
      );
      await writeFile(
        path.join(staticDirectory, "_headers"),
        "/*\n  Cross-Origin-Opener-Policy: same-origin\n",
      );
      httpSurface = await createHostedServerSurface({
        deploymentUrl: backend.url,
        allowInsecureLoopbackForTests: true,
        staticDirectory,
        revision: "synthetic",
        publicOrigin: "https://hosted-app.invalid",
        session: {
          login: async () => Response.redirect("https://hosted-app.invalid/"),
          callback: async () =>
            Response.redirect("https://hosted-app.invalid/"),
          logout: () => new Response(null, { status: 204 }),
          resolve: async () => ({
            status: "authenticated",
            identity: { subject: "a" },
            expiresAt: Date.now() + 120_000,
          }),
        },
        admission: createHostedAdmissionService({
          deploymentUrl: backend.url,
          allowInsecureLoopbackForTests: true,
          tokens: {
            admission: (user) =>
              issued({
                sub: `user:${user.userId}`,
                userId: user.userId,
                principalKind: "user",
                authority: "host",
              }),
          },
        }),
        tokens: applicationTokens,
        authenticateCredential: async (workspaceId, bearer) =>
          workspaceId === workspaces[0]
            ? httpCredentials.authenticate(bearer)
            : null,
        open: async (workspaceId) => {
          expect(workspaceId).toBe(workspaces[0]);
          httpAllocations++;
          return {
            resources: {
              directory: sessionDirectory,
              vault: vaultA,
              accessCredentials: httpCredentials,
              connectorSessionDocument: sessionDocument,
              dataFrameStorage: new FileDataFrameStorage(
                path.join(directory, "frames"),
              ),
              getEngine: async () => {
                await queryEngine.initialize();
                return queryEngine;
              },
            },
            close: () => queryEngine.dispose(),
          };
        },
      });
      const httpApp = httpSurface.app;
      const mcpCredential = z
        .object({
          credential: z.object({ id: z.string() }),
          accessCredential: z.string(),
        })
        .parse(
          await hostedApplication.application.execute("issueAccessCredential", {
            name: "HTTP MCP agent",
          }),
        );
      const mcpRequest = async (
        bearer: string,
        workspaceId = workspaces[0]!,
        call?: { name: string; arguments: Record<string, string> },
      ) => {
        const response = await httpApp.request(
          `https://hosted-app.invalid/workspaces/${workspaceId}/mcp`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${bearer}`,
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: call ? "tools/call" : "tools/list",
              params: call ?? {},
            }),
          },
        );
        return new Response(await response.arrayBuffer(), response);
      };
      expect((await mcpRequest("dfa_invalid")).status).toBe(401);
      expect(
        (await mcpRequest(mcpCredential.accessCredential, workspaces[1]!))
          .status,
      ).toBe(401);
      expect(httpAllocations).toBe(0);
      const toolsResponse = await mcpRequest(mcpCredential.accessCredential);
      expect(toolsResponse.status).toBe(200);
      expect(await toolsResponse.json()).toMatchObject({
        result: {
          tools: expect.arrayContaining([
            expect.objectContaining({ name: expect.any(String) }),
          ]),
        },
      });
      expect(httpAllocations).toBe(1);
      const readResponse = await mcpRequest(
        mcpCredential.accessCredential,
        workspaces[0]!,
        {
          name: "read_neighborhood",
          arguments: { kind: "dataSource", id: credentialSourceId },
        },
      );
      expect(readResponse.status).toBe(200);
      const readResult = z
        .object({
          result: z.object({
            isError: z.boolean().optional(),
            content: z.array(
              z.object({ type: z.string(), text: z.string().optional() }),
            ),
          }),
        })
        .parse(await readResponse.json());
      expect(readResult.result.isError).not.toBe(true);
      expect(
        readResult.result.content.map((item) => item.text).join("\n"),
      ).toContain("Credential acceptance");
      await hostedApplication.application.execute("revokeAccessCredential", {
        id: mcpCredential.credential.id,
      });
      expect((await mcpRequest(mcpCredential.accessCredential)).status).toBe(
        401,
      );
      expect(httpAllocations).toBe(1);
      const httpOperation = async (operation: string, input: unknown) => {
        const response = await httpApp.request(
          `https://hosted-app.invalid/api/host/${operation}`,
          {
            method: "POST",
            headers: {
              Origin: "https://hosted-app.invalid",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(input),
          },
        );
        // Consume the body like a real client, releasing the workspace lease.
        return new Response(await response.arrayBuffer(), response);
      };
      const httpSourceId = crypto.randomUUID();
      expect(
        (
          await httpOperation("getOrCreateDataSource", {
            id: httpSourceId,
            type: "csv",
            name: "HTTP admitted source",
          })
        ).status,
      ).toBe(200);
      expect(await a.getDataSource(httpSourceId)).toMatchObject({
        id: httpSourceId,
      });
      expect(await b.getDataSource(httpSourceId)).toBeNull();
      const arrowResponse = await httpApp.request(
        "https://hosted-app.invalid/data/arrow",
        {
          method: "POST",
          headers: {
            Origin: "https://hosted-app.invalid",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sql: "SELECT 7::INTEGER AS demo_value" }),
        },
      );
      expect(arrowResponse.status).toBe(200);
      expect(
        tableFromIPC(new Uint8Array(await arrowResponse.arrayBuffer()))
          .toArray()
          .map((row) => row.toJSON()),
      ).toEqual([{ demo_value: 7 }]);
      const handshake = await startSession(sessionsA, {
        connectorId: "csv",
        requestedName: "Scoped recovery",
        scopes: [],
      });
      await expect(
        consumeCallback(sessionsB, handshake.stateNonce),
      ).rejects.toThrow();
      await consumeCallback(sessionsA, handshake.stateNonce);
      await markVerifying(sessionsA, handshake.session.id, httpSourceId);
      await sweep(sessionsA, new Date(), 0);
      expect((await sessionsA.get(handshake.session.id))?.state).toBe(
        "connected",
      );
      expect(await sessionsB.get(handshake.session.id)).toBeNull();
      const encryptedSessions = await readFile(
        path.join(sessionDirectory, "connector-sessions.dfsd"),
      );
      expect(
        encryptedSessions.includes(Buffer.from(handshake.session.codeVerifier)),
      ).toBe(false);
      expect(
        encryptedSessions.includes(Buffer.from(handshake.stateNonce)),
      ).toBe(false);
      const applicationSourceId = crypto.randomUUID();
      await hostedApplication.application.execute("getOrCreateDataSource", {
        id: applicationSourceId,
        type: "csv",
        name: "Composed hosted source",
      });
      expect(
        await hostedApplication.application.execute("getDataSource", {
          id: applicationSourceId,
        }),
      ).toMatchObject({ id: applicationSourceId });
      expect(await b.getDataSource(applicationSourceId)).toBeNull();
      await expect(
        hostedApplication.application
          .forPrincipal({ kind: "user", userId: "b" })
          .execute("getDataTable", { id: tableId }),
      ).rejects.toThrow("FORBIDDEN");
      const hostedProviderInput = {
        providerId: "openai",
        displayLabel: "Hosted owner provider",
        authKind: "api-key" as const,
        credential: "synthetic-workspace-provider-key",
        defaultModel: "gpt-5",
      };
      await expect(
        saveAssistantProviderConfig(
          { ...ownerContext, principal: { kind: "user", userId: "b" } },
          { input: hostedProviderInput },
        ),
      ).rejects.toThrow("FORBIDDEN");
      await expect(
        saveAssistantProviderConfig(ownerContext, {
          input: { ...hostedProviderInput, authKind: "oauth" },
        }),
      ).rejects.toThrow("Use an API key");
      await expect(
        startAssistantOAuthLogin(ownerContext, { id: crypto.randomUUID() }),
      ).rejects.toThrow("Use an API key");
      const ownedProvider = await saveAssistantProviderConfig(ownerContext, {
        input: hostedProviderInput,
      });
      const ownedRow = await providersA.getAssistantProviderConfig(
        ownedProvider.id,
      );
      expect(ownedRow?.credentialRef).toMatch(/^secret:/);
      expect(JSON.stringify(ownedRow)).not.toContain(
        hostedProviderInput.credential,
      );
      expect(
        await providersB.getAssistantProviderConfig(ownedProvider.id),
      ).toBeNull();
      await removeAssistantProviderConfig(ownerContext, {
        id: ownedProvider.id,
      });
      expect(
        await providersA.getAssistantProviderConfig(ownedProvider.id),
      ).toBeNull();
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
      const allocationsBeforeRevokedRequest = httpAllocations;
      expect((await httpOperation("getAccessCapabilities", {})).status).toBe(
        403,
      );
      expect(httpAllocations).toBe(allocationsBeforeRevokedRequest);
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
      httpSurface?.closeConnections();
      await httpSurface?.closeResources();
      await backend?.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
