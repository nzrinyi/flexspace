import { useEffect, useMemo, useState } from 'react';
import type { SenStatsCommitteeDocument, SenStatsExpenseDocument, SenStatsSenatorDocument } from '../../types';
import { currency, groupClassName, groupFullName, groupLabel, quarterlyExpenseRows } from './SenStatsHelpers';
import { useSenatorSelect } from './SenatorSelectionContext';

function senatorPhotoUrl(senator?: SenStatsSenatorDocument) {
  const profilePhoto = senator?.profileDetails?.photoUrl;
  return senator?.photoUrl || (typeof profilePhoto === 'string' ? profilePhoto : undefined);
}

function detailValue(senator: SenStatsSenatorDocument | undefined, keys: string[]) {
  if (!senator) return '';
  const sources = [senator.extraDetails, senator.profileDetails, ...(senator.officeDetails ?? [])];
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value;
      if (typeof value === 'number') return String(value);
    }
  }
  return '';
}

export function SenatorProfileDrawer({ senators, committees, expenses }: { senators: SenStatsSenatorDocument[]; committees: Array<SenStatsCommitteeDocument & { id: string }>; expenses: Array<SenStatsExpenseDocument & { id: string }> }) {
  const { selectedSenatorId, drawerOpen, originLabel, closeDrawer } = useSenatorSelect();
  const senator = senators.find((item) => item.id === selectedSenatorId);
  const photoUrl = senatorPhotoUrl(senator);
  const senatorExpenses = useMemo(() => senator ? expenses.filter((expense) => expense.senatorId === senator.id) : [], [expenses, senator]);
  const quarterRows = useMemo(() => quarterlyExpenseRows(senatorExpenses).slice(-4), [senatorExpenses]);
  const totalExpenses = senatorExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const memberships = senator ? committees.filter((committee) => (committee.members || []).some((member) => member.senatorId === senator.id || member.name === senator.name)) : [];
  const profileUrl = typeof senator?.profileDetails?.profileUrl === 'string' ? senator.profileDetails.profileUrl : senator?.sourceUrl;
  const appointedDate = detailValue(senator, ['nominatedDate', 'appointed-date', 'appointedDate', 'summoned-to-the-senate', 'date-of-appointment']);
  const retirementDate = detailValue(senator, ['retirementDate', 'retirement-date', 'mandatory-retirement-date', 'retirement']);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDrawer, drawerOpen]);

  if (!drawerOpen || !senator) return null;

  return <div className="senator-drawer-layer" role="presentation">
    <button type="button" className="senator-drawer-backdrop" aria-label="Close senator profile" onClick={closeDrawer} />
    <aside className={`senator-profile-drawer ${groupClassName(senator.party)}`} aria-label={`${senator.name} profile drawer`}>
      <header>
        {originLabel && <button type="button" className="drawer-origin" onClick={closeDrawer}>Back to {originLabel}</button>}
        <button type="button" className="drawer-close" aria-label="Close profile drawer" onClick={closeDrawer}>×</button>
      </header>
      <section className="drawer-identity">
        {photoUrl ? <img src={photoUrl} alt={`${senator.name} portrait`} referrerPolicy="no-referrer" /> : <span className="senator-avatar party-avatar profile-fallback"><i aria-hidden="true">{senator.name.slice(0, 1)}</i></span>}
        <div>
          <span>Senator profile</span>
          <strong>{senator.name}</strong>
          <small>{senator.province} · <b title={groupFullName(senator.party)}>{groupLabel(senator.party)}</b></small>
          {profileUrl && <a href={profileUrl} target="_blank" rel="noreferrer">Official profile</a>}
        </div>
      </section>
      <div className="drawer-stat-grid">
        <p><span>Expenses</span><strong>{currency(totalExpenses)}</strong><small>{senatorExpenses.length} records</small></p>
        <p><span>Committees</span><strong>{memberships.length}</strong><small>current memberships</small></p>
        <p><span>Appointed</span><strong>{appointedDate || 'Not synced'}</strong></p>
        <p><span>Retirement</span><strong>{retirementDate || 'Not synced'}</strong></p>
      </div>
      <section className="drawer-section">
        <strong>Recent expense quarters</strong>
        {quarterRows.length === 0 ? <p className="muted">No expense records available for this senator.</p> : quarterRows.map((row) => {
          const total = Object.entries(row).filter(([key]) => key !== 'quarter').reduce((sum, [, value]) => sum + Number(value || 0), 0);
          return <p key={String(row.quarter)}><span>{String(row.quarter)}</span><b>{currency(total)}</b></p>;
        })}
      </section>
      <section className="drawer-section">
        <strong>Committee memberships</strong>
        {memberships.length === 0 ? <p className="muted">No committee memberships synced yet.</p> : memberships.map((committee) => {
          const member = committee.members?.find((item) => item.senatorId === senator.id || item.name === senator.name);
          return <p key={committee.id}><span>{committee.code}</span><b>{committee.name}{member?.role ? ` · ${member.role}` : ''}</b></p>;
        })}
      </section>
    </aside>
  </div>;
}

export function SenatorCommandPalette({ senators }: { senators: SenStatsSenatorDocument[] }) {
  const { selectSenator } = useSenatorSelect();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const matches = useMemo(() => senators.filter((senator) => `${senator.name} ${senator.province} ${senator.party}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8), [query, senators]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!open) return null;

  return <div className="command-palette-layer" role="dialog" aria-modal="true" aria-label="Find senator">
    <button type="button" className="senator-drawer-backdrop" aria-label="Close senator search" onClick={() => setOpen(false)} />
    <section className="command-palette">
      <label>Find senator<input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a senator name…" /></label>
      <div>
        {matches.map((senator) => <button key={senator.id} type="button" onClick={() => { selectSenator(senator.id, 'command palette'); setOpen(false); }}><strong>{senator.name}</strong><span>{senator.province} · {groupLabel(senator.party)}</span></button>)}
        {matches.length === 0 && <p className="muted">No senator matches.</p>}
      </div>
    </section>
  </div>;
}
