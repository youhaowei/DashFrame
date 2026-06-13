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
