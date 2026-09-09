import { z } from "zod";
import type { SecretKeyringConfig } from "../secret-file-backend";
import type {
  ConnectorSetupSessionRow,
  ConnectorSetupStore,
  SessionExpected,
} from "./session-store";
import {
  StableEncryptedDocument,
  type StableDocumentDependencies,
} from "../host/stable-encrypted-document";

const state = z.enum([
  "awaiting-user-auth",
  "exchanging",
  "verifying",
  "connected",
  "failed",
  "expired",
]);
const ownerSubject = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value && !/[\s\p{Cc}]/u.test(value), {
    message: "Invalid connector session owner",
  });
const row = z
  .object({
    id: z.string().min(1),
    ownerSubject,
    connectorId: z.string().min(1),
    requestedName: z.string(),
    state,
    stateNonceHash: z.string().regex(/^[a-f0-9]{64}$/),
    codeVerifier: z.string().min(43),
    scopes: z.array(z.string()),
    dataSourceId: z.string().nullable(),
    failureCode: z.string().nullable(),
    failureMessage: z.string().nullable(),
    expiresAt: z.number().finite(),
    createdAt: z.number().finite(),
    updatedAt: z.number().finite(),
  })
  .strict();
const snapshot = z
  .object({ version: z.literal(1), sessions: z.array(row) })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    const nonces = new Set<string>();
    for (const session of value.sessions) {
      if (ids.has(session.id))
        ctx.addIssue({ code: "custom", message: "Duplicate session ID" });
      if (nonces.has(session.stateNonceHash))
        ctx.addIssue({ code: "custom", message: "Duplicate session nonce" });
      ids.add(session.id);
      nonces.add(session.stateNonceHash);
    }
  });
const expectedSchema = z
  .object({
    state: state.optional(),
    stateNonceHash: z.string().optional(),
    dataSourceId: z.string().nullable().optional(),
    updatedAt: z.number().finite().optional(),
  })
  .strict();
const patchSchema = z
  .object({
    state: state.optional(),
    stateNonceHash: z.string().optional(),
    codeVerifier: z.string().optional(),
    dataSourceId: z.string().nullable().optional(),
    failureCode: z.string().nullable().optional(),
    failureMessage: z.string().nullable().optional(),
    updatedAt: z.number().finite().optional(),
  })
  .strict();

type StoredRow = z.infer<typeof row>;
type Snapshot = z.infer<typeof snapshot>;

export type HostedConnectorSessionDocument = StableEncryptedDocument<Snapshot>;

/** Call only after the runtime has acquired exclusive ownership of the workspace volume. */
export function createHostedConnectorSessionDocument(
  directory: string,
  workspaceId: string,
  keyring: SecretKeyringConfig,
  dependencies?: StableDocumentDependencies,
): HostedConnectorSessionDocument {
  return new StableEncryptedDocument(
    directory,
    workspaceId,
    keyring,
    {
      empty: () => ({ version: 1, sessions: [] }),
      parse: (value) => snapshot.parse(value),
    },
    dependencies,
  );
}

/**
 * Attenuates one workspace document to the current verified owner. The owner
 * is captured by the server and never accepted from request JSON or a nonce.
 */
export function createHostedConnectorSessionStore(options: {
  document: HostedConnectorSessionDocument;
  ownerSubject: string;
  getDataSourceKind(id: string): Promise<string | null>;
}): ConnectorSetupStore {
  const owner = ownerSubject.parse(options.ownerSubject);
  const visible = (stored: StoredRow): ConnectorSetupSessionRow => {
    const { ownerSubject: _, ...session } = stored;
    return structuredClone(session);
  };
  const mine = (sessions: StoredRow[], id: string) =>
    sessions.find(
      (candidate) => candidate.id === id && candidate.ownerSubject === owner,
    );

  return {
    get: (id) =>
      options.document.read((document) => {
        const found = mine(document.sessions, id);
        return found ? visible(found) : null;
      }),
    findByNonce: (stateNonceHash) =>
      options.document.read((document) => {
        const found = document.sessions.find(
          (candidate) =>
            candidate.ownerSubject === owner &&
            candidate.stateNonceHash === stateNonceHash,
        );
        return found ? visible(found) : null;
      }),
    insert: async (session) => {
      const parsed = row.omit({ ownerSubject: true }).parse(session);
      await options.document.update((document) => {
        if (document.sessions.some((candidate) => candidate.id === parsed.id))
          throw new Error("Connector setup session already exists");
        if (
          document.sessions.some(
            (candidate) => candidate.stateNonceHash === parsed.stateNonceHash,
          )
        )
          throw new Error("Connector setup state collision");
        return {
          value: {
            version: 1,
            sessions: [
              ...document.sessions,
              { ...parsed, ownerSubject: owner },
            ],
          },
          result: undefined,
        };
      });
    },
    compareAndSwap: async (id, expected, patch) => {
      const parsedExpected = expectedSchema.parse(expected);
      const parsedPatch = patchSchema.parse(patch);
      return options.document.update((document) => {
        const index = document.sessions.findIndex(
          (candidate) =>
            candidate.id === id && candidate.ownerSubject === owner,
        );
        if (index < 0) return { value: document, result: null, changed: false };
        const current = document.sessions[index]!;
        if (!matches(current, parsedExpected))
          return { value: document, result: null, changed: false };
        const updated = row.parse({ ...current, ...parsedPatch });
        if (
          updated.stateNonceHash !== current.stateNonceHash &&
          document.sessions.some(
            (candidate, candidateIndex) =>
              candidateIndex !== index &&
              candidate.stateNonceHash === updated.stateNonceHash,
          )
        )
          throw new Error("Connector setup state collision");
        const sessions = [...document.sessions];
        sessions[index] = updated;
        return {
          value: { version: 1, sessions },
          result: visible(updated),
        };
      });
    },
    list: (cursor) =>
      options.document.read((document) => {
        const sessions = document.sessions
          .filter((candidate) => candidate.ownerSubject === owner)
          .sort((a, b) => codeUnitCompare(a.id, b.id))
          .filter(
            (candidate) =>
              cursor === null || codeUnitCompare(candidate.id, cursor) > 0,
          );
        const page = sessions.slice(0, 100);
        return {
          page: page.map(visible),
          continueCursor: page.at(-1)?.id ?? "",
          isDone: sessions.length <= 100,
        };
      }),
    delete: (id, updatedBefore) =>
      options.document.update((document) => {
        const index = document.sessions.findIndex(
          (candidate) =>
            candidate.id === id && candidate.ownerSubject === owner,
        );
        const current = document.sessions[index];
        if (
          !current ||
          !["connected", "failed", "expired"].includes(current.state) ||
          current.updatedAt >= updatedBefore
        )
          return { value: document, result: false, changed: false };
        return {
          value: {
            version: 1,
            sessions: document.sessions.filter(
              (_, candidate) => candidate !== index,
            ),
          },
          result: true,
        };
      }),
    getDataSourceKind: options.getDataSourceKind,
  };
}

function matches(row: StoredRow, expected: SessionExpected): boolean {
  return Object.entries(expected).every(
    ([name, value]) => row[name as keyof SessionExpected] === value,
  );
}

function codeUnitCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
