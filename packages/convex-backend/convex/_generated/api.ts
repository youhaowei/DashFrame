import {
  anyApi,
  type ApiFromModules,
  type FilterApi,
  type FunctionReference,
} from "convex/server";
import type * as app from "../app";
import type * as host from "../host";
import type * as connectorSetup from "../connectorSetup";
import type * as admission from "../admission";
import type * as hostedMetadata from "../hostedMetadata";
import type * as hostedLifecycle from "../hostedLifecycle";
import type * as hostedSourceOperations from "../hostedSourceOperations";
import type * as hostedProviderMetadata from "../hostedProviderMetadata";
const fullApi = anyApi as unknown as ApiFromModules<{
  app: typeof app;
  host: typeof host;
  connectorSetup: typeof connectorSetup;
  admission: typeof admission;
  hostedMetadata: typeof hostedMetadata;
  hostedLifecycle: typeof hostedLifecycle;
  hostedSourceOperations: typeof hostedSourceOperations;
  hostedProviderMetadata: typeof hostedProviderMetadata;
}>;
export const api = fullApi as FilterApi<
  typeof fullApi,
  FunctionReference<"query" | "mutation", "public">
>;
export const internal = fullApi as FilterApi<
  typeof fullApi,
  FunctionReference<"query" | "mutation", "internal">
>;
