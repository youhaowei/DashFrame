import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * The kind of artifact the assistant is currently bound to. The assistant is
 * always *contextual to the current artifact* — it acts on this object, it is
 * not a free-floating chat. When nothing is focused (list pages, settings) the
 * context is `null` and the assistant presents a route-level empty state.
 */
export type ArtifactKind =
  | "dashboard"
  | "visualization"
  | "insight"
  | "data-source"
  | "report";

export interface ArtifactContextValue {
  /** Discriminator for the focused artifact. */
  kind: ArtifactKind;
  /** Stable identifier (insight id, source id, …). */
  id: string;
  /** Human-facing name shown in the assistant header. */
  title: string;
  /** Optional one-line descriptor (e.g. row count, source type). */
  subtitle?: string;
}

interface ArtifactContextStore {
  /** The artifact the assistant is bound to, or null when none is focused. */
  artifact: ArtifactContextValue | null;
  /**
   * Bind the assistant to an artifact. Center surfaces call this on mount/focus
   * and clear it (`set(null)`) on unmount so the binding always reflects what
   * the user is actually looking at.
   */
  setArtifact: (artifact: ArtifactContextValue | null) => void;
}

const ArtifactContext = createContext<ArtifactContextStore | null>(null);

/**
 * Provides the assistant's artifact-context binding. Mounted once in the shell
 * so the assistant sidebar (right region) and the artifact surfaces (center
 * region) share one source of truth for "what is the assistant acting on".
 */
export function ArtifactContextProvider({ children }: { children: ReactNode }) {
  const [artifact, setArtifact] = useState<ArtifactContextValue | null>(null);
  const value = useMemo<ArtifactContextStore>(
    () => ({ artifact, setArtifact }),
    [artifact],
  );
  return (
    <ArtifactContext.Provider value={value}>
      {children}
    </ArtifactContext.Provider>
  );
}

/**
 * Read the current artifact binding (the assistant sidebar consumes this).
 * Returns `null` outside a provider so the hook is safe in isolation/tests.
 */
export function useArtifactContext(): ArtifactContextValue | null {
  return useContext(ArtifactContext)?.artifact ?? null;
}

/**
 * Bind the assistant to an artifact for the lifetime of a component. The center
 * surface calls this; on unmount the binding clears so the assistant never
 * points at a stale artifact.
 *
 * @example
 * useBindArtifact({ kind: "insight", id, title: insight.name });
 */
export function useBindArtifact(artifact: ArtifactContextValue | null): void {
  const set = useContext(ArtifactContext)?.setArtifact;
  // Serialize the binding so the effect re-runs only on a real change, not on
  // every render that produces a fresh object literal.
  const key = artifact
    ? `${artifact.kind}:${artifact.id}:${artifact.title}:${artifact.subtitle ?? ""}`
    : "";
  useEffect(() => {
    if (!set) return;
    set(artifact);
    return () => set(null);
    // `key` captures every field of `artifact`; depending on the object would
    // thrash on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, key]);
}
