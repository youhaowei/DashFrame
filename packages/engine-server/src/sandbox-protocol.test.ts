import { describe, expect, it } from "vite-plus/test";
import {
  SandboxFrameDecoder,
  SANDBOX_MAX_ARROW,
  decodeParams,
  encodeFrame,
  encodeParams,
  type SandboxFrame,
} from "./sandbox-protocol";

describe("sandbox pipe boundary", () => {
  it("handles fragmented and coalesced frames without confusing payload with metadata", () => {
    const received: SandboxFrame[] = [];
    const decoder = new SandboxFrameDecoder((frame) => received.push(frame));
    const data = Buffer.concat([
      encodeFrame({ id: 1 }, new Uint8Array([0, 255, 7])),
      encodeFrame({ id: 2 }),
    ]);
    for (const byte of data) decoder.push(new Uint8Array([byte]));
    expect(received.map((frame) => frame.metadata)).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    expect([...received[0]!.payload]).toEqual([0, 255, 7]);
  });

  it("rejects hostile lengths before allocating or waiting for the advertised payload", () => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(2, 0);
    header.writeUInt32BE(SANDBOX_MAX_ARROW + 1, 4);
    expect(() => new SandboxFrameDecoder(() => {}).push(header)).toThrow(
      "SANDBOX_MESSAGE_LIMIT",
    );
  });

  it("rejects malformed metadata and parameter objects; preserves bigint precision", () => {
    const wire = encodeFrame({ id: 1 });
    wire.fill(0, 8);
    expect(() => new SandboxFrameDecoder(() => {}).push(wire)).toThrow();
    const params = [null, true, "? inside a value", 1.25, 9007199254740993n];
    expect(
      decodeParams(JSON.parse(JSON.stringify(encodeParams(params)))),
    ).toEqual(params);
    expect(() => encodeParams([{ toString: () => "unsafe" }])).toThrow();
    expect(() => decodeParams([["bigint", "1e9"]])).toThrow();
  });
});
