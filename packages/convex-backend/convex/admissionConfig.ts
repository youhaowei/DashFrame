import type { AuthConfig } from "convex/server";

type Environment = Record<string, string | undefined>;

export function deploymentMode(environment: Environment = process.env) {
  const mode = environment.DASHFRAME_DEPLOYMENT_MODE;
  if (mode !== "local" && mode !== "hosted")
    throw new Error("DASHFRAME_DEPLOYMENT_MODE must be local or hosted");
  return mode;
}

function required(environment: Environment, name: string) {
  const value = environment[name];
  if (!value || value.trim() !== value)
    throw new Error(`Missing or invalid ${name}`);
  return value;
}

function issuer(environment: Environment, name: string) {
  const value = required(environment, name);
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error(`Invalid ${name}`);
  return value;
}

/** Embedded public keys let CI pin trust and reject shared RSA key material. */
function rsaModuli(jwks: string): Set<string> {
  const prefix = "data:application/json;base64,";
  if (!jwks.startsWith(prefix))
    throw new Error("Hosted JWKS must be an embedded public key set");
  const parsed: unknown = JSON.parse(atob(jwks.slice(prefix.length)));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("keys" in parsed) ||
    !Array.isArray(parsed.keys) ||
    parsed.keys.length === 0
  )
    throw new Error("Invalid hosted JWKS");
  const moduli = new Set<string>();
  for (const key of parsed.keys as unknown[]) {
    if (
      !key ||
      typeof key !== "object" ||
      !("kty" in key) ||
      key.kty !== "RSA" ||
      !("n" in key) ||
      typeof key.n !== "string" ||
      !("e" in key) ||
      typeof key.e !== "string" ||
      "d" in key ||
      "p" in key ||
      "q" in key
    )
      throw new Error("Hosted JWKS must contain public RSA keys only");
    if (!/^[A-Za-z0-9_-]+$/.test(key.n) || !/^[A-Za-z0-9_-]+$/.test(key.e))
      throw new Error("Invalid hosted RSA key");
    const modulus = atob(
      key.n.replaceAll("-", "+").replaceAll("_", "/"),
    ).replace(/^\x00+/, "");
    if (modulus.length < 256)
      throw new Error("Hosted RSA keys must be at least 2048 bits");
    moduli.add(btoa(modulus));
  }
  return moduli;
}

export function hostedTrust(environment: Environment = process.env) {
  if (deploymentMode(environment) !== "hosted")
    throw new Error("Hosted admission is unavailable in local mode");
  const runtimeIssuer = issuer(environment, "DASHFRAME_AUTH_ISSUER");
  const operatorIssuer = issuer(environment, "DASHFRAME_OPERATOR_AUTH_ISSUER");
  // Reject URL aliases as a configuration mistake, but retain the exact issuer
  // strings for JWT verification: RFC 7519 section 2 forbids canonicalizing iss.
  if (new URL(runtimeIssuer).href === new URL(operatorIssuer).href)
    throw new Error("Operator and runtime issuers must differ");
  const runtimeJwks = required(environment, "DASHFRAME_AUTH_JWKS");
  const operatorJwks = required(environment, "DASHFRAME_OPERATOR_AUTH_JWKS");
  const runtimeKeys = rsaModuli(runtimeJwks);
  const operatorKeys = rsaModuli(operatorJwks);
  if ([...operatorKeys].some((key) => runtimeKeys.has(key)))
    throw new Error("Operator and runtime RSA keys must differ");
  return { runtimeIssuer, operatorIssuer, runtimeJwks, operatorJwks };
}

export function admissionAuthConfig(
  environment: Environment = process.env,
): AuthConfig {
  if (deploymentMode(environment) === "local") {
    return {
      providers: [
        {
          type: "customJwt",
          issuer: required(environment, "DASHFRAME_AUTH_ISSUER"),
          jwks: required(environment, "DASHFRAME_AUTH_JWKS"),
          algorithm: "RS256",
          applicationID: "dashframe",
        },
      ],
    };
  }
  const trust = hostedTrust(environment);
  return {
    providers: [
      {
        type: "customJwt",
        issuer: trust.runtimeIssuer,
        jwks: trust.runtimeJwks,
        algorithm: "RS256",
        applicationID: "dashframe",
      },
      {
        type: "customJwt",
        issuer: trust.operatorIssuer,
        jwks: trust.operatorJwks,
        algorithm: "RS256",
        applicationID: "dashframe-operator",
      },
    ],
  };
}
