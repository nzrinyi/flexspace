import { useEffect, useState } from 'react';
import type { SenStatsExpenseDocument, SenStatsSenatorDocument } from '../../types';
import { currency, groupClassName, groupLabel } from './SenStatsHelpers';
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

  const showDetails = Boolean(selectedSenator && detailsOpen);

  return <>
    <div className="senstats-group-key" aria-label="Group colour legend">
      {groupOptions.filter((group) => group !== 'All').map((group) => <span key={group} className={groupClassName(group)}><i />{groupLabel(group)}</span>)}
    </div>
    <div className="senstats-filters">
      <label><span>Search</span><input value={searchTerm} onChange={(event) => onSearchTermChange(event.target.value)} placeholder="Search senator, province, group…" /></label>
      <label><span>Group / affiliation</span><select value={groupFilter} onChange={(event) => onGroupFilterChange(event.target.value)}>{groupOptions.map((group) => <option key={group}>{group}</option>)}</select></label>
      <label><span>Province / territory</span><select value={provinceFilter} onChange={(event) => onProvinceFilterChange(event.target.value)}>{provinceOptions.map((province) => <option key={province}>{province}</option>)}</select></label>
    </div>
    <div className={`senstats-grid senator-workspace ${showDetails ? 'with-details' : ''}`}>
      <section className="senator-list-panel" aria-label="Canadian senators">
        {senators.length === 0 && <p className="muted">No senators synced yet. The daily workflow will populate this list once it runs.</p>}
        {filteredSenators.length === 0 && senators.length > 0 && <p className="muted">No senators match those filters.</p>}
        {filteredSenators.length > 0 && <table className="senator-table">
          <thead><tr><th>Photo</th><th>Name</th><th className="optional-col">Province</th><th>Group</th><th className="history-col">History</th></tr></thead>
          <tbody>
            {filteredSenators.map((senator) => {
              const photoUrl = senatorPhotoUrl(senator);
              const active = senator.id === selectedSenator?.id && detailsOpen;
              return <tr key={senator.id} className={`${active ? 'active ' : ''}${groupClassName(senator.party)}`} onClick={() => { onSelectSenator(senator.id); setDetailsOpen(true); }} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { onSelectSenator(senator.id); setDetailsOpen(true); } }}><td><span className="senator-avatar">{photoUrl && <img src={photoUrl} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} />}<i aria-hidden="true">{senator.name.slice(0, 1)}</i></span></td><td><strong>{senator.name}</strong></td><td className="optional-col">{senator.province}</td><td><em title={senator.party}>{groupLabel(senator.party)}</em></td><td className="history-col">{recentlyChangedSenatorIds.has(senator.id) ? <span className="history-badge" title="Recent affiliation change">↻</span> : '—'}</td></tr>;
            })}
          </tbody>
        </table>}
      </section>
      {selectedSenator && detailsOpen && <aside className="expense-panel senator-drilldown" aria-live="polite">
        <div className="drilldown-header"><div><span>Senator details</span><strong>{selectedSenator.name}</strong></div><button type="button" onClick={() => setDetailsOpen(false)}>Close</button></div>
        <div className={`senstats-stat selected-senator-card ${groupClassName(selectedSenator.party)}`}>{selectedPhotoUrl && <img src={selectedPhotoUrl} alt={`${selectedSenator.name} portrait`} referrerPolicy="no-referrer" />}<span>Profile</span><small>{selectedSenator.province} · {groupLabel(selectedSenator.party)}</small>{selectedSenator.sourceUrl && <a href={selectedSenator.sourceUrl} target="_blank" rel="noreferrer">Official profile</a>}</div>
        <div className="senstats-stat"><span>Visible expenses</span><strong>{expenses.length ? currency(totalExpenses) : 'No data available'}</strong><small>{expenseLoading ? 'Syncing expense records…' : `${expenses.length} quarterly records`}</small></div>
        {selectedProfileFields.length > 0 && <div className="senstats-profile-data"><strong>Additional profile data</strong>{selectedProfileFields.map(([key, value]) => <p key={key}><span>{key.replace(/-/g, ' ')}</span><small>{String(value)}</small></p>)}</div>}
        <SenStatsExpenseChart expenses={expenses} loading={expenseLoading} />
      </aside>}
    </div>
  </>;
}
