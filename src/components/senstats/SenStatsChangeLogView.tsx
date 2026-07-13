import type { SenStatsChangeLogDocument } from '../../types';
import { groupLabel } from './SenStatsHelpers';

function formatDate(value: SenStatsChangeLogDocument['detectedAt']) {
  if (!value) return 'Unknown date';
  return value.toDate().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
}

function actionLabel(change: SenStatsChangeLogDocument) {
  if (change.action) return change.action;
  if (change.type === 'group_change') return 'Affiliation Updated';
  if (change.type === 'new_senator') return 'Senator Added';
  if (change.type === 'retired_senator') return 'Senator Removed';
  return 'Roster Updated';
}

function changeText(change: SenStatsChangeLogDocument) {
  if (change.type === 'group_change') return 'Normalized group values changed between sync snapshots.';
  if (change.type === 'new_senator') return `New senator added for ${change.newProvince || change.previousProvince || 'unknown province'}.`;
  if (change.type === 'retired_senator') return 'Senator no longer appears in the current public roster.';
  return 'Roster data changed.';
}

function groupedChanges(changes: Array<SenStatsChangeLogDocument & { id: string }>) {
  return changes.reduce<Array<{ key: string; label: string; detectedAt: SenStatsChangeLogDocument['detectedAt']; changes: Array<SenStatsChangeLogDocument & { id: string }> }>>((groups, change) => {
    const label = actionLabel(change);
    const timestamp = change.detectedAt?.toMillis?.() ?? 0;
    const key = `${change.syncId || timestamp}|${label}`;
    const group = groups.find((item) => item.key === key);
    if (group) group.changes.push(change);
    else groups.push({ key, label, detectedAt: change.detectedAt, changes: [change] });
    return groups;
  }, []);
}

export function SenStatsChangeLogView({ changes, onSelectSenator }: { changes: Array<SenStatsChangeLogDocument & { id: string }>; onSelectSenator: (id: string) => void }) {
  const meaningfulChanges = changes.filter((change) => change.type !== 'group_change' || groupLabel(change.previousParty || 'Unknown') !== groupLabel(change.newParty || 'Unknown'));
  if (!meaningfulChanges.length) return <div className="senstats-chart-empty"><div className="empty-graphic" aria-hidden="true">↻</div><strong>No meaningful changes recorded yet</strong><span>Future syncs will list new senators, retirements, and real affiliation changes here.</span></div>;
  return <section className="change-log-list audit-log-list" aria-label="Quorum change log">
    {groupedChanges(meaningfulChanges).map((group) => <article key={group.key} className={`change-log-group ${group.changes[0].type}`}>
      <header><span>{group.label}</span><strong>{group.changes.length === 1 ? '1 audit event' : `${group.changes.length} audit events`}</strong><small>{formatDate(group.detectedAt)} · Actor: {group.changes[0].actor || 'System/Scraper'}</small></header>
      <div className="change-log-group-body">
        {group.changes.map((change) => <div key={change.id} className={`change-log-item ${change.type}`}>
          <div><button type="button" className="change-log-senator" onClick={() => onSelectSenator(change.senatorId)}>{change.senatorName}</button><small>{changeText(change)}</small></div>
          {change.type === 'group_change' && <p className="change-diff"><b>{groupLabel(change.previousParty || 'Unknown')}</b><i aria-hidden="true">→</i><b>{groupLabel(change.newParty || 'Unknown')}</b></p>}
          {change.type !== 'group_change' && <p>{change.newProvince || change.previousProvince || 'Roster snapshot'}</p>}
          {change.sourceUrl && <a href={change.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a>}
        </div>)}
      </div>
    </article>)}
  </section>;
}
