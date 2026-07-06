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
  sections: ContextPanelSection[];
  registerSection: (section: ContextPanelSection) => () => void;
}

const ContextPanelContext = createContext<ContextPanelRegistry | null>(null);

function replaceSection(
  current: ContextPanelSection[],
  section: ContextPanelSection,
) {
  return [...current.filter((item) => item.id !== section.id), section];
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
    () => ({ sections, registerSection }),
    [registerSection, sections],
  );

  return (
    <ContextPanelContext.Provider value={value}>
      {children}
    </ContextPanelContext.Provider>
  );
}

function useContextPanelRegistry() {
  const registry = useContext(ContextPanelContext);
  if (!registry) {
    throw new Error(
      "Context panel outlet hooks must be used inside ContextPanelProvider",
    );
  }
  return registry;
}

export function useContextPanelSections() {
  return useContextPanelRegistry().sections;
}

export function useContextPanelSection(section: ContextPanelSection | null) {
  const { registerSection } = useContextPanelRegistry();

  useEffect(() => {
    if (!section) return;
    return registerSection(section);
  }, [registerSection, section]);
}
