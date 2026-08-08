import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  upsertSection: (section: ContextPanelSection, owner: symbol) => void;
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
) {
  const index = current.findIndex((item) => item.id === section.id);
  if (index === -1) return [...current, section];

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
    (section: ContextPanelSection, owner: symbol) => {
      setRegisteredSections((current) =>
        replaceSection(current, { ...section, owner }),
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

function useContextPanelRegistry() {
  const registry = useContext(ContextPanelRegistryContext);
  if (!registry) {
    throw new Error(
      "Context panel outlet hooks must be used inside ContextPanelProvider",
    );
  }
  return registry;
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

export function useContextPanelSection(section: ContextPanelSection | null) {
  const { upsertSection, releaseSection } = useContextPanelRegistry();
  const sectionId = section?.id;
  const sectionTitle = section?.title;
  const sectionContent = section?.content;

  // One identity for this component's whole lifetime. Minting a fresh owner per
  // effect run would make a content update remove-then-append the section,
  // moving it to the end of the panel; ownership must outlive the content.
  const [owner] = useState(() => Symbol("context-panel-section"));

  // Content changes update the section in place — no removal, so order holds.
  useEffect(() => {
    if (!sectionId || sectionTitle === undefined) return;
    upsertSection(
      { id: sectionId, title: sectionTitle, content: sectionContent },
      owner,
    );
  }, [upsertSection, owner, sectionContent, sectionId, sectionTitle]);

  // Removal happens only on unmount or when the id itself changes, and only
  // while this owner still holds the slot — a newer binder that took the same
  // id keeps it.
  useEffect(() => {
    if (!sectionId) return;
    return () => releaseSection(sectionId, owner);
  }, [releaseSection, owner, sectionId]);
}
