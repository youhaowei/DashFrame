// Connector types
export type {
  ConnectorQueryResult,
  ConnectorFieldMetadata,
  DefinitionCompatibility,
  DefinitionQueryOptions,
  FileParseResult,
  FormField,
  FormFieldType,
  QueryOptions,
  RemoteDatabase,
  SourceType,
  ValidationResult,
  TableDefinition,
  TableOrigin,
  MetricRef,
  RatioExpression,
} from "./types";

// Connector base classes
export {
  BaseConnector,
  FileSourceConnector,
  RemoteApiConnector,
  isFileConnector,
  isRemoteApiConnector,
  supportsDefinitions,
} from "./base";

export type { AnyConnector, DefinitionConnector, SecretResolver } from "./base";

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
