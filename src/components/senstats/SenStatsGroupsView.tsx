import { useState } from 'react';
import type { SenStatsSenatorDocument } from '../../types';
import { groupClassName } from './SenStatsHelpers';

interface SenStatsGroupsViewProps {
  groups: Array<{ group: string; senators: SenStatsSenatorDocument[] }>;
  recentlyChangedSenatorIds: Set<string>;
}

function provinceBadge(province: string) {
  return province.split(/\s+/).map((word) => word[0]).join('').slice(0, 3).toUpperCase() || 'CA';
}

export function SenStatsGroupsView({ groups, recentlyChangedSenatorIds }: SenStatsGroupsViewProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(groups.slice(0, 1).map((item) => item.group)));
  const [groupSearch, setGroupSearch] = useState<Record<string, string>>({});
  const toggleGroup = (group: string) => setExpandedGroups((current) => {
    const next = new Set(current);
    if (next.has(group)) next.delete(group); else next.add(group);
    return next;
  });
  return <div className="groups-grid modern-groups-grid">{groups.map(({ group, senators }) => {
    const expanded = expandedGroups.has(group);
    const searchValue = groupSearch[group] ?? '';
    const visibleSenators = senators.filter((senator) => `${senator.name} ${senator.province}`.toLowerCase().includes(searchValue.trim().toLowerCase()));
    return <article key={group} className={`group-card modern-group-card ${expanded ? 'expanded' : 'collapsed'} ${groupClassName(group)}`}><div className="group-sticky-header"><button type="button" className="group-card-header" onClick={() => toggleGroup(group)} aria-expanded={expanded}><span><strong>{group}</strong><small>{expanded ? `${visibleSenators.length} shown` : 'Tap to expand'}</small></span><b aria-label={`${senators.length} senators`}>{senators.length}</b><i>{expanded ? '−' : '+'}</i></button>{expanded && <label className="group-search"><span>Search within group</span><input value={searchValue} onChange={(event) => setGroupSearch((current) => ({ ...current, [group]: event.target.value }))} placeholder={`Filter ${group} senators…`} /></label>}</div><div className="group-collapse-panel" aria-hidden={!expanded}>{expanded && <div className="group-senator-grid">{visibleSenators.length === 0 && <p className="muted">No senators match this group search.</p>}{visibleSenators.map((senator) => <button type="button" className="group-senator-mini-card" key={senator.id}><span>{senator.name}{recentlyChangedSenatorIds.has(senator.id) && <em className="history-badge" title="Recent affiliation change">↻</em>}</span><small><i aria-hidden="true">⚑</i>{provinceBadge(senator.province)}</small></button>)}</div>}</div></article>;
  })}</div>;
}
