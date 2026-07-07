import { useEffect, useState } from 'react';
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

function senatorPhotoUrl(senator?: SenStatsSenatorDocument) {
  const profilePhoto = senator?.profileDetails?.photoUrl;
  return senator?.photoUrl || (typeof profilePhoto === 'string' ? profilePhoto : undefined);
}

export function SenStatsSenatorsView({ senators, selectedSenator, filteredSenators, expenses, expenseLoading, groupOptions, provinceOptions, groupFilter, provinceFilter, searchTerm, recentlyChangedSenatorIds, onGroupFilterChange, onProvinceFilterChange, onSearchTermChange, onSelectSenator }: SenStatsSenatorsViewProps) {
  const [detailsOpen, setDetailsOpen] = useState(Boolean(selectedSenator));
  const totalExpenses = expenses.reduce((total, expense) => total + (Number(expense.amount) || 0), 0);
  const selectedProfileFields = selectedSenator ? Object.entries({ ...(selectedSenator.extraDetails ?? {}), ...(selectedSenator.profileDetails ?? {}) }).filter(([, value]) => typeof value === 'string' && value).slice(0, 8) : [];
  const selectedPhotoUrl = senatorPhotoUrl(selectedSenator);

  useEffect(() => {
    if (selectedSenator) setDetailsOpen(true);
  }, [selectedSenator?.id]);

  return <>
    <div className="senstats-group-key" aria-label="Group colour legend">
      {groupOptions.filter((group) => group !== 'All').map((group) => <span key={group} className={groupClassName(group)}><i />{group}</span>)}
    </div>
    <div className="senstats-filters">
      <label><span>Search</span><input value={searchTerm} onChange={(event) => onSearchTermChange(event.target.value)} placeholder="Search senator, province, group…" /></label>
      <label><span>Group / affiliation</span><select value={groupFilter} onChange={(event) => onGroupFilterChange(event.target.value)}>{groupOptions.map((group) => <option key={group}>{group}</option>)}</select></label>
      <label><span>Province / territory</span><select value={provinceFilter} onChange={(event) => onProvinceFilterChange(event.target.value)}>{provinceOptions.map((province) => <option key={province}>{province}</option>)}</select></label>
    </div>
    <div className="senstats-grid senstats-grid-full">
      <aside className="senator-list senator-list-full" aria-label="Canadian senators">
        {senators.length === 0 && <p className="muted">No senators synced yet. The daily workflow will populate this list once it runs.</p>}
        {filteredSenators.length === 0 && senators.length > 0 && <p className="muted">No senators match those filters.</p>}
        {filteredSenators.map((senator) => {
          const photoUrl = senatorPhotoUrl(senator);
          return <button key={senator.id} type="button" className={senator.id === selectedSenator?.id && detailsOpen ? `active ${groupClassName(senator.party)}` : groupClassName(senator.party)} onClick={() => { onSelectSenator(senator.id); setDetailsOpen(true); }}><span className="senator-avatar">{photoUrl && <img src={photoUrl} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} />}<i aria-hidden="true">{senator.name.slice(0, 1)}</i></span><strong>{senator.name}{recentlyChangedSenatorIds.has(senator.id) && <span className="history-badge" title="Recent affiliation change">↻</span>}</strong><span>{senator.province}</span><em>{senator.party}</em></button>;
        })}
      </aside>
      {selectedSenator && detailsOpen && <div className="expense-panel senator-drilldown" aria-live="polite">
        <div className="drilldown-header"><div><span>Senator details</span><strong>{selectedSenator.name}</strong></div><button type="button" onClick={() => setDetailsOpen(false)}>Close</button></div>
        <div className={`senstats-stat selected-senator-card ${groupClassName(selectedSenator.party)}`}>{selectedPhotoUrl && <img src={selectedPhotoUrl} alt={`${selectedSenator.name} portrait`} referrerPolicy="no-referrer" />}<span>Selected senator</span><strong>{selectedSenator.name}</strong><small>{selectedSenator.province} · {selectedSenator.party}</small>{selectedSenator.sourceUrl && <a href={selectedSenator.sourceUrl} target="_blank" rel="noreferrer">Official profile</a>}</div>
        <div className="senstats-stat"><span>Visible expenses</span><strong>{expenses.length ? currency(totalExpenses) : 'No data available'}</strong><small>{expenseLoading ? 'Syncing expense records…' : `${expenses.length} quarterly records`}</small></div>
        {selectedProfileFields.length > 0 && <div className="senstats-profile-data"><strong>Additional profile data</strong>{selectedProfileFields.map(([key, value]) => <p key={key}><span>{key.replace(/-/g, ' ')}</span><small>{String(value)}</small></p>)}</div>}
        <SenStatsExpenseChart expenses={expenses} loading={expenseLoading} />
      </div>}
    </div>
  </>;
}
