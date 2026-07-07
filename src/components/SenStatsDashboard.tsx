import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import type { SenStatsCommitteeDocument, SenStatsExpenseDocument, SenStatsSenatorDocument } from '../types';

type SenStatsSenator = SenStatsSenatorDocument;
type SenStatsExpense = SenStatsExpenseDocument & { id: string };
type SenStatsCommittee = SenStatsCommitteeDocument & { id: string };
type SenStatsTab = 'senators' | 'groups' | 'committees';

class SenStatsErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <section className="card blank-app"><p className="eyebrow">SenStats data issue</p><h2>Some political data could not be displayed.</h2><p className="muted">The dashboard is still available, but one section failed to render. Check the ingestion logs and Firestore documents.</p></section>;
    }
    return this.props.children;
  }
}

function currency(amount: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(amount || 0);
}

function groupClassName(group: string) {
  const normalized = group.toLowerCase();
  if (normalized.includes('independent')) return 'group-isg';
  if (normalized.includes('conservative')) return 'group-conservative';
  if (normalized.includes('canadian senators')) return 'group-csg';
  if (normalized.includes('progressive')) return 'group-psg';
  if (normalized.includes('government')) return 'group-gro';
  return 'group-na';
}

function SenStatsDashboardContent() {
  const [activeTab, setActiveTab] = useState<SenStatsTab>('senators');
  const [senators, setSenators] = useState<SenStatsSenator[]>([]);
  const [committees, setCommittees] = useState<SenStatsCommittee[]>([]);
  const [selectedSenatorId, setSelectedSenatorId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<SenStatsExpense[]>([]);
  const [groupFilter, setGroupFilter] = useState('All');
  const [provinceFilter, setProvinceFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const senatorsQuery = query(collection(db, 'senstats_senators'), orderBy('name'));
    return onSnapshot(senatorsQuery, (snapshot) => {
      const nextSenators = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }) as SenStatsSenator);
      setSenators(nextSenators);
      setSelectedSenatorId((current) => current ?? nextSenators[0]?.id ?? null);
      setLoading(false);
      setError(null);
    }, (snapshotError) => {
      setError(snapshotError.message);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const committeesQuery = query(collection(db, 'senstats_committees'), orderBy('name'));
    return onSnapshot(committeesQuery, (snapshot) => {
      setCommittees(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }) as SenStatsCommittee));
    }, (snapshotError) => setError(snapshotError.message));
  }, []);

  useEffect(() => {
    if (!selectedSenatorId) {
      setExpenses([]);
      return undefined;
    }
    setExpenseLoading(true);
    const expensesQuery = query(collection(db, 'senstats_senators', selectedSenatorId, 'expenses'), orderBy('createdAt', 'desc'));
    return onSnapshot(expensesQuery, (snapshot) => {
      setExpenses(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }) as SenStatsExpense));
      setExpenseLoading(false);
    }, (snapshotError) => {
      setError(snapshotError.message);
      setExpenseLoading(false);
    });
  }, [selectedSenatorId]);

  const groupOptions = useMemo(() => ['All', ...Array.from(new Set(senators.map((senator) => senator.party).filter(Boolean))).sort()], [senators]);
  const provinceOptions = useMemo(() => ['All', ...Array.from(new Set(senators.map((senator) => senator.province).filter(Boolean))).sort()], [senators]);
  const filteredSenators = useMemo(() => senators.filter((senator) => {
    const queryText = `${senator.name} ${senator.party} ${senator.province}`.toLowerCase();
    return (groupFilter === 'All' || senator.party === groupFilter)
      && (provinceFilter === 'All' || senator.province === provinceFilter)
      && queryText.includes(searchTerm.trim().toLowerCase());
  }), [groupFilter, provinceFilter, searchTerm, senators]);
  const senatorsByGroup = useMemo(() => groupOptions.filter((group) => group !== 'All').map((group) => ({ group, senators: senators.filter((senator) => senator.party === group) })), [groupOptions, senators]);
  const selectedSenator = senators.find((senator) => senator.id === selectedSenatorId) ?? filteredSenators[0] ?? senators[0];
  const totalExpenses = useMemo(() => expenses.reduce((total, expense) => total + (Number(expense.amount) || 0), 0), [expenses]);

  if (loading) return <section className="card blank-app"><p className="eyebrow">SenStats</p><h2>Loading senators…</h2></section>;
  if (error) return <section className="card blank-app"><p className="eyebrow">Realtime listener failed</p><h2>Unable to load SenStats data.</h2><p className="muted">{error}</p></section>;

  return (
    <section className="card senstats-dashboard">
      <div className="section-heading">
        <div><p className="eyebrow">Realtime Firestore dashboard</p><h2>Senators, groups, and committees</h2></div>
        <span>{senators.length} senators synced · daily at 09:17 UTC</span>
      </div>

      <div className="senstats-tabs" role="tablist" aria-label="SenStats sections">
        {(['senators', 'groups', 'committees'] as SenStatsTab[]).map((tab) => <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab === 'senators' ? 'Senators' : tab === 'groups' ? 'Groups' : 'Committees'}</button>)}
      </div>

      {activeTab === 'senators' && <>
        <div className="senstats-filters">
          <label><span>Search</span><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search senator, province, group…" /></label>
          <label><span>Group / affiliation</span><select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>{groupOptions.map((group) => <option key={group}>{group}</option>)}</select></label>
          <label><span>Province / territory</span><select value={provinceFilter} onChange={(event) => setProvinceFilter(event.target.value)}>{provinceOptions.map((province) => <option key={province}>{province}</option>)}</select></label>
        </div>
        <div className="senstats-grid">
          <aside className="senator-list" aria-label="Canadian senators">
            {filteredSenators.length === 0 && <p className="muted">No senators match those filters.</p>}
            {filteredSenators.map((senator) => <button key={senator.id} type="button" className={senator.id === selectedSenator?.id ? `active ${groupClassName(senator.party)}` : groupClassName(senator.party)} onClick={() => setSelectedSenatorId(senator.id)}><strong>{senator.name}</strong><span>{senator.province}</span><em>{senator.party}</em></button>)}
          </aside>
          <div className="expense-panel">
            {selectedSenator ? <><div className={`senstats-stat ${groupClassName(selectedSenator.party)}`}><span>Selected senator</span><strong>{selectedSenator.name}</strong><small>{selectedSenator.province} · {selectedSenator.party}</small></div><div className="senstats-stat"><span>Visible expenses</span><strong>{currency(totalExpenses)}</strong><small>{expenseLoading ? 'Syncing expense records…' : `${expenses.length} quarterly records`}</small></div><div className="expense-list">{expenses.length === 0 && <p className="muted">No expense records are available for this senator yet.</p>}{expenses.map((expense) => <article key={expense.id}><div><strong>{expense.quarter}</strong><span>{expense.category}</span></div><b>{currency(expense.amount)}</b></article>)}</div></> : <p className="muted">Choose a senator to inspect expenses.</p>}
          </div>
        </div>
      </>}

      {activeTab === 'groups' && <div className="groups-grid">{senatorsByGroup.map(({ group, senators: groupSenators }) => <article key={group} className={`group-card ${groupClassName(group)}`}><div><strong>{group}</strong><span>{groupSenators.length} senators</span></div><ul>{groupSenators.map((senator) => <li key={senator.id}>{senator.name}<small>{senator.province}</small></li>)}</ul></article>)}</div>}

      {activeTab === 'committees' && <div className="committees-grid">{committees.length === 0 && <p className="muted">No committee documents yet. The next SenStats sync will attempt to read current committee pages and membership from the Senate website.</p>}{committees.map((committee) => <article key={committee.id} className="committee-card"><div><strong>{committee.name}</strong><span>{committee.code} · {committee.type || 'Committee'}</span></div><p className="muted">{committee.session || 'Current session'}</p><div className="committee-members">{(committee.members || []).length === 0 && <span>No members parsed yet</span>}{(committee.members || []).map((member) => <span key={`${committee.id}-${member.name}-${member.role}`}>{member.name}{member.role ? ` · ${member.role}` : ''}</span>)}</div></article>)}</div>}
    </section>
  );
}

export function SenStatsDashboard() {
  return <SenStatsErrorBoundary><SenStatsDashboardContent /></SenStatsErrorBoundary>;
}
