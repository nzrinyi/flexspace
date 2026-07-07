import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import type { SenStatsExpenseDocument, SenStatsSenatorDocument } from '../types';

type SenStatsSenator = SenStatsSenatorDocument;
type SenStatsExpense = SenStatsExpenseDocument & { id: string };

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

function SenStatsDashboardContent() {
  const [senators, setSenators] = useState<SenStatsSenator[]>([]);
  const [selectedSenatorId, setSelectedSenatorId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<SenStatsExpense[]>([]);
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

  const selectedSenator = senators.find((senator) => senator.id === selectedSenatorId) ?? senators[0];
  const totalExpenses = useMemo(() => expenses.reduce((total, expense) => total + (Number(expense.amount) || 0), 0), [expenses]);

  if (loading) return <section className="card blank-app"><p className="eyebrow">SenStats</p><h2>Loading senators…</h2></section>;
  if (error) return <section className="card blank-app"><p className="eyebrow">Realtime listener failed</p><h2>Unable to load SenStats data.</h2><p className="muted">{error}</p></section>;

  return (
    <section className="card senstats-dashboard">
      <div className="section-heading">
        <div><p className="eyebrow">Realtime Firestore dashboard</p><h2>Senator expenses</h2></div>
        <span>{senators.length} senators synced</span>
      </div>
      <div className="senstats-grid">
        <aside className="senator-list" aria-label="Canadian senators">
          {senators.length === 0 && <p className="muted">No senator documents yet. Run the daily ingestion workflow to seed Firestore.</p>}
          {senators.map((senator) => <button key={senator.id} type="button" className={senator.id === selectedSenator?.id ? 'active' : ''} onClick={() => setSelectedSenatorId(senator.id)}><strong>{senator.name}</strong><span>{senator.province} · {senator.party}</span></button>)}
        </aside>
        <div className="expense-panel">
          {selectedSenator ? <><div className="senstats-stat"><span>Selected senator</span><strong>{selectedSenator.name}</strong><small>{selectedSenator.province} · {selectedSenator.party}</small></div><div className="senstats-stat"><span>Visible expenses</span><strong>{currency(totalExpenses)}</strong><small>{expenseLoading ? 'Syncing expense records…' : `${expenses.length} quarterly records`}</small></div><div className="expense-list">{expenses.length === 0 && <p className="muted">No expense records are available for this senator yet.</p>}{expenses.map((expense) => <article key={expense.id}><div><strong>{expense.quarter}</strong><span>{expense.category}</span></div><b>{currency(expense.amount)}</b></article>)}</div></> : <p className="muted">Choose a senator to inspect expenses.</p>}
        </div>
      </div>
    </section>
  );
}

export function SenStatsDashboard() {
  return <SenStatsErrorBoundary><SenStatsDashboardContent /></SenStatsErrorBoundary>;
}
