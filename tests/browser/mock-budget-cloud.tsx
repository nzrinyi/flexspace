import { BudgetCloud as RealBudgetCloud } from "../../src/budget/BudgetCloud";
import type { CloudView } from "../../src/budget/BudgetCloud";
import type { ReactNode } from "react";
export function BudgetCloud({
  children,
  onSwitchApp,
}: {
  children: (view: CloudView) => ReactNode;
  onSwitchApp: () => void;
}) {
  if (new URLSearchParams(location.search).get("cloudTest") === "1")
    return (
      <RealBudgetCloud onSwitchApp={onSwitchApp}>{children}</RealBudgetCloud>
    );
  return children({
    onManage: () => {},
    name: "",
    saving: false,
    cloud: false,
  });
}
