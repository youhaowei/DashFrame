import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface ContextPanelSection {
  id: string;
  title: string;
  content: ReactNode;
}

interface ContextPanelRegistry {
  /** Add the section, or update it in place when its id is already present. */
  upsertSection: (
    section: ContextPanelSection,
    owner: symbol,
    claim: boolean,
  ) => void;
  /** Drop the section only while `owner` still holds it. */
  releaseSection: (id: string, owner: symbol) => void;
}

interface RegisteredContextPanelSection extends ContextPanelSection {
  owner: symbol;
}

const ContextPanelRegistryContext = createContext<ContextPanelRegistry | null>(
  null,
);
const ContextPanelSectionsContext = createContext<ContextPanelSection[] | null>(
  null,
);

function replaceSection(
  current: RegisteredContextPanelSection[],
  section: RegisteredContextPanelSection,
  claim: boolean,
) {
  const index = current.findIndex((item) => item.id === section.id);
  if (index === -1) return [...current, section];

  // A superseded owner may not take the slot back on a late content update —
  // it would then clear a live section when it finally unmounts.
  if (!claim && current[index]!.owner !== section.owner) return current;

  const next = [...current];
  next[index] = section;
  return next;
}

function removeSection(
  current: RegisteredContextPanelSection[],
  id: string,
  owner: symbol,
) {
  return current.filter((item) => item.id !== id || item.owner !== owner);
}

export function ContextPanelProvider({ children }: { children: ReactNode }) {
  const [registeredSections, setRegisteredSections] = useState<
    RegisteredContextPanelSection[]
  >([]);

  const upsertSection = useCallback(
    (section: ContextPanelSection, owner: symbol, claim: boolean) => {
      setRegisteredSections((current) =>
        replaceSection(current, { ...section, owner }, claim),
      );
    },
    [],
  );

  const releaseSection = useCallback((id: string, owner: symbol) => {
    setRegisteredSections((current) => removeSection(current, id, owner));
  }, []);

  const value = useMemo(
    () => ({ upsertSection, releaseSection }),
    [upsertSection, releaseSection],
  );
  const sections = useMemo(
    () => registeredSections.map(({ owner: _, ...section }) => section),
    [registeredSections],
  );

  return (
    <ContextPanelRegistryContext.Provider value={value}>
      <ContextPanelSectionsContext.Provider value={sections}>
        {children}
      </ContextPanelSectionsContext.Provider>
    </ContextPanelRegistryContext.Provider>
  );
}

export function useContextPanelSections() {
  const sections = useContext(ContextPanelSectionsContext);
  if (!sections) {
    throw new Error(
      "Context panel outlet hooks must be used inside ContextPanelProvider",
    );
  }
  return sections;
}
