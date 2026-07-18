import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface HarnessCredentialRecord {
  id: string;
  projectId: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  revokedAt?: string;
}

export interface IssuedHarnessCredential {
  credential: HarnessCredentialRecord;
  token: string;
}

export interface HarnessCredentialIdentity {
  id: string;
  projectId: string;
  name: string;
}

export interface HarnessCredentialStore {
  issue(projectId: string, name: string): Promise<IssuedHarnessCredential>;
  list(projectId: string): Promise<HarnessCredentialRecord[]>;
  revoke(projectId: string, credentialId: string): Promise<boolean>;
  authenticate(
    projectId: string,
    token: string,
  ): Promise<HarnessCredentialIdentity | null>;
}

interface PersistedHarnessCredential extends HarnessCredentialRecord {
  verifier: string;
}

interface PersistedFile {
  version: 1;
  credentials: PersistedHarnessCredential[];
}

const EMPTY_FILE: PersistedFile = { version: 1, credentials: [] };
const TOKEN_PREFIX = "dfh_";

function verifier(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function matchesVerifier(token: string, expectedHex: string): boolean {
  const actual = Buffer.from(verifier(token), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function publicRecord(
  record: PersistedHarnessCredential,
): HarnessCredentialRecord {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    tokenPrefix: record.tokenPrefix,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
  };
}

/**
 * Host-local credential persistence. Files are keyed by project identity and
 * deliberately live outside the shareable project directory. Only SHA-256
 * verifiers of 256-bit random bearer credentials are written to disk.
 */
export class FileHarnessCredentialStore implements HarnessCredentialStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly rootDir: string) {}

  issue(projectId: string, name: string): Promise<IssuedHarnessCredential> {
    return this.exclusive(async () => {
      const normalizedName = name.trim();
      if (!normalizedName || normalizedName.length > 80) {
        throw new Error("Harness name must be between 1 and 80 characters");
      }

      const file = await this.read(projectId);
      const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
      const credential: PersistedHarnessCredential = {
        id: randomUUID(),
        projectId,
        name: normalizedName,
        tokenPrefix: token.slice(0, 12),
        verifier: verifier(token),
        createdAt: new Date().toISOString(),
      };
      file.credentials.push(credential);
      await this.write(projectId, file);
      return { credential: publicRecord(credential), token };
    });
  }

  list(projectId: string): Promise<HarnessCredentialRecord[]> {
    return this.exclusive(async () => {
      const file = await this.read(projectId);
      return file.credentials
        .map(publicRecord)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }

  revoke(projectId: string, credentialId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const file = await this.read(projectId);
      const credential = file.credentials.find(
        (candidate) => candidate.id === credentialId,
      );
      if (!credential || credential.revokedAt) return false;
      credential.revokedAt = new Date().toISOString();
      await this.write(projectId, file);
      return true;
    });
  }

  authenticate(
    projectId: string,
    token: string,
  ): Promise<HarnessCredentialIdentity | null> {
    return this.exclusive(async () => {
      if (!token.startsWith(TOKEN_PREFIX)) return null;
      const file = await this.read(projectId);
      const credential = file.credentials.find(
        (candidate) =>
          !candidate.revokedAt && matchesVerifier(token, candidate.verifier),
      );
      return credential
        ? {
            id: credential.id,
            projectId: credential.projectId,
            name: credential.name,
          }
        : null;
    });
  }

  private filePath(projectId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) {
      throw new Error("Invalid project id for harness credential store");
    }
    return path.join(this.rootDir, `${projectId}.json`);
  }

  private async read(projectId: string): Promise<PersistedFile> {
    try {
      const raw = await fs.readFile(this.filePath(projectId), "utf8");
      const parsed = JSON.parse(raw) as PersistedFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.credentials)) {
        throw new Error("Unsupported harness credential file");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...EMPTY_FILE, credentials: [] };
      }
      throw error;
    }
  }

  private async write(projectId: string, file: PersistedFile): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const target = this.filePath(projectId);
    const temporary = path.join(
      this.rootDir,
      `.${projectId}.${randomUUID()}.tmp`,
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
