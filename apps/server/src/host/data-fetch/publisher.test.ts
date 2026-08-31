/// <reference types="vite/client" />
import { api, internal } from "@dashframe/convex-backend/api";
import schema from "@dashframe/convex-backend/schema";
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { HostContext } from "../context";
import type { PublishMaterialization } from "./materializer";
import {
  PublicationOutcomeUnknownError,
  publishMaterialization,
  publishWithConfirmation,
} from "./publisher";

const modules = import.meta.glob(
  "../../../../../packages/convex-backend/convex/**/*.ts",
);

describe("publication acknowledgement recovery", () => {
  it("recovers a real native materialization commit without publishing twice", async () => {
    const native = convexTest(schema, modules);
    const id = crypto.randomUUID();
    const sourceId = crypto.randomUUID(),
      tableId = crypto.randomUUID();
    const sourceFrameId = crypto.randomUUID(),
      fieldId = crypto.randomUUID();
    const fields = [
      {
        id: fieldId,
        name: "source value",
        tableId,
        type: "number" as const,
        sampleValues: [],
      },
    ];
    const table = {
      id: tableId,
      dataSourceId: sourceId,
      name: "Source table",
      table: "remote",
      fields,
      metrics: [],
      createdAt: 0,
    };
    await native.run((ctx) =>
      ctx.db.insert("dataTables", {
        ...table,
        workspaceId: "workspace",
        revision: 1,
      }),
    );
    const value: PublishMaterialization = {
      target: { kind: "ephemeral" },
      sources: [
        {
          source: {
            table,
            arrow: new Uint8Array([7]),
            fields,
            rowCount: 1,
            provenance: { connectorKind: "local", bindingVersion: "v1" },
          },
          frame: {
            id: sourceFrameId,
            fieldIds: [fieldId],
            rowCount: 1,
            schema: [{ id: fieldId, name: "source value", type: "number" }],
          },
        },
      ],
      result: {
        id,
        fieldIds: ["result"],
        rowCount: 1,
        schema: [{ id: "result", name: "result", type: "number" }],
      },
      definitionFingerprint: "fingerprint",
      provenance: { connectorKind: "local", bindingVersion: "v1" },
      fetchedAt: 100,
    };
    const publish = vi.fn(async (request: PublishMaterialization) => {
      const args = JSON.parse(
        JSON.stringify({ workspaceId: "workspace", value: request }),
      ) as FunctionArgs<typeof internal.host.publishMaterialization>;
      await native.mutation(internal.host.publishMaterialization, args);
      throw new Error("connection closed after commit");
    });
    const getOperation = vi.fn((operationId: string) =>
      native.query(internal.host.getOperation, {
        workspaceId: "workspace",
        operationId,
      }),
    );
    await expect(
      publishMaterialization(
        {
          metadata: { publishMaterialization: publish, getOperation },
        } as unknown as HostContext,
        value,
      ),
    ).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledOnce();
    expect(
      await native.query(internal.host.getDataTable, {
        workspaceId: "workspace",
        id: tableId,
      }),
    ).toMatchObject({ dataFrameId: sourceFrameId });
    expect(getOperation).toHaveBeenCalledWith(`materialize:${id}`);
    expect(
      await native
        .withIdentity({
          subject: "user",
          workspaceId: "workspace",
          principalKind: "user",
          userId: "user",
        })
        .query(api.app.getDataFrameEntry, { id }),
    ).toMatchObject({ id });
  });

  it("does not query confirmation on an acknowledged success", async () => {
    const getOperation = vi.fn(async () => null);
    await publishWithConfirmation(
      { getOperation },
      "operation",
      {},
      async () => {},
    );
    expect(getOperation).not.toHaveBeenCalled();
  });

  it.each(["absent", "different", "unavailable"] as const)(
    "keeps the outcome unknown when confirmation is %s",
    async (confirmation) => {
      const failure = new Error("lost acknowledgement");
      const getOperation = vi.fn(async () => {
        if (confirmation === "unavailable") throw new Error("offline");
        return confirmation === "absent"
          ? null
          : { request: { id: "different" }, result: null };
      });
      const result = await publishWithConfirmation(
        { getOperation },
        "materialize:frame",
        { id: "frame" },
        async () => {
          throw failure;
        },
      ).catch((error: unknown) => error);
      expect(result).toBeInstanceOf(PublicationOutcomeUnknownError);
      expect(result).toMatchObject({
        operationId: "materialize:frame",
        cause: failure,
      });
      expect(getOperation).toHaveBeenCalledOnce();
    },
  );

  it("compares JSON wire values independent of key order", async () => {
    const getOperation = vi.fn(async () => ({
      request: { nested: { bytes: { 0: 7 }, id: "frame" } },
      result: null,
    }));
    await expect(
      publishWithConfirmation(
        { getOperation },
        "operation",
        {
          nested: {
            id: "frame",
            optional: undefined,
            bytes: new Uint8Array([7]),
          },
        },
        async () => {
          throw new Error("lost");
        },
      ),
    ).resolves.toBeUndefined();
  });
});
