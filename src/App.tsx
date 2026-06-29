import { FormEvent, useEffect, useMemo, useState } from 'react';
import { signInAnonymously, type User } from 'firebase/auth';
import { arrayUnion, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';
import { useCollection } from 'react-firebase-hooks/firestore';
import { auth, db } from './firebase';
import { averagePartnerWeights, CANADIAN_VEHICLES, DEFAULT_WEIGHTS, scoreVehicles } from './scoring';
import type { BodyStyle, CriteriaKey, CriteriaWeights, Drivetrain, Powertrain, ScoredVehicle, SessionDocument, TestDriveEntry, UserPreferenceDocument } from './types';
import './styles.css';

const sliderConfig: Array<{ key: CriteriaKey; label: string; help: string }> = [
  { key: 'space', label: 'Car Seat & Cabin Space', help: 'Prioritize second-row room, cargo access, and family ergonomics.' },
  { key: 'winterTraction', label: 'Ottawa Winter Traction', help: 'Favor snow confidence, AWD behavior, and cold-weather stability.' },
  { key: 'valueMSRP', label: 'Value & MSRP Budget', help: 'Emphasize purchase price, features per dollar, and long-term value.' },
];

const bodyStyleOptions: Array<'All' | BodyStyle> = ['All', 'Compact SUV', 'Midsize SUV', 'Wagon'];
const drivetrainOptions: Array<'All' | Drivetrain> = ['All', 'AWD', 'FWD', '4WD'];
const powertrainOptions: Array<'All' | Powertrain> = ['All', 'Gas', 'Hybrid', 'Plug-in Hybrid', 'Electric'];

function getSessionIdFromUrl() {
  return new URLSearchParams(window.location.search).get('session');
}

function App() {
  const [user, authLoading, authError] = useAuthState(auth);
  const [anonymousSignInError, setAnonymousSignInError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || user) return;

    void signInAnonymously(auth)
      .then(() => setAnonymousSignInError(null))
      .catch((error: unknown) => {
        setAnonymousSignInError(error instanceof Error ? error.message : 'Anonymous sign-in failed.');
      });
  }, [authLoading, user]);

  const authFailureMessage = authError?.message ?? anonymousSignInError;

  if (authFailureMessage) {
    return (
      <main className="shell error">
        <section className="card">
          <p className="eyebrow">Firebase Auth setup required</p>
          <h1>Family Fleet Finder could not start a secure anonymous session.</h1>
          <p>{authFailureMessage}</p>
          <p>Enable Authentication and the Anonymous provider for the <strong>flexspace-1</strong> project.</p>
        </section>
      </main>
    );
  }

  if (authLoading || !user) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Initializing secure session...</div>;
  }

  return <AuthenticatedSession activeUser={user} />;
}

interface AuthenticatedSessionProps {
  activeUser: User;
}

function AuthenticatedSession({ activeUser }: AuthenticatedSessionProps) {
  const [sessionId, setSessionId] = useState<string | null>(getSessionIdFromUrl);
  const [session, setSession] = useState<SessionDocument | null>(null);
  const [sessionStatus, setSessionStatus] = useState('Preparing your shared profile...');
  const [filters, setFilters] = useState({ query: '', bodyStyle: 'All' as 'All' | BodyStyle, drivetrain: 'All' as 'All' | Drivetrain, powertrain: 'All' as 'All' | Powertrain, maxPrice: 60000 });
  const [selectedVehicleId, setSelectedVehicleId] = useState(CANADIAN_VEHICLES[0].id);
  const [testDriveEntries, setTestDriveEntries] = useState<TestDriveEntry[]>([]);
  const preferencesQuery = sessionId ? collection(db, 'sessions', sessionId, 'userPreferences') : null;
  const [preferencesSnapshot, preferencesLoading, preferencesError] = useCollection(preferencesQuery as any);

  const preferences = useMemo<UserPreferenceDocument[]>(() => {
    return preferencesSnapshot?.docs.map((preferenceDoc: { id: string; data: () => Partial<UserPreferenceDocument> }) => {
      const data = preferenceDoc.data();
      return {
        userId: data.userId ?? preferenceDoc.id,
        criteriaWeights: data.criteriaWeights ?? DEFAULT_WEIGHTS,
        personalNotes: data.personalNotes ?? {},
      };
    }) ?? [];
  }, [preferencesSnapshot]);

  useEffect(() => {
    async function bootstrapSession() {
      setSessionStatus('Connecting this device to the shared session...');
      const activeSessionId = sessionId ?? doc(collection(db, 'sessions')).id;
      const sessionRef = doc(db, 'sessions', activeSessionId);
      const shareLink = `${window.location.origin}/join?session=${activeSessionId}`;
      const snapshot = await getDoc(sessionRef);

      if (!snapshot.exists()) {
        const newSession: Omit<SessionDocument, 'createdAt'> & { createdAt: ReturnType<typeof serverTimestamp> } = {
          id: activeSessionId,
          dynamicShareLink: shareLink,
          createdAt: serverTimestamp(),
          partnerIds: [activeUser.uid],
          vehiclesShortlist: CANADIAN_VEHICLES.map((vehicle) => vehicle.id),
        };
        await setDoc(sessionRef, newSession);
      } else {
        await updateDoc(sessionRef, { partnerIds: arrayUnion(activeUser.uid), dynamicShareLink: shareLink });
      }

      await setDoc(
        doc(db, 'sessions', activeSessionId, 'userPreferences', activeUser.uid),
        { userId: activeUser.uid, criteriaWeights: DEFAULT_WEIGHTS, personalNotes: {} },
        { merge: true },
      );

      const refreshed = await getDoc(sessionRef);
      setSession(refreshed.data() as SessionDocument);
      setSessionId(activeSessionId);
      window.history.replaceState({}, '', `/?session=${activeSessionId}`);
      setSessionStatus('Live session connected. Share the invite link with your partner.');
    }

    void bootstrapSession().catch((error: unknown) => {
      setSessionStatus(error instanceof Error ? error.message : 'Unable to initialize the shared session.');
    });
  }, [activeUser.uid, sessionId]);

  const myPreference = preferences.find((preference) => preference.userId === activeUser.uid);
  const combinedWeights = useMemo(() => averagePartnerWeights(preferences), [preferences]);
  const scoredVehicles = useMemo(() => scoreVehicles(combinedWeights), [combinedWeights]);
  const filteredVehicles = useMemo(() => {
    const search = filters.query.trim().toLowerCase();
    return scoredVehicles.filter((vehicle) => {
      const matchesSearch = !search || `${vehicle.make} ${vehicle.model}`.toLowerCase().includes(search);
      const matchesBody = filters.bodyStyle === 'All' || vehicle.bodyStyle === filters.bodyStyle;
      const matchesDrivetrain = filters.drivetrain === 'All' || vehicle.drivetrain === filters.drivetrain;
      const matchesPowertrain = filters.powertrain === 'All' || vehicle.powertrain === filters.powertrain;
      return matchesSearch && matchesBody && matchesDrivetrain && matchesPowertrain && vehicle.msrp <= filters.maxPrice;
    });
  }, [filters, scoredVehicles]);

  const selectedVehicle = scoredVehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? scoredVehicles[0]!;

  return (
    <main className="shell">
      <section className="hero card">
        <p className="eyebrow">Family Fleet Finder</p>
        <h1>Compare family vehicles together, in real time.</h1>
        <p>Pair two devices, rank priorities, estimate payments, track test drives, and keep manufacturer research in one shared workspace.</p>
        <div className="invite-panel">
          <span>{sessionStatus}</span>
          <input readOnly value={session?.dynamicShareLink ?? 'Creating invite link...'} aria-label="Invite link" />
        </div>
      </section>

      <section className="grid">
        <PrioritySliders sessionId={sessionId} userId={activeUser.uid} currentWeights={myPreference?.criteriaWeights} />
        <Dashboard scoredVehicles={filteredVehicles} combinedWeights={combinedWeights} loading={preferencesLoading || !sessionId} error={preferencesError?.message} partnerCount={preferences.length} onSelectVehicle={setSelectedVehicleId} />
      </section>

      <VehicleBrowser filters={filters} onFiltersChange={setFilters} vehicles={filteredVehicles} onSelectVehicle={setSelectedVehicleId} />
      <VehicleProfile vehicle={selectedVehicle} />
      <PaymentCalculator vehicle={selectedVehicle} />
      <TestDriveDiary vehicles={scoredVehicles} entries={testDriveEntries} onEntriesChange={setTestDriveEntries} />
      <FeatureIdeas />
    </main>
  );
}

interface PrioritySlidersProps {
  sessionId: string | null;
  userId?: string;
  currentWeights?: CriteriaWeights;
}

function PrioritySliders({ sessionId, userId, currentWeights }: PrioritySlidersProps) {
  const [draftWeights, setDraftWeights] = useState<CriteriaWeights>(currentWeights ?? DEFAULT_WEIGHTS);
  const [saveState, setSaveState] = useState('Ready');

  useEffect(() => {
    setDraftWeights(currentWeights ?? DEFAULT_WEIGHTS);
  }, [currentWeights]);

  useEffect(() => {
    if (!sessionId || !userId) return;

    setSaveState('Saving...');
    const timeout = window.setTimeout(async () => {
      await setDoc(doc(db, 'sessions', sessionId, 'userPreferences', userId), { userId, criteriaWeights: draftWeights, personalNotes: {} }, { merge: true });
      setSaveState('Synced');
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [draftWeights, sessionId, userId]);

  function handleSliderChange(key: CriteriaKey, value: string) {
    setDraftWeights((current) => ({ ...current, [key]: Number(value) }));
  }

  return (
    <form className="card sliders" onSubmit={(event: FormEvent) => event.preventDefault()}>
      <div className="section-heading"><p className="eyebrow">Your priorities</p><span>{saveState}</span></div>
      <h2>Balance what matters most.</h2>
      {sliderConfig.map((slider) => (
        <label className="slider-row" key={slider.key}>
          <span className="slider-label"><strong>{slider.label}</strong><small>{slider.help}</small></span>
          <input type="range" min="1" max="10" value={draftWeights[slider.key]} onChange={(event) => handleSliderChange(slider.key, event.target.value)} disabled={!sessionId || !userId} />
          <b>{draftWeights[slider.key]}</b>
        </label>
      ))}
    </form>
  );
}

interface DashboardProps {
  scoredVehicles: ScoredVehicle[];
  combinedWeights: CriteriaWeights;
  loading: boolean;
  error?: string;
  partnerCount: number;
  onSelectVehicle: (vehicleId: string) => void;
}

function Dashboard({ scoredVehicles, combinedWeights, loading, error, partnerCount, onSelectVehicle }: DashboardProps) {
  return (
    <section className="card dashboard">
      <div className="section-heading"><p className="eyebrow">Live ranking</p><span>{partnerCount} partner profile{partnerCount === 1 ? '' : 's'} connected</span></div>
      <h2>Compatibility Score</h2>
      {loading && <p className="muted">Loading shared Firestore preferences...</p>}
      {error && <p className="error-text">Preference stream error: {error}</p>}
      <div className="weight-summary"><span>Space {combinedWeights.space.toFixed(1)}</span><span>Winter {combinedWeights.winterTraction.toFixed(1)}</span><span>Value {combinedWeights.valueMSRP.toFixed(1)}</span></div>
      <div className="bars">
        {scoredVehicles.slice(0, 8).map((vehicle) => (
          <button className="vehicle-row" key={vehicle.id} onClick={() => onSelectVehicle(vehicle.id)}>
            <span><strong>{vehicle.name}</strong><small>${vehicle.msrp.toLocaleString('en-CA')} • {vehicle.powertrain}</small></span>
            <span className="bar-shell"><span className="bar-fill" style={{ width: `${vehicle.familyCompatibilityScore}%` }} /></span>
            <b>{vehicle.familyCompatibilityScore}</b>
          </button>
        ))}
      </div>
    </section>
  );
}

interface VehicleBrowserProps {
  filters: { query: string; bodyStyle: 'All' | BodyStyle; drivetrain: 'All' | Drivetrain; powertrain: 'All' | Powertrain; maxPrice: number };
  onFiltersChange: (filters: VehicleBrowserProps['filters']) => void;
  vehicles: ScoredVehicle[];
  onSelectVehicle: (vehicleId: string) => void;
}

function VehicleBrowser({ filters, onFiltersChange, vehicles, onSelectVehicle }: VehicleBrowserProps) {
  return (
    <section className="card stack">
      <div className="section-heading"><p className="eyebrow">Browse models</p><span>{vehicles.length} matches</span></div>
      <div className="filters">
        <input value={filters.query} onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })} placeholder="Search make or model" />
        <select value={filters.bodyStyle} onChange={(event) => onFiltersChange({ ...filters, bodyStyle: event.target.value as 'All' | BodyStyle })}>{bodyStyleOptions.map((option) => <option key={option}>{option}</option>)}</select>
        <select value={filters.drivetrain} onChange={(event) => onFiltersChange({ ...filters, drivetrain: event.target.value as 'All' | Drivetrain })}>{drivetrainOptions.map((option) => <option key={option}>{option}</option>)}</select>
        <select value={filters.powertrain} onChange={(event) => onFiltersChange({ ...filters, powertrain: event.target.value as 'All' | Powertrain })}>{powertrainOptions.map((option) => <option key={option}>{option}</option>)}</select>
        <label>Max ${filters.maxPrice.toLocaleString('en-CA')}<input type="range" min="30000" max="70000" step="1000" value={filters.maxPrice} onChange={(event) => onFiltersChange({ ...filters, maxPrice: Number(event.target.value) })} /></label>
      </div>
      <div className="vehicle-cards">
        {vehicles.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} onSelect={() => onSelectVehicle(vehicle.id)} />)}
      </div>
    </section>
  );
}

function VehicleCard({ vehicle, onSelect }: { vehicle: ScoredVehicle; onSelect: () => void }) {
  return (
    <button className="vehicle-card" onClick={onSelect}>
      <VehicleImage vehicle={vehicle} />
      <strong>{vehicle.name}</strong>
      <span>${vehicle.msrp.toLocaleString('en-CA')} • {vehicle.drivetrain} • {vehicle.powertrain}</span>
      <b>{vehicle.familyCompatibilityScore}/100</b>
    </button>
  );
}

function VehicleImage({ vehicle }: { vehicle: ScoredVehicle }) {
  return vehicle.imageUrl ? <img className="vehicle-photo" src={vehicle.imageUrl} alt={`${vehicle.name} manufacturer gallery`} /> : <div className="vehicle-photo photo-fallback">{vehicle.make}</div>;
}

function VehicleProfile({ vehicle }: { vehicle: ScoredVehicle }) {
  return (
    <section className="card profile">
      <VehicleImage vehicle={vehicle} />
      <div>
        <p className="eyebrow">Model profile</p>
        <h2>{vehicle.year} {vehicle.name}</h2>
        <div className="spec-grid">
          <span>MSRP <b>${vehicle.msrp.toLocaleString('en-CA')}</b></span><span>Body <b>{vehicle.bodyStyle}</b></span><span>Seats <b>{vehicle.seats}</b></span><span>Cargo <b>{vehicle.cargoLitres} L</b></span><span>Drive <b>{vehicle.drivetrain}</b></span><span>Efficiency <b>{vehicle.fuelEfficiency}</b></span>
        </div>
        <h3>Why it fits</h3><ul>{vehicle.highlights.map((item) => <li key={item}>{item}</li>)}</ul>
        <h3>Watch-outs</h3><ul>{vehicle.tradeoffs.map((item) => <li key={item}>{item}</li>)}</ul>
        <a href={vehicle.manufacturerUrl} target="_blank" rel="noreferrer">Open manufacturer page / gallery</a>
        <small>Photo/source: {vehicle.photoCredit}</small>
      </div>
    </section>
  );
}

function PaymentCalculator({ vehicle }: { vehicle: ScoredVehicle }) {
  const [price, setPrice] = useState(vehicle.msrp);
  const [rate, setRate] = useState(5.99);
  const [termMonths, setTermMonths] = useState(60);
  const [downPayment, setDownPayment] = useState(5000);
  const [extraPrincipal, setExtraPrincipal] = useState(0);

  useEffect(() => setPrice(vehicle.msrp), [vehicle.msrp]);

  const principal = Math.max(price - downPayment - extraPrincipal, 0);
  const monthlyRate = rate / 100 / 12;
  const safeTermMonths = Math.max(termMonths, 1);
  const payment = monthlyRate === 0 ? principal / safeTermMonths : (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -safeTermMonths);
  const totalInterest = Math.max(payment * safeTermMonths - principal, 0);

  return (
    <section className="card stack">
      <div className="section-heading"><p className="eyebrow">Payment calculator</p><span>{vehicle.name}</span></div>
      <div className="calculator-grid">
        <label>Price<input type="number" value={price} onChange={(event) => setPrice(Number(event.target.value))} /></label>
        <label>Interest %<input type="number" step="0.1" value={rate} onChange={(event) => setRate(Number(event.target.value))} /></label>
        <label>Term months<input type="number" value={termMonths} onChange={(event) => setTermMonths(Number(event.target.value))} /></label>
        <label>Down payment<input type="number" value={downPayment} onChange={(event) => setDownPayment(Number(event.target.value))} /></label>
        <label>Lump principal<input type="number" value={extraPrincipal} onChange={(event) => setExtraPrincipal(Number(event.target.value))} /></label>
      </div>
      <div className="payment-result"><strong>${Math.round(payment).toLocaleString('en-CA')}</strong><span>/ month estimated</span><small>Financed principal ${principal.toLocaleString('en-CA')} • estimated interest ${Math.round(totalInterest).toLocaleString('en-CA')}</small></div>
    </section>
  );
}

function TestDriveDiary({ vehicles, entries, onEntriesChange }: { vehicles: ScoredVehicle[]; entries: TestDriveEntry[]; onEntriesChange: (entries: TestDriveEntry[]) => void }) {
  const [draft, setDraft] = useState<TestDriveEntry>({ vehicleId: vehicles[0]?.id ?? '', date: new Date().toISOString().slice(0, 10), dealer: '', notes: '', carSeatFits: false, strollerFits: false, winterConfidence: 5, partnerRating: 5 });

  function addEntry(event: FormEvent) {
    event.preventDefault();
    onEntriesChange([draft, ...entries]);
    setDraft({ ...draft, dealer: '', notes: '' });
  }

  return (
    <section className="card stack">
      <div className="section-heading"><p className="eyebrow">Test drive diary</p><span>{entries.length} entries</span></div>
      <form className="diary-form" onSubmit={addEntry}>
        <select value={draft.vehicleId} onChange={(event) => setDraft({ ...draft, vehicleId: event.target.value })}>{vehicles.map((vehicle) => <option value={vehicle.id} key={vehicle.id}>{vehicle.name}</option>)}</select>
        <input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
        <input placeholder="Dealer / location" value={draft.dealer} onChange={(event) => setDraft({ ...draft, dealer: event.target.value })} />
        <textarea placeholder="Driving notes, kid comfort, road noise..." value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
        <label><input type="checkbox" checked={draft.carSeatFits} onChange={(event) => setDraft({ ...draft, carSeatFits: event.target.checked })} /> Car seat fit checked</label>
        <label><input type="checkbox" checked={draft.strollerFits} onChange={(event) => setDraft({ ...draft, strollerFits: event.target.checked })} /> Stroller fit checked</label>
        <label>Winter confidence {draft.winterConfidence}<input type="range" min="1" max="10" value={draft.winterConfidence} onChange={(event) => setDraft({ ...draft, winterConfidence: Number(event.target.value) })} /></label>
        <label>Partner rating {draft.partnerRating}<input type="range" min="1" max="10" value={draft.partnerRating} onChange={(event) => setDraft({ ...draft, partnerRating: Number(event.target.value) })} /></label>
        <button type="submit">Add diary entry</button>
      </form>
      <div className="diary-list">{entries.map((entry, index) => <article key={`${entry.vehicleId}-${entry.date}-${index}`}><strong>{vehicles.find((vehicle) => vehicle.id === entry.vehicleId)?.name}</strong><span>{entry.date} • {entry.dealer || 'No dealer noted'}</span><p>{entry.notes || 'No notes yet.'}</p></article>)}</div>
    </section>
  );
}

function FeatureIdeas() {
  return (
    <section className="card stack">
      <p className="eyebrow">Suggested next features</p>
      <ul className="ideas">
        <li>Shared shortlist voting and vetoes.</li>
        <li>Insurance quote and winter tire cost tracking.</li>
        <li>Trade-in value and fuel-cost comparison over five years.</li>
        <li>Firestore-backed diary sync with photo uploads from test drives.</li>
      </ul>
    </section>
  );
}

export default App;
