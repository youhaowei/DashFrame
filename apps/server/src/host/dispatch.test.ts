import { expect, it, vi } from "vite-plus/test";
import type { HostContext } from "./context";
import { hostOperations } from "./registry";
import * as app from "@dashframe/convex-backend/app";
import {
  CONVEX_QUERY_NAMES,
  CONVEX_MUTATION_NAMES,
  createApplicationOperations,
} from "./dispatch";

it.each([false, true])(
  "preserves admitted cancellation when dispatch adds a caller signal: %s",
  async (includeCaller) => {
    const admitted = new AbortController();
    const caller = new AbortController();
    let observed: AbortSignal | undefined;
    const stop = new Error("probe complete");
    const spy = vi
      .spyOn(hostOperations.getConnectorCatalog, "execute")
      .mockImplementation(async (ctx) => {
        observed = ctx.requestSignal;
        throw stop;
      });
    try {
      const application = createApplicationOperations({
        convexUrl: "https://metadata.test",
        identity: { issue: () => ({ token: "fixture", expiresAt: 1 }) },
        context: (principal) =>
          ({ principal, requestSignal: admitted.signal }) as HostContext,
      });
      await expect(
        application.execute(
          "getConnectorCatalog",
          {},
          {
            principal: { kind: "user", userId: "owner" },
            ...(includeCaller ? { signal: caller.signal } : {}),
          },
        ),
      ).rejects.toThrow(stop);
      admitted.abort();
      expect(observed?.aborted).toBe(true);
    } finally {
      spy.mockRestore();
    }
  },
);

const registeredFunctions = {
  projectInfo: app.projectInfo,
  listDataSources: app.listDataSources,
  getDataSource: app.getDataSource,
  getDataSourceByType: app.getDataSourceByType,
  listDataTables: app.listDataTables,
  getDataTable: app.getDataTable,
  listDataFrames: app.listDataFrames,
  getDataFrameEntry: app.getDataFrameEntry,
  getDataFrameByInsight: app.getDataFrameByInsight,
  listInsights: app.listInsights,
  getInsight: app.getInsight,
  listVisualizations: app.listVisualizations,
  getVisualization: app.getVisualization,
  listDashboards: app.listDashboards,
  getDashboard: app.getDashboard,
  listDrafts: app.listDrafts,
  getDraftLog: app.getDraftLog,
  draftPublishReview: app.draftPublishReview,
  previewDiff: app.previewDiff,
  publishDraft: app.publishDraft,
  discardDraft: app.discardDraft,
  reviseDraft: app.reviseDraft,
  updateDataFrameEntry: app.updateDataFrameEntry,
};

// The generated API is a lazy proxy, so check the actual registered exports.
it.each([
  ...CONVEX_QUERY_NAMES.map((name) => ({ name, flag: "isQuery" })),
  ...CONVEX_MUTATION_NAMES.map((name) => ({ name, flag: "isMutation" })),
])(
  "dispatches $name to an existing Convex $flag function",
  ({ name, flag }) => {
    expect(registeredFunctions).toHaveProperty(name);
    expect(registeredFunctions[name]).toHaveProperty(flag, true);
  },
);
