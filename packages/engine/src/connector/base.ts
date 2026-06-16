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

// ---------------------------------------------------------------------------
// SecretResolver — the one-ref-bound capability the connector is constructed
// with. The connector calls this to open its own secret, and ONLY its own
// secret: the vault and the ref are not in scope at the call site.
//
// Type: `(use) => Promise<T>` where `use` receives the plaintext and returns
// a `T`. Plaintext never escapes the callback — the resolver is structurally
// identical to `SecretVault.withSecret(ref, use)` pre-bound to one ref.
// ---------------------------------------------------------------------------

/**
 * A capability-attenuated secret lease pre-bound to exactly one secret ref.
 *
 * The connector is CONSTRUCTED with this resolver instead of receiving a
 * credential at call time. The data pipeline that calls `connect()` /
 * `query()` never has the vault, the ref, or the plaintext in scope —
 * capability attenuation is enforced by construction.
 *
 * Usage:
 * ```ts
 * const resolver: SecretResolver = (use) => vault.withSecret(ref, use);
 * const connector = new NotionConnector(resolver);
 * await connector.query(databaseId, tableId); // no credential arg
 * ```
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
   * @param formData - Optional form configuration data
   * @throws Error on parse failure
   */
  abstract parse(
    file: File,
    tableId: UUID,
    formData?: Record<string, unknown>,
  ): Promise<FileParseResult>;
}

/**
 * Remote API connector — the auth-bound execution object.
 *
 * Auth-blind data plane: the connector is CONSTRUCTED with a
 * {@link SecretResolver} pre-bound to exactly one secret ref. Data methods
 * (`connect`, `query`) take data args only — no credential is ever passed at
 * call time. The pipeline that calls these methods has no vault, ref, or
 * plaintext in scope.
 *
 * Always obtain a connector instance through a factory (e.g.
 * `createNotionConnector(auth)`), never by constructing directly in caller
 * code that has a vault in scope.
 *
 * Two-phase workflow:
 * 1. connect() - Authenticate and list available databases
 * 2. query() - Fetch data from a specific database
 */
export abstract class RemoteApiConnector extends BaseConnector {
  readonly sourceType = "remote-api" as const;

  /** One-ref-bound secret lease. Resolves the connector's own secret only. */
  protected readonly auth: SecretResolver;

  constructor(auth: SecretResolver) {
    super();
    this.auth = auth;
  }

  /**
   * Connect and list available databases.
   *
   * Auth-blind: credentials are resolved internally via `this.auth`.
   * @throws Error on connection failure
   */
  abstract connect(): Promise<RemoteDatabase[]>;

  /**
   * Query a specific database.
   *
   * Auth-blind: credentials are resolved internally via `this.auth`.
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

// ---------------------------------------------------------------------------
// RemoteConnectorKind — the registry-storable descriptor for a remote
// connector KIND (metadata + factory). Separates static metadata from
// auth-bound execution.
//
// The connector registry stores RemoteConnectorKind instances, not
// RemoteApiConnector instances. At connect / query time, call
// `kind.createConnector(auth)` to get a properly bound connector.
// ---------------------------------------------------------------------------

/**
 * Registry-storable descriptor for a remote API connector kind.
 *
 * Carries metadata (id, name, icon, getFormFields, validate) and a factory
 * method (`createConnector`). Stored in the connector registry in place of
 * an auth-bound `RemoteApiConnector` instance — the registry never holds a
 * live auth-bound connector.
 *
 * Call `kind.createConnector(auth)` at the construction seam (where vault +
 * ref are in scope) to mint an auth-bound connector for data operations.
 */
export abstract class RemoteConnectorKind extends BaseConnector {
  readonly sourceType = "remote-api" as const;

  /**
   * Factory: create an auth-bound connector for this kind.
   *
   * @param auth - One-ref-bound lease: `(use) => vault.withSecret(ref, use)`
   */
  abstract createConnector(auth: SecretResolver): RemoteApiConnector;
}

/**
 * Union type for any connector storable in the registry.
 *
 * - {@link FileSourceConnector}: file upload connector (auth-free)
 * - {@link RemoteConnectorKind}: remote API connector descriptor (metadata + factory)
 */
export type AnyConnector = FileSourceConnector | RemoteConnectorKind;

/**
 * Type guard to check if a connector is a file source connector.
 */
export function isFileConnector(
  connector: AnyConnector,
): connector is FileSourceConnector {
  return connector.sourceType === "file";
}

/**
 * Type guard to check if a connector is a remote connector kind descriptor.
 *
 * Returns `true` for {@link RemoteConnectorKind} instances. To get an
 * auth-bound connector, call `connector.createConnector(auth)`.
 */
export function isRemoteConnectorKind(
  connector: AnyConnector,
): connector is RemoteConnectorKind {
  // Structural guard: check sourceType AND the factory method.
  // sourceType alone is insufficient — auth-bound RemoteApiConnector instances
  // also carry sourceType "remote-api" but lack createConnector(). The factory
  // check ensures callers can safely call connector.createConnector(auth).
  return (
    connector.sourceType === "remote-api" &&
    "createConnector" in connector &&
    typeof (connector as RemoteConnectorKind).createConnector === "function"
  );
}

/**
 * @deprecated Use {@link isRemoteConnectorKind} instead.
 *
 * The registry now stores {@link RemoteConnectorKind} descriptors, not
 * auth-bound {@link RemoteApiConnector} instances. Renamed for clarity.
 */
export const isRemoteApiConnector = isRemoteConnectorKind;
