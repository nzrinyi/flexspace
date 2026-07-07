import { useState } from 'react';
import type { SenStatsSenatorDocument } from '../../types';
import { groupClassName } from './SenStatsHelpers';

interface SenStatsGroupsViewProps {
  groups: Array<{ group: string; senators: SenStatsSenatorDocument[] }>;
  recentlyChangedSenatorIds: Set<string>;
}

export function SenStatsGroupsView({ groups, recentlyChangedSenatorIds }: SenStatsGroupsViewProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(groups.slice(0, 2).map((item) => item.group)));
  const toggleGroup = (group: string) => setExpandedGroups((current) => {
    const next = new Set(current);
    if (next.has(group)) next.delete(group); else next.add(group);
    return next;
  });
  return <div className="groups-grid">{groups.map(({ group, senators }) => {
    const expanded = expandedGroups.has(group);
    return <article key={group} className={`group-card ${groupClassName(group)}`}><button type="button" className="group-card-header" onClick={() => toggleGroup(group)} aria-expanded={expanded}><span><strong>{group}</strong><small>{senators.length} senators</small></span><b>{expanded ? '−' : '+'}</b></button>{expanded && <ul>{senators.map((senator) => <li key={senator.id}>{senator.name}{recentlyChangedSenatorIds.has(senator.id) && <span className="history-badge" title="Recent affiliation change">↻</span>}<small>{senator.province}</small></li>)}</ul>}</article>;
  })}</div>;
}
