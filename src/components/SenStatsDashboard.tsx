import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, collectionGroup, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import type { SenStatsAffiliationHistoryDocument, SenStatsCommitteeDocument, SenStatsExpenseDocument, SenStatsSenatorDocument } from '../types';
import { SenStatsCommitteesView } from './senstats/SenStatsCommitteesView';
import { SenStatsDataSourcesView } from './senstats/SenStatsDataSourcesView';
import { SenStatsGroupsView } from './senstats/SenStatsGroupsView';
import { SenStatsLoadingSkeleton } from './senstats/SenStatsLoadingSkeleton';
import { SenStatsSenatorsView } from './senstats/SenStatsSenatorsView';

type SenStatsSenator = SenStatsSenatorDocument;
type SenStatsExpense = SenStatsExpenseDocument & { id: string };
type SenStatsCommittee = SenStatsCommitteeDocument & { id: string };
type SenStatsTab = 'senators' | 'groups' | 'committees' | 'sources';

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

function SenStatsDashboardContent() {
  const [activeTab, setActiveTab] = useState<SenStatsTab>('senators');
  const [senators, setSenators] = useState<SenStatsSenator[]>([]);
  const [committees, setCommittees] = useState<SenStatsCommittee[]>([]);
  const [selectedSenatorId, setSelectedSenatorId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<SenStatsExpense[]>([]);
  const [recentlyChangedSenatorIds, setRecentlyChangedSenatorIds] = useState<Set<string>>(new Set());
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
    return onSnapshot(collectionGroup(db, 'party_affiliation_history'), (snapshot) => {
      const changedIds = new Set<string>();
      snapshot.docs.forEach((docSnapshot) => {
        const history = docSnapshot.data() as SenStatsAffiliationHistoryDocument;
        if (history.senatorId) changedIds.add(history.senatorId);
      });
      setRecentlyChangedSenatorIds(changedIds);
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

  if (loading) return <SenStatsLoadingSkeleton />;
  if (error) return <section className="card blank-app"><p className="eyebrow">Realtime listener failed</p><h2>Unable to load SenStats data.</h2><p className="muted">{error}</p></section>;

  return (
    <section className="card senstats-dashboard">
      <div className="section-heading">
        <div><h2>Senators, groups, and committees</h2></div>
        <span>{senators.length} senators synced · daily at 09:17 UTC</span>
      </div>

      <div className="senstats-tabs" role="tablist" aria-label="SenStats sections">
        {(['senators', 'groups', 'committees', 'sources'] as SenStatsTab[]).map((tab) => <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab === 'senators' ? 'Senators' : tab === 'groups' ? 'Groups' : tab === 'committees' ? 'Committees' : 'Data sources'}</button>)}
      </div>

      {activeTab === 'senators' && <SenStatsSenatorsView senators={senators} selectedSenator={selectedSenator} filteredSenators={filteredSenators} expenses={expenses} committees={committees} expenseLoading={expenseLoading} groupOptions={groupOptions} provinceOptions={provinceOptions} groupFilter={groupFilter} provinceFilter={provinceFilter} searchTerm={searchTerm} recentlyChangedSenatorIds={recentlyChangedSenatorIds} onGroupFilterChange={setGroupFilter} onProvinceFilterChange={setProvinceFilter} onSearchTermChange={setSearchTerm} onSelectSenator={setSelectedSenatorId} />}
      {activeTab === 'groups' && <SenStatsGroupsView groups={senatorsByGroup} recentlyChangedSenatorIds={recentlyChangedSenatorIds} />}
      {activeTab === 'committees' && <SenStatsCommitteesView committees={committees} />}
      {activeTab === 'sources' && <SenStatsDataSourcesView senatorCount={senators.length} selectedSenator={selectedSenator} expenses={expenses} committees={committees} />}
    </section>
  );
}

export function SenStatsDashboard() {
  return <SenStatsErrorBoundary><SenStatsDashboardContent /></SenStatsErrorBoundary>;
}
