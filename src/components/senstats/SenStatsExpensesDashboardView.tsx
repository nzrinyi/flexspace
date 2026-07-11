import { useMemo, useState } from 'react';
import type { SenStatsExpenseDocument, SenStatsSenatorDocument } from '../../types';
import { currency, groupClassName, groupLabel, quarterlyExpenseRows } from './SenStatsHelpers';
import { SenStatsExpenseChart } from './SenStatsExpenseChart';

type ExpensePivot = 'groups' | 'provinces' | 'individuals';
type ExpenseRow = SenStatsExpenseDocument & { id: string };
const CURRENT_YEAR = String(new Date().getFullYear());

interface ExpenseAggregateRow {
  key: string;
  label: string;
  total: number;
  count: number;
  average: number;
  senatorCount: number;
  averagePerSenator: number;
  value: number;
  className?: string;
}

function aggregateExpenses(expenses: ExpenseRow[], keyForExpense: (expense: ExpenseRow) => { key: string; label?: string; className?: string }, compareBy: 'total' | 'perSenator' = 'total') {
  const rows = new Map<string, ExpenseAggregateRow & { senatorIds: Set<string> }>();
  expenses.forEach((expense) => {
    const amount = Number(expense.amount) || 0;
    const { key, label, className } = keyForExpense(expense);
    const current = rows.get(key) ?? { key, label: label || key, total: 0, count: 0, average: 0, senatorCount: 0, averagePerSenator: 0, value: 0, className, senatorIds: new Set<string>() };
    current.total += amount;
    current.count += 1;
    current.average = current.count ? current.total / current.count : 0;
    if (expense.senatorId || expense.senatorName) current.senatorIds.add(expense.senatorId || expense.senatorName || 'Unknown');
    current.senatorCount = current.senatorIds.size;
    current.averagePerSenator = current.senatorCount ? current.total / current.senatorCount : current.total;
    current.value = compareBy === 'perSenator' ? current.averagePerSenator : current.total;
    if (label) current.label = label;
    if (className) current.className = className;
    rows.set(key, current);
  });
  return Array.from(rows.values()).map(({ senatorIds, ...row }) => row).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function ExpenseBarChart({ rows, emptyLabel = 'No expense records available for this view.', valueLabel = 'Total' }: { rows: ExpenseAggregateRow[]; emptyLabel?: string; valueLabel?: string }) {
  const maxValue = Math.max(...rows.map((row) => row.value), 1);
  const isPerSenator = valueLabel.toLowerCase().includes('senator');
  if (!rows.length) return <div className="senstats-chart-empty"><div className="empty-graphic" aria-hidden="true">∅</div><strong>No expense data</strong><span>{emptyLabel}</span></div>;
  return <div className="expense-pivot-chart" role="img" aria-label={`Expense ${valueLabel.toLowerCase()} by selected pivot`}>
    {rows.map((row) => <article key={row.key} className={`expense-pivot-row ${row.className || ''}`} title={`${row.label}: ${valueLabel} ${currency(row.value)}`}>
      <div><strong>{row.label}</strong><span>{isPerSenator ? `${row.senatorCount} senators · total ${currency(row.total)}` : `${row.count} records · average per record ${currency(row.average)}`}</span></div>
      <div className="expense-pivot-track"><i style={{ width: `${Math.max((row.value / maxValue) * 100, 3)}%` }} /></div>
      <b><span>{valueLabel}</span>{currency(row.value)}</b>
    </article>)}
  </div>;
}

function ExpensePivotSelector({ rows, activeKey, onSelect, label }: { rows: ExpenseAggregateRow[]; activeKey: string; onSelect: (key: string) => void; label: string }) {
  return <aside className="expense-pivot-selector" aria-label={label}>
    <span>{label}</span>
    <button type="button" className={activeKey === 'All' ? 'active' : ''} onClick={() => onSelect('All')}><strong>All</strong><small>{currency(rows.reduce((sum, row) => sum + row.total, 0))}</small></button>
    {rows.map((row) => <button key={row.key} type="button" className={`${activeKey === row.key ? 'active ' : ''}${row.className || ''}`} onClick={() => onSelect(row.key)}><strong>{row.label}</strong><small>{currency(row.value)}</small></button>)}
  </aside>;
}

function expenseYear(expense: ExpenseRow) {
  const match = String(expense.quarter || '').match(/\b(20\d{2})\b/);
  return match?.[1] || 'Unknown';
}

export function SenStatsExpensesDashboardView({ senators, expenses, selectedSenator, onSelectSenator, loading }: { senators: SenStatsSenatorDocument[]; expenses: ExpenseRow[]; selectedSenator?: SenStatsSenatorDocument; onSelectSenator: (id: string) => void; loading: boolean }) {
  const [activePivot, setActivePivot] = useState<ExpensePivot>('individuals');
  const [selectedGroup, setSelectedGroup] = useState('All');
  const [selectedProvince, setSelectedProvince] = useState('All');
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const senatorsById = useMemo(() => new Map(senators.map((senator) => [senator.id, senator])), [senators]);
  const yearOptions = useMemo(() => ['All time', ...Array.from(new Set([CURRENT_YEAR, ...expenses.map(expenseYear).filter((year) => year !== 'Unknown')])).sort((a, b) => b.localeCompare(a))], [expenses]);
  const yearFilteredExpenses = useMemo(() => selectedYear === 'All time' ? expenses : expenses.filter((expense) => expenseYear(expense) === selectedYear), [expenses, selectedYear]);
  const senatorExpenseRows = useMemo(() => aggregateExpenses(yearFilteredExpenses, (expense) => {
    const senator = senatorsById.get(expense.senatorId || '');
    return { key: expense.senatorId || senator?.id || expense.senatorName || 'Unknown', label: senator?.name || expense.senatorName || 'Unknown senator', className: groupClassName(senator?.party || '') };
  }), [yearFilteredExpenses, senatorsById]);
  const groupRows = useMemo(() => aggregateExpenses(yearFilteredExpenses, (expense) => {
    const senator = senatorsById.get(expense.senatorId || '');
    const group = senator?.party || 'Unknown';
    return { key: group, label: groupLabel(group), className: groupClassName(group) };
  }, 'perSenator'), [yearFilteredExpenses, senatorsById]);
  const provinceRows = useMemo(() => aggregateExpenses(yearFilteredExpenses, (expense) => {
    const senator = senatorsById.get(expense.senatorId || '');
    const province = senator?.province || 'Unknown';
    return { key: province, label: province };
  }, 'perSenator'), [yearFilteredExpenses, senatorsById]);
  const filteredByGroup = useMemo(() => selectedGroup === 'All' ? yearFilteredExpenses : yearFilteredExpenses.filter((expense) => (senatorsById.get(expense.senatorId || '')?.party || 'Unknown') === selectedGroup), [yearFilteredExpenses, selectedGroup, senatorsById]);
  const filteredByProvince = useMemo(() => selectedProvince === 'All' ? yearFilteredExpenses : yearFilteredExpenses.filter((expense) => (senatorsById.get(expense.senatorId || '')?.province || 'Unknown') === selectedProvince), [yearFilteredExpenses, selectedProvince, senatorsById]);
  const selectedSenatorExpenses = useMemo(() => selectedSenator ? yearFilteredExpenses.filter((expense) => expense.senatorId === selectedSenator.id) : [], [yearFilteredExpenses, selectedSenator]);
  const selectedQuarterRows = useMemo(() => quarterlyExpenseRows(selectedSenatorExpenses).slice(-8), [selectedSenatorExpenses]);
  const totalExpenses = yearFilteredExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);

  if (loading) return <div className="senstats-chart-empty"><div className="empty-graphic pulse" /><strong>Loading expense dashboard…</strong><span>Reading the shared expense dataset once for all pivots.</span></div>;

  return <section className="source-card source-wide expenses-dashboard" aria-label="Expense dashboards">
    <div className="source-heading expense-heading"><span>Expenses</span><strong>{selectedYear}</strong><small>{yearFilteredExpenses.length} records · {currency(totalExpenses)}</small><label>Year<select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}>{yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}</select></label></div>
    <div className="senstats-tabs nested-tabs expense-pivot-tabs" role="tablist" aria-label="Expense dashboard views">
      {(['individuals', 'groups', 'provinces'] as ExpensePivot[]).map((tab) => <button key={tab} type="button" className={activePivot === tab ? 'active' : ''} onClick={() => setActivePivot(tab)}>{tab === 'groups' ? 'By group' : tab === 'provinces' ? 'By province' : 'By individual'}</button>)}
    </div>

    {activePivot === 'groups' && <div className="expenses-dashboard-layout"><ExpensePivotSelector rows={groupRows} activeKey={selectedGroup} onSelect={setSelectedGroup} label="Group selector" /><div className="expense-pivot-content"><div className="source-heading"><span>Average per senator</span><strong>{selectedGroup === 'All' ? 'All parliamentary groups' : groupLabel(selectedGroup)}</strong><small>Groups are compared by average spending per senator; totals are shown as context.</small></div><ExpenseBarChart valueLabel={selectedGroup === 'All' ? 'Average per senator' : 'Total'} rows={selectedGroup === 'All' ? groupRows : aggregateExpenses(filteredByGroup, (expense) => { const senator = senatorsById.get(expense.senatorId || ''); return { key: senator?.name || expense.senatorName || 'Unknown', label: senator?.name || expense.senatorName || 'Unknown senator', className: groupClassName(senator?.party || '') }; })} /></div></div>}

    {activePivot === 'provinces' && <div className="expenses-dashboard-layout"><ExpensePivotSelector rows={provinceRows} activeKey={selectedProvince} onSelect={setSelectedProvince} label="Province selector" /><div className="expense-pivot-content"><div className="source-heading"><span>Average per senator</span><strong>{selectedProvince === 'All' ? 'All provinces and territories' : selectedProvince}</strong><small>Provinces are compared by average spending per senator; totals are shown as context.</small></div><ExpenseBarChart valueLabel={selectedProvince === 'All' ? 'Average per senator' : 'Total'} rows={selectedProvince === 'All' ? provinceRows : aggregateExpenses(filteredByProvince, (expense) => { const senator = senatorsById.get(expense.senatorId || ''); return { key: senator?.name || expense.senatorName || 'Unknown', label: senator?.name || expense.senatorName || 'Unknown senator', className: groupClassName(senator?.party || '') }; })} /></div></div>}

    {activePivot === 'individuals' && <div className="expenses-dashboard-layout"><ExpensePivotSelector rows={senatorExpenseRows} activeKey={selectedSenator?.id || 'All'} onSelect={(key) => { if (key !== 'All') onSelectSenator(key); }} label="Senator selector" /><div className="expense-pivot-content"><div className="source-heading"><span>Individual deep dive</span><strong>{selectedSenator?.name || 'Select a senator'}</strong><small>{selectedSenatorExpenses.length ? `${selectedSenatorExpenses.length} records · ${currency(selectedSenatorExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0))}` : 'No expense records available for this senator.'}</small></div>{selectedSenator ? <><SenStatsExpenseChart expenses={selectedSenatorExpenses} loading={false} /><div className="dashboard-table expense-quarter-table" role="table" aria-label="Selected senator quarterly expense totals"><div role="row" className="source-table-head"><span>Quarter</span><span>Total</span><span>Categories</span></div>{selectedQuarterRows.length === 0 ? <div role="row"><strong>No records available</strong><span>—</span><span>Quarterly expense rows will appear after the sync finds this senator.</span></div> : selectedQuarterRows.map((row) => { const total = Object.entries(row).filter(([key]) => key !== 'quarter').reduce((sum, [, value]) => sum + Number(value || 0), 0); const categories = Object.keys(row).filter((key) => key !== 'quarter').join(', '); return <div role="row" key={String(row.quarter)}><strong>{String(row.quarter)}</strong><span>{currency(total)}</span><span>{categories || 'Other'}</span></div>; })}</div></> : <p className="muted">Choose a senator from the selector to see the individual quarterly breakdown.</p>}</div></div>}
  </section>;
}
