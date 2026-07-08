import type { SenStatsExpenseDocument } from '../../types';
import { currency, expenseCategoryColors, quarterlyExpenseRows } from './SenStatsHelpers';

interface SenStatsExpenseChartProps {
  expenses: Array<SenStatsExpenseDocument & { id: string }>;
  loading: boolean;
}

export function SenStatsExpenseChart({ expenses, loading }: SenStatsExpenseChartProps) {
  const rows = quarterlyExpenseRows(expenses);
  const categories = Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter((key) => key !== 'quarter'))));
  const maxTotal = Math.max(...rows.map((row) => categories.reduce((sum, category) => sum + Number(row[category] || 0), 0)), 1);

  if (loading) return <div className="senstats-chart-empty"><div className="empty-graphic pulse" /><strong>Loading expense trend…</strong><span>Listening for quarterly disclosure records.</span></div>;
  if (!rows.length) return <div className="senstats-chart-empty"><div className="empty-graphic" aria-hidden="true">∅</div><strong>No expense data available yet</strong><span>Once the sync finds quarterly records, this panel will become a spending trend chart.</span></div>;

  return (
    <div className="senstats-chart native-expense-chart" role="img" aria-label="Quarterly spending trend by category">
      <div className="expense-chart-legend">
        {categories.map((category) => <span key={category}><i style={{ background: expenseCategoryColors[category] ?? expenseCategoryColors.Other }} />{category}</span>)}
      </div>
      <div className="expense-chart-bars">
        {rows.map((row) => {
          const total = categories.reduce((sum, category) => sum + Number(row[category] || 0), 0);
          return (
            <article key={String(row.quarter)} className="expense-chart-row">
              <span>{row.quarter}</span>
              <div className="expense-chart-stack" title={`${row.quarter}: ${currency(total)}`}>
                {categories.map((category) => {
                  const value = Number(row[category] || 0);
                  if (!value) return null;
                  return <i key={category} style={{ width: `${Math.max((value / maxTotal) * 100, 3)}%`, background: expenseCategoryColors[category] ?? expenseCategoryColors.Other }} title={`${category}: ${currency(value)}`} />;
                })}
              </div>
              <strong>{currency(total)}</strong>
            </article>
          );
        })}
      </div>
    </div>
  );
}
