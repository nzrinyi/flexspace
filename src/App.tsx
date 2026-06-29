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
          <h1>CarMatch could not start a secure anonymous session.</h1>
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
  const [activeSection, setActiveSection] = useState<'dashboard' | 'browse' | 'profile' | 'calculator' | 'diary'>('dashboard');
  const [activeProfile, setActiveProfile] = useState<'Emily' | 'Nick'>('Emily');
  const [favoritesByProfile, setFavoritesByProfile] = useState<Record<'Emily' | 'Nick', string[]>>({ Emily: [], Nick: [] });
  const [sharedNotesByVehicle, setSharedNotesByVehicle] = useState<Record<string, string>>({});
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
        <div className="hero-topline"><p className="eyebrow">CarMatch</p><span>{sessionStatus}</span></div>
        <h1>Compare family vehicles together.</h1>
        <p>Rank priorities, browse models, estimate payments, and track test drives in one shared workspace.</p>
        <div className="profile-switcher" aria-label="User profile selector">
          {(['Emily', 'Nick'] as const).map((profileName) => (
            <button key={profileName} className={activeProfile === profileName ? 'active' : ''} onClick={() => setActiveProfile(profileName)}>{profileName}</button>
          ))}
        </div>
      </section>

      <nav className="app-menu" aria-label="Primary app sections">
        <button className={activeSection === 'dashboard' ? 'active' : ''} onClick={() => setActiveSection('dashboard')}>Shared priorities</button>
        <button className={activeSection === 'browse' ? 'active' : ''} onClick={() => setActiveSection('browse')}>Browse vehicles</button>
        <button className={activeSection === 'calculator' ? 'active' : ''} onClick={() => setActiveSection('calculator')}>Payment calculator</button>
        <button className={activeSection === 'diary' ? 'active' : ''} onClick={() => setActiveSection('diary')}>Test drive diary</button>
      </nav>

      {activeSection === 'dashboard' && (
        <section className="grid">
          <PrioritySliders sessionId={sessionId} userId={activeUser.uid} currentWeights={myPreference?.criteriaWeights} />
          <Dashboard scoredVehicles={filteredVehicles} combinedWeights={combinedWeights} loading={preferencesLoading || !sessionId} error={preferencesError?.message} partnerCount={preferences.length} onSelectVehicle={(vehicleId) => { setSelectedVehicleId(vehicleId); setActiveSection('profile'); }} />
        </section>
      )}

      {activeSection === 'browse' && (
        <VehicleBrowser filters={filters} onFiltersChange={setFilters} vehicles={filteredVehicles} activeProfile={activeProfile} favorites={favoritesByProfile[activeProfile]} onToggleFavorite={(vehicleId) => setFavoritesByProfile((current) => toggleProfileFavorite(current, activeProfile, vehicleId))} onSelectVehicle={(vehicleId) => { setSelectedVehicleId(vehicleId); setActiveSection('profile'); }} />
      )}

      {activeSection === 'profile' && <VehicleProfile vehicle={selectedVehicle} activeProfile={activeProfile} isFavorite={favoritesByProfile[activeProfile].includes(selectedVehicle.id)} onToggleFavorite={() => setFavoritesByProfile((current) => toggleProfileFavorite(current, activeProfile, selectedVehicle.id))} sharedNote={sharedNotesByVehicle[selectedVehicle.id] ?? ''} onSharedNoteChange={(note) => setSharedNotesByVehicle((current) => ({ ...current, [selectedVehicle.id]: note }))} />}
      {activeSection === 'calculator' && <PaymentCalculator vehicle={selectedVehicle} />}
      {activeSection === 'diary' && <TestDriveDiary vehicles={scoredVehicles} entries={testDriveEntries} onEntriesChange={setTestDriveEntries} />}
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
  activeProfile: 'Emily' | 'Nick';
  favorites: string[];
  onToggleFavorite: (vehicleId: string) => void;
  onSelectVehicle: (vehicleId: string) => void;
}

function VehicleBrowser({ filters, onFiltersChange, vehicles, activeProfile, favorites, onToggleFavorite, onSelectVehicle }: VehicleBrowserProps) {
  return (
    <section className="card stack">
      <div className="section-heading"><p className="eyebrow">Browse models</p><span>{vehicles.length} matches</span></div>
      <div className="filters">
        <label>Search<input value={filters.query} onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })} placeholder="Make or model" /></label>
        <label>Body style<select value={filters.bodyStyle} onChange={(event) => onFiltersChange({ ...filters, bodyStyle: event.target.value as 'All' | BodyStyle })}>{bodyStyleOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label>Drivetrain<select value={filters.drivetrain} onChange={(event) => onFiltersChange({ ...filters, drivetrain: event.target.value as 'All' | Drivetrain })}>{drivetrainOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label>Powertrain<select value={filters.powertrain} onChange={(event) => onFiltersChange({ ...filters, powertrain: event.target.value as 'All' | Powertrain })}>{powertrainOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label>Max price ${filters.maxPrice.toLocaleString('en-CA')}<input type="range" min="30000" max="70000" step="1000" value={filters.maxPrice} onChange={(event) => onFiltersChange({ ...filters, maxPrice: Number(event.target.value) })} /></label>
      </div>
      <div className="vehicle-cards">
        {vehicles.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} isFavorite={favorites.includes(vehicle.id)} activeProfile={activeProfile} onToggleFavorite={() => onToggleFavorite(vehicle.id)} onSelect={() => onSelectVehicle(vehicle.id)} />)}
      </div>
    </section>
  );
}

function VehicleCard({ vehicle, isFavorite, activeProfile, onToggleFavorite, onSelect }: { vehicle: ScoredVehicle; isFavorite: boolean; activeProfile: 'Emily' | 'Nick'; onToggleFavorite: () => void; onSelect: () => void }) {
  return (
    <article className="vehicle-card">
      <button className="star-button" onClick={onToggleFavorite} aria-label={`${isFavorite ? 'Remove from' : 'Add to'} ${activeProfile}'s favourites`}>{isFavorite ? '★' : '☆'}</button>
      <button className="vehicle-card-main" onClick={onSelect}>
        <VehicleImage vehicle={vehicle} />
        <strong>{vehicle.name}</strong>
        <span>${vehicle.msrp.toLocaleString('en-CA')} • {vehicle.drivetrain} • {vehicle.powertrain}</span>
        <b>{vehicle.familyCompatibilityScore}/100</b>
      </button>
    </article>
  );
}


function toggleProfileFavorite(current: Record<'Emily' | 'Nick', string[]>, profile: 'Emily' | 'Nick', vehicleId: string) {
  const currentFavorites = current[profile];
  return {
    ...current,
    [profile]: currentFavorites.includes(vehicleId)
      ? currentFavorites.filter((favoriteId) => favoriteId !== vehicleId)
      : [...currentFavorites, vehicleId],
  };
}

function VehicleImage({ vehicle }: { vehicle: ScoredVehicle }) {
  const [imageFailed, setImageFailed] = useState(false);

  if (vehicle.imageUrl && !imageFailed) {
    return <img className="vehicle-photo" src={vehicle.imageUrl} alt={`${vehicle.name} manufacturer gallery`} loading="lazy" onError={() => setImageFailed(true)} />;
  }

  return <div className="vehicle-photo photo-fallback"><strong>{vehicle.make}</strong><span>Open profile for manufacturer photos</span></div>;
}

function VehicleProfile({ vehicle, activeProfile, isFavorite, onToggleFavorite, sharedNote, onSharedNoteChange }: { vehicle: ScoredVehicle; activeProfile: 'Emily' | 'Nick'; isFavorite: boolean; onToggleFavorite: () => void; sharedNote: string; onSharedNoteChange: (note: string) => void }) {
  return (
    <section className="card profile">
      <VehicleImage vehicle={vehicle} />
      <div>
        <div className="section-heading"><p className="eyebrow">Model profile</p><button className="star-inline" onClick={onToggleFavorite}>{isFavorite ? '★' : '☆'} {activeProfile}'s favourite</button></div>
        <h2>{vehicle.year} {vehicle.name}</h2>
        <div className="spec-grid">
          <span>MSRP <b>${vehicle.msrp.toLocaleString('en-CA')}</b></span><span>Body <b>{vehicle.bodyStyle}</b></span><span>Seats <b>{vehicle.seats}</b></span><span>Cargo <b>{vehicle.cargoLitres} L</b></span><span>Drive <b>{vehicle.drivetrain}</b></span><span>Efficiency <b>{vehicle.fuelEfficiency}</b></span>
        </div>
        <h3>Why it fits</h3><ul>{vehicle.highlights.map((item) => <li key={item}>{item}</li>)}</ul>
        <h3>Watch-outs</h3><ul>{vehicle.tradeoffs.map((item) => <li key={item}>{item}</li>)}</ul>
        <label className="shared-note">Shared notes<textarea value={sharedNote} onChange={(event) => onSharedNoteChange(event.target.value)} placeholder="Add shared observations, must-have trim notes, dealer quotes, or partner comments..." /></label>
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
  const [fees, setFees] = useState(2495);
  const [taxRate, setTaxRate] = useState(13);
  const [rebate, setRebate] = useState(0);

  useEffect(() => setPrice(vehicle.msrp), [vehicle.msrp]);

  const taxAmount = (Math.max(price + fees - rebate, 0) * taxRate) / 100;
  const allInPrice = Math.max(price + fees + taxAmount - rebate, 0);
  const principal = Math.max(allInPrice - downPayment - extraPrincipal, 0);
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
        <label>Fees / freight / PDI<input type="number" value={fees} onChange={(event) => setFees(Number(event.target.value))} /></label>
        <label>Tax rate %<input type="number" step="0.1" value={taxRate} onChange={(event) => setTaxRate(Number(event.target.value))} /></label>
        <label>Rebates / discounts<input type="number" value={rebate} onChange={(event) => setRebate(Number(event.target.value))} /></label>
      </div>
      <div className="payment-result"><strong>${Math.round(payment).toLocaleString('en-CA')}</strong><span>/ month estimated</span><small>MSRP/base ${price.toLocaleString('en-CA')} • fees ${fees.toLocaleString('en-CA')} • tax ${Math.round(taxAmount).toLocaleString('en-CA')} • all-in ${Math.round(allInPrice).toLocaleString('en-CA')} • financed ${Math.round(principal).toLocaleString('en-CA')} • interest ${Math.round(totalInterest).toLocaleString('en-CA')}</small></div>
      <p className="muted">MSRP usually excludes freight/PDI, dealer fees, accessories, licensing, insurance, and sales tax. Use the fee and tax fields to estimate a more realistic drive-away amount.</p>
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
      <form className="diary-form diary-panel" onSubmit={addEntry}>
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
      <div className="diary-list">{entries.map((entry, index) => {
        const vehicleName = vehicles.find((vehicle) => vehicle.id === entry.vehicleId)?.name ?? 'Selected vehicle';
        return (
          <article className="diary-entry" key={`${entry.vehicleId}-${entry.date}-${index}`}>
            <div><strong>{vehicleName}</strong><span>{entry.date} • {entry.dealer || 'No dealer noted'}</span></div>
            <p>{entry.notes || 'No notes yet.'}</p>
            <div className="diary-chips"><span>{entry.carSeatFits ? '✓' : '○'} Car seat</span><span>{entry.strollerFits ? '✓' : '○'} Stroller</span><span>Winter {entry.winterConfidence}/10</span><span>Partner {entry.partnerRating}/10</span></div>
          </article>
        );
      })}</div>
    </section>
  );
}

export default App;
