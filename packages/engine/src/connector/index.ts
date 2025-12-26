// Connector types
export type {
  SourceType,
  FormFieldType,
  FormField,
  ValidationResult,
  FileParseResult,
  RemoteDatabase,
  QueryOptions,
  ConnectorQueryResult,
} from "./types";

// Connector base classes
export {
  BaseConnector,
  FileSourceConnector,
  RemoteApiConnector,
  isFileConnector,
  isRemoteApiConnector,
} from "./base";

export type { AnyConnector } from "./base";
