import type { UUID } from "@dashframe/types";
import type {
  ConnectorQueryResult,
  FileParseResult,
  FormField,
  QueryOptions,
  RemoteDatabase,
  SourceType,
  ValidationResult,
} from "./types";

/**
 * Bound secret resolver — capability-attenuated lease pre-bound to ONE secret ref.
 *
 * The connector factory mints one `SecretResolver` per connector instance, bound
 * to exactly the ref stored in `DataSource.config`. The resolver calls
 * `SecretVault.withSecret(ref, use)` internally. The connector calls
 * `this.auth(use => ...)` and receives the plaintext only inside `use`.
 *
 * Type-level attenuation: the return type is `Promise<T>` so the connector
 * cannot leak the plaintext string out of the callback — TS cannot express a
 * "string that must not escape", but the structural guarantee (T ≠ string
 * unless the caller explicitly returns it) is the best JS can do.
 *
 * The pipeline call site constructs the connector via the factory and then
 * calls `connector.query(databaseId, tableId)` — no ref, no vault, no
 * plaintext in scope.
 */
export type SecretResolver = <T>(
  use: (plaintext: string) => Promise<T>,
) => Promise<T>;

/**
 * Base connector class - stateless, pure config + methods.
 *
 * Connectors are "strategy" objects that define:
 * - Static configuration (id, name, description, icon)
 * - Form field definitions for dynamic UI
 * - Validation logic for form data
 *
 * State management is handled by React hooks, not the connector.
 */
export abstract class BaseConnector {
  /** Unique identifier for this connector */
  abstract readonly id: string;

  /** Display name shown in UI */
  abstract readonly name: string;

  /** Description shown below the name */
  abstract readonly description: string;

  /** Source type discriminant */
  abstract readonly sourceType: SourceType;

  /**
   * SVG string for the connector icon.
   * Sanitized with DOMPurify at render time.
   */
  abstract readonly icon: string;

  /**
   * Get form fields to render for this connector.
   * Return empty array if no configuration is needed.
   */
  abstract getFormFields(): FormField[];

  /**
   * Validate form data before executing an action.
   * @param formData - Form values keyed by field name
   * @returns Validation result with optional per-field errors
   */
  abstract validate(formData: Record<string, unknown>): ValidationResult;
}

/**
 * File source connector for local file uploads (CSV, Excel, etc.).
 *
 * NOTE: The `parse` method uses the browser's File API.
 * Only use in client components with "use client" directive.
 */
export abstract class FileSourceConnector extends BaseConnector {
  readonly sourceType = "file" as const;

  /** File input accept attribute (e.g., '.csv,text/csv') */
  abstract readonly accept: string;

  /** Maximum file size in MB (enforced in UI) */
  abstract readonly maxSizeMB?: number;

  /** Helper text shown below the file input */
  abstract readonly helperText?: string;

  /**
   * Parse an uploaded file into a DataFrame.
   *
   * NOTE: Browser-only - uses File API.
   *
   * @param file - The uploaded File object
   * @param tableId - UUID to assign to the resulting table
   * @throws Error on parse failure
   */
  abstract parse(file: File, tableId: UUID): Promise<FileParseResult>;
}

/**
 * Remote API connector for external services (Notion, Airtable, etc.).
 *
 * Auth-blind data pipeline: the connector is constructed with a bound
 * `SecretResolver` pre-bound to the DataSource's credential ref. The pipeline
 * never sees the vault, ref, or plaintext — only the typed data methods.
 *
 * Two-phase workflow:
 * 1. connect() - Authenticate and list available databases
 * 2. query() - Fetch data from a specific database
 *
 * Both methods resolve the credential via `this.auth(use => ...)` internally.
 * The call site has no vault or ref in scope — enforced by type.
 */
export abstract class RemoteApiConnector extends BaseConnector {
  readonly sourceType = "remote-api" as const;

  /**
   * Bound secret resolver — pre-bound to this connector's credential ref.
   * Call as: `await this.auth(apiKey => doSomethingWith(apiKey))`
   */
  protected readonly auth: SecretResolver;

  constructor(auth: SecretResolver) {
    super();
    this.auth = auth;
  }

  /**
   * Connect and list available databases.
   * Credentials are resolved internally via `this.auth`.
   * @throws Error on connection failure
   */
  abstract connect(): Promise<RemoteDatabase[]>;

  /**
   * Query a specific database.
   * Credentials are resolved internally via `this.auth`.
   * @param databaseId - ID of the database to query
   * @param tableId - UUID to assign to the resulting table
   * @param options - Optional pagination/filter options
   */
  abstract query(
    databaseId: string,
    tableId: UUID,
    options?: QueryOptions,
  ): Promise<ConnectorQueryResult>;
}

/**
 * Union type for any connector.
 */
export type AnyConnector = FileSourceConnector | RemoteApiConnector;

/**
 * Type guard to check if a connector is a file source connector.
 *
 * @example
 * ```typescript
 * if (isFileConnector(connector)) {
 *   // TypeScript knows connector is FileSourceConnector
 *   connector.parse(file, tableId);
 * }
 * ```
 */
export function isFileConnector(
  connector: AnyConnector,
): connector is FileSourceConnector {
  return connector.sourceType === "file";
}

/**
 * Type guard to check if a connector is a remote API connector.
 *
 * @example
 * ```typescript
 * if (isRemoteApiConnector(connector)) {
 *   // TypeScript knows connector is RemoteApiConnector
 *   await connector.connect();
 * }
 * ```
 */
export function isRemoteApiConnector(
  connector: AnyConnector,
): connector is RemoteApiConnector {
  return connector.sourceType === "remote-api";
}
