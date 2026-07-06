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
  registerSection: (section: ContextPanelSection) => () => void;
  unregisterSection: (id: string) => void;
}

const ContextPanelRegistryContext = createContext<ContextPanelRegistry | null>(
  null,
);
const ContextPanelSectionsContext = createContext<ContextPanelSection[] | null>(
  null,
);

function replaceSection(
  current: ContextPanelSection[],
  section: ContextPanelSection,
) {
  const index = current.findIndex((item) => item.id === section.id);
  if (index === -1) return [...current, section];

  const next = [...current];
  next[index] = section;
  return next;
}

function removeSection(current: ContextPanelSection[], id: string) {
  return current.filter((item) => item.id !== id);
}

export function ContextPanelProvider({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<ContextPanelSection[]>([]);

  const unregisterSection = useCallback((id: string) => {
    setSections((current) => removeSection(current, id));
  }, []);

  const registerSection = useCallback(
    (section: ContextPanelSection) => {
      setSections((current) => replaceSection(current, section));
      return () => unregisterSection(section.id);
    },
    [unregisterSection],
  );

  const value = useMemo(
    () => ({ registerSection, unregisterSection }),
    [registerSection, unregisterSection],
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
  const { registerSection, unregisterSection } = useContextPanelRegistry();
  const sectionId = section?.id;
  const sectionTitle = section?.title;
  const sectionContent = section?.content;

  useEffect(() => {
    if (!sectionId) return;
    return () => unregisterSection(sectionId);
  }, [sectionId, unregisterSection]);

  useEffect(() => {
    if (!sectionId || sectionTitle === undefined) return;
    registerSection({
      id: sectionId,
      title: sectionTitle,
      content: sectionContent,
    });
  }, [registerSection, sectionContent, sectionId, sectionTitle]);
}
