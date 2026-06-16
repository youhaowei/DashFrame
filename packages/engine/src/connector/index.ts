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

// Connector base classes
export {
  BaseConnector,
  FileSourceConnector,
  RemoteApiConnector,
  isFileConnector,
  isRemoteApiConnector,
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
