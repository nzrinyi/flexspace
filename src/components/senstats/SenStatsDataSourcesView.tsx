interface SenStatsDataSourcesViewProps {
  senatorCount: number;
  expenseCount: number;
  committeeCount: number;
  attendanceCount: number;
}

const officialSources = [
  { label: 'Current senators roster', url: 'https://sencanada.ca/umbraco/surface/SenatorsAjax/GetSenators?Lang=en&displayFor=senatorslist' },
  { label: 'Senate proactive disclosure expense summary', url: 'https://sencanada.ca/en/proactive/summary/#?Year=2026&Quarter=1&Member=Senators' },
  { label: 'Senate proactive disclosure by senator', url: 'https://sencanada.ca/en/ProActive/Summary/Senators' },
  { label: 'Senate proactive disclosure details', url: 'https://sencanada.ca/en/ProActive/Summary/Details' },
  { label: 'Senate committees directory', url: 'https://sencanada.ca/en/committees/' },
  { label: 'Senators attendance register', url: 'https://sencanada.ca/en/attendance/' },
  { label: 'Open North Represent reference', url: 'https://represent.opennorth.ca/' },
];

const fieldSources = [
  { field: 'Name, province, and group', source: 'Official Senate current-senators roster.' },
  { field: 'Appointment and retirement details', source: 'Official Senate roster columns such as nominated date, retirement date, and appointed-on-advice-of details.' },
  { field: 'Photos / thumbnails', source: 'Image URLs exposed in the public Senate roster response when available. If the public response omits or blocks images, mirror official profile images into a controlled image store during sync.' },
  { field: 'Quarterly expenses', source: 'Senate ProActive expense summary pages, including the Senators filter view.' },
  { field: 'Committee membership', source: 'Public Senate committee directory and committee member pages.' },
  { field: 'Attendance', source: 'Senators\' Attendance and Activities on Sitting Days register.' },
  { field: 'Affiliation changes', source: 'Differences observed between consecutive public roster syncs.' },
];

export function SenStatsDataSourcesView({ senatorCount, expenseCount, committeeCount, attendanceCount }: SenStatsDataSourcesViewProps) {
  return (
    <section className="data-sources-view" aria-label="SenStats data sources">
      <div className="source-overview-grid">
        <article className="source-card primary"><span>Senators loaded</span><strong>{senatorCount}</strong><small>Read from the public Senate roster.</small></article>
        <article className="source-card"><span>Expense records</span><strong>{expenseCount}</strong><small>Read from Senate proactive disclosure expense pages.</small></article>
        <article className="source-card"><span>Committees</span><strong>{committeeCount}</strong><small>Read from public Senate committee pages.</small></article>
        <article className="source-card"><span>Attendance rows</span><strong>{attendanceCount}</strong><small>Read from the Senate attendance register.</small></article>
      </div>

      <div className="source-card source-wide">
        <div className="source-heading"><span>Official public sources</span><strong>External websites used by SenStats, including expenses and attendance</strong></div>
        <div className="source-link-list">
          {officialSources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer"><span>{source.label}</span><small>{source.url}</small></a>)}
        </div>
      </div>

      <div className="source-card source-wide">
        <div className="source-heading"><span>Field-level provenance</span><strong>Where each piece of data comes from</strong></div>
        <div className="source-table external-only" role="table" aria-label="Field-level SenStats data provenance">
          <div role="row" className="source-table-head"><span role="columnheader">Data</span><span role="columnheader">External source</span></div>
          {fieldSources.map((item) => <div role="row" key={item.field}><strong role="cell">{item.field}</strong><span role="cell">{item.source}</span></div>)}
        </div>
      </div>

      <div className="source-card source-wide">
        <div className="source-heading"><span>Collection notes</span><strong>Operational workarounds</strong></div>
        <p className="muted">If the Senate pages time out, manually export the public roster, proactive disclosure expense table, or attendance register as CSV and load them through a controlled import. If photos are missing or hotlink-blocked, mirror official profile images with a separate low-frequency image job rather than fetching every profile during the daily sync.</p>
      </div>
    </section>
  );
}
