import type { UUID } from "@dashframe/types";
import { describe, expect, it, vi } from "vitest";

import { connectRemoteSource } from "./remote-connector-onboarding";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111" as UUID;

describe("connectRemoteSource", () => {
  it("creates and probes a Postgres source with non-secret config separated", async () => {
    const addSource = vi.fn(async () => SOURCE_ID);
    const removeSource = vi.fn(async () => {});
    const listPostgresTables = vi.fn(async () => [
      { id: "analytics.orders", title: "orders" },
    ]);

    const result = await connectRemoteSource({
      connectorId: "postgres",
      connectorName: "Postgres",
      credentials: {
        connectionString: "postgres://user:secret@host/db",
        defaultSchema: " analytics ",
      },
      addSource,
      removeSource,
      listNotionDatabases: vi.fn(),
      listPostgresTables,
    });

    expect(addSource).toHaveBeenCalledWith({
      type: "postgres",
      name: "Postgres",
      apiKey: undefined,
      connectionString: "postgres://user:secret@host/db",
      config: { defaultSchema: "analytics" },
    });
    expect(listPostgresTables).toHaveBeenCalledWith(SOURCE_ID);
    expect(removeSource).not.toHaveBeenCalled();
    expect(result.resources).toEqual([
      { id: "analytics.orders", title: "orders" },
    ]);
  });

  it("removes a newly-created source when the connection probe fails", async () => {
    const removeSource = vi.fn(async () => {});

    await expect(
      connectRemoteSource({
        connectorId: "notion",
        connectorName: "Notion",
        credentials: { apiKey: "secret_test" },
        addSource: vi.fn(async () => SOURCE_ID),
        removeSource,
        listNotionDatabases: vi.fn(async () => {
          throw new Error("invalid token");
        }),
        listPostgresTables: vi.fn(),
      }),
    ).rejects.toThrow("invalid token");

    expect(removeSource).toHaveBeenCalledWith(SOURCE_ID);
  });
});
