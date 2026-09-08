import { z } from "zod";
import { v } from "convex/values";

/** Hosted metadata carries opaque references, never connector credentials. */
const secretRef = z
  .string()
  .regex(/^secret:[0-9a-f-]{36}$/i, "Credential must be a staged SecretRef");
const sourceConfig = z.strictObject({
  apiKey: secretRef.optional(),
  connectionString: secretRef.optional(),
  defaultSchema: z.string().optional(),
  // The binding registry accepts legacy v1 and GA4 acquisition v2.
  sourceBindingVersion: z.enum(["v1", "v2"]).optional(),
});

/** Native argument validation rejects unknown fields before a mutation runs. */
export const hostedSourceConfigValidator = v.object({
  apiKey: v.optional(v.string()),
  connectionString: v.optional(v.string()),
  defaultSchema: v.optional(v.string()),
  sourceBindingVersion: v.optional(v.union(v.literal("v1"), v.literal("v2"))),
});

/** Also validate expected state: CAS input must not upload plaintext credentials. */
export function parseHostedSourceConfig(value: unknown) {
  return sourceConfig.parse(value);
}
