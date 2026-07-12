import type { SenStatsSyncStatusDocument } from '../../types';

interface SenStatsDataSourcesViewProps {
  senatorCount: number;
  expenseCount: number;
  committeeCount: number;
  attendanceCount: number;
  syncStatus: SenStatsSyncStatusDocument | null;
}

const officialSources = [
  { category: 'Roster', label: 'Current senators roster', url: 'https://sencanada.ca/umbraco/surface/SenatorsAjax/GetSenators?Lang=en&displayFor=senatorslist' },
  { category: 'Expenses', label: 'Proactive disclosure summary', url: 'https://sencanada.ca/en/proactive/summary/#?Year=2026&Quarter=1&Member=Senators' },
  { category: 'Expenses', label: 'Proactive disclosure by senator', url: 'https://sencanada.ca/en/ProActive/Summary/Senators' },
  { category: 'Expenses', label: 'Proactive disclosure details', url: 'https://sencanada.ca/en/ProActive/Summary/Details' },
  { category: 'Committees', label: 'Senate committees directory', url: 'https://sencanada.ca/en/committees/' },
  { category: 'Attendance', label: 'Senators attendance register', url: 'https://sencanada.ca/en/attendance/' },
  { category: 'Reference', label: 'Open North Represent reference', url: 'https://represent.opennorth.ca/' },
];

const fieldSources = [
  { icon: '👤', field: 'Name, province, and group', source: 'Official Senate current-senators roster.' },
  { icon: '📅', field: 'Appointment and retirement details', source: 'Official Senate roster columns such as nominated date, retirement date, and appointed-on-advice-of details.' },
  { icon: '🖼️', field: 'Photos / thumbnails', source: 'Image URLs exposed in the public Senate roster response when available. If the public response omits or blocks images, mirror official profile images into a controlled image store during sync.' },
  { icon: '💳', field: 'Quarterly expenses', source: 'Senate ProActive expense summary pages, including the Senators filter view.' },
  { icon: '🏛️', field: 'Committee membership', source: 'Public Senate committee directory and committee member pages.' },
  { icon: '✅', field: 'Attendance', source: "Senators' Attendance and Activities on Sitting Days register." },
  { icon: '🔁', field: 'Affiliation changes', source: 'Differences observed between consecutive public roster syncs.' },
];

function formatSyncDate(value: SenStatsSyncStatusDocument['finishedAt']) {
  if (!value) return 'Never synced';
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toLocaleString();
  return String(value);
}

function sourceStatus(syncStatus: SenStatsSyncStatusDocument | null, count: number) {
  if (!syncStatus) return 'No sync status has been written yet.';
  const date = formatSyncDate(syncStatus.finishedAt);
  const errors = syncStatus.errors ?? [];
  if (count > 0) return `Last completed ${date}.`;
  return errors.length ? `Last attempted ${date}; errors: ${errors.join(' ')}` : `Last attempted ${date}; no records were written.`;
}

function healthClass(syncStatus: SenStatsSyncStatusDocument | null, count: number) {
  if (!syncStatus) return 'warning';
  if ((syncStatus.errorCount ?? 0) > 0 || (syncStatus.errors ?? []).length > 0) return 'danger';
  return count > 0 ? 'success' : 'warning';
}

function SourceMetric({ label, count, syncStatus, primary = false }: { label: string; count: number; syncStatus: SenStatsSyncStatusDocument | null; primary?: boolean }) {
  const health = healthClass(syncStatus, count);

  return (
    <article className={`source-card source-metric ${primary ? 'primary' : ''} ${health}`}>
      <div className="source-metric-label"><i aria-hidden="true" /><span>{label}</span></div>
      <strong>{count}</strong>
      <small>{sourceStatus(syncStatus, count)}</small>
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
        <SourceMetric label="Expense records" count={expenseCount} syncStatus={syncStatus} />
        <SourceMetric label="Committees" count={committeeCount} syncStatus={syncStatus} />
        <SourceMetric label="Attendance rows" count={attendanceCount} syncStatus={syncStatus} />
      </div>

      <div className="source-card source-wide">
        <div className="source-heading"><span>Official public sources</span><strong>External websites used by SenStats, including expenses and attendance</strong></div>
        <div className="source-link-table" aria-label="Official public source links">
          {officialSources.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer" aria-label={`Open ${source.label} in a new tab`}>
              <span>{source.category}</span>
              <strong>{source.label}</strong>
              <small aria-hidden="true">↗</small>
            </a>
          ))}
        </div>
      </div>

      <div className="source-card source-wide">
        <div className="source-heading"><span>Field-level provenance</span><strong>Where each piece of data comes from</strong></div>
        <div className="source-table external-only" role="table" aria-label="Field-level SenStats data provenance">
          <div role="row" className="source-table-head"><span role="columnheader">Type</span><span role="columnheader">Data</span><span role="columnheader">External source</span></div>
          {fieldSources.map((item) => (
            <div role="row" key={item.field}>
              <span className="source-field-icon" role="cell" aria-hidden="true">{item.icon}</span>
              <strong role="cell">{item.field}</strong>
              <span role="cell">{item.source}</span>
            </div>
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
