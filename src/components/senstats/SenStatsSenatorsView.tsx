import { useMemo, useState } from 'react';
import type { SenStatsSenatorDocument } from '../../types';
import { groupClassName, groupFullName, groupLabel } from './SenStatsHelpers';

interface SenStatsSenatorsViewProps {
  senators: SenStatsSenatorDocument[];
  selectedSenator?: SenStatsSenatorDocument;
  filteredSenators: SenStatsSenatorDocument[];
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

type SenatorSortKey = 'name' | 'province' | 'group';

function senatorPhotoUrl(senator?: SenStatsSenatorDocument) {
  const profilePhoto = senator?.profileDetails?.photoUrl;
  return senator?.photoUrl || (typeof profilePhoto === 'string' ? profilePhoto : undefined);
}

function SortButton({ active, direction, label, onClick }: { active: boolean; direction: 'asc' | 'desc'; label: string; onClick: () => void }) {
  return <button type="button" className={`senator-sort-button ${active ? 'active' : ''}`} onClick={onClick}>
    {label}<span aria-hidden="true">{active ? (direction === 'asc' ? '▲' : '▼') : '↕'}</span>
  </button>;
}

export function SenStatsSenatorsView({ senators, selectedSenator, filteredSenators, groupOptions, provinceOptions, groupFilter, provinceFilter, searchTerm, recentlyChangedSenatorIds, onGroupFilterChange, onProvinceFilterChange, onSearchTermChange, onSelectSenator }: SenStatsSenatorsViewProps) {
  const [sortKey, setSortKey] = useState<SenatorSortKey>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [hoveredGroup, setHoveredGroup] = useState('');
  const hasActiveFilters = searchTerm.trim() || groupFilter !== 'All' || provinceFilter !== 'All';
  const sortedSenators = useMemo(() => [...filteredSenators].sort((a, b) => {
    const aValue = sortKey === 'group' ? groupLabel(a.party) : String(a[sortKey] || '');
    const bValue = sortKey === 'group' ? groupLabel(b.party) : String(b[sortKey] || '');
    const result = aValue.localeCompare(bValue, undefined, { sensitivity: 'base' }) || a.name.localeCompare(b.name);
    return sortDirection === 'asc' ? result : -result;
  }), [filteredSenators, sortDirection, sortKey]);
  const changeSort = (nextKey: SenatorSortKey) => {
    if (nextKey === sortKey) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(nextKey);
    setSortDirection('asc');
  };
  const clearFilters = () => {
    onSearchTermChange('');
    onGroupFilterChange('All');
    onProvinceFilterChange('All');
  };

  return <>
    <div className="senstats-group-key" aria-label="Group colour legend">
      {groupOptions.filter((group) => group !== 'All').map((group) => <span key={group} className={groupClassName(group)} title={groupFullName(group)} onMouseEnter={() => setHoveredGroup(group)} onMouseLeave={() => setHoveredGroup('')} onFocus={() => setHoveredGroup(group)} onBlur={() => setHoveredGroup('')} tabIndex={0}><i />{groupLabel(group)}</span>)}
    </div>
    <section className="senstats-filter-bar" aria-label="Senator filters">
      <div className="filter-rail-heading"><span>Refine senators</span><strong>{filteredSenators.length}</strong><small>of {senators.length}</small></div>
      <div className="senstats-filters compact with-clear">
        <label><span>Search</span><input value={searchTerm} onChange={(event) => onSearchTermChange(event.target.value)} placeholder="Name, province, group…" /></label>
        <label><span>Group</span><select value={groupFilter} onChange={(event) => onGroupFilterChange(event.target.value)}>{groupOptions.map((group) => <option key={group}>{group}</option>)}</select></label>
        <label><span>Province</span><select value={provinceFilter} onChange={(event) => onProvinceFilterChange(event.target.value)}>{provinceOptions.map((province) => <option key={province}>{province}</option>)}</select></label>
        {hasActiveFilters && <button type="button" className="clear-filters-button" onClick={clearFilters}>Clear filters</button>}
      </div>
    </section>
    <div className="senstats-grid senator-workspace drawer-only">
      <section className="senator-list-panel full-width" aria-label="Canadian senators">
        {senators.length === 0 && <p className="muted">No senators synced yet. The daily workflow will populate this list once it runs.</p>}
        {filteredSenators.length === 0 && senators.length > 0 && <p className="muted">No senators match those filters.</p>}
        {filteredSenators.length > 0 && <table className="senator-table">
          <thead><tr><th>Photo</th><th aria-sort={sortKey === 'name' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><SortButton label="Name" active={sortKey === 'name'} direction={sortDirection} onClick={() => changeSort('name')} /></th><th className="optional-col" aria-sort={sortKey === 'province' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><SortButton label="Province" active={sortKey === 'province'} direction={sortDirection} onClick={() => changeSort('province')} /></th><th aria-sort={sortKey === 'group' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><SortButton label="Group" active={sortKey === 'group'} direction={sortDirection} onClick={() => changeSort('group')} /></th><th className="history-col">History</th></tr></thead>
          <tbody>
            {sortedSenators.map((senator) => {
              const photoUrl = senatorPhotoUrl(senator);
              const active = senator.id === selectedSenator?.id;
              const groupHovered = hoveredGroup && senator.party !== hoveredGroup;
              return <tr key={senator.id} className={`${active ? 'active ' : ''}${groupHovered ? 'group-dimmed ' : ''}${groupClassName(senator.party)}`} onClick={() => onSelectSenator(senator.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelectSenator(senator.id); }}><td><span className="senator-avatar party-avatar">{photoUrl && <img src={photoUrl} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} />}<i aria-hidden="true">{senator.name.slice(0, 1)}</i></span></td><td><strong>{senator.name}</strong><small>{senator.province}</small></td><td className="optional-col">{senator.province}</td><td><em title={groupFullName(senator.party)} onMouseEnter={(event) => { event.stopPropagation(); setHoveredGroup(senator.party); }} onMouseLeave={() => setHoveredGroup('')} onFocus={() => setHoveredGroup(senator.party)} onBlur={() => setHoveredGroup('')} tabIndex={0}><i aria-hidden="true" />{groupLabel(senator.party)}</em></td><td className="history-col">{recentlyChangedSenatorIds.has(senator.id) ? <span className="history-badge" title="Recent affiliation change">↻</span> : '—'}</td></tr>;
            })}
          </tbody>
        </table>}
      </section>
    </div>
  </>;
}
