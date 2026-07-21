import type { SecretRef, SecretVault } from "@wystack/secret-vault";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface AccessCredentialRecord {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  revokedAt?: string;
}

export interface IssuedAccessCredentialRecord {
  credential: AccessCredentialRecord;
  token: string;
}

interface PersistedAccessCredential extends AccessCredentialRecord {
  verifierRef: SecretRef;
}

interface PersistedFile {
  version: 1;
  credentials: PersistedAccessCredential[];
}

const EMPTY_FILE: PersistedFile = { version: 1, credentials: [] };
const TOKEN_PREFIX = "dfa_";

function verifier(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function matchesVerifier(token: string, expectedHex: string): boolean {
  const actual = Buffer.from(verifier(token), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function publicRecord(
  record: PersistedAccessCredential,
): AccessCredentialRecord {
  return {
    id: record.id,
    name: record.name,
    tokenPrefix: record.tokenPrefix,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
  };
}

/**
 * Named access-credential workflows for the current single-user workspace.
 * SecretVault owns verifier persistence. The host-local file is only the
 * listable inventory that SecretVault intentionally does not provide.
 */
export class ApiAccessCredentials {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly vault: SecretVault,
    private readonly rootDir: string,
  ) {}

  issue(name: string): Promise<IssuedAccessCredentialRecord> {
    return this.exclusive(async () => {
      const normalizedName = name.trim();
      if (!normalizedName || normalizedName.length > 80) {
        throw new Error("Credential name must be between 1 and 80 characters");
      }

      const file = await this.read();
      const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
      const id = randomUUID();
      const verifierRef = await this.vault.store(verifier(token), {
        class: "serve-token",
        locatorHint: `access-${id}`,
      });
      const credential: PersistedAccessCredential = {
        id,
        name: normalizedName,
        tokenPrefix: token.slice(0, 12),
        verifierRef,
        createdAt: new Date().toISOString(),
      };
      file.credentials.push(credential);
      try {
        await this.write(file);
      } catch (error) {
        await this.vault.delete(verifierRef).catch(() => undefined);
        throw error;
      }
      return { credential: publicRecord(credential), token };
    });
  }

  list(): Promise<AccessCredentialRecord[]> {
    return this.exclusive(async () => {
      const file = await this.read();
      return file.credentials
        .map(publicRecord)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }

  revoke(credentialId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const file = await this.read();
      const credential = file.credentials.find(
        (candidate) => candidate.id === credentialId,
      );
      if (!credential || credential.revokedAt) return false;
      credential.revokedAt = new Date().toISOString();
      await this.write(file);
      await this.vault.delete(credential.verifierRef).catch(() => undefined);
      return true;
    });
  }

  authenticate(token: string): Promise<string | null> {
    return this.exclusive(async () => {
      if (!token.startsWith(TOKEN_PREFIX)) return null;
      const file = await this.read();
      for (const credential of file.credentials) {
        if (credential.revokedAt) continue;
        if (!token.startsWith(credential.tokenPrefix)) continue;
        if (!(await this.vault.has(credential.verifierRef))) continue;
        const matches = await this.vault.withSecret(
          credential.verifierRef,
          async (expected) => matchesVerifier(token, expected),
        );
        if (matches) return credential.id;
      }
      return null;
    });
  }

  private filePath(): string {
    return path.join(this.rootDir, "credentials.json");
  }

  private async read(): Promise<PersistedFile> {
    try {
      const raw = await fs.readFile(this.filePath(), "utf8");
      const parsed = JSON.parse(raw) as PersistedFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.credentials)) {
        throw new Error("Unsupported access credential file");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...EMPTY_FILE, credentials: [] };
      }
      throw error;
    }
  }

  private async write(file: PersistedFile): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const target = this.filePath();
    const temporary = path.join(
      this.rootDir,
      `.credentials.${randomUUID()}.tmp`,
    );
    await fs.writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporary, target);
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
