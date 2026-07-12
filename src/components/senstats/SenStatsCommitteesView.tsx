import { useEffect, useMemo, useState } from 'react';
import type { SenStatsCommitteeDocument, SenStatsCommitteeMember, SenStatsSenatorDocument } from '../../types';
import { groupClassName, groupLabel } from './SenStatsHelpers';
import { useSenatorSelect } from './SenatorSelectionContext';

interface SenStatsCommitteesViewProps {
  committees: Array<SenStatsCommitteeDocument & { id: string }>;
  senators: SenStatsSenatorDocument[];
}

function isLeadershipRole(role = '') {
  const normalized = role.toLowerCase();
  return normalized.includes('chair');
}

function committeeMemberKey(committeeId: string, member: SenStatsCommitteeMember) {
  return `${committeeId}-${member.senatorId || member.name}-${member.role || 'member'}`;
}

function roleIcon(role = '') {
  return isLeadershipRole(role) ? '♛' : '';
}

function CommitteeMemberRow({ member, committeeId, senator }: { member: SenStatsCommitteeMember; committeeId: string; senator?: SenStatsSenatorDocument }) {
  const { selectSenator } = useSenatorSelect();
  const initials = member.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const photoUrl = senator?.photoUrl;
  const content = <>
    {photoUrl ? <img className="member-photo" src={photoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span aria-hidden="true" className="member-initials">{initials || '—'}</span>}
    <div>
      <strong>{member.name}</strong>
      <small className="member-meta-badges">
        <span className={`member-role-badge ${isLeadershipRole(member.role) ? 'leadership' : ''}`}>{roleIcon(member.role)} {member.role || 'Member'}</span>
        {member.party && <span>{groupLabel(member.party)}</span>}
        {member.province && <span>{member.province}</span>}
      </small>
    </div>
  </>;
  return <li key={committeeMemberKey(committeeId, member)} className={`committee-member-row ${isLeadershipRole(member.role) ? 'leadership' : ''} ${groupClassName(member.party || '')}`}>
    {senator ? <button type="button" className="senator-inline-trigger" onClick={() => selectSenator(senator.id, 'Committees')}>{content}</button> : content}
  </li>;
}

function uniqueMembers(members: SenStatsCommitteeMember[]) {
  const seen = new Set<string>();
  return members.filter((member) => {
    const key = (member.senatorId || member.name || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function SenStatsCommitteesView({ committees, senators }: SenStatsCommitteesViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [memberSearchTerm, setMemberSearchTerm] = useState('');
  const [selectedCommitteeId, setSelectedCommitteeId] = useState('');
  const senatorsById = useMemo(() => new Map(senators.map((senator) => [senator.id, senator])), [senators]);
  const senatorsByName = useMemo(() => new Map(senators.map((senator) => [senator.name.toLowerCase(), senator])), [senators]);
  const committeesWithMembers = useMemo(() => committees.filter((committee) => (committee.members || []).length > 0), [committees]);
  const hiddenCommitteeCount = committees.length - committeesWithMembers.length;
  const filteredCommittees = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return committeesWithMembers;
    return committeesWithMembers.filter((committee) => [
      committee.code,
      committee.name,
      committee.type,
      committee.session,
      ...(committee.members || []).map((member) => member.name),
    ].filter(Boolean).join(' ').toLowerCase().includes(normalizedSearch));
  }, [committeesWithMembers, searchTerm]);
  const selectedCommittee = filteredCommittees.find((committee) => committee.id === selectedCommitteeId) || filteredCommittees[0];

  useEffect(() => {
    if (!filteredCommittees.length) return;
    if (!selectedCommitteeId || !filteredCommittees.some((committee) => committee.id === selectedCommitteeId)) {
      setSelectedCommitteeId(filteredCommittees[0].id);
    }
  }, [filteredCommittees, selectedCommitteeId]);

  if (committees.length === 0) {
    return <div className="committee-empty-panel senstats-chart-empty">
      <div className="committee-skeleton-stack" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <strong>No committee data available yet</strong>
      <span>The next SenStats sync will attempt to read current committee pages and membership from the Senate website.</span>
    </div>;
  }

  return <section className="committees-view">
    <div className="committee-toolbar">
      <div>
        <span>Committees</span>
        <strong>{committeesWithMembers.length} with member data</strong>
        <small aria-live="polite">Showing {filteredCommittees.length} of {committeesWithMembers.length} committees{searchTerm.trim() ? ' matching your search' : ''}.</small>
        {hiddenCommitteeCount > 0 && <small className="committee-hidden-badge">{hiddenCommitteeCount} hidden</small>}
      </div>
      <div className="committee-search-grid">
        <label>
          Search committees
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search committee or code…" />
        </label>
        <label>
          Search senators
          <input value={memberSearchTerm} onChange={(event) => setMemberSearchTerm(event.target.value)} placeholder="Filter selected members…" />
        </label>
      </div>
    </div>

    {filteredCommittees.length === 0 ? <div className="senstats-chart-empty">
      {committeesWithMembers.length === 0 ? <div className="committee-skeleton-stack" aria-hidden="true"><i /><i /><i /></div> : <div className="empty-graphic" aria-hidden="true">⌕</div>}
      <strong>{committeesWithMembers.length === 0 ? 'No committee member rows yet' : 'No results found'}</strong>
      <span>{committeesWithMembers.length === 0 ? 'Committee cards stay hidden until at least one member row is available, so blank cards do not look broken.' : 'Try a different committee code, name, or senator.'}</span>
    </div> : <>
      <div className="committee-button-grid" role="tablist" aria-label="Committees">
        {filteredCommittees.map((committee) => {
          const isSelected = selectedCommittee?.id === committee.id;
          return <button
            key={committee.id}
            type="button"
            role="tab"
            aria-selected={isSelected}
            className={`committee-picker-button ${isSelected ? 'active' : ''}`}
            onClick={() => setSelectedCommitteeId(committee.id)}
          >
            <strong title={`${committee.name} · ${(committee.members || []).length} member${(committee.members || []).length === 1 ? '' : 's'}`}>{committee.code}</strong>
          </button>;
        })}
      </div>
      {selectedCommittee && (() => {
        const members = selectedCommittee.members || [];
        const dedupedMembers = uniqueMembers(members);
        const normalizedMemberSearch = memberSearchTerm.trim().toLowerCase();
        const visibleMembers = normalizedMemberSearch ? dedupedMembers.filter((member) => [member.name, member.role, groupLabel(member.party || ''), member.province].filter(Boolean).join(' ').toLowerCase().includes(normalizedMemberSearch)) : dedupedMembers;
        const leadership = visibleMembers.filter((member) => isLeadershipRole(member.role));
        const regularMembers = visibleMembers.filter((member) => !isLeadershipRole(member.role));
        const caucusStats = Object.entries(dedupedMembers.reduce<Record<string, number>>((counts, member) => {
          const label = groupLabel(member.party || 'Unknown');
          counts[label] = (counts[label] || 0) + 1;
          return counts;
        }, {})).sort(([, a], [, b]) => b - a);
        const nextMeeting = selectedCommittee.nextMeetingDate || selectedCommittee.nextMeeting || '';
        return <article className="committee-card committee-detail-panel" aria-live="polite">
          <header className="committee-card-header committee-detail-header">
            <div>
              <span>{selectedCommittee.code} · {selectedCommittee.type || 'Committee'}</span>
              <strong>{selectedCommittee.name}</strong>
              <div className="committee-quick-stats" aria-label={`${selectedCommittee.name} caucus breakdown`}>
                <span>{dedupedMembers.length} total</span>
                {caucusStats.map(([label, count]) => <span key={label}>{count} {label}</span>)}
              </div>
              <em className={nextMeeting ? 'meeting-status posted' : 'meeting-status pending'}>{nextMeeting ? `Next meeting: ${nextMeeting}` : 'Next meeting date not posted yet'}</em>
            </div>
            <small>{selectedCommittee.session || 'Current session'}</small>
          </header>
          {selectedCommittee.sourceUrl && <a className="committee-official-link" href={selectedCommittee.sourceUrl} target="_blank" rel="noreferrer">Official committee page <span className="external-link-icon" aria-hidden="true">↗</span></a>}
          {visibleMembers.length === 0 ? <div className="senstats-chart-empty committee-member-empty"><strong>No matching members</strong><span>Try a different senator, role, caucus, or province.</span></div> : <>
            {leadership.length > 0 && <ul className="committee-member-list leadership-list" aria-label={`${selectedCommittee.name} leadership`}>
              {leadership.map((member) => <CommitteeMemberRow key={committeeMemberKey(selectedCommittee.id, member)} committeeId={selectedCommittee.id} member={member} senator={senatorsById.get(member.senatorId || '') || senatorsByName.get(member.name.toLowerCase())} />)}
            </ul>}
            <ul className="committee-member-list" aria-label={`${selectedCommittee.name} members`}>
              {regularMembers.map((member) => <CommitteeMemberRow key={committeeMemberKey(selectedCommittee.id, member)} committeeId={selectedCommittee.id} member={member} senator={senatorsById.get(member.senatorId || '') || senatorsByName.get(member.name.toLowerCase())} />)}
            </ul>
          </>}
        </article>;
      })()}
    </>}
  </section>;
}
