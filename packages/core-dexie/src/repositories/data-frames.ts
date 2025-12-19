import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import type { UUID, DataFrame } from "@dashframe/types";
import {
  // Import the class for fromJSON() factory method
  // The class implements the DataFrame interface
  DataFrame as BrowserDataFrame,
  deleteArrowData,
} from "@dashframe/engine-browser";
import { db, type DataFrameEntity } from "../db";

// ============================================================================
// Types
// ============================================================================

/**
 * DataFrameEntry - Public DTO for DataFrame metadata.
 * Alias for DataFrameEntity (same structure) for API clarity.
 */
export type DataFrameEntry = DataFrameEntity;

/**
 * Result type for useDataFrames hook.
 */
export interface UseDataFramesResult {
  data: DataFrameEntry[] | undefined;
  isLoading: boolean;
}

/**
 * Mutation methods for data frames.
 */
export interface DataFrameMutations {
  /**
   * Add a DataFrame instance to the store.
   * Data is already persisted to IndexedDB by DataFrame.create().
   * This only stores the serialization reference in Dexie.
   */
  addDataFrame: (
    dataFrame: DataFrame,
    metadata: {
      name: string;
      insightId?: UUID;
      rowCount?: number;
      columnCount?: number;
    },
  ) => Promise<UUID>;

  /**
   * Get DataFrame entry with metadata (for UI display).
   */
  getEntry: (id: UUID) => Promise<DataFrameEntry | undefined>;

  /**
   * Get DataFrame entry by insight ID.
   */
  getByInsight: (insightId: UUID) => Promise<DataFrameEntry | undefined>;

  /**
   * Update DataFrame metadata (name, insightId, counts).
   */
  updateMetadata: (
    id: UUID,
    updates: Partial<
      Pick<DataFrameEntry, "name" | "insightId" | "rowCount" | "columnCount">
    >,
  ) => Promise<void>;

  /**
   * Replace DataFrame data (for re-uploads or updates).
   * Deletes old Arrow data from IndexedDB and stores new reference.
   */
  replaceDataFrame: (
    id: UUID,
    newDataFrame: DataFrame,
    metadata?: { rowCount?: number; columnCount?: number },
  ) => Promise<void>;

  /**
   * Remove DataFrame and its IndexedDB data.
   */
  removeDataFrame: (id: UUID) => Promise<void>;

  /**
   * Clear all DataFrames and their IndexedDB data.
   */
  clear: () => Promise<void>;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to read all data frames.
 * Returns reactive data that updates when IndexedDB changes.
 */
export function useDataFrames(): UseDataFramesResult {
  const data = useLiveQuery(() => db.dataFrames.toArray());

  return {
    data,
    isLoading: data === undefined,
  };
}

/**
 * Hook to get data frame mutations.
 * Returns stable mutation functions.
 */
export function useDataFrameMutations(): DataFrameMutations {
  return useMemo(
    () => ({
      addDataFrame: async (
        dataFrame: DataFrame,
        metadata: {
          name: string;
          insightId?: UUID;
          rowCount?: number;
          columnCount?: number;
        },
      ): Promise<UUID> => {
        const id = dataFrame.id;
        const serialization = dataFrame.toJSON();

        const entity: DataFrameEntity = {
          ...serialization,
          name: metadata.name,
          insightId: metadata.insightId,
          rowCount: metadata.rowCount,
          columnCount: metadata.columnCount,
        };

        await db.dataFrames.put(entity);
        return id;
      },

      getEntry: async (id: UUID): Promise<DataFrameEntry | undefined> => {
        const entity = await db.dataFrames.get(id);
        return entity ? entity : undefined;
      },

      getByInsight: async (
        insightId: UUID,
      ): Promise<DataFrameEntry | undefined> => {
        const entity = await db.dataFrames
          .where("insightId")
          .equals(insightId)
          .first();
        return entity ? entity : undefined;
      },

      updateMetadata: async (
        id: UUID,
        updates: Partial<
          Pick<
            DataFrameEntry,
            "name" | "insightId" | "rowCount" | "columnCount"
          >
        >,
      ): Promise<void> => {
        await db.dataFrames.update(id, updates);
      },

      replaceDataFrame: async (
        id: UUID,
        newDataFrame: DataFrame,
        metadata?: { rowCount?: number; columnCount?: number },
      ): Promise<void> => {
        const oldEntity = await db.dataFrames.get(id);

        // Delete old Arrow data from IndexedDB (safety check for legacy data)
        if (oldEntity?.storage?.type === "indexeddb") {
          await deleteArrowData(oldEntity.storage.key);
        }

        // Update with new DataFrame reference
        const newSerialization = newDataFrame.toJSON();

        await db.dataFrames.update(id, {
          storage: newSerialization.storage,
          fieldIds: newSerialization.fieldIds,
          primaryKey: newSerialization.primaryKey,
          createdAt: newSerialization.createdAt,
          rowCount: metadata?.rowCount,
          columnCount: metadata?.columnCount,
        });
      },

      removeDataFrame: async (id: UUID): Promise<void> => {
        const entity = await db.dataFrames.get(id);

        // Delete Arrow data from IndexedDB (safety check for legacy data)
        if (entity?.storage?.type === "indexeddb") {
          await deleteArrowData(entity.storage.key);
        }

        await db.dataFrames.delete(id);
      },

      clear: async (): Promise<void> => {
        // Delete all Arrow data from IndexedDB
        const entities = await db.dataFrames.toArray();
        for (const entity of entities) {
          // Safety check for entries that may not have storage (legacy data)
          if (entity.storage?.type === "indexeddb") {
            await deleteArrowData(entity.storage.key);
          }
        }

        await db.dataFrames.clear();
      },
    }),
    [],
  );
}

// ============================================================================
// Direct Access Functions (for non-React contexts)
// ============================================================================

/**
 * Get a DataFrame instance by ID.
 * Returns the class instance that can load data into DuckDB.
 *
 * Note: Returns the browser-specific BrowserDataFrame implementation
 * which has additional methods like load() for DuckDB integration.
 */
export async function getDataFrame(
  id: UUID,
): Promise<InstanceType<typeof BrowserDataFrame> | undefined> {
  const entity = await db.dataFrames.get(id);
  return entity ? BrowserDataFrame.fromJSON(entity) : undefined;
}

/**
 * Get DataFrame entry with metadata (for UI display).
 */
export async function getDataFrameEntry(
  id: UUID,
): Promise<DataFrameEntry | undefined> {
  const entity = await db.dataFrames.get(id);
  return entity ? entity : undefined;
}

/**
 * Get DataFrame entry by insight ID.
 */
export async function getDataFrameByInsight(
  insightId: UUID,
): Promise<DataFrameEntry | undefined> {
  const entity = await db.dataFrames
    .where("insightId")
    .equals(insightId)
    .first();
  return entity ? entity : undefined;
}

/**
 * Get all DataFrame entries.
 */
export async function getAllDataFrames(): Promise<DataFrameEntry[]> {
  const entities = await db.dataFrames.toArray();
  return entities;
}
