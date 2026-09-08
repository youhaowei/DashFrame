import { expect, it } from "vite-plus/test";
import * as app from "@dashframe/convex-backend/app";
import { CONVEX_QUERY_NAMES, CONVEX_MUTATION_NAMES } from "./dispatch";

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
