import { useContext } from "react";
import { BudgetStoreContext } from "./BudgetStoreContext";
export { BUDGET_KEY } from "./BudgetStoreContext";
export function useBudget() {
  const store = useContext(BudgetStoreContext);
  if (!store) throw new Error("Open a cloud budget before editing.");
  return store;
}
