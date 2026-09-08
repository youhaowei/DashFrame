import { api } from "@dashframe/convex-backend/api";
import type { SecretRef } from "@wystack/secret-vault";
import { isSecretRef } from "@wystack/secret-vault";
import { z } from "zod";
import { createHostedMetadataClient } from "./hosted-convex-metadata";
import {
  createHostedSourceMetadata,
  type HostedSourceMetadata,
  type HostedSourceMetadataOptions,
} from "./hosted-convex-source-operations";
import type { HostMetadata } from "./metadata";

const secretRef = z.custom<SecretRef>(isSecretRef, "Invalid SecretRef");
const baseUrl = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    if (
      Array.from(value).some(
        (character) =>
          character.charCodeAt(0) <= 32 ||
          character.charCodeAt(0) === 127 ||
          character === "\\",
      )
    )
      return false;
    try {
      const parsed = new URL(value);
      return (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash
      );
    } catch {
      return false;
    }
  }, "Invalid provider base URL");
const rowSchema = z
  .object({
    id: z.string().uuid(),
    providerId: z.string().trim().min(1),
    displayLabel: z.string().trim().min(1),
    authKind: z.enum(["api-key", "local", "oauth"]),
    baseUrl: baseUrl.nullable(),
    credentialRef: secretRef.nullable(),
    defaultModel: z.string().trim().min(1),
    isDefault: z.boolean(),
    createdAt: z.number().finite().nonnegative(),
    updatedAt: z.number().finite().nonnegative(),
  })
  .strict()
  .refine((row) => row.updatedAt >= row.createdAt, {
    message: "updatedAt cannot precede createdAt",
  });

export type HostedProviderMetadata = HostedSourceMetadata &
  Pick<
    HostMetadata,
    | "listAssistantProviderConfigs"
    | "getAssistantProviderConfig"
    | "saveAssistantProviderConfig"
    | "removeAssistantProviderConfig"
  >;

export type HostedProviderMetadataOptions = HostedSourceMetadataOptions;

/** Provider metadata scoped by the signed user and the injected workspace vault. */
export function createHostedProviderMetadata(
  options: HostedProviderMetadataOptions,
): HostedProviderMetadata {
  const client = createHostedMetadataClient(options);
  const credentialVault = options.credentialVault;
  return {
    ...createHostedSourceMetadata(options),
    listAssistantProviderConfigs: async () =>
      rowSchema
        .array()
        .parse(
          await (await client()).query(api.hostedProviderMetadata.list, {}),
        ),
    getAssistantProviderConfig: async (id) => {
      const parsedId = z.string().uuid().parse(id);
      const result = await (
        await client()
      ).query(api.hostedProviderMetadata.get, { id: parsedId });
      return result === null ? null : rowSchema.parse(result);
    },
    saveAssistantProviderConfig: async ({ row, expected }) => {
      const parsedRow = rowSchema.parse(row);
      const parsedExpected =
        expected === null ? null : rowSchema.parse(expected);
      const introduced =
        parsedRow.credentialRef !== null &&
        parsedRow.credentialRef !== parsedExpected?.credentialRef;
      if (
        introduced &&
        !(await credentialVault.has(parsedRow.credentialRef as SecretRef))
      )
        throw new Error("Provider credential is unavailable in this workspace");
      return rowSchema.parse(
        await (
          await client()
        ).mutation(api.hostedProviderMetadata.save, {
          row: parsedRow,
          expected: parsedExpected,
        }),
      );
    },
    removeAssistantProviderConfig: async ({ id, expected }) => {
      const parsedId = z.string().uuid().parse(id);
      const parsedExpected = rowSchema.parse(expected);
      if (parsedId !== parsedExpected.id)
        throw new Error("Provider configuration identity mismatch");
      await (
        await client()
      ).mutation(api.hostedProviderMetadata.remove, {
        id: parsedId,
        expected: parsedExpected,
      });
    },
  };
}
