import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { executeFetch } = vi.hoisted(() => ({ executeFetch: vi.fn() }));
vi.mock("./data-fetch/production", () => ({
  createProductionFetchExecutor: () => executeFetch,
}));

import type { HostContext } from "./context";
import { createApplicationOperations } from "./dispatch";
import { hostOperations } from "./registry";

const insightId = "10000000-0000-4000-8000-000000000001";
const tableId = "10000000-0000-4000-8000-000000000002";
const fieldId = "20000000-0000-4000-8000-000000000001";
const principal = { kind: "user", userId: "owner" } as const;

function registryFixture() {
  const getDataTable = vi.fn(async () => ({
    id: tableId,
    dataSourceId: "source-1",
    name: "Sales",
    table: "sales",
    fields: [],
    metrics: [],
    dataFrameId: "30000000-0000-4000-8000-000000000001",
    lastFetchedAt: 1,
    createdAt: 0,
  }));
  const getInsight = vi.fn(async (id: string) =>
    id === insightId
      ? {
          id: insightId,
          name: "Revenue",
          createdAt: 0,
          definition: {
            source: { sourceType: "dataTable", sourceId: tableId },
            selectedFields: [fieldId],
            metrics: [],
          },
        }
      : undefined,
  );
  const context = {
    principal,
    metadata: { getDataTable, getInsight },
  } as unknown as HostContext;
  const application = createApplicationOperations({
    convexUrl: "https://metadata.test",
    identity: { issue: () => ({ token: "fixture", expiresAt: 1 }) },
    context: () => context,
  });
  return { application, getDataTable, getInsight };
}

describe("presentation registry dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeFetch.mockResolvedValue({
      status: "ready",
      dataFrameId: "30000000-0000-4000-8000-000000000002",
      schema: [],
      rowCount: 0,
      definitionFingerprint: "fingerprint",
      provenance: { connectorKind: "local", bindingVersion: "v1" },
      fetchedAt: 1,
    });
  });

  it("dispatches a saved Insight presentation through the outer registry", async () => {
    const { application, getInsight } = registryFixture();
    const input = {
      insightId,
      presentation: { dimensions: [fieldId] },
    };

    const result = await application.execute("runInsight", input, {
      principal,
    });

    expect(hostOperations.runInsight.schema.parse(input)).toEqual(input);
    expect(result).toMatchObject({ status: "ready" });
    expect(getInsight).toHaveBeenCalledWith(insightId);
    expect(executeFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        insight: expect.objectContaining({
          presentation: input.presentation,
        }),
        target: { kind: "ephemeral" },
      }),
    );
  });

  it("rejects malformed presentation before dispatching runInsight", async () => {
    const { application, getDataTable, getInsight } = registryFixture();
    const input = {
      insightId,
      presentation: { dimensions: [fieldId, fieldId] },
    };

    await expect(
      application.execute("runInsight", input, { principal }),
    ).rejects.toThrow();
    expect(executeFetch).not.toHaveBeenCalled();
    expect(getDataTable).not.toHaveBeenCalled();
    expect(getInsight).not.toHaveBeenCalled();
  });
});
