import { useState } from 'react';
import type { SenStatsSenatorDocument } from '../../types';
import { groupClassName, groupLabel } from './SenStatsHelpers';

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

  return (
    <div className="groups-accordion">
      {groups.map(({ group, senators }) => {
        const expanded = expandedGroups.has(group);
        const searchValue = groupSearch[group] ?? '';
        const visibleSenators = senators.filter((senator) => `${senator.name} ${senator.province}`.toLowerCase().includes(searchValue.trim().toLowerCase()));
        return (
          <article key={group} className={`group-accordion-item ${expanded ? 'expanded' : 'collapsed'} ${groupClassName(group)}`}>
            <button type="button" className="group-accordion-header" onClick={() => toggleGroup(group)} aria-expanded={expanded}>
              <span className="group-accordion-title">
                <strong>{groupLabel(group)}</strong>
                <small>{expanded ? `${visibleSenators.length} of ${senators.length} senators shown` : `${senators.length} senators`}</small>
              </span>
              <span className="group-accordion-meta">
                <b aria-label={`${senators.length} senators`}>{senators.length}</b>
                <i aria-hidden="true">⌄</i>
              </span>
            </button>
            <div className="group-accordion-panel" aria-hidden={!expanded}>
              {expanded && (
                <>
                  <label className="group-search">
                    <span>Filter this group</span>
                    <input value={searchValue} onChange={(event) => setGroupSearch((current) => ({ ...current, [group]: event.target.value }))} placeholder={`Search ${group} senators…`} />
                  </label>
                  <div className="group-senator-list">
                    {visibleSenators.length === 0 && <p className="muted">No senators match this group search.</p>}
                    {visibleSenators.map((senator) => (
                      <button type="button" className="group-senator-row" key={senator.id}>
                        <span>{senator.name}{recentlyChangedSenatorIds.has(senator.id) && <em className="history-badge" title="Recent affiliation change">↻</em>}</span>
                        <small><i aria-hidden="true">⚑</i>{provinceBadge(senator.province)}</small>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
