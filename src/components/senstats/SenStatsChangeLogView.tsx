import type { SenStatsChangeLogDocument } from '../../types';
import { groupLabel } from './SenStatsHelpers';

function formatDate(value: SenStatsChangeLogDocument['detectedAt']) {
  if (!value) return 'Unknown date';
  return value.toDate().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
}

function changeText(change: SenStatsChangeLogDocument) {
  if (change.type === 'group_change') return `Group changed from ${groupLabel(change.previousParty || 'Unknown')} to ${groupLabel(change.newParty || 'Unknown')}.`;
  if (change.type === 'new_senator') return `New senator added for ${change.newProvince || change.previousProvince || 'unknown province'}.`;
  if (change.type === 'retired_senator') return `Senator no longer appears in the current public roster.`;
  return 'Roster data changed.';
}

export function SenStatsChangeLogView({ changes }: { changes: Array<SenStatsChangeLogDocument & { id: string }> }) {
  if (!changes.length) return <div className="senstats-chart-empty"><div className="empty-graphic" aria-hidden="true">↻</div><strong>No changes recorded yet</strong><span>Future syncs will list new senators, retirements, and group changes here.</span></div>;
  return <section className="change-log-list" aria-label="SenStats change log">
    {changes.map((change) => <article key={change.id} className={`change-log-item ${change.type}`}>
      <div><span>{change.type.replace(/_/g, ' ')}</span><strong>{change.senatorName}</strong><small>{formatDate(change.detectedAt)}</small></div>
      <p>{changeText(change)}</p>
      {change.sourceUrl && <a href={change.sourceUrl} target="_blank" rel="noreferrer">Open public source</a>}
    </article>)}
  </section>;
}
