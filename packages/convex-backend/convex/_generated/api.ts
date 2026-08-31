import {
  anyApi,
  type ApiFromModules,
  type FilterApi,
  type FunctionReference,
} from "convex/server";
import type * as app from "../app";
import type * as host from "../host";
const fullApi = anyApi as unknown as ApiFromModules<{
  app: typeof app;
  host: typeof host;
}>;
export const api = fullApi as FilterApi<
  typeof fullApi,
  FunctionReference<"query" | "mutation", "public">
>;
export const internal = fullApi as FilterApi<
  typeof fullApi,
  FunctionReference<"query" | "mutation", "internal">
>;
