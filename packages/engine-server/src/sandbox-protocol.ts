/** Private pipe protocol. No path, credential, or host callback operations. */
export const SANDBOX_PROTOCOL = 1;
export const SANDBOX_MAX_METADATA = 64 * 1024;
export const SANDBOX_MAX_ARROW = 32 * 1024 * 1024;
export const SANDBOX_MAX_ROWS = 100_000;

export interface SandboxFrame {
  metadata: unknown;
  payload: Uint8Array;
}

export function encodeFrame(
  metadata: unknown,
  payload: Uint8Array = new Uint8Array(),
): Buffer {
  const json = Buffer.from(JSON.stringify(metadata));
  if (json.length > SANDBOX_MAX_METADATA || payload.length > SANDBOX_MAX_ARROW)
    throw new Error("SANDBOX_MESSAGE_LIMIT");
  const header = Buffer.alloc(8);
  header.writeUInt32BE(json.length, 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, json, payload]);
}

/** Fixed-size header first; reject advertised lengths before allocating body. */
export class SandboxFrameDecoder {
  private header = Buffer.alloc(8);
  private headerOffset = 0;
  private body: Buffer | undefined;
  private bodyOffset = 0;
  private metadataLength = 0;

  constructor(private readonly receive: (frame: SandboxFrame) => void) {}

  push(chunk: Uint8Array): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.body) {
        const count = Math.min(8 - this.headerOffset, chunk.length - offset);
        this.header.set(
          chunk.subarray(offset, offset + count),
          this.headerOffset,
        );
        this.headerOffset += count;
        offset += count;
        if (this.headerOffset !== 8) continue;
        this.metadataLength = this.header.readUInt32BE(0);
        const payloadLength = this.header.readUInt32BE(4);
        if (
          this.metadataLength < 2 ||
          this.metadataLength > SANDBOX_MAX_METADATA ||
          payloadLength > SANDBOX_MAX_ARROW
        )
          throw new Error("SANDBOX_MESSAGE_LIMIT");
        this.body = Buffer.alloc(this.metadataLength + payloadLength);
      }
      const count = Math.min(
        this.body.length - this.bodyOffset,
        chunk.length - offset,
      );
      this.body.set(chunk.subarray(offset, offset + count), this.bodyOffset);
      this.bodyOffset += count;
      offset += count;
      if (this.bodyOffset !== this.body.length) continue;
      const metadata: unknown = JSON.parse(
        this.body.subarray(0, this.metadataLength).toString("utf8"),
      );
      const payload = this.body.subarray(this.metadataLength);
      this.body = undefined;
      this.bodyOffset = 0;
      this.headerOffset = 0;
      this.receive({ metadata, payload });
    }
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("SANDBOX_PROTOCOL_ERROR");
  return value as Record<string, unknown>;
}

export function tableName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    value.includes("\0")
  )
    throw new Error("SANDBOX_INVALID_TABLE");
  return value;
}

export function encodeParams(params: readonly unknown[]): unknown[] {
  if (params.length > 256) throw new Error("SANDBOX_PARAMETER_LIMIT");
  let bytes = 0;
  return params.map((value) => {
    if (value === null) return ["null"];
    if (typeof value === "bigint") {
      const text = value.toString();
      if (!/^-?\d{1,39}$/.test(text))
        throw new Error("SANDBOX_INVALID_PARAMETER");
      return ["bigint", text];
    }
    if (typeof value === "string") {
      bytes += Buffer.byteLength(value);
      if (bytes > 16 * 1024) throw new Error("SANDBOX_PARAMETER_LIMIT");
      return ["string", value];
    }
    if (typeof value === "boolean") return ["boolean", value];
    if (typeof value === "number" && Number.isFinite(value))
      return ["number", value];
    throw new Error("SANDBOX_INVALID_PARAMETER");
  });
}

export function decodeParams(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 256)
    throw new Error("SANDBOX_INVALID_PARAMETER");
  return value.map((entry: unknown) => {
    if (!Array.isArray(entry)) throw new Error("SANDBOX_INVALID_PARAMETER");
    const [kind, item] = entry as unknown[];
    if (kind === "null" && entry.length === 1) return null;
    if (entry.length !== 2) throw new Error("SANDBOX_INVALID_PARAMETER");
    if (kind === "string" && typeof item === "string") return item;
    if (kind === "boolean" && typeof item === "boolean") return item;
    if (kind === "number" && typeof item === "number" && Number.isFinite(item))
      return item;
    if (
      kind === "bigint" &&
      typeof item === "string" &&
      /^-?\d{1,39}$/.test(item)
    )
      return BigInt(item);
    throw new Error("SANDBOX_INVALID_PARAMETER");
  });
}
