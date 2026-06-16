// Connector types
export type {
  ConnectorQueryResult,
  FileParseResult,
  FormField,
  FormFieldType,
  QueryOptions,
  RemoteDatabase,
  SourceType,
  ValidationResult,
} from "./types";

// Connector base classes and types
export {
  BaseConnector,
  FileSourceConnector,
  RemoteApiConnector,
  RemoteConnectorKind,
  isFileConnector,
  isRemoteApiConnector,
  isRemoteConnectorKind,
} from "./base";

export type { AnyConnector, SecretResolver } from "./base";

export {
  createFieldsFromColumns,
  createSourceSchema,
  detectPrimaryKeyColumn,
  inferStringColumnType,
  parsePrimitiveBoolean,
  parsePrimitiveValueByType,
  parseStringValueByType,
} from "./utils";

export type { ConnectorColumn, SystemFieldInput } from "./utils";
