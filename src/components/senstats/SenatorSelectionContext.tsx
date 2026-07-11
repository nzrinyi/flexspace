import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface SenatorSelectionContextValue {
  selectedSenatorId: string | null;
  drawerOpen: boolean;
  originLabel: string;
  selectSenator: (senatorId: string, originLabel?: string) => void;
  closeDrawer: () => void;
}

const SenatorSelectionContext = createContext<SenatorSelectionContextValue | null>(null);

export function SenatorSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedSenatorId, setSelectedSenatorId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [originLabel, setOriginLabel] = useState('');

  const value = useMemo(() => ({
    selectedSenatorId,
    drawerOpen,
    originLabel,
    selectSenator: (senatorId: string, nextOriginLabel = '') => {
      setSelectedSenatorId(senatorId);
      setOriginLabel(nextOriginLabel);
      setDrawerOpen(true);
    },
    closeDrawer: () => setDrawerOpen(false),
  }), [drawerOpen, originLabel, selectedSenatorId]);

  return <SenatorSelectionContext.Provider value={value}>{children}</SenatorSelectionContext.Provider>;
}

export function useSenatorSelect() {
  const context = useContext(SenatorSelectionContext);
  if (!context) throw new Error('useSenatorSelect must be used inside SenatorSelectionProvider');
  return context;
}
