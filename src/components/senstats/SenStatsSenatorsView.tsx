import type { SenStatsExpenseDocument, SenStatsSenatorDocument } from '../../types';
import { currency, groupClassName } from './SenStatsHelpers';
import { SenStatsExpenseChart } from './SenStatsExpenseChart';

interface SenStatsSenatorsViewProps {
  senators: SenStatsSenatorDocument[];
  selectedSenator?: SenStatsSenatorDocument;
  filteredSenators: SenStatsSenatorDocument[];
  expenses: Array<SenStatsExpenseDocument & { id: string }>;
  expenseLoading: boolean;
  groupOptions: string[];
  provinceOptions: string[];
  groupFilter: string;
  provinceFilter: string;
  searchTerm: string;
  recentlyChangedSenatorIds: Set<string>;
  onGroupFilterChange: (value: string) => void;
  onProvinceFilterChange: (value: string) => void;
  onSearchTermChange: (value: string) => void;
  onSelectSenator: (id: string) => void;
}

export function SenStatsSenatorsView({ senators, selectedSenator, filteredSenators, expenses, expenseLoading, groupOptions, provinceOptions, groupFilter, provinceFilter, searchTerm, recentlyChangedSenatorIds, onGroupFilterChange, onProvinceFilterChange, onSearchTermChange, onSelectSenator }: SenStatsSenatorsViewProps) {
  const totalExpenses = expenses.reduce((total, expense) => total + (Number(expense.amount) || 0), 0);
  return <>
    <div className="senstats-group-key" aria-label="Group colour legend">
      {groupOptions.filter((group) => group !== 'All').map((group) => <span key={group} className={groupClassName(group)}><i />{group}</span>)}
    </div>
    <div className="senstats-filters">
      <label><span>Search</span><input value={searchTerm} onChange={(event) => onSearchTermChange(event.target.value)} placeholder="Search senator, province, group…" /></label>
      <label><span>Group / affiliation</span><select value={groupFilter} onChange={(event) => onGroupFilterChange(event.target.value)}>{groupOptions.map((group) => <option key={group}>{group}</option>)}</select></label>
      <label><span>Province / territory</span><select value={provinceFilter} onChange={(event) => onProvinceFilterChange(event.target.value)}>{provinceOptions.map((province) => <option key={province}>{province}</option>)}</select></label>
    </div>
    <div className="senstats-grid">
      <aside className="senator-list" aria-label="Canadian senators">
        {senators.length === 0 && <p className="muted">No senators synced yet. The daily workflow will populate this list once it runs.</p>}
        {filteredSenators.length === 0 && senators.length > 0 && <p className="muted">No senators match those filters.</p>}
        {filteredSenators.map((senator) => <button key={senator.id} type="button" className={senator.id === selectedSenator?.id ? `active ${groupClassName(senator.party)}` : groupClassName(senator.party)} onClick={() => onSelectSenator(senator.id)}><strong>{senator.name}{recentlyChangedSenatorIds.has(senator.id) && <span className="history-badge" title="Recent affiliation change">↻</span>}</strong><span>{senator.province}</span><em>{senator.party}</em></button>)}
      </aside>
      <div className="expense-panel">
        {selectedSenator ? <><div className={`senstats-stat ${groupClassName(selectedSenator.party)}`}><span>Selected senator</span><strong>{selectedSenator.name}</strong><small>{selectedSenator.province} · {selectedSenator.party}</small></div><div className="senstats-stat"><span>Visible expenses</span><strong>{expenses.length ? currency(totalExpenses) : 'No data available'}</strong><small>{expenseLoading ? 'Syncing expense records…' : `${expenses.length} quarterly records`}</small></div><SenStatsExpenseChart expenses={expenses} loading={expenseLoading} /></> : <p className="muted">Choose a senator to inspect expenses.</p>}
      </div>
    </div>
  </>;
}
