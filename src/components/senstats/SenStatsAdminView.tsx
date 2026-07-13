import type { SenStatsSyncStatusDocument } from '../../types';

function formatDate(value: SenStatsSyncStatusDocument['finishedAt']) {
  if (!value) return 'Not reported';
  return value.toDate().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
}

export function SenStatsAdminView({ status }: { status?: SenStatsSyncStatusDocument | null }) {
  if (!status) return <div className="senstats-chart-empty"><div className="empty-graphic" aria-hidden="true">!</div><strong>No sync status yet</strong><span>Run the Quorum daily sync once to populate the latest sync summary.</span></div>;
  const failures = status.errors?.filter(Boolean) ?? [];
  return <section className="admin-grid" aria-label="Latest Quorum sync results">
    <article className={`source-card sync-status ${status.status}`}><span>Latest sync</span><strong>{status.status || 'Unknown'}</strong><small>Finished {formatDate(status.finishedAt)}</small></article>
    <article className="source-card"><span>Senators</span><strong>{status.senatorCount ?? 0}</strong><small>{status.photoCount ?? 0} with photos · {status.missingPhotoCount ?? 0} missing photos</small></article>
    <article className="source-card"><span>Expenses</span><strong>{status.expenseCount ?? 0}</strong><small>Public disclosure records parsed</small></article>
    <article className="source-card"><span>Committees</span><strong>{status.committeeCount ?? 0}</strong><small>Committee pages parsed</small></article>
    <article className="source-card"><span>Change log entries</span><strong>{status.changeCount ?? 0}</strong><small>Detected during the latest sync</small></article>
    <article className="source-card"><span>Errors</span><strong>{status.errorCount ?? failures.length}</strong><small>{failures.length ? 'Review latest ingestion log' : 'No sync errors reported'}</small></article>
    <article className="source-card source-wide"><div className="source-heading"><span>Workarounds</span><strong>If automated collection is incomplete</strong></div><p className="muted">{status.workaround || 'If the live Senate pages time out or omit photos, manually export the public roster/proactive disclosure tables as CSV and run a controlled import. For photos, mirror official senator profile images into a stable image store with a low-frequency job instead of fetching every profile during the daily sync.'}</p></article>
    {failures.length > 0 && <article className="source-card source-wide"><div className="source-heading"><span>Recent errors</span><strong>Logged by the ingestion job</strong></div><ul className="admin-error-list">{failures.slice(0, 8).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul></article>}
  </section>;
}
