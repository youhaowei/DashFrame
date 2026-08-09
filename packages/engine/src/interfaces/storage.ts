import type { UUID } from "@dashframe/types";

/**
 * DataFrameStorage interface - Persistence for DataFrame binary data.
 *
 * Implementations handle storing and retrieving Arrow IPC buffers:
 * - IndexedDBStorage (engine-browser) - Browser IndexedDB
 * - S3Storage (engine-server) - AWS S3
 * - FileStorage (engine-server) - Local filesystem
 */
export interface DataFrameStorage {
  /**
   * Store a DataFrame's binary data.
   * @param id - Unique identifier for the data
   * @param data - Arrow IPC buffer
   */
  save(id: UUID, data: Uint8Array): Promise<void>;

  /**
   * Retrieve a DataFrame's binary data.
   * @param id - Unique identifier for the data
   * @returns Arrow IPC buffer or null if not found
   */
  load(id: UUID): Promise<Uint8Array | null>;

  /**
   * Delete a DataFrame's binary data.
   * @param id - Unique identifier for the data
   */
  delete(id: UUID): Promise<void>;

  /**
   * Optional reversible delete used when binary storage and artifact metadata
   * must cross one failure boundary. Implementations move bytes out of the
   * active namespace, then either commit or roll back after the DB transaction.
   */
  stageDelete?(id: UUID): Promise<string | null>;
  commitDelete?(token: string): Promise<void>;
  rollbackDelete?(token: string): Promise<void>;
  /** Reconcile interrupted staged deletes against committed metadata. */
  recoverStagedDeletes?(referencedIds: readonly UUID[]): Promise<void>;

  /**
   * Check if a DataFrame exists in storage.
   * @param id - Unique identifier for the data
   */
  exists(id: UUID): Promise<boolean>;

  /**
   * List all stored DataFrame IDs.
   */
  list(): Promise<UUID[]>;

  /**
   * Get storage usage information.
   */
  getUsage(): Promise<{ count: number; totalBytes?: number }>;
}
