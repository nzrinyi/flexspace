import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, collectionGroup, doc, getDocs, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import type { SenStatsAffiliationHistoryDocument, SenStatsAttendanceDocument, SenStatsChangeLogDocument, SenStatsCommitteeDocument, SenStatsExpenseDocument, SenStatsSenatorDocument, SenStatsSyncStatusDocument } from '../types';
import { SenStatsChangeLogView } from './senstats/SenStatsChangeLogView';
import { SenStatsCommitteesView } from './senstats/SenStatsCommitteesView';
import { SenStatsDashboardsView } from './senstats/SenStatsDashboardsView';
import { SenStatsDataSourcesView } from './senstats/SenStatsDataSourcesView';
import { SenStatsLoadingSkeleton } from './senstats/SenStatsLoadingSkeleton';
import { SenatorCommandPalette, SenatorProfileDrawer } from './senstats/SenatorProfileDrawer';
import { SenatorSelectionProvider, useSenatorSelect } from './senstats/SenatorSelectionContext';
import { SenStatsSenatorsView } from './senstats/SenStatsSenatorsView';

type SenStatsSenator = SenStatsSenatorDocument;
type SenStatsExpense = SenStatsExpenseDocument & { id: string };
type SenStatsCommittee = SenStatsCommitteeDocument & { id: string };
type SenStatsSyncStatus = SenStatsSyncStatusDocument;
type SenStatsAttendance = SenStatsAttendanceDocument & { id: string };
type SenStatsChange = SenStatsChangeLogDocument & { id: string };
type SenStatsTab = 'senators' | 'dashboards' | 'committees' | 'sources' | 'changes';

function TabIcon({ tab }: { tab: SenStatsTab }) {
  const paths: Record<SenStatsTab, string> = {
    senators: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0H5Zm14.5-9.5 1.5 1.5 2.5-2.5-1.5-1.5-2.5 2.5ZM19 4h4v2h-4V4Zm0 4h3v2h-3V8Z',
    dashboards: 'M4 19h16v2H4v-2Zm1-8h4v6H5v-6Zm5-6h4v12h-4V5Zm5 3h4v9h-4V8Z',
    committees: 'M7 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm10 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM7 13c-3 0-5 1.6-5 4v2h10v-2c0-2.4-2-4-5-4Zm10 0c-3 0-5 1.6-5 4v2h10v-2c0-2.4-2-4-5-4Z',
    sources: 'M12 3C7 3 4 4.5 4 7v10c0 2.5 3 4 8 4s8-1.5 8-4V7c0-2.5-3-4-8-4Zm0 2c4 0 6 1 6 2s-2 2-6 2-6-1-6-2 2-2 6-2Zm0 14c-4 0-6-1-6-2v-2c1.4.9 3.5 1.4 6 1.4s4.6-.5 6-1.4v2c0 1-2 2-6 2Zm0-4.5c-4 0-6-1-6-2v-2c1.4.9 3.5 1.4 6 1.4s4.6-.5 6-1.4v2c0 1-2 2-6 2Z',
    changes: 'M12 6V3L8 7l4 4V8c2.8 0 5 2.2 5 5 0 .9-.2 1.7-.6 2.4l1.5 1.5c.7-1.1 1.1-2.4 1.1-3.9 0-3.9-3.1-7-7-7Zm-5 5c0-.9.2-1.7.6-2.4L6.1 7.1C5.4 8.2 5 9.5 5 11c0 3.9 3.1 7 7 7v3l4-4-4-4v3c-2.8 0-5-2.2-5-5Z',
  };
  return <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={paths[tab]} fill="currentColor" /></svg>;
}

class SenStatsErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <section className="card blank-app"><p className="eyebrow">Quorum data issue</p><h2>Some political data could not be displayed.</h2><p className="muted">The dashboard is still available, but one section failed to render. Check the ingestion logs and Firestore documents.</p></section>;
    }
    return this.props.children;
  }
}

function SenStatsDashboardContent({ darkMode }: { darkMode: boolean }) {
  const { selectSenator } = useSenatorSelect();
  const [activeTab, setActiveTab] = useState<SenStatsTab>('senators');
  const [senators, setSenators] = useState<SenStatsSenator[]>([]);
  const [committees, setCommittees] = useState<SenStatsCommittee[]>([]);
  const [selectedSenatorId, setSelectedSenatorId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<SenStatsExpense[]>([]);
  const [allExpenses, setAllExpenses] = useState<SenStatsExpense[]>([]);
  const [recentlyChangedSenatorIds, setRecentlyChangedSenatorIds] = useState<Set<string>>(new Set());
  const [syncStatus, setSyncStatus] = useState<SenStatsSyncStatus | null>(null);
  const [changeLog, setChangeLog] = useState<SenStatsChange[]>([]);
  const [attendance, setAttendance] = useState<SenStatsAttendance[]>([]);
  const [groupFilter, setGroupFilter] = useState('All');
  const [provinceFilter, setProvinceFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [allExpenseLoading, setAllExpenseLoading] = useState(true);
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
    return onSnapshot(collection(db, 'senstats_attendance'), (snapshot) => {
      setAttendance(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }) as SenStatsAttendance).sort((a, b) => String(a.senatorName ?? '').localeCompare(String(b.senatorName ?? ''))));
    }, (snapshotError) => {
      console.warn('Unable to load SenStats attendance rows', snapshotError);
      setAttendance([]);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(doc(db, 'senstats_sync', 'latest'), (snapshot) => {
      setSyncStatus(snapshot.exists() ? snapshot.data() as SenStatsSyncStatus : null);
    }, (snapshotError) => setError(snapshotError.message));
  }, []);

  useEffect(() => {
    const changesQuery = query(collection(db, 'senstats_change_log'), orderBy('detectedAt', 'desc'), limit(50));
    return onSnapshot(changesQuery, (snapshot) => {
      setChangeLog(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }) as SenStatsChange));
    }, (snapshotError) => setError(snapshotError.message));
  }, []);


  useEffect(() => {
    setAllExpenseLoading(true);
    return onSnapshot(collection(db, 'senstats_expenses'), (snapshot) => {
      const nextExpenses = snapshot.docs.map((docSnapshot) => {
        const data = docSnapshot.data() as SenStatsExpenseDocument;
        const parentSenatorId = docSnapshot.ref.parent.parent?.id || '';
        return { id: docSnapshot.id, ...data, senatorId: data.senatorId || parentSenatorId } as SenStatsExpense;
      });
      setAllExpenses((currentExpenses) => (nextExpenses.length || currentExpenses.length === 0 ? nextExpenses : currentExpenses));
      setAllExpenseLoading(false);
    }, (snapshotError) => {
      console.warn('Unable to load SenStats expense rows', snapshotError);
      setAllExpenses([]);
      setAllExpenseLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!senators.length || allExpenses.length > 0) return undefined;
    let cancelled = false;
    setAllExpenseLoading(true);
    Promise.all(senators.map(async (senator) => {
      const snapshot = await getDocs(collection(db, 'senstats_senators', senator.id, 'expenses'));
      return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data(), senatorId: senator.id, senatorName: senator.name }) as SenStatsExpense);
    })).then((expenseGroups) => {
      if (!cancelled) {
        const flattened = expenseGroups.flat();
        if (flattened.length) setAllExpenses(flattened);
        setAllExpenseLoading(false);
      }
    }).catch((snapshotError) => {
      console.warn('Unable to load nested SenStats expense fallback rows', snapshotError);
      if (!cancelled) setAllExpenseLoading(false);
    });
    return () => { cancelled = true; };
  }, [allExpenses.length, senators]);

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
  const selectedSenator = senators.find((senator) => senator.id === selectedSenatorId) ?? filteredSenators[0] ?? senators[0];

  if (loading) return <SenStatsLoadingSkeleton />;
  if (error) return <section className="card blank-app"><p className="eyebrow">Realtime listener failed</p><h2>Unable to load Quorum data.</h2><p className="muted">{error}</p></section>;

  return (
    <section className={`card senstats-dashboard ${darkMode ? 'senstats-dark' : ''}`}>
      <div className="senstats-tabs" role="tablist" aria-label="Quorum sections">
        {(['senators', 'dashboards', 'committees', 'sources', 'changes'] as SenStatsTab[]).map((tab) => <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}><TabIcon tab={tab} /><span>{tab === 'senators' ? 'Senators' : tab === 'dashboards' ? 'Dashboards' : tab === 'committees' ? 'Committees' : tab === 'sources' ? 'Data sources' : 'Change log'}</span></button>)}
      </div>

      {activeTab === 'senators' && <SenStatsSenatorsView senators={senators} selectedSenator={selectedSenator} filteredSenators={filteredSenators} groupOptions={groupOptions} provinceOptions={provinceOptions} groupFilter={groupFilter} provinceFilter={provinceFilter} searchTerm={searchTerm} onGroupFilterChange={setGroupFilter} onProvinceFilterChange={setProvinceFilter} onSearchTermChange={setSearchTerm} onSelectSenator={(id) => { setSelectedSenatorId(id); selectSenator(id, 'Senators'); }} />}
      {activeTab === 'dashboards' && <SenStatsDashboardsView senators={senators} attendance={attendance} expenses={allExpenses} selectedSenator={selectedSenator} onSelectSenator={(id) => { setSelectedSenatorId(id); selectSenator(id, 'Dashboards'); }} expensesLoading={allExpenseLoading} recentlyChangedSenatorIds={recentlyChangedSenatorIds} syncedAttendanceCount={syncStatus?.attendanceCount ?? 0} />}
      {activeTab === 'committees' && <SenStatsCommitteesView committees={committees} senators={senators} />}
      {activeTab === 'sources' && <SenStatsDataSourcesView senatorCount={senators.length} expenseCount={syncStatus?.expenseCount ?? allExpenses.length} committeeCount={syncStatus?.committeeCount ?? committees.length} attendanceCount={syncStatus?.attendanceCount ?? attendance.length} syncStatus={syncStatus} />}
      {activeTab === 'changes' && <SenStatsChangeLogView changes={changeLog} onSelectSenator={(id) => { setSelectedSenatorId(id); selectSenator(id, 'Change log'); }} />}
      <SenatorProfileDrawer senators={senators} committees={committees} expenses={allExpenses} />
      <SenatorCommandPalette senators={senators} />
    </section>
  );
}

export function SenStatsDashboard({ darkMode }: { darkMode: boolean }) {
  return <SenStatsErrorBoundary><SenatorSelectionProvider><SenStatsDashboardContent darkMode={darkMode} /></SenatorSelectionProvider></SenStatsErrorBoundary>;
}
