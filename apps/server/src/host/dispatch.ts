import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { Value } from "convex/values";
import { isPrincipal, type Principal } from "@wystack/identity";
import { COMMAND_PATHS } from "@dashframe/types";
import type { ConvexIdentity } from "../convex-identity";
import type { ApplicationOperations } from "./application";
import type { HostContext } from "./context";
import { hostOperationByName } from "./registry";
import * as setup from "./connector-setup";

const queries = new Set([
  "projectInfo",
  "listDataSources",
  "getDataSource",
  "getDataSourceByType",
  "listDataTables",
  "getDataTable",
  "listDataFrames",
  "getDataFrameEntry",
  "getDataFrameByInsight",
  "listInsights",
  "getInsight",
  "listVisualizations",
  "getVisualization",
  "listDashboards",
  "getDashboard",
  "listDrafts",
  "getDraftLog",
  "draftPublishReview",
  "previewDiff",
]);
const mutations = new Set([
  "publishDraft",
  "discardDraft",
  "reviseDraft",
  "putDataFrameEntry",
  "updateDataFrameEntry",
]);
const commandPaths = new Set<string>(Object.values(COMMAND_PATHS));
function object(input: unknown): Record<string, Value> {
  const cleaned: unknown = JSON.parse(JSON.stringify(input ?? {}));
  if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned))
    throw new Error("Invalid operation input");
  return cleaned as Record<string, Value>;
}

export function createApplicationOperations(
  options: {
    convexUrl: string;
    identity: ConvexIdentity;
    context(principal: Principal): HostContext;
  },
  bound?: Principal,
): ApplicationOperations {
  const application: ApplicationOperations = {
    forPrincipal: (principal) =>
      createApplicationOperations(options, principal),
    async execute(name, input, context) {
      const principal = bound ?? context?.principal;
      if (!isPrincipal(principal)) throw new Error("Unauthorized");
      if (
        bound &&
        context?.principal &&
        JSON.stringify(bound) !== JSON.stringify(context.principal)
      )
        throw new Error("Principal mismatch");
      const host = options.context(principal);
      host.application = application.forPrincipal(principal);
      const operation = hostOperationByName(name);
      if (operation) return operation.execute(host, input);
      if (name === "completeConnectorOAuth")
        return setup.completeConnectorOAuth(
          host,
          z
            .object({
              state: z.string(),
              code: z.string().optional(),
              oauthError: z.string().optional(),
            })
            .strict()
            .parse(input),
        );
      if (name === "reissueConnectorSetupResume")
        return setup.reissueConnectorSetupResume(
          host,
          z.object({ sessionId: z.string().uuid() }).strict().parse(input),
        );
      if (name === "sweepConnectorSetupSessions")
        return setup.sweepConnectorSetupSessions(host, {});
      if (commandPaths.has(name)) {
        const batch = hostOperationByName("commitBatch")!;
        const result = (await batch.execute(host, {
          commands: [{ path: name, args: input }],
        })) as { results: Array<{ value: unknown }> };
        return result.results[0]?.value;
      }
      const args = {
        ...object(input),
        ...(context?.draftId ? { draftId: context.draftId } : {}),
      };
      const client = new ConvexHttpClient(options.convexUrl);
      client.setAuth(options.identity.issue(principal).token);
      if (queries.has(name))
        return client.query(
          makeFunctionReference<"query", Record<string, Value>, unknown>(
            `app:${name}`,
          ),
          args,
        );
      if (mutations.has(name))
        return client.mutation(
          makeFunctionReference<"mutation", Record<string, Value>, unknown>(
            `app:${name}`,
          ),
          args,
        );
      throw new Error("Unknown application operation");
    },
  };
  return application;
}
