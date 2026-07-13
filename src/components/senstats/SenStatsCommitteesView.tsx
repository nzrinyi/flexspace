import type { SenStatsCommitteeDocument } from '../../types';

interface SenStatsCommitteesViewProps {
  committees: Array<SenStatsCommitteeDocument & { id: string }>;
}

export function SenStatsCommitteesView({ committees }: SenStatsCommitteesViewProps) {
  return <div className="committees-grid">{committees.length === 0 && <div className="senstats-chart-empty"><div className="empty-graphic" aria-hidden="true">☷</div><strong>No committee data available yet</strong><span>The next SenStats sync will attempt to read current committee pages and membership from the Senate website.</span></div>}{committees.map((committee) => <article key={committee.id} className="committee-card"><div><strong>{committee.name}</strong><span>{committee.code} · {committee.type || 'Committee'}</span></div><p className="muted">{committee.session || 'Current session'}</p><div className="committee-members">{(committee.members || []).length === 0 && <span>No members parsed yet</span>}{(committee.members || []).map((member) => <span key={`${committee.id}-${member.name}-${member.role}`}>{member.name}{member.role ? ` · ${member.role}` : ''}</span>)}</div></article>)}</div>;
}
