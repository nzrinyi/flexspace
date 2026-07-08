import type { SenStatsCommitteeDocument, SenStatsExpenseDocument, SenStatsSenatorDocument } from '../../types';
import { currency } from './SenStatsHelpers';

interface SenStatsDataSourcesViewProps {
  senatorCount: number;
  selectedSenator?: SenStatsSenatorDocument;
  expenses: Array<SenStatsExpenseDocument & { id: string }>;
  committees: Array<SenStatsCommitteeDocument & { id: string }>;
}

const officialSources = [
  { label: 'Current senators roster', url: 'https://sencanada.ca/umbraco/surface/SenatorsAjax/GetSenators?Lang=en&displayFor=senatorslist' },
  { label: 'Senate proactive disclosure summary', url: 'https://sencanada.ca/en/ProActive/Summary' },
  { label: 'Senate proactive disclosure by senator', url: 'https://sencanada.ca/en/ProActive/Summary/Senators' },
  { label: 'Senate proactive disclosure details', url: 'https://sencanada.ca/en/ProActive/Summary/Details' },
  { label: 'Senate committees directory', url: 'https://sencanada.ca/en/committees/' },
  { label: 'Open North Represent reference', url: 'https://represent.opennorth.ca/' },
];

const fieldSources = [
  { field: 'Name, province, and group', source: 'Official Senate current-senators roster.' },
  { field: 'Appointment and retirement details', source: 'Official Senate roster columns such as nominated date, retirement date, and appointed-on-advice-of details.' },
  { field: 'Photos / thumbnails', source: 'Image URLs exposed in the public Senate roster response when available. If the public response omits or blocks images, mirror official profile images into a controlled image store during sync.' },
  { field: 'Quarterly expenses', source: 'Primary tables on Senate ProActive Summary, Summary/Senators, and Summary Details pages.' },
  { field: 'Committee membership', source: 'Public Senate committee directory and committee member pages.' },
  { field: 'Affiliation changes', source: 'Differences observed between consecutive public roster syncs.' },
];

export function SenStatsDataSourcesView({ senatorCount, selectedSenator, expenses, committees }: SenStatsDataSourcesViewProps) {
  const expenseTotal = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const expenseSourceUrls = Array.from(new Set(expenses.map((expense) => expense.sourceUrl).filter(Boolean))).slice(0, 5) as string[];
  const selectedPhotoUrl = selectedSenator?.photoUrl || (typeof selectedSenator?.profileDetails?.photoUrl === 'string' ? selectedSenator.profileDetails.photoUrl : '');
  const profileUrl = typeof selectedSenator?.profileDetails?.profileUrl === 'string' ? selectedSenator.profileDetails.profileUrl : selectedSenator?.sourceUrl;

  return (
    <section className="data-sources-view" aria-label="SenStats data sources">
      <div className="source-overview-grid">
        <article className="source-card primary">
          <span>Selected senator</span>
          <strong>{selectedSenator?.name ?? 'No senator selected'}</strong>
          <small>{profileUrl ? 'Official Senate profile available' : 'Official profile link not available yet'}</small>
          {profileUrl && <a href={profileUrl} target="_blank" rel="noreferrer">Open public profile</a>}
        </article>
        <article className="source-card">
          <span>Senators loaded</span>
          <strong>{senatorCount}</strong>
          <small>Read from the public Senate roster.</small>
        </article>
        <article className="source-card">
          <span>Selected expenses</span>
          <strong>{currency(expenseTotal)}</strong>
          <small>{expenses.length} public disclosure records for current senator</small>
        </article>
        <article className="source-card">
          <span>Committees</span>
          <strong>{committees.length}</strong>
          <small>Read from public Senate committee pages.</small>
        </article>
      </div>

      <div className="source-card source-wide">
        <div className="source-heading"><span>Official public sources</span><strong>External websites used by SenStats</strong></div>
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
        <div className="source-heading"><span>Photos</span><strong>{selectedPhotoUrl ? 'Photo URL available for selected senator' : 'No photo URL available for selected senator'}</strong></div>
        {selectedPhotoUrl ? <a href={selectedPhotoUrl} target="_blank" rel="noreferrer">Open public photo</a> : <p className="muted">The current low-timeout sync does not visit individual senator profile pages. If the roster response does not include photos, use a one-time offline image collection or a separate low-frequency image mirror job that downloads official profile photos and serves local copies.</p>}
      </div>

      <div className="source-card source-wide">
        <div className="source-heading"><span>Expense provenance</span><strong>External URLs found for selected senator</strong></div>
        {expenseSourceUrls.length ? <div className="source-link-list compact">{expenseSourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><span>Expense source</span><small>{url}</small></a>)}</div> : <p className="muted">No expense source URLs are available for the selected senator yet. If the automated sync fails, export the Senate ProActive table manually as CSV and load it through a controlled import script.</p>}
      </div>
    </section>
  );
}
