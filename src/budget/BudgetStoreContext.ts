import { createContext } from "react";
import type { BudgetData } from "./model";
export const BUDGET_KEY = "flexspace.flowbudget.v1";
export interface BudgetStore {
  data: BudgetData;
  commit: (next: BudgetData, replacing?: boolean) => void | Promise<void>;
  undo: () => void | Promise<void>;
  canUndo: boolean;
  storageError: string;
  mode?: "cloud";
  saving?: boolean;
}
export const BudgetStoreContext = createContext<BudgetStore | null>(null);
