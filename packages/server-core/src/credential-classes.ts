import type { CredentialClass } from "@wystack/secret-vault";

/** DashFrame credential-class identifiers registered with SecretRegistry at composition time. */
export const CREDENTIAL_CLASS = {
  ConnectorKey: "connector-key",
  ServeToken: "serve-token",
} as const satisfies Record<string, CredentialClass>;
