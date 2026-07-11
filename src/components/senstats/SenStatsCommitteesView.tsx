import { useMemo, useState } from 'react';
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

function CommitteeMemberRow({ member, committeeId, senator }: { member: SenStatsCommitteeMember; committeeId: string; senator?: SenStatsSenatorDocument }) {
  const { selectSenator } = useSenatorSelect();
  const initials = member.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const photoUrl = senator?.photoUrl;
  const content = <>
    {photoUrl ? <img className="member-photo" src={photoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span aria-hidden="true" className="member-initials">{initials || '—'}</span>}
    <div>
      <strong>{member.name}</strong>
      <small>{member.role || 'Member'}{member.party ? ` · ${groupLabel(member.party)}` : ''}{member.province ? ` · ${member.province}` : ''}</small>
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
        {hiddenCommitteeCount > 0 && <small>{hiddenCommitteeCount} empty committee{hiddenCommitteeCount === 1 ? '' : 's'} hidden until data is available.</small>}
      </div>
      <label>
        Search committees
        <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search by committee, code, or senator…" />
      </label>
    </div>

    {filteredCommittees.length === 0 ? <div className="senstats-chart-empty">
      {committeesWithMembers.length === 0 ? <div className="committee-skeleton-stack" aria-hidden="true"><i /><i /><i /></div> : <div className="empty-graphic" aria-hidden="true">⌕</div>}
      <strong>{committeesWithMembers.length === 0 ? 'No committee member rows yet' : 'No matching committee records'}</strong>
      <span>{committeesWithMembers.length === 0 ? 'Committee cards stay hidden until at least one member row is available, so blank cards do not look broken.' : 'Try a different committee code, name, or senator.'}</span>
    </div> : <div className="committees-grid">{filteredCommittees.map((committee) => {
      const members = committee.members || [];
      const dedupedMembers = uniqueMembers(members);
      const leadership = dedupedMembers.filter((member) => isLeadershipRole(member.role));
      const regularMembers = dedupedMembers.filter((member) => !isLeadershipRole(member.role));
      const nextMeeting = committee.nextMeetingDate || committee.nextMeeting || '';
      return <details key={committee.id} className="committee-card" open>
        <summary className="committee-card-header">
          <div>
            <span>{committee.code} · {committee.type || 'Committee'}</span>
            <strong>{committee.name}</strong>
            <em>{nextMeeting ? `Next meeting: ${nextMeeting}` : 'Next meeting date not posted yet'}</em>
          </div>
          <small>{committee.session || 'Current session'}</small>
        </summary>
        {committee.sourceUrl && <a className="committee-official-link" href={committee.sourceUrl} target="_blank" rel="noreferrer">Official committee page</a>}
        {leadership.length > 0 && <ul className="committee-member-list leadership-list" aria-label={`${committee.name} leadership`}>
          {leadership.map((member) => <CommitteeMemberRow key={committeeMemberKey(committee.id, member)} committeeId={committee.id} member={member} senator={senatorsById.get(member.senatorId || '') || senatorsByName.get(member.name.toLowerCase())} />)}
        </ul>}
        <ul className="committee-member-list" aria-label={`${committee.name} members`}>
          {regularMembers.map((member) => <CommitteeMemberRow key={committeeMemberKey(committee.id, member)} committeeId={committee.id} member={member} senator={senatorsById.get(member.senatorId || '') || senatorsByName.get(member.name.toLowerCase())} />)}
        </ul>
      </details>;
    })}</div>}
  </section>;
}
