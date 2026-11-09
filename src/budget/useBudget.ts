import { useEffect, useRef, useState } from "react";
import { emptyBudget, validateBudget, type BudgetData } from "./model";
export const BUDGET_KEY = "flexspace.flowbudget.v1";
function load() {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    return {
      data: raw ? validateBudget(JSON.parse(raw)) : emptyBudget(),
      error: "",
    };
  } catch {
    return {
      data: emptyBudget(),
      error:
        "Your saved budget could not be read. It has not been overwritten. Download the saved file before restoring a backup.",
    };
  }
}
export function useBudget() {
  const initial = useRef<ReturnType<typeof load> | null>(null);
  if (!initial.current) initial.current = load();
  const [data, setData] = useState(initial.current.data),
    [storageError, setStorageError] = useState(initial.current.error);
  const [demo, setDemo] = useState<BudgetData | null>(null);
  const current = useRef(data);
  current.current = data;
  const undoRef = useRef<BudgetData | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  useEffect(() => {
    function changed(event: StorageEvent) {
      if (event.key !== BUDGET_KEY) return;
      const loaded = load();
      if (loaded.error) {
        setStorageError(loaded.error);
        return;
      }
      setData(loaded.data);
      undoRef.current = null;
      setCanUndo(false);
      setStorageError(
        "Budget updated in another tab. Unsaved form drafts are kept; review before saving.",
      );
    }
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  function commit(next: BudgetData, replacing = false) {
    const source = demo ?? current.current;
    const checked = validateBudget({ ...next, revision: source.revision + 1 });
    if (demo) {
      setDemo(checked);
      return;
    }
    let stored: BudgetData | undefined;
    try {
      const raw = localStorage.getItem(BUDGET_KEY);
      if (raw) stored = validateBudget(JSON.parse(raw));
    } catch {
      if (!replacing)
        throw new Error(
          "Saved data is unreadable. Download it from Settings before restoring a backup.",
        );
    }
    if (!replacing && stored && stored.revision !== source.revision) {
      setData(stored);
      throw new Error(
        "This budget changed in another tab. The latest data is loaded. Review your draft and save again.",
      );
    }
    try {
      localStorage.setItem(BUDGET_KEY, JSON.stringify(checked));
    } catch {
      throw new Error(
        "Device storage is unavailable or full. Nothing was saved. Export a backup and free space, then retry.",
      );
    }
    undoRef.current = source;
    setCanUndo(true);
    setData(checked);
    setStorageError("");
  }
  function undo() {
    if (!undoRef.current) return;
    const previous = undoRef.current;
    commit({ ...previous, revision: current.current.revision });
    undoRef.current = null;
    setCanUndo(false);
  }
  return {
    data: demo ?? data,
    commit,
    storageError,
    canUndo: canUndo && !demo,
    undo,
    demo: Boolean(demo),
    startDemo: (sample: BudgetData) => setDemo(sample),
    exitDemo: () => setDemo(null),
  };
}
