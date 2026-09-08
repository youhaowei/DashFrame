import { expect, expectTypeOf, it, vi } from "vite-plus/test";
import type { HostOperationName } from "../host-contract";
import type { HostContext } from "./context";
import { hostOperations } from "./registry";

const id = "00000000-0000-4000-8000-000000000001";
const cases = {
  commitBatch: { input: { commands: [] } },
  draftBatch: {
    input: { commands: [] },
    openToService:
      "Services may propose commands through principal-owned drafts.",
  },
  getOrCreateDataSource: { input: { id, type: "csv", name: "Source" } },
  ingestLocalDataFrame: { input: { dataTableId: id, arrowBase64: "" } },
  queryDataFrame: {
    input: { dataFrameId: id },
    openToService:
      "API clients may read bounded pages of project-owned frames.",
  },
  removeDataFrameEntry: { input: { id } },
  clearAllData: { input: {} },
  fetchData: {
    input: { insight: { baseTableId: id, selectedFields: [], metrics: [] } },
    openToService:
      "API clients may materialize unsaved previews from persisted sources.",
  },
  runInsight: {
    input: { insightId: id },
    openToService: "API clients may execute saved Insight definitions.",
  },
  getConnectorCatalog: {
    input: {},
    openToService: "Connector descriptors are public catalog metadata.",
  },
  prepareRemoteDataTable: { input: { id } },
  listNotionDatabases: {
    input: { dataSourceId: id },
    openToService:
      "API clients may discover databases through host-owned connector credentials.",
  },
  listPostgresTables: {
    input: { dataSourceId: id },
    openToService:
      "API clients may discover tables through host-owned connector credentials.",
  },
  listGa4Properties: {
    input: { dataSourceId: id },
    openToService:
      "API clients may discover properties through host-owned connector credentials.",
  },
  listAssistantProviderCatalog: {
    input: {},
    openToService: "Provider descriptors are public catalog metadata.",
  },
  listAssistantProviderConfigs: { input: {} },
  saveAssistantProviderConfig: {
    input: {
      input: {
        providerId: "openai",
        displayLabel: "Provider",
        authKind: "api-key",
        defaultModel: "model",
      },
    },
  },
  removeAssistantProviderConfig: { input: { id } },
  setAssistantDefaultModel: {
    input: { input: { id, expectedDefaultModel: "old", defaultModel: "new" } },
  },
  startAssistantOAuthLogin: { input: { id } },
  getAccessCapabilities: {
    input: {},
    openToService:
      "Services may discover that they cannot manage access credentials.",
  },
  getAccessConnectionInfo: { input: {} },
  listAccessCredentials: { input: {} },
  issueAccessCredential: { input: { name: "Bot" } },
  revokeAccessCredential: { input: { id } },
  startConnectorSetup: {
    input: { connectorId: "notion", requestedName: "Source" },
  },
  getConnectorSetupSession: { input: { sessionId: id } },
  cancelConnectorSetup: { input: { sessionId: id } },
} satisfies Record<
  keyof typeof hostOperations,
  { input: unknown; openToService?: string }
>;

it("classifies the entire host registry and keeps the HTTP name union in sync", () => {
  expect(Object.keys(cases).sort()).toEqual(Object.keys(hostOperations).sort());
  expectTypeOf<HostOperationName>().toEqualTypeOf<
    keyof typeof hostOperations
  >();
});

it.each(Object.entries(hostOperations))(
  "%s enforces its service principal boundary before accessing host capabilities",
  async (name, operation) => {
    const touched = vi.fn(() => {
      throw new Error("metadata touched");
    });
    // No capability can read, write, or start a real resource in this fixture.
    const unavailable = new Proxy({}, { get: touched });
    const ctx: HostContext = {
      principal: { kind: "service", credentialId: "bot" },
      metadata: unavailable as HostContext["metadata"],
      getServerEndpoint: touched,
      cleanupResources: touched,
      accessCredentials: unavailable as HostContext["accessCredentials"],
      vault: unavailable as HostContext["vault"],
      googleOAuth: unavailable as HostContext["googleOAuth"],
      application: unavailable as HostContext["application"],
      dataFrameStorage: unavailable as HostContext["dataFrameStorage"],
      dataPlaneRuntime: unavailable as HostContext["dataPlaneRuntime"],
    };
    const entry = cases[name as keyof typeof cases];
    // Validation is a separate boundary: malformed fixtures must not look like permission evidence.
    expect(operation.schema.safeParse(entry.input).success).toBe(true);
    const result = Promise.resolve().then(() =>
      operation.execute(ctx, entry.input),
    );
    if ("openToService" in entry) {
      const message = await result.then(
        () => "",
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );
      expect(message).not.toContain("FORBIDDEN");
      // "Not FORBIDDEN" alone is vacuous for a handler that throws elsewhere:
      // prove the service call either completed or reached a host capability.
      // (fetchData/runInsight return safe failure DTOs, so the capability
      // touch is the only evidence they got past the guard.)
      expect(message === "" || touched.mock.calls.length > 0).toBe(true);
    } else {
      await expect(result).rejects.toThrow("FORBIDDEN");
      expect(touched).not.toHaveBeenCalled();
    }
  },
);
