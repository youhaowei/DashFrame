import {
  type ReactNode,
  createContext,
  useCallback,
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
   * Bind the assistant to an artifact. The returned cleanup only clears this
   * registration when it still owns the current binding.
   */
  registerArtifact: (artifact: ArtifactContextValue | null) => () => void;
}

const ArtifactContext = createContext<ArtifactContextStore | null>(null);

/**
 * Provides the assistant's artifact-context binding. Mounted once in the shell
 * so the assistant sidebar (right region) and the artifact surfaces (center
 * region) share one source of truth for "what is the assistant acting on".
 */
export function ArtifactContextProvider({ children }: { children: ReactNode }) {
  const [binding, setBinding] = useState<{
    artifact: ArtifactContextValue | null;
    owner: symbol;
  } | null>(null);

  const registerArtifact = useCallback(
    (artifact: ArtifactContextValue | null) => {
      const owner = Symbol("artifact-context-binding");
      setBinding({ artifact, owner });
      return () => {
        setBinding((current) => (current?.owner === owner ? null : current));
      };
    },
    [],
  );

  const artifact = binding?.artifact ?? null;
  const value = useMemo<ArtifactContextStore>(
    () => ({ artifact, registerArtifact }),
    [artifact, registerArtifact],
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
  const registerArtifact = useContext(ArtifactContext)?.registerArtifact;
  const kind = artifact?.kind;
  const id = artifact?.id;
  const title = artifact?.title;
  const subtitle = artifact?.subtitle;
  // Each artifact field is a separate dependency, avoiding delimiter aliases
  // while still ignoring fresh object literals with unchanged contents.
  const binding = useMemo(
    () =>
      kind && id !== undefined && title !== undefined
        ? { kind, id, title, ...(subtitle === undefined ? {} : { subtitle }) }
        : null,
    [id, kind, subtitle, title],
  );

  useEffect(() => {
    if (!registerArtifact) return;
    return registerArtifact(binding);
  }, [binding, registerArtifact]);
}
