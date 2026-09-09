// Public surface of the shared renderer. Hosts point their tanstackRouter
// plugin's routesDirectory at packages/app/src/routes and import these.
export {
  RouteRoot,
  type AppRouterContext,
  type ProviderWrapper,
} from "./routeRoot";

export {
  ChartEngineProvider,
  useChartEngine,
  type ChartEngineProviderProps,
  type MosaicConnector,
} from "./components/providers/ChartEngineProvider";

export {
  createAppRuntime,
  resolveAppConfig,
  type AppRuntime,
  type AppRuntimeConfig,
} from "./data/runtime";

export {
  startHostBootstrap,
  type ClientRuntime,
  type HostAccessResult,
  type HostBootstrapController,
  type HostBootstrapDependencies,
  type HostBootstrapView,
} from "./bootstrap/host-bootstrap-controller";

export { startHostSession } from "./bootstrap/host-session";

export {
  lookupHostRuntime,
  sameHostRuntime,
  type HostRuntimeConfig,
  type RuntimeReply,
} from "./bootstrap/runtime-transport";
