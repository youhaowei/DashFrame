import { z } from "zod";
import { object, type ObjectValue } from "./values";

/** Hosted metadata carries opaque references, never connector credentials. */
const secretRef = z
  .string()
  .regex(/^secret:[0-9a-f-]{36}$/i, "Credential must be a staged SecretRef");
const sourceConfig = z
  .object({
    apiKey: secretRef.optional(),
    connectionString: secretRef.optional(),
    password: z.never().optional(),
    token: z.never().optional(),
  })
  .passthrough();

/** Native argument validation bounds passthrough fields to Convex-safe JSON. */
export const hostedSourceConfigValidator = object;

/** Also validate expected state: CAS input must not upload plaintext credentials. */
export function parseHostedSourceConfig(value: unknown): ObjectValue & {
  apiKey?: string;
  connectionString?: string;
} {
  return sourceConfig.parse(value) as ObjectValue & {
    apiKey?: string;
    connectionString?: string;
  };
}
