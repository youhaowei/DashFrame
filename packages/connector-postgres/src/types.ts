/**
 * Config for PostgresConnector.
 *
 * Credential is stored as a SecretRef — never plaintext.
 * The DSN (host/port/db/user/password as a single connection string) lives in
 * SecretVault and is resolved server-side via the bound SecretResolver.
 */
export interface PostgresConnectorConfig {
  /**
   * SecretRef pointing to the plaintext DSN in the vault.
   * Format: "secret:<uuid>". Never a raw postgres:// string.
   * Optional: when omitted, the bound SecretResolver provides the credential.
   * Present only to surface the ref in config introspection endpoints.
   */
  connectionStringRef?: string;

  /**
   * Optional default schema to introspect for table/view listing.
   * Defaults to "public" when omitted.
   */
  defaultSchema?: string;
}
