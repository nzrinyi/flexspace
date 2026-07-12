import type { SenStatsSyncStatusDocument } from '../../types';

interface SenStatsDataSourcesViewProps {
  senatorCount: number;
  expenseCount: number;
  committeeCount: number;
  attendanceCount: number;
  syncStatus: SenStatsSyncStatusDocument | null;
}

const sourceMatrix = [
  { icon: '👤', category: 'Roster', field: 'Name, province, and group', source: 'Current senators roster', detail: 'Official Senate roster response.', url: 'https://sencanada.ca/umbraco/surface/SenatorsAjax/GetSenators?Lang=en&displayFor=senatorslist' },
  { icon: '📅', category: 'Roster', field: 'Appointment and retirement details', source: 'Roster profile columns', detail: 'Nominated date, mandatory retirement date, and appointment metadata from official Senate fields.', url: 'https://sencanada.ca/en/senators/' },
  { icon: '🖼️', category: 'Roster', field: 'Photos / thumbnails', source: 'Official Senate portraits', detail: 'Public image URLs exposed by roster/profile responses when available.', url: 'https://sencanada.ca/en/senators/' },
  { icon: '💳', category: 'Expenses', field: 'Quarterly expenses', source: 'Proactive disclosure summary', detail: 'Separate monthly/quarterly scrape; not expected to refresh on every daily roster run.', url: 'https://sencanada.ca/en/proactive/summary/#?Year=2026&Quarter=1&Member=Senators' },
  { icon: '🏛️', category: 'Committees', field: 'Committee membership and roles', source: 'Committee membership endpoint', detail: 'Public committee member responses, including Chair, Deputy Chair, Vice Chair, and member rows when present.', url: 'https://sencanada.ca/en/committees/' },
  { icon: '✅', category: 'Attendance', field: 'Attendance', source: 'Attendance register', detail: "Senators' Attendance and Activities on Sitting Days register.", url: 'https://sencanada.ca/en/attendance/' },
  { icon: '🔁', category: 'Audit', field: 'Affiliation changes', source: 'Consecutive roster snapshots', detail: 'Meaningful normalized differences between stored and newly synced roster data.', url: 'https://sencanada.ca/en/senators/' },
];

function formatSyncDate(value: SenStatsSyncStatusDocument['finishedAt']) {
  if (!value) return 'Never synced';
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toLocaleString();
  return String(value);
}

function sourceStatus(syncStatus: SenStatsSyncStatusDocument | null, count: number, monthly = false) {
  if (!syncStatus) return 'No sync status has been written yet.';
  const date = formatSyncDate(syncStatus.finishedAt);
  const errors = syncStatus.errors ?? [];
  if (count > 0) return monthly ? `Latest stored expense records are available; expense scrape runs separately. Last roster sync ${date}.` : `Last completed ${date}.`;
  if (monthly && !errors.length) return `No records in this view yet. Expense sync runs separately from the daily roster sync, so this is not a daily-run warning.`;
  return errors.length ? `Last attempted ${date}; errors: ${errors.join(' ')}` : `Last attempted ${date}; no records were written.`;
}

function healthClass(syncStatus: SenStatsSyncStatusDocument | null, count: number, monthly = false) {
  if (!syncStatus) return monthly ? 'neutral' : 'warning';
  if ((syncStatus.errorCount ?? 0) > 0 || (syncStatus.errors ?? []).length > 0) return 'danger';
  if (monthly) return count > 0 ? 'success' : 'neutral';
  return count > 0 ? 'success' : 'warning';
}

function SourceMetric({ label, count, syncStatus, primary = false, monthly = false }: { label: string; count: number; syncStatus: SenStatsSyncStatusDocument | null; primary?: boolean; monthly?: boolean }) {
  const health = healthClass(syncStatus, count, monthly);

  return (
    <article className={`source-card source-metric ${primary ? 'primary' : ''} ${health}`}>
      <div className="source-metric-label"><i aria-hidden="true" /><span>{label}</span></div>
      <strong>{count}</strong>
      <small>{sourceStatus(syncStatus, count, monthly)}</small>
    </article>
  );
}

export function SenStatsDataSourcesView({ senatorCount, expenseCount, committeeCount, attendanceCount, syncStatus }: SenStatsDataSourcesViewProps) {
  const lastUpdated = formatSyncDate(syncStatus?.finishedAt);

  return (
    <section className="data-sources-view" aria-label="SenStats data sources">
      <div className="source-page-heading">
        <div><span>Data sources</span><strong>Transparency and sync health</strong></div>
        <small>Last updated: {lastUpdated}</small>
      </div>

      <div className="source-overview-grid">
        <SourceMetric label="Senators loaded" count={senatorCount} syncStatus={syncStatus} primary />
        <SourceMetric label="Expense records" count={expenseCount} syncStatus={syncStatus} monthly />
        <SourceMetric label="Committees" count={committeeCount} syncStatus={syncStatus} />
        <SourceMetric label="Attendance rows" count={attendanceCount} syncStatus={syncStatus} />
      </div>

      <div className="source-card source-wide">
        <div className="source-heading"><span>Source and field provenance</span><strong>What each dataset means and where it comes from</strong></div>
        <div className="source-table source-matrix" role="table" aria-label="SenStats source and field provenance">
          <div role="row" className="source-table-head"><span role="columnheader">Type</span><span role="columnheader">Data</span><span role="columnheader">Official source</span><span role="columnheader">Notes</span></div>
          {sourceMatrix.map((item) => (
            <a role="row" key={item.field} href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.source} in a new tab`}>
              <span className="source-field-icon" role="cell" aria-hidden="true">{item.icon}</span>
              <strong role="cell"><small>{item.category}</small>{item.field}</strong>
              <span role="cell">{item.source} ↗</span>
              <p role="cell">{item.detail}</p>
            </a>
          ))}
        </div>
      </div>

      <div className="source-card source-wide">
        <div className="source-heading"><span>Latest sync result</span><strong>{syncStatus?.status ?? 'No sync status yet'}</strong></div>
        <p className="muted">{syncStatus ? `Finished ${formatSyncDate(syncStatus.finishedAt)} with ${syncStatus.errorCount ?? 0} reported errors. ${(syncStatus.errors ?? []).join(' ') || 'No source-level errors were reported.'}` : 'The next scheduled ingestion run will write source-level status here.'}</p>
      </div>
    </section>
  );
}
