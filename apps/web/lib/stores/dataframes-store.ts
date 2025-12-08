"use client";

import "./config";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UUID, DataFrameSerialization } from "@dashframe/dataframe";
import {
  DataFrame as DataFrameClass,
  deleteArrowData,
} from "@dashframe/dataframe";
import { superjsonStorage } from "./storage";

// ============================================================================
// State Interface
// ============================================================================

/**
 * Extended serialization with metadata for UI display.
 * The base DataFrameSerialization only contains storage info.
 * We add name/source tracking for user-facing features.
 */
export interface DataFrameEntry extends DataFrameSerialization {
  name: string;
  insightId?: UUID; // Link to insight that produced this DataFrame
  rowCount?: number; // Cached for display (may be stale)
  columnCount?: number;
}

interface DataFramesState {
  dataFrames: Map<UUID, DataFrameEntry>;
  _cachedEntries: DataFrameEntry[]; // Cached entries for stable selector references
}

interface DataFramesActions {
  /**
   * Add a DataFrame instance to the store.
   * Data is already persisted to IndexedDB by DataFrame.create().
   * This only stores the serialization reference in localStorage.
   */
  addDataFrame: (
    dataFrame: DataFrameClass,
    metadata: {
      name: string;
      insightId?: UUID;
      rowCount?: number;
      columnCount?: number;
    },
  ) => UUID;

  /**
   * Get a DataFrame instance by ID.
   * Returns the class instance that can load data from IndexedDB.
   */
  getDataFrame: (id: UUID) => DataFrameClass | undefined;

  /**
   * Get DataFrame entry with metadata (for UI display).
   */
  getEntry: (id: UUID) => DataFrameEntry | undefined;

  /**
   * Get DataFrame entry by insight ID.
   */
  getByInsight: (insightId: UUID) => DataFrameEntry | undefined;

  /**
   * Update DataFrame metadata (name, insightId, counts).
   */
  updateMetadata: (
    id: UUID,
    updates: Partial<
      Pick<DataFrameEntry, "name" | "insightId" | "rowCount" | "columnCount">
    >,
  ) => void;

  /**
   * Replace DataFrame data (for re-uploads or updates).
   * Deletes old Arrow data from IndexedDB and stores new reference.
   */
  replaceDataFrame: (
    id: UUID,
    newDataFrame: DataFrameClass,
    metadata?: { rowCount?: number; columnCount?: number },
  ) => Promise<void>;

  /**
   * Remove DataFrame and its IndexedDB data.
   */
  removeDataFrame: (id: UUID) => Promise<void>;

  /**
   * Get all entries with metadata.
   */
  getAllEntries: () => DataFrameEntry[];

  /**
   * Clear all DataFrames and their IndexedDB data.
   */
  clear: () => Promise<void>;
}

type DataFramesStore = DataFramesState & DataFramesActions;

// ============================================================================
// Store Implementation
// ============================================================================

export const useDataFramesStore = create<DataFramesStore>()(
  persist(
    immer((set, get) => ({
      // Initial state
      dataFrames: new Map(),
      _cachedEntries: [],

      addDataFrame: (dataFrame, metadata) => {
        const id = dataFrame.id;
        const serialization = dataFrame.toJSON();

        const entry: DataFrameEntry = {
          ...serialization,
          name: metadata.name,
          insightId: metadata.insightId,
          rowCount: metadata.rowCount,
          columnCount: metadata.columnCount,
        };

        set((state) => {
          state.dataFrames.set(id, entry);
          state._cachedEntries = Array.from(state.dataFrames.values());
        });

        return id;
      },

      getDataFrame: (id) => {
        const entry = get().dataFrames.get(id);
        return entry ? DataFrameClass.fromJSON(entry) : undefined;
      },

      getEntry: (id) => {
        return get().dataFrames.get(id);
      },

      getByInsight: (insightId) => {
        const entries = Array.from(get().dataFrames.values());
        return entries.find((e) => e.insightId === insightId);
      },

      updateMetadata: (id, updates) => {
        set((state) => {
          const entry = state.dataFrames.get(id);
          if (entry) {
            if (updates.name !== undefined) entry.name = updates.name;
            if (updates.insightId !== undefined)
              entry.insightId = updates.insightId;
            if (updates.rowCount !== undefined)
              entry.rowCount = updates.rowCount;
            if (updates.columnCount !== undefined)
              entry.columnCount = updates.columnCount;
          }
        });
      },

      replaceDataFrame: async (id, newDataFrame, metadata) => {
        const oldEntry = get().dataFrames.get(id);

        // Delete old Arrow data from IndexedDB (safety check for legacy data)
        if (oldEntry?.storage?.type === "indexeddb") {
          await deleteArrowData(oldEntry.storage.key);
        }

        // Update with new DataFrame reference
        const newSerialization = newDataFrame.toJSON();

        set((state) => {
          const entry = state.dataFrames.get(id);
          if (entry) {
            entry.storage = newSerialization.storage;
            entry.fieldIds = newSerialization.fieldIds;
            entry.primaryKey = newSerialization.primaryKey;
            entry.createdAt = newSerialization.createdAt;
            if (metadata?.rowCount !== undefined)
              entry.rowCount = metadata.rowCount;
            if (metadata?.columnCount !== undefined)
              entry.columnCount = metadata.columnCount;
          }
          state._cachedEntries = Array.from(state.dataFrames.values());
        });
      },

      removeDataFrame: async (id) => {
        const entry = get().dataFrames.get(id);

        // Delete Arrow data from IndexedDB (safety check for legacy data)
        if (entry?.storage?.type === "indexeddb") {
          await deleteArrowData(entry.storage.key);
        }

        set((state) => {
          state.dataFrames.delete(id);
          state._cachedEntries = Array.from(state.dataFrames.values());
        });
      },

      getAllEntries: () => {
        return get()._cachedEntries;
      },

      clear: async () => {
        // Delete all Arrow data from IndexedDB
        const entries = get().dataFrames.values();
        for (const entry of entries) {
          // Safety check for entries that may not have storage (legacy data)
          if (entry.storage?.type === "indexeddb") {
            await deleteArrowData(entry.storage.key);
          }
        }

        set((state) => {
          state.dataFrames.clear();
          state._cachedEntries = [];
        });
      },
    })),
    {
      name: "dashframe:dataframes",
      storage: superjsonStorage,
      partialize: (state) => ({
        dataFrames: state.dataFrames,
      }),
      skipHydration: true,
    },
  ),
);
