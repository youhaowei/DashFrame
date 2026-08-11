import { duckdbColumnsToArrowIpc } from "@dashframe/engine-server";
import { openArtifactDb, schema } from "@dashframe/server-core";
import type { Principal } from "@wystack/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wy } from "../wystack";
import { dataFrameQueryFunctions } from "./data-frame-query";

const user: Principal = { kind: "user", userId: "local-user" };

describe("queryDataFrame", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-frame-query-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
  });
  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a bounded page through the server-owned table and rejects unsafe sorts", async () => {
    const id = crypto.randomUUID();
    await db.insert(schema.dataFrames).values({
      id,
      storage: { type: "file", key: id },
      fieldIds: ["country", "revenue"],
      name: "Revenue",
      rowCount: 2,
      columnCount: 2,
      analysis: {
        schema: [
          { id: "country", name: "Country", type: "string" },
          { id: "revenue", name: "Revenue", type: "number" },
        ],
      },
    });
    const registerArrowTable = vi.fn(async () => {});
    const queryArrow = vi.fn(async (sql: string) =>
      duckdbColumnsToArrowIpc(
        sql.includes("COUNT(*)")
          ? [{ name: "count", typeId: 4, values: [2] }]
          : [
              { name: "country", typeId: 17, values: ["CA"] },
              { name: "revenue", typeId: 4, values: [12] },
            ],
      ),
    );
    const app = await wy.build({ db, functions: dataFrameQueryFunctions });
    const storage = {
      load: vi.fn(async () => new Uint8Array([1])),
    };
    const call = (args: Record<string, unknown>) =>
      app.call("queryDataFrame", args, {
        principal: user,
        dataFrameStorage: storage as never,
        dataPlaneRuntime: { queryArrow, registerArrowTable },
      });

    const ready = await call({
      dataFrameId: id,
      offset: 1,
      limit: 1,
      sort: [{ fieldId: "revenue", direction: "desc" }],
    });
    expect(ready.result).toMatchObject({
      status: "ready",
      rows: [{ country: "CA", revenue: 12 }],
      totalCount: 2,
      page: { offset: 1, limit: 1, returned: 1 },
    });
    expect(registerArrowTable).toHaveBeenCalledWith(
      `df_${id.replaceAll("-", "_")}`,
      expect.any(Uint8Array),
    );
    expect(queryArrow).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY "revenue" DESC LIMIT ? OFFSET ?'),
      [1, 1],
    );

    const unsafe = await call({
      dataFrameId: id,
      sort: [{ fieldId: 'revenue"; DROP TABLE x; --', direction: "asc" }],
    });
    expect(unsafe.result).toMatchObject({ code: "QUERY_SORT_NOT_ALLOWED" });
  });
});
