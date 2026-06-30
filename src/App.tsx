import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { signInAnonymously, type User } from 'firebase/auth';
import { arrayUnion, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';
import { useCollection } from 'react-firebase-hooks/firestore';
import { auth, db } from './firebase';
import { averagePartnerWeights, CANADIAN_VEHICLES, DEFAULT_WEIGHTS, scoreVehicles } from './scoring';
import type { BodyStyle, CriteriaKey, CriteriaWeights, DealQuoteDocument, Drivetrain, Powertrain, ProfileName, ScoredVehicle, SessionDocument, TestDriveEntry, UserPreferenceDocument, UserReaction, VehicleNoteDocument, VehicleStage } from './types';
import './styles.css';

const sliderConfig: Array<{ key: CriteriaKey; label: string; help: string }> = [
  { key: 'space', label: 'Car Seat & Cabin Space', help: 'Second-row room, cargo access, and family ergonomics.' },
  { key: 'winterTraction', label: 'Ottawa Winter Traction', help: 'Snow confidence, AWD behavior, and cold-weather stability.' },
  { key: 'valueMSRP', label: 'Value & MSRP Budget', help: 'Purchase price, features per dollar, and resale value.' },
  { key: 'reliability', label: 'Long-Term Reliability', help: 'Dependable ownership and fewer surprise repairs.' },
  { key: 'fuelEfficiency', label: 'Fuel Economy & Hybrid Efficiency', help: 'Lower fuel use and electrified options.' },
  { key: 'safetyTech', label: 'Safety & Driver Assistance', help: 'Active safety, visibility, and family protection.' },
  { key: 'comfort', label: 'Ride Comfort & Quiet Cabin', help: 'Calm highway manners, supportive seats, and low road noise.' },
];

const bodyStyleOptions: Array<'All' | BodyStyle> = ['All', 'Compact SUV', 'Midsize SUV', 'Wagon'];
const drivetrainOptions: Array<'All' | Drivetrain> = ['All', 'AWD', 'FWD', '4WD'];
const powertrainOptions: Array<'All' | Powertrain> = ['All', 'Gas', 'Hybrid', 'Plug-in Hybrid', 'Electric'];
const profileNames: ProfileName[] = ['Emily', 'Nick'];
const stageOptions: VehicleStage[] = ['Browsing', 'Shortlisted', 'Test drive booked', 'Test driven', 'Quote received', 'Finalist', 'Rejected', 'Winner'];
const reactionOptions: UserReaction[] = ['Unrated', 'Love', 'Maybe', 'No'];

interface Filters {
  query: string;
  bodyStyle: 'All' | BodyStyle;
  drivetrain: 'All' | Drivetrain;
  powertrain: 'All' | Powertrain;
  maxPrice: number;
  minSeats: number;
  mustHaveAwd: boolean;
  mustHaveHybrid: boolean;
  mustFitCarSeat: boolean;
  maxMonthlyPayment: number;
  stage: 'All' | VehicleStage;
}

const defaultFilters: Filters = {
  query: '', bodyStyle: 'All', drivetrain: 'All', powertrain: 'All', maxPrice: 70000, minSeats: 0,
  mustHaveAwd: false, mustHaveHybrid: false, mustFitCarSeat: false, maxMonthlyPayment: 0, stage: 'All',
};

function getSessionIdFromUrl() {
  return new URLSearchParams(window.location.search).get('session');
}

function emptyVehicleNote(vehicleId: string): VehicleNoteDocument {
  return { vehicleId, sharedNote: '', stage: 'Browsing', reactions: { Emily: 'Unrated', Nick: 'Unrated' } };
}

function estimateMonthlyPayment(vehicle: ScoredVehicle) {
  const allIn = (vehicle.msrp + 2495) * 1.13;
  const principal = Math.max(allIn - 5000, 0);
  const monthlyRate = 0.0599 / 12;
  return Math.round((principal * monthlyRate) / (1 - (1 + monthlyRate) ** -60));
}

function App() {
  const [user, authLoading, authError] = useAuthState(auth);
  const [anonymousSignInError, setAnonymousSignInError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || user) return;
    void signInAnonymously(auth).then(() => setAnonymousSignInError(null)).catch((error: unknown) => {
      setAnonymousSignInError(error instanceof Error ? error.message : 'Anonymous sign-in failed.');
    });
  }, [authLoading, user]);

  const authFailureMessage = authError?.message ?? anonymousSignInError;
  if (authFailureMessage) {
    return <main className="shell error"><section className="card"><p className="eyebrow">Firebase Auth setup required</p><h1>CarMatch could not start a secure anonymous session.</h1><p>{authFailureMessage}</p><p>Enable Authentication and the Anonymous provider for the <strong>flexspace-1</strong> project.</p></section></main>;
  }
  if (authLoading || !user) return <div style={{ padding: '20px', textAlign: 'center' }}>Initializing secure session...</div>;
  return <AuthenticatedSession activeUser={user} />;
}

function AuthenticatedSession({ activeUser }: { activeUser: User }) {
  const [sessionId, setSessionId] = useState<string | null>(getSessionIdFromUrl);
  const [session, setSession] = useState<SessionDocument | null>(null);
  const [sessionStatus, setSessionStatus] = useState('Preparing your shared profile...');
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>(CANADIAN_VEHICLES.slice(0, 3).map((vehicle) => vehicle.id));
  const [testDriveEntries, setTestDriveEntries] = useState<TestDriveEntry[]>([]);
  const [dealQuotes, setDealQuotes] = useState<DealQuoteDocument[]>([]);
  const [vehicleNotes, setVehicleNotes] = useState<Record<string, VehicleNoteDocument>>({});
  const [activeSection, setActiveSection] = useState<'dashboard' | 'browse' | 'compare' | 'calculator' | 'deals' | 'diary' | 'summary'>('dashboard');
  const [activeProfile, setActiveProfile] = useState<ProfileName>('Emily');
  const [favoritesByProfile, setFavoritesByProfile] = useState<Record<ProfileName, string[]>>({ Emily: [], Nick: [] });
  const [profileWeights, setProfileWeights] = useState<Record<ProfileName, CriteriaWeights>>({ Emily: DEFAULT_WEIGHTS, Nick: DEFAULT_WEIGHTS });

  const canReadSharedCollections = Boolean(sessionId && session?.partnerIds?.includes(activeUser.uid));
  const preferencesQuery = useMemo(() => (sessionId && canReadSharedCollections ? collection(db, 'sessions', sessionId, 'userPreferences') : null), [canReadSharedCollections, sessionId]);
  const notesQuery = useMemo(() => (sessionId && canReadSharedCollections ? collection(db, 'sessions', sessionId, 'vehicleNotes') : null), [canReadSharedCollections, sessionId]);
  const diaryQuery = useMemo(() => (sessionId && canReadSharedCollections ? collection(db, 'sessions', sessionId, 'testDriveDiary') : null), [canReadSharedCollections, sessionId]);
  const quotesQuery = useMemo(() => (sessionId && canReadSharedCollections ? collection(db, 'sessions', sessionId, 'dealQuotes') : null), [canReadSharedCollections, sessionId]);
  const [preferencesSnapshot, preferencesLoading, preferencesError] = useCollection(preferencesQuery as any);
  const [notesSnapshot] = useCollection(notesQuery as any);
  const [diarySnapshot] = useCollection(diaryQuery as any);
  const [quotesSnapshot] = useCollection(quotesQuery as any);

  const profilePreferences = useMemo<UserPreferenceDocument[]>(() => [
    { userId: 'Emily', criteriaWeights: profileWeights.Emily, personalNotes: {}, favoriteVehicleIds: favoritesByProfile.Emily },
    { userId: 'Nick', criteriaWeights: profileWeights.Nick, personalNotes: {}, favoriteVehicleIds: favoritesByProfile.Nick },
  ], [favoritesByProfile, profileWeights]);

  useEffect(() => {
    if (!preferencesSnapshot) return;
    const nextWeights: Record<ProfileName, CriteriaWeights> = { Emily: DEFAULT_WEIGHTS, Nick: DEFAULT_WEIGHTS };
    const nextFavorites: Record<ProfileName, string[]> = { Emily: [], Nick: [] };
    preferencesSnapshot.docs.forEach((preferenceDoc: { data: () => Partial<UserPreferenceDocument> }) => {
      const data = preferenceDoc.data();
      if (data.userId === 'Emily' || data.userId === 'Nick') {
        nextWeights[data.userId] = { ...DEFAULT_WEIGHTS, ...(data.criteriaWeights ?? {}) };
        nextFavorites[data.userId] = data.favoriteVehicleIds ?? [];
      }
    });
    setProfileWeights(nextWeights);
    setFavoritesByProfile(nextFavorites);
  }, [preferencesSnapshot]);

  useEffect(() => {
    if (!notesSnapshot) return;
    const nextNotes: Record<string, VehicleNoteDocument> = {};
    notesSnapshot.docs.forEach((noteDoc: { id: string; data: () => Partial<VehicleNoteDocument> }) => {
      const data = noteDoc.data();
      const vehicleId = data.vehicleId ?? noteDoc.id;
      nextNotes[vehicleId] = { ...emptyVehicleNote(vehicleId), ...data, vehicleId, reactions: { Emily: 'Unrated', Nick: 'Unrated', ...(data.reactions ?? {}) } };
    });
    setVehicleNotes(nextNotes);
  }, [notesSnapshot]);

  useEffect(() => {
    if (!diarySnapshot) return;
    setTestDriveEntries(diarySnapshot.docs.map((entryDoc: { id: string; data: () => Partial<TestDriveEntry> }) => ({ ...defaultDiaryDraft(CANADIAN_VEHICLES[0]?.id ?? ''), ...entryDoc.data(), id: entryDoc.id })));
  }, [diarySnapshot]);

  useEffect(() => {
    if (!quotesSnapshot) return;
    setDealQuotes(quotesSnapshot.docs.map((quoteDoc: { id: string; data: () => Partial<DealQuoteDocument> }) => ({ ...defaultDealQuote(CANADIAN_VEHICLES[0]?.id ?? ''), ...quoteDoc.data(), id: quoteDoc.id })));
  }, [quotesSnapshot]);

  useEffect(() => {
    async function bootstrapSession() {
      setSessionStatus('Connecting this device to the shared session...');
      const activeSessionId = sessionId ?? doc(collection(db, 'sessions')).id;
      const sessionRef = doc(db, 'sessions', activeSessionId);
      const shareLink = `${window.location.origin}/join?session=${activeSessionId}`;
      const snapshot = await getDoc(sessionRef);
      if (!snapshot.exists()) {
        await setDoc(sessionRef, { id: activeSessionId, dynamicShareLink: shareLink, createdAt: serverTimestamp(), partnerIds: [activeUser.uid], vehiclesShortlist: CANADIAN_VEHICLES.map((vehicle) => vehicle.id) });
      } else {
        await updateDoc(sessionRef, { partnerIds: arrayUnion(activeUser.uid), dynamicShareLink: shareLink });
      }
      await setDoc(doc(db, 'sessions', activeSessionId, 'userPreferences', activeUser.uid), { userId: activeUser.uid, criteriaWeights: DEFAULT_WEIGHTS, personalNotes: {}, favoriteVehicleIds: [] }, { merge: true });
      const refreshed = await getDoc(sessionRef);
      setSession(refreshed.data() as SessionDocument);
      setSessionId(activeSessionId);
      window.history.replaceState({}, '', `/?session=${activeSessionId}`);
      setSessionStatus('Live session connected. Shared notes, diary entries, and quotes sync in real time.');
    }
    void bootstrapSession().catch((error: unknown) => setSessionStatus(error instanceof Error ? error.message : 'Unable to initialize the shared session.'));
  }, [activeUser.uid, sessionId]);

  useEffect(() => {
    if (!sessionId || !canReadSharedCollections) return;
    const activeSessionId = sessionId;
    async function ensureProfilePreferenceDocs() {
      await Promise.all(profileNames.map(async (profileName) => {
        const preferenceRef = doc(db, 'sessions', activeSessionId, 'userPreferences', profileName);
        const snapshot = await getDoc(preferenceRef);
        if (!snapshot.exists()) await setDoc(preferenceRef, { userId: profileName, criteriaWeights: DEFAULT_WEIGHTS, personalNotes: {}, favoriteVehicleIds: [] });
      }));
    }
    void ensureProfilePreferenceDocs().catch((error: unknown) => setSessionStatus(error instanceof Error ? error.message : 'Unable to initialize saved profile preferences.'));
  }, [canReadSharedCollections, sessionId]);

  const saveProfilePreference = useCallback((profileName: ProfileName, weights: CriteriaWeights, favoriteVehicleIds: string[]) => {
    if (!sessionId) return;
    const activeSessionId = sessionId;
    void setDoc(doc(db, 'sessions', activeSessionId, 'userPreferences', profileName), { userId: profileName, criteriaWeights: weights, personalNotes: {}, favoriteVehicleIds }, { merge: true }).catch((error: unknown) => setSessionStatus(error instanceof Error ? error.message : 'Unable to save profile preferences.'));
  }, [sessionId]);

  const saveVehicleNote = useCallback((vehicleId: string, patch: Partial<VehicleNoteDocument>) => {
    if (!sessionId) return;
    const activeSessionId = sessionId;
    const nextNote = { ...emptyVehicleNote(vehicleId), ...(vehicleNotes[vehicleId] ?? {}), ...patch, vehicleId };
    setVehicleNotes((current) => ({ ...current, [vehicleId]: nextNote }));
    void setDoc(doc(db, 'sessions', activeSessionId, 'vehicleNotes', vehicleId), { ...nextNote, updatedAt: serverTimestamp() }, { merge: true }).catch((error: unknown) => setSessionStatus(error instanceof Error ? error.message : 'Unable to save shared vehicle notes.'));
  }, [sessionId, vehicleNotes]);

  const saveDiaryEntry = useCallback((entry: TestDriveEntry) => {
    if (!sessionId) return;
    const activeSessionId = sessionId;
    const entryId = entry.id ?? `${entry.vehicleId}-${Date.now()}`;
    void setDoc(doc(db, 'sessions', activeSessionId, 'testDriveDiary', entryId), { ...entry, id: entryId, createdAt: serverTimestamp() }, { merge: true }).catch((error: unknown) => setSessionStatus(error instanceof Error ? error.message : 'Unable to save test-drive diary.'));
  }, [sessionId]);

  const saveDealQuote = useCallback((quote: DealQuoteDocument) => {
    if (!sessionId) return;
    const activeSessionId = sessionId;
    const quoteId = quote.id ?? `${quote.vehicleId}-${Date.now()}`;
    void setDoc(doc(db, 'sessions', activeSessionId, 'dealQuotes', quoteId), { ...quote, id: quoteId, createdAt: serverTimestamp() }, { merge: true }).catch((error: unknown) => setSessionStatus(error instanceof Error ? error.message : 'Unable to save deal quote.'));
  }, [sessionId]);

  const handleProfileWeightsChange = useCallback((profileName: ProfileName, weights: CriteriaWeights) => {
    setProfileWeights((current) => ({ ...current, [profileName]: weights }));
    saveProfilePreference(profileName, weights, favoritesByProfile[profileName]);
  }, [favoritesByProfile, saveProfilePreference]);

  const handleToggleFavorite = useCallback((vehicleId: string) => {
    setFavoritesByProfile((current) => {
      const next = toggleProfileFavorite(current, activeProfile, vehicleId);
      saveProfilePreference(activeProfile, profileWeights[activeProfile], next[activeProfile]);
      return next;
    });
  }, [activeProfile, profileWeights, saveProfilePreference]);

  const combinedWeights = useMemo(() => averagePartnerWeights(profilePreferences), [profilePreferences]);
  const baseScoredVehicles = useMemo(() => scoreVehicles(combinedWeights), [combinedWeights]);
  const scoredVehicles = useMemo(() => enrichScores(baseScoredVehicles, testDriveEntries, dealQuotes), [baseScoredVehicles, testDriveEntries, dealQuotes]);
  const filteredVehicles = useMemo(() => {
    const search = filters.query.trim().toLowerCase();
    return scoredVehicles.filter((vehicle) => {
      const note = vehicleNotes[vehicle.id] ?? emptyVehicleNote(vehicle.id);
      const monthly = estimateMonthlyPayment(vehicle);
      const hasCarSeatPass = testDriveEntries.some((entry) => entry.vehicleId === vehicle.id && entry.carSeatFits);
      const isHybrid = vehicle.powertrain === 'Hybrid' || vehicle.powertrain === 'Plug-in Hybrid' || vehicle.powertrain === 'Electric';
      return (!search || `${vehicle.make} ${vehicle.model}`.toLowerCase().includes(search))
        && (filters.bodyStyle === 'All' || vehicle.bodyStyle === filters.bodyStyle)
        && (filters.drivetrain === 'All' || vehicle.drivetrain === filters.drivetrain)
        && (filters.powertrain === 'All' || vehicle.powertrain === filters.powertrain)
        && vehicle.msrp <= filters.maxPrice
        && vehicle.seats >= filters.minSeats
        && (!filters.mustHaveAwd || vehicle.drivetrain === 'AWD' || vehicle.drivetrain === '4WD')
        && (!filters.mustHaveHybrid || isHybrid)
        && (!filters.mustFitCarSeat || hasCarSeatPass)
        && (!filters.maxMonthlyPayment || monthly <= filters.maxMonthlyPayment)
        && (filters.stage === 'All' || note.stage === filters.stage);
    });
  }, [dealQuotes, filters, scoredVehicles, testDriveEntries, vehicleNotes]);

  const selectedVehicle = scoredVehicles.find((vehicle) => vehicle.id === selectedVehicleIds[0]) ?? scoredVehicles[0]!;
  const selectedVehicles = selectedVehicleIds.map((vehicleId) => scoredVehicles.find((vehicle) => vehicle.id === vehicleId)).filter(Boolean) as ScoredVehicle[];

  return (
    <main className={`shell profile-${activeProfile.toLowerCase()}`}>
      <section className="hero card">
        <div className="hero-topline"><p className="eyebrow">CarMatch</p><span>{sessionStatus}</span></div>
        <h1>Compare family vehicles together.</h1>
        <p>Rank priorities, compare finalists, estimate payments, track dealer quotes, and keep test-drive decisions in one shared workspace.</p>
        <div className="profile-switcher" aria-label="User profile selector">{profileNames.map((profileName) => <button key={profileName} className={activeProfile === profileName ? 'active' : ''} onClick={() => setActiveProfile(profileName)}>{profileName}</button>)}</div>
      </section>

      <nav className="app-menu" aria-label="Primary app sections">
        <button className={activeSection === 'dashboard' ? 'active' : ''} onClick={() => setActiveSection('dashboard')}>Shared priorities</button>
        <button className={activeSection === 'browse' ? 'active' : ''} onClick={() => setActiveSection('browse')}>Browse vehicles</button>
        <button className={activeSection === 'compare' ? 'active' : ''} onClick={() => setActiveSection('compare')}>Compare</button>
        <button className={activeSection === 'calculator' ? 'active' : ''} onClick={() => setActiveSection('calculator')}>Payment calculator</button>
        <button className={activeSection === 'deals' ? 'active' : ''} onClick={() => setActiveSection('deals')}>Deal tracker</button>
        <button className={activeSection === 'diary' ? 'active' : ''} onClick={() => setActiveSection('diary')}>Test drive diary</button>
        <button className={activeSection === 'summary' ? 'active' : ''} onClick={() => setActiveSection('summary')}>Export summary</button>
      </nav>

      {activeSection === 'dashboard' && <section className="grid"><PrioritySliders profileName={activeProfile} currentWeights={profileWeights[activeProfile]} onWeightsChange={handleProfileWeightsChange} /><Dashboard scoredVehicles={filteredVehicles} combinedWeights={combinedWeights} loading={!sessionId || preferencesLoading} error={preferencesError?.message} partnerCount={profilePreferences.length} onSelectVehicle={(vehicleId) => { setSelectedVehicleIds([vehicleId, ...selectedVehicleIds.filter((id) => id !== vehicleId)].slice(0, 4)); setActiveSection('compare'); }} /></section>}
      {activeSection === 'browse' && <VehicleBrowser filters={filters} onFiltersChange={setFilters} vehicles={filteredVehicles} activeProfile={activeProfile} favorites={favoritesByProfile[activeProfile]} selectedVehicleIds={selectedVehicleIds} notes={vehicleNotes} onToggleFavorite={handleToggleFavorite} onToggleCompare={(vehicleId) => setSelectedVehicleIds((current) => toggleCompareVehicle(current, vehicleId))} onSelectVehicle={(vehicleId) => { setSelectedVehicleIds([vehicleId, ...selectedVehicleIds.filter((id) => id !== vehicleId)].slice(0, 4)); }} />}
      {activeSection === 'compare' && <ComparisonTable vehicles={selectedVehicles.length ? selectedVehicles : scoredVehicles.slice(0, 3)} favoritesByProfile={favoritesByProfile} notes={vehicleNotes} quotes={dealQuotes} entries={testDriveEntries} onStageChange={(vehicleId, stage) => saveVehicleNote(vehicleId, { stage })} onSelectVehicle={(vehicleId) => setSelectedVehicleIds([vehicleId, ...selectedVehicleIds.filter((id) => id !== vehicleId)].slice(0, 4))} />}
      {activeSection === 'calculator' && <PaymentCalculator vehicle={selectedVehicle} budgetLimit={filters.maxMonthlyPayment} onBudgetLimitChange={(maxMonthlyPayment) => setFilters((current) => ({ ...current, maxMonthlyPayment }))} />}
      {activeSection === 'deals' && <DealTracker vehicles={scoredVehicles} quotes={dealQuotes} onSaveQuote={saveDealQuote} />}
      {activeSection === 'diary' && <TestDriveDiary vehicles={scoredVehicles} entries={testDriveEntries} onSaveEntry={saveDiaryEntry} />}
      {activeSection === 'summary' && <ExportSummary vehicles={scoredVehicles} selectedVehicles={selectedVehicles} favoritesByProfile={favoritesByProfile} notes={vehicleNotes} quotes={dealQuotes} entries={testDriveEntries} weights={profileWeights} />}

      <VehicleProfile vehicle={selectedVehicle} activeProfile={activeProfile} isFavorite={favoritesByProfile[activeProfile].includes(selectedVehicle.id)} note={vehicleNotes[selectedVehicle.id] ?? emptyVehicleNote(selectedVehicle.id)} quotes={dealQuotes.filter((quote) => quote.vehicleId === selectedVehicle.id)} entries={testDriveEntries.filter((entry) => entry.vehicleId === selectedVehicle.id)} onToggleFavorite={() => handleToggleFavorite(selectedVehicle.id)} onNoteChange={(patch) => saveVehicleNote(selectedVehicle.id, patch)} />
    </main>
  );
}

interface PrioritySlidersProps { profileName: ProfileName; currentWeights: CriteriaWeights; onWeightsChange: (profileName: ProfileName, weights: CriteriaWeights) => void; }
function PrioritySliders({ profileName, currentWeights, onWeightsChange }: PrioritySlidersProps) {
  const [draftWeights, setDraftWeights] = useState<CriteriaWeights>(currentWeights);
  const [saveState, setSaveState] = useState(`${profileName}'s priorities ready`);
  const [hasUserEdited, setHasUserEdited] = useState(false);
  useEffect(() => { setDraftWeights(currentWeights); setHasUserEdited(false); setSaveState(`${profileName}'s priorities ready`); }, [currentWeights, profileName]);
  useEffect(() => {
    if (!hasUserEdited) return;
    setSaveState(`Updating ${profileName}...`);
    const timeout = window.setTimeout(() => { onWeightsChange(profileName, draftWeights); setHasUserEdited(false); setSaveState(`${profileName}'s priorities applied`); }, 250);
    return () => window.clearTimeout(timeout);
  }, [draftWeights, hasUserEdited, onWeightsChange, profileName]);
  return <form className="card sliders" onSubmit={(event: FormEvent) => event.preventDefault()}><div className="section-heading"><p className="eyebrow">{profileName}'s priorities</p><span>{saveState}</span></div><h2>Balance what matters most for {profileName}.</h2>{sliderConfig.map((slider) => <label className="slider-row" key={slider.key}><span className="slider-label"><strong>{slider.label}</strong><small>{slider.help}</small></span><input type="range" min="1" max="10" value={draftWeights[slider.key]} onChange={(event) => { setHasUserEdited(true); setDraftWeights((current) => ({ ...current, [slider.key]: Number(event.target.value) })); }} /><b>{draftWeights[slider.key]}</b></label>)}</form>;
}

function Dashboard({ scoredVehicles, combinedWeights, loading, error, partnerCount, onSelectVehicle }: { scoredVehicles: ScoredVehicle[]; combinedWeights: CriteriaWeights; loading: boolean; error?: string; partnerCount: number; onSelectVehicle: (vehicleId: string) => void; }) {
  return <section className="card dashboard"><div className="section-heading"><p className="eyebrow">Live ranking</p><span>{partnerCount} partner profiles connected</span></div><h2>Recommendation Score</h2>{loading && <p className="muted">Preparing shared profile scoring...</p>}{error && <p className="error-text">Preference stream error: {error}</p>}<div className="weight-summary"><span>Space {combinedWeights.space.toFixed(1)}</span><span>Winter {combinedWeights.winterTraction.toFixed(1)}</span><span>Value {combinedWeights.valueMSRP.toFixed(1)}</span><span>Reliability {combinedWeights.reliability.toFixed(1)}</span><span>Efficiency {combinedWeights.fuelEfficiency.toFixed(1)}</span><span>Safety {combinedWeights.safetyTech.toFixed(1)}</span><span>Comfort {combinedWeights.comfort.toFixed(1)}</span></div><div className="bars">{scoredVehicles.slice(0, 8).map((vehicle) => <button className="vehicle-row" key={vehicle.id} onClick={() => onSelectVehicle(vehicle.id)}><span><strong>{vehicle.name}</strong><small>${vehicle.msrp.toLocaleString('en-CA')} • match {vehicle.familyCompatibilityScore} • confidence {vehicle.confidenceScore}</small></span><span className="bar-shell"><span className="bar-fill" style={{ width: `${vehicle.overallRecommendationScore}%` }} /></span><b>{vehicle.overallRecommendationScore}</b></button>)}</div></section>;
}

function VehicleBrowser({ filters, onFiltersChange, vehicles, activeProfile, favorites, selectedVehicleIds, notes, onToggleFavorite, onToggleCompare, onSelectVehicle }: { filters: Filters; onFiltersChange: (filters: Filters) => void; vehicles: ScoredVehicle[]; activeProfile: ProfileName; favorites: string[]; selectedVehicleIds: string[]; notes: Record<string, VehicleNoteDocument>; onToggleFavorite: (vehicleId: string) => void; onToggleCompare: (vehicleId: string) => void; onSelectVehicle: (vehicleId: string) => void; }) {
  return <section className="card stack"><div className="section-heading"><p className="eyebrow">Browse models</p><span>{vehicles.length} matches</span></div><div className="filters advanced-filters"><label>Search<input value={filters.query} onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })} placeholder="Make or model" /></label><label>Body style<select value={filters.bodyStyle} onChange={(event) => onFiltersChange({ ...filters, bodyStyle: event.target.value as 'All' | BodyStyle })}>{bodyStyleOptions.map((option) => <option key={option}>{option}</option>)}</select></label><label>Drivetrain<select value={filters.drivetrain} onChange={(event) => onFiltersChange({ ...filters, drivetrain: event.target.value as 'All' | Drivetrain })}>{drivetrainOptions.map((option) => <option key={option}>{option}</option>)}</select></label><label>Powertrain<select value={filters.powertrain} onChange={(event) => onFiltersChange({ ...filters, powertrain: event.target.value as 'All' | Powertrain })}>{powertrainOptions.map((option) => <option key={option}>{option}</option>)}</select></label><label>Stage<select value={filters.stage} onChange={(event) => onFiltersChange({ ...filters, stage: event.target.value as 'All' | VehicleStage })}>{(['All', ...stageOptions] as Array<'All' | VehicleStage>).map((option) => <option key={option}>{option}</option>)}</select></label><label>Min seats<input type="number" value={filters.minSeats} onChange={(event) => onFiltersChange({ ...filters, minSeats: Number(event.target.value) })} /></label><label>Max monthly<input type="number" value={filters.maxMonthlyPayment} onChange={(event) => onFiltersChange({ ...filters, maxMonthlyPayment: Number(event.target.value) })} /></label><label>Max price ${filters.maxPrice.toLocaleString('en-CA')}<input type="range" min="30000" max="80000" step="1000" value={filters.maxPrice} onChange={(event) => onFiltersChange({ ...filters, maxPrice: Number(event.target.value) })} /></label><label className="check"><input type="checkbox" checked={filters.mustHaveAwd} onChange={(event) => onFiltersChange({ ...filters, mustHaveAwd: event.target.checked })} /> Must have AWD/4WD</label><label className="check"><input type="checkbox" checked={filters.mustHaveHybrid} onChange={(event) => onFiltersChange({ ...filters, mustHaveHybrid: event.target.checked })} /> Must be hybrid/electric</label><label className="check"><input type="checkbox" checked={filters.mustFitCarSeat} onChange={(event) => onFiltersChange({ ...filters, mustFitCarSeat: event.target.checked })} /> Car seat tested</label></div><div className="vehicle-cards">{vehicles.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} isFavorite={favorites.includes(vehicle.id)} isCompared={selectedVehicleIds.includes(vehicle.id)} activeProfile={activeProfile} note={notes[vehicle.id] ?? emptyVehicleNote(vehicle.id)} onToggleFavorite={() => onToggleFavorite(vehicle.id)} onToggleCompare={() => onToggleCompare(vehicle.id)} onSelect={() => onSelectVehicle(vehicle.id)} />)}</div></section>;
}

function VehicleCard({ vehicle, isFavorite, isCompared, activeProfile, note, onToggleFavorite, onToggleCompare, onSelect }: { vehicle: ScoredVehicle; isFavorite: boolean; isCompared: boolean; activeProfile: ProfileName; note: VehicleNoteDocument; onToggleFavorite: () => void; onToggleCompare: () => void; onSelect: () => void }) {
  return <article className="vehicle-card"><button className="star-button" onClick={onToggleFavorite} aria-label={`${isFavorite ? 'Remove from' : 'Add to'} ${activeProfile}'s favourites`}>{isFavorite ? '★' : '☆'}</button><button className="compare-toggle" onClick={onToggleCompare}>{isCompared ? '✓ Compare' : '+ Compare'}</button><button className="vehicle-card-main" onClick={onSelect}><VehicleImage vehicle={vehicle} /><strong>{vehicle.name}</strong><span>${vehicle.msrp.toLocaleString('en-CA')} • {vehicle.drivetrain} • {vehicle.powertrain}</span><span>{note.stage} • {activeProfile}: {note.reactions[activeProfile]}</span><b>{vehicle.overallRecommendationScore}/100</b></button></article>;
}

function VehicleImage({ vehicle }: { vehicle: ScoredVehicle }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (vehicle.imageUrl && !imageFailed) return <img className="vehicle-photo" src={vehicle.imageUrl} alt={`${vehicle.name} exterior`} loading="lazy" onError={() => setImageFailed(true)} />;
  return <div className="vehicle-photo photo-fallback"><strong>{vehicle.make}</strong><span>Open manufacturer gallery</span></div>;
}

function VehicleProfile({ vehicle, activeProfile, isFavorite, note, quotes, entries, onToggleFavorite, onNoteChange }: { vehicle: ScoredVehicle; activeProfile: ProfileName; isFavorite: boolean; note: VehicleNoteDocument; quotes: DealQuoteDocument[]; entries: TestDriveEntry[]; onToggleFavorite: () => void; onNoteChange: (patch: Partial<VehicleNoteDocument>) => void }) {
  const bestQuote = quotes.sort((a, b) => quoteNetPrice(a) - quoteNetPrice(b))[0];
  return <section className="card profile"><VehicleImage vehicle={vehicle} /><div><div className="section-heading"><p className="eyebrow">Model profile</p><button className="star-inline" onClick={onToggleFavorite}>{isFavorite ? '★' : '☆'} {activeProfile}'s favourite</button></div><h2>{vehicle.year} {vehicle.name}</h2><div className="spec-grid"><span>MSRP <b>${vehicle.msrp.toLocaleString('en-CA')}</b></span><span>Overall <b>{vehicle.overallRecommendationScore}</b></span><span>Confidence <b>{vehicle.confidenceScore}</b></span><span>Test drive <b>{vehicle.testDriveScore}</b></span><span>Deal <b>{vehicle.dealScore}</b></span><span>Est. monthly <b>${estimateMonthlyPayment(vehicle)}</b></span><span>Stage <b>{note.stage}</b></span><span>Best quote <b>{bestQuote ? `$${quoteNetPrice(bestQuote).toLocaleString('en-CA')}` : 'None'}</b></span></div><div className="inline-controls"><label>Stage<select value={note.stage} onChange={(event) => onNoteChange({ stage: event.target.value as VehicleStage })}>{stageOptions.map((stage) => <option key={stage}>{stage}</option>)}</select></label><label>{activeProfile} reaction<select value={note.reactions[activeProfile]} onChange={(event) => onNoteChange({ reactions: { ...note.reactions, [activeProfile]: event.target.value as UserReaction } })}>{reactionOptions.map((reaction) => <option key={reaction}>{reaction}</option>)}</select></label></div><h3>Why it fits</h3><ul>{vehicle.highlights.map((item) => <li key={item}>{item}</li>)}</ul><h3>Watch-outs</h3><ul>{vehicle.tradeoffs.map((item) => <li key={item}>{item}</li>)}</ul><h3>Ownership estimate</h3><p className="muted">Approx. monthly fuel + maintenance planning: ${(estimateOwnershipCost(vehicle)).toLocaleString('en-CA')} / month, before insurance and parking.</p><label className="shared-note">Shared notes<textarea value={note.sharedNote} onChange={(event) => onNoteChange({ sharedNote: event.target.value })} placeholder="Add shared observations, must-have trim notes, dealer quotes, or partner comments..." /></label><a href={vehicle.manufacturerUrl} target="_blank" rel="noreferrer">Open manufacturer page / gallery</a><small>Photo/source: {vehicle.photoCredit}</small><div className="mini-summary"><span>{entries.length} test drives</span><span>{quotes.length} quotes</span><span>Emily: {note.reactions.Emily}</span><span>Nick: {note.reactions.Nick}</span></div></div></section>;
}

function ComparisonTable({ vehicles, favoritesByProfile, notes, quotes, entries, onStageChange }: { vehicles: ScoredVehicle[]; favoritesByProfile: Record<ProfileName, string[]>; notes: Record<string, VehicleNoteDocument>; quotes: DealQuoteDocument[]; entries: TestDriveEntry[]; onStageChange: (vehicleId: string, stage: VehicleStage) => void; onSelectVehicle: (vehicleId: string) => void }) {
  const rows = ['MSRP', 'Monthly', 'Overall', 'Confidence', 'Test drive', 'Deal', 'Seats', 'Cargo', 'Drive', 'Powertrain', 'Emily', 'Nick', 'Best quote', 'Diary entries'] as const;
  return <section className="card stack"><div className="section-heading"><p className="eyebrow">Side-by-side comparison</p><span>{vehicles.length} finalists</span></div><div className="comparison-table"><div className="compare-head">Metric</div>{vehicles.map((vehicle) => <div className="compare-head" key={vehicle.id}><VehicleImage vehicle={vehicle} /><strong>{vehicle.name}</strong><select value={(notes[vehicle.id] ?? emptyVehicleNote(vehicle.id)).stage} onChange={(event) => onStageChange(vehicle.id, event.target.value as VehicleStage)}>{stageOptions.map((stage) => <option key={stage}>{stage}</option>)}</select></div>)}{rows.map((row) => <ComparisonRow key={row} row={row} vehicles={vehicles} favoritesByProfile={favoritesByProfile} notes={notes} quotes={quotes} entries={entries} />)}</div></section>;
}

function ComparisonRow({ row, vehicles, favoritesByProfile, notes, quotes, entries }: { row: string; vehicles: ScoredVehicle[]; favoritesByProfile: Record<ProfileName, string[]>; notes: Record<string, VehicleNoteDocument>; quotes: DealQuoteDocument[]; entries: TestDriveEntry[] }) {
  return <><div className="compare-label">{row}</div>{vehicles.map((vehicle) => <div key={`${row}-${vehicle.id}`}>{comparisonValue(row, vehicle, favoritesByProfile, notes, quotes, entries)}</div>)}</>;
}

function PaymentCalculator({ vehicle, budgetLimit, onBudgetLimitChange }: { vehicle: ScoredVehicle; budgetLimit: number; onBudgetLimitChange: (value: number) => void }) {
  const [price, setPrice] = useState(vehicle.msrp); const [rate, setRate] = useState(5.99); const [termMonths, setTermMonths] = useState(60); const [downPayment, setDownPayment] = useState(5000); const [extraPrincipal, setExtraPrincipal] = useState(0); const [fees, setFees] = useState(2495); const [taxRate, setTaxRate] = useState(13); const [rebate, setRebate] = useState(0); const [insurance, setInsurance] = useState(180); const [fuel, setFuel] = useState(160); const [maintenance, setMaintenance] = useState(85);
  useEffect(() => setPrice(vehicle.msrp), [vehicle.msrp]);
  const taxAmount = (Math.max(price + fees - rebate, 0) * taxRate) / 100; const allInPrice = Math.max(price + fees + taxAmount - rebate, 0); const principal = Math.max(allInPrice - downPayment - extraPrincipal, 0); const monthlyRate = rate / 100 / 12; const safeTermMonths = Math.max(termMonths, 1); const payment = monthlyRate === 0 ? principal / safeTermMonths : (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -safeTermMonths); const totalInterest = Math.max(payment * safeTermMonths - principal, 0); const totalMonthly = Math.round(payment + insurance + fuel + maintenance); const budgetState = budgetLimit === 0 ? 'Set a monthly budget guardrail' : totalMonthly <= budgetLimit ? '✅ Within monthly budget' : totalMonthly <= budgetLimit * 1.12 ? '⚠️ Budget stretch' : '❌ Over budget';
  return <section className="card stack"><div className="section-heading"><p className="eyebrow">Payment calculator</p><span>{vehicle.name}</span></div><div className="calculator-grid"><label>Price<input type="number" value={price} onChange={(event) => setPrice(Number(event.target.value))} /></label><label>Interest %<input type="number" step="0.1" value={rate} onChange={(event) => setRate(Number(event.target.value))} /></label><label>Term months<input type="number" value={termMonths} onChange={(event) => setTermMonths(Number(event.target.value))} /></label><label>Down payment<input type="number" value={downPayment} onChange={(event) => setDownPayment(Number(event.target.value))} /></label><label>Lump principal<input type="number" value={extraPrincipal} onChange={(event) => setExtraPrincipal(Number(event.target.value))} /></label><label>Fees / freight / PDI<input type="number" value={fees} onChange={(event) => setFees(Number(event.target.value))} /></label><label>Tax rate %<input type="number" step="0.1" value={taxRate} onChange={(event) => setTaxRate(Number(event.target.value))} /></label><label>Rebates / discounts<input type="number" value={rebate} onChange={(event) => setRebate(Number(event.target.value))} /></label><label>Insurance / mo.<input type="number" value={insurance} onChange={(event) => setInsurance(Number(event.target.value))} /></label><label>Fuel / mo.<input type="number" value={fuel} onChange={(event) => setFuel(Number(event.target.value))} /></label><label>Maintenance / mo.<input type="number" value={maintenance} onChange={(event) => setMaintenance(Number(event.target.value))} /></label><label>Budget guardrail<input type="number" value={budgetLimit} onChange={(event) => onBudgetLimitChange(Number(event.target.value))} /></label></div><div className="payment-result"><strong>${Math.round(payment).toLocaleString('en-CA')}</strong><span>/ month financed • {budgetState}</span><small>All-in ${Math.round(allInPrice).toLocaleString('en-CA')} • financed ${Math.round(principal).toLocaleString('en-CA')} • interest ${Math.round(totalInterest).toLocaleString('en-CA')} • total ownership estimate ${totalMonthly.toLocaleString('en-CA')}/mo</small></div><p className="muted">MSRP usually excludes freight/PDI, dealer fees, accessories, licensing, insurance, and sales tax. Use these fields to estimate a more realistic drive-away and monthly ownership amount.</p></section>;
}

function DealTracker({ vehicles, quotes, onSaveQuote }: { vehicles: ScoredVehicle[]; quotes: DealQuoteDocument[]; onSaveQuote: (quote: DealQuoteDocument) => void }) {
  const [draft, setDraft] = useState<DealQuoteDocument>(defaultDealQuote(vehicles[0]?.id ?? ''));
  useEffect(() => { if (!draft.vehicleId && vehicles[0]) setDraft(defaultDealQuote(vehicles[0].id)); }, [draft.vehicleId, vehicles]);
  function submit(event: FormEvent) { event.preventDefault(); onSaveQuote(draft); setDraft({ ...defaultDealQuote(draft.vehicleId), dealer: draft.dealer }); }
  return <section className="card stack"><div className="section-heading"><p className="eyebrow">Deal tracker</p><span>{quotes.length} saved quotes</span></div><form className="calculator-grid deal-form" onSubmit={submit}><label>Vehicle<select value={draft.vehicleId} onChange={(event) => setDraft({ ...draft, vehicleId: event.target.value })}>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}</select></label><label>Dealer<input value={draft.dealer} onChange={(event) => setDraft({ ...draft, dealer: event.target.value })} /></label><label>Trim<input value={draft.trim} onChange={(event) => setDraft({ ...draft, trim: event.target.value })} /></label><label>Price<input type="number" value={draft.price} onChange={(event) => setDraft({ ...draft, price: Number(event.target.value) })} /></label><label>Discount<input type="number" value={draft.discount} onChange={(event) => setDraft({ ...draft, discount: Number(event.target.value) })} /></label><label>Fees<input type="number" value={draft.fees} onChange={(event) => setDraft({ ...draft, fees: Number(event.target.value) })} /></label><label>Accessories<input type="number" value={draft.accessories} onChange={(event) => setDraft({ ...draft, accessories: Number(event.target.value) })} /></label><label>Trade-in<input type="number" value={draft.tradeIn} onChange={(event) => setDraft({ ...draft, tradeIn: Number(event.target.value) })} /></label><label>Finance %<input type="number" value={draft.financeRate} onChange={(event) => setDraft({ ...draft, financeRate: Number(event.target.value) })} /></label><label>Lease %<input type="number" value={draft.leaseRate} onChange={(event) => setDraft({ ...draft, leaseRate: Number(event.target.value) })} /></label><label>Quote expiry<input type="date" value={draft.expiryDate} onChange={(event) => setDraft({ ...draft, expiryDate: event.target.value })} /></label><label>Contact<input value={draft.contact} onChange={(event) => setDraft({ ...draft, contact: event.target.value })} /></label><label>Listing URL<input value={draft.listingUrl} onChange={(event) => setDraft({ ...draft, listingUrl: event.target.value })} /></label><label>Used year<input type="number" value={draft.usedYear ?? ''} onChange={(event) => setDraft({ ...draft, usedYear: Number(event.target.value) })} /></label><label>Mileage km<input type="number" value={draft.mileageKm ?? ''} onChange={(event) => setDraft({ ...draft, mileageKm: Number(event.target.value) })} /></label><label>Accident history<input value={draft.accidentHistory ?? ''} onChange={(event) => setDraft({ ...draft, accidentHistory: event.target.value })} /></label><label className="check"><input type="checkbox" checked={draft.cpo ?? false} onChange={(event) => setDraft({ ...draft, cpo: event.target.checked })} /> Certified pre-owned</label><label className="wide">Inspection notes<textarea value={draft.inspectionNotes ?? ''} onChange={(event) => setDraft({ ...draft, inspectionNotes: event.target.value })} /></label><button type="submit">Save quote</button></form><div className="quote-list">{quotes.map((quote) => <article key={quote.id ?? `${quote.vehicleId}-${quote.dealer}`}><strong>{vehicles.find((vehicle) => vehicle.id === quote.vehicleId)?.name ?? quote.vehicleId} • {quote.dealer || 'Dealer TBD'}</strong><span>{quote.trim || 'Trim TBD'} • net ${quoteNetPrice(quote).toLocaleString('en-CA')} • finance {quote.financeRate}% • expires {quote.expiryDate || 'not set'}</span><small>{quote.listingUrl && <a href={quote.listingUrl} target="_blank" rel="noreferrer">Listing</a>} {quote.usedYear ? `Used ${quote.usedYear}, ${quote.mileageKm?.toLocaleString('en-CA') ?? 0} km` : 'New quote'}</small></article>)}</div></section>;
}

function TestDriveDiary({ vehicles, entries, onSaveEntry }: { vehicles: ScoredVehicle[]; entries: TestDriveEntry[]; onSaveEntry: (entry: TestDriveEntry) => void }) {
  const [draft, setDraft] = useState<TestDriveEntry>(defaultDiaryDraft(vehicles[0]?.id ?? ''));
  function addEntry(event: FormEvent) { event.preventDefault(); onSaveEntry(draft); setDraft({ ...defaultDiaryDraft(draft.vehicleId), dealer: draft.dealer }); }
  return <section className="card stack"><div className="section-heading"><p className="eyebrow">Test drive diary</p><span>{entries.length} entries</span></div><form className="diary-form diary-panel" onSubmit={addEntry}><select value={draft.vehicleId} onChange={(event) => setDraft({ ...draft, vehicleId: event.target.value })}>{vehicles.map((vehicle) => <option value={vehicle.id} key={vehicle.id}>{vehicle.name}</option>)}</select><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /><input type="time" value={draft.appointmentTime} onChange={(event) => setDraft({ ...draft, appointmentTime: event.target.value })} /><input type="date" value={draft.reminderDate} onChange={(event) => setDraft({ ...draft, reminderDate: event.target.value })} /><input placeholder="Dealer / location" value={draft.dealer} onChange={(event) => setDraft({ ...draft, dealer: event.target.value })} /><textarea placeholder="Driving notes, kid comfort, road noise..." value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />{(['carSeatFits', 'strollerFits', 'doorsOpen90', 'passengerLegroom', 'cargoFloorWorks', 'winterTireQuote', 'outTheDoorQuote', 'prepaymentRules'] as const).map((key) => <label className="check" key={key}><input type="checkbox" checked={Boolean(draft[key])} onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} /> {checklistLabel(key)}</label>)}<label>Winter confidence {draft.winterConfidence}<input type="range" min="1" max="10" value={draft.winterConfidence} onChange={(event) => setDraft({ ...draft, winterConfidence: Number(event.target.value) })} /></label><label>Partner rating {draft.partnerRating}<input type="range" min="1" max="10" value={draft.partnerRating} onChange={(event) => setDraft({ ...draft, partnerRating: Number(event.target.value) })} /></label><button type="submit">Save diary entry</button></form><div className="diary-list">{entries.map((entry, index) => { const vehicleName = vehicles.find((vehicle) => vehicle.id === entry.vehicleId)?.name ?? 'Selected vehicle'; return <article className="diary-entry" key={entry.id ?? `${entry.vehicleId}-${entry.date}-${index}`}><div><strong>{vehicleName}</strong><span>{entry.date} {entry.appointmentTime && `at ${entry.appointmentTime}`} • {entry.dealer || 'No dealer noted'}</span></div><p>{entry.notes || 'No notes yet.'}</p><div className="diary-chips"><span>{entry.carSeatFits ? '✓' : '○'} Car seat</span><span>{entry.strollerFits ? '✓' : '○'} Stroller</span><span>{entry.doorsOpen90 ? '✓' : '○'} Doors 90°</span><span>Winter {entry.winterConfidence}/10</span><span>Partner {entry.partnerRating}/10</span>{entry.reminderDate && <span>Reminder {entry.reminderDate}</span>}</div></article>; })}</div></section>;
}

function ExportSummary({ vehicles, selectedVehicles, favoritesByProfile, notes, quotes, entries, weights }: { vehicles: ScoredVehicle[]; selectedVehicles: ScoredVehicle[]; favoritesByProfile: Record<ProfileName, string[]>; notes: Record<string, VehicleNoteDocument>; quotes: DealQuoteDocument[]; entries: TestDriveEntry[]; weights: Record<ProfileName, CriteriaWeights> }) {
  const finalists = selectedVehicles.length ? selectedVehicles : vehicles.slice(0, 3);
  const summary = [`CarMatch decision summary`, `Top picks: ${finalists.map((vehicle) => `${vehicle.name} (${vehicle.overallRecommendationScore})`).join(', ')}`, `Emily favourites: ${favoritesByProfile.Emily.join(', ') || 'none'}`, `Nick favourites: ${favoritesByProfile.Nick.join(', ') || 'none'}`, `Emily weights: ${JSON.stringify(weights.Emily)}`, `Nick weights: ${JSON.stringify(weights.Nick)}`, `Saved quotes: ${quotes.length}`, `Test drives: ${entries.length}`, ...finalists.map((vehicle) => `${vehicle.name}: stage ${(notes[vehicle.id] ?? emptyVehicleNote(vehicle.id)).stage}; note ${(notes[vehicle.id] ?? emptyVehicleNote(vehicle.id)).sharedNote || 'none'}`)].join('\n');
  return <section className="card stack"><div className="section-heading"><p className="eyebrow">Export summary</p><span>Copy or print for dealer visits</span></div><textarea className="summary-box" readOnly value={summary} /><button onClick={() => void navigator.clipboard?.writeText(summary)}>Copy summary</button></section>;
}

function defaultDiaryDraft(vehicleId: string): TestDriveEntry { return { vehicleId, date: new Date().toISOString().slice(0, 10), appointmentTime: '', reminderDate: '', dealer: '', notes: '', carSeatFits: false, strollerFits: false, doorsOpen90: false, passengerLegroom: false, cargoFloorWorks: false, winterTireQuote: false, outTheDoorQuote: false, prepaymentRules: false, winterConfidence: 5, partnerRating: 5 }; }
function defaultDealQuote(vehicleId: string): DealQuoteDocument { return { vehicleId, dealer: '', trim: '', price: CANADIAN_VEHICLES.find((vehicle) => vehicle.id === vehicleId)?.msrp ?? 0, discount: 0, fees: 2495, accessories: 0, tradeIn: 0, financeRate: 5.99, leaseRate: 6.49, expiryDate: '', contact: '', listingUrl: '', usedYear: undefined, mileageKm: undefined, accidentHistory: '', cpo: false, inspectionNotes: '' }; }
function toggleProfileFavorite(current: Record<ProfileName, string[]>, profile: ProfileName, vehicleId: string) { const currentFavorites = current[profile]; return { ...current, [profile]: currentFavorites.includes(vehicleId) ? currentFavorites.filter((favoriteId) => favoriteId !== vehicleId) : [...currentFavorites, vehicleId] }; }
function toggleCompareVehicle(current: string[], vehicleId: string) { return current.includes(vehicleId) ? current.filter((id) => id !== vehicleId) : [vehicleId, ...current].slice(0, 4); }
function quoteNetPrice(quote: DealQuoteDocument) { return Math.max(quote.price - quote.discount + quote.fees + quote.accessories - quote.tradeIn, 0); }
function estimateOwnershipCost(vehicle: ScoredVehicle) { return Math.round((vehicle.powertrain.includes('Hybrid') ? 120 : 175) + 90 + (vehicle.msrp * 0.0008)); }
function enrichScores(vehicles: ScoredVehicle[], entries: TestDriveEntry[], quotes: DealQuoteDocument[]) { return vehicles.map((vehicle) => { const vehicleEntries = entries.filter((entry) => entry.vehicleId === vehicle.id); const vehicleQuotes = quotes.filter((quote) => quote.vehicleId === vehicle.id); const testDriveScore = vehicleEntries.length ? Math.round(vehicleEntries.reduce((sum, entry) => sum + entry.partnerRating * 7 + entry.winterConfidence * 3 + (entry.carSeatFits ? 5 : 0) + (entry.strollerFits ? 5 : 0), 0) / vehicleEntries.length) : vehicle.testDriveScore; const bestNet = vehicleQuotes.length ? Math.min(...vehicleQuotes.map(quoteNetPrice)) : vehicle.msrp; const dealScore = vehicleQuotes.length ? Math.max(60, Math.min(100, Math.round(100 - ((bestNet - vehicle.msrp) / vehicle.msrp) * 100))) : vehicle.dealScore; const confidenceScore = Math.min(100, vehicle.confidenceScore + Math.min(vehicleEntries.length * 4, 12) + Math.min(vehicleQuotes.length * 3, 9)); return { ...vehicle, testDriveScore, dealScore, confidenceScore, overallRecommendationScore: Math.round(vehicle.familyCompatibilityScore * 0.45 + confidenceScore * 0.2 + testDriveScore * 0.2 + dealScore * 0.15) }; }).sort((a, b) => b.overallRecommendationScore - a.overallRecommendationScore); }
function comparisonValue(row: string, vehicle: ScoredVehicle, favoritesByProfile: Record<ProfileName, string[]>, notes: Record<string, VehicleNoteDocument>, quotes: DealQuoteDocument[], entries: TestDriveEntry[]) { const note = notes[vehicle.id] ?? emptyVehicleNote(vehicle.id); const bestQuote = quotes.filter((quote) => quote.vehicleId === vehicle.id).sort((a, b) => quoteNetPrice(a) - quoteNetPrice(b))[0]; const diaryCount = entries.filter((entry) => entry.vehicleId === vehicle.id).length; const values: Record<string, string> = { MSRP: `$${vehicle.msrp.toLocaleString('en-CA')}`, Monthly: `$${estimateMonthlyPayment(vehicle).toLocaleString('en-CA')}`, Overall: `${vehicle.overallRecommendationScore}`, Confidence: `${vehicle.confidenceScore}`, 'Test drive': `${vehicle.testDriveScore}`, Deal: `${vehicle.dealScore}`, Seats: `${vehicle.seats}`, Cargo: `${vehicle.cargoLitres} L`, Drive: vehicle.drivetrain, Powertrain: vehicle.powertrain, Emily: `${favoritesByProfile.Emily.includes(vehicle.id) ? '★ ' : ''}${note.reactions.Emily}`, Nick: `${favoritesByProfile.Nick.includes(vehicle.id) ? '★ ' : ''}${note.reactions.Nick}`, 'Best quote': bestQuote ? `$${quoteNetPrice(bestQuote).toLocaleString('en-CA')}` : 'None', 'Diary entries': `${diaryCount}` }; return values[row] ?? ''; }
function checklistLabel(key: keyof Pick<TestDriveEntry, 'carSeatFits' | 'strollerFits' | 'doorsOpen90' | 'passengerLegroom' | 'cargoFloorWorks' | 'winterTireQuote' | 'outTheDoorQuote' | 'prepaymentRules'>) { return ({ carSeatFits: 'Car seat fit checked', strollerFits: 'Stroller fit checked', doorsOpen90: 'Rear doors open wide', passengerLegroom: 'Passenger legroom with car seat', cargoFloorWorks: 'Cargo floor works for stroller', winterTireQuote: 'Asked winter tire pricing', outTheDoorQuote: 'Got out-the-door quote', prepaymentRules: 'Asked prepayment rules' })[key]; }

export default App;
