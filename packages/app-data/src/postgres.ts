import type { Field, UUID } from "@dashframe/types";
import { useMutation } from "@wystack/client";
import { useMemo } from "react";

import { api } from "./api";
import { loose } from "./wystack-args";

export interface PostgresTableRef {
  id: string;
  title: string;
}

export interface PostgresQueryResult {
  arrowBuffer: string;
  fieldIds: string[];
  fields: Field[];
  rowCount: number;
}

/** Server-backed Postgres operations. Credentials remain in SecretVault. */
export function usePostgresMutations() {
  const listMutation = useMutation(api.listPostgresTables);
  const queryMutation = useMutation(api.queryPostgresTable);

  return useMemo(
    () => ({
      listTables: async (dataSourceId: UUID): Promise<PostgresTableRef[]> =>
        (await listMutation.mutateAsync({
          dataSourceId,
        })) as PostgresTableRef[],
      queryTable: async (
        dataSourceId: UUID,
        databaseId: string,
        tableId: UUID,
        limit?: number,
      ): Promise<PostgresQueryResult> =>
        (await queryMutation.mutateAsync(
          loose({ dataSourceId, databaseId, tableId, limit }),
        )) as PostgresQueryResult,
    }),
    [listMutation, queryMutation],
  );
}
