import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { signInAnonymously, type User } from 'firebase/auth';
import { arrayUnion, collection, doc, getDoc, increment, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';
import { useCollection } from 'react-firebase-hooks/firestore';
import { auth, db } from './firebase';
import { averagePartnerWeights, CANADIAN_VEHICLES, DEFAULT_WEIGHTS, scoreVehicles } from './scoring';
import type { BodyStyle, CriteriaKey, CriteriaWeights, DealQuoteDocument, Drivetrain, Powertrain, ProfileName, ScoredVehicle, SessionDocument, TestDriveEntry, UserPreferenceDocument, UserReaction, VehicleNoteDocument, VehicleStage, VehicleTrimOption } from './types';
import { CompareTray } from './components/CompareTray';
import { ComparisonTable as EnhancedComparisonTable } from './components/ComparisonTable';
import { PaymentCalculator as EnhancedPaymentCalculator } from './components/PaymentCalculator';
import { TestDriveDiary as EnhancedTestDriveDiary } from './components/TestDriveDiary';
import { SenStatsDashboard } from './components/SenStatsDashboard';
import { useLocalStorageState } from './hooks/useLocalStorageState';
import './styles.css';

const sliderConfig: Array<{ key: CriteriaKey; label: string; help: string }> = [
  { key: 'space', label: 'Car Seat & Cabin Space', help: 'Second-row room, cargo access, and family ergonomics.' },
  { key: 'winterTraction', label: 'Winter Traction', help: 'Snow confidence, AWD behavior, and cold-weather stability.' },
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
const mustHaveLabels = { mustHaveAwd: 'Must be AWD / 4WD', mustFitCarSeat: 'Must fit rear-facing car seat', mustBeUnderBudget: 'Must be under monthly budget', mustHaveHybrid: 'Must have hybrid/electric option', mustHaveHeatedRearSeats: 'Must have heated rear seats', mustHaveMemorySeats: 'Must have memory seats', mustHaveSpareTire: 'Must have spare tire', mustAvoidCvt: 'Must not be CVT', mustHavePhysicalClimateControls: 'Must have physical climate controls' } as const;

type MustHaveKey = keyof typeof mustHaveLabels;
type MustHaveSettings = Record<MustHaveKey, boolean>;
type ReadinessStatus = 'Ready to decide' | 'Needs test drive' | 'Needs quote' | 'Nick has not reviewed' | 'Emily marked as finalist' | 'Needs shared note' | 'Deal breaker';

type AppSection = 'dashboard' | 'browse' | 'compare' | 'calculator' | 'deals' | 'diary' | 'decision';
type WorkspaceApp = 'CarMatch' | 'SenStats' | 'AppSelection';

const sectionLabels: Record<AppSection, string> = { dashboard: 'Shared priorities', browse: 'Browse vehicles', compare: 'Compare', calculator: 'Payment calculator', deals: 'Deal tracker', diary: 'Test drive diary', decision: 'Decision Room' };

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
  hideRejected: boolean;
}

const defaultFilters: Filters = {
  query: '', bodyStyle: 'All', drivetrain: 'All', powertrain: 'All', maxPrice: 70000, minSeats: 0,
  mustHaveAwd: false, mustHaveHybrid: false, mustFitCarSeat: false, maxMonthlyPayment: 0, stage: 'All', hideRejected: false,
};

const defaultMustHaves: MustHaveSettings = {
  mustHaveAwd: false,
  mustFitCarSeat: false,
  mustBeUnderBudget: false,
  mustHaveHybrid: false,
  mustHaveHeatedRearSeats: false,
  mustHaveMemorySeats: false,
  mustHaveSpareTire: false,
  mustAvoidCvt: false,
  mustHavePhysicalClimateControls: false,
};

interface VehicleReadiness {
  score: number;
  status: ReadinessStatus;
  checklist: Array<{ label: string; complete: boolean }>;
  missing: string[];
  blocked: boolean;
}

interface ProfilePreferenceMeta {
  updatedByUid?: string;
  updatedByProfile?: ProfileName;
  version?: number;
}


function getSessionIdFromUrl() {
  return new URLSearchParams(window.location.search).get('session');
}

function emptyVehicleNote(vehicleId: string): VehicleNoteDocument {
  return { vehicleId, sharedNote: '', stage: 'Browsing', reactions: { Emily: 'Unrated', Nick: 'Unrated' } };
}

function actualVehiclePrice(vehicle: ScoredVehicle, quotes: DealQuoteDocument[]) {
  const bestQuote = quotes.filter((quote) => quote.vehicleId === vehicle.id).sort((a, b) => quoteNetPrice(a) - quoteNetPrice(b))[0];
  return bestQuote ? quoteNetPrice(bestQuote) : Math.round((vehicle.msrp + 2495) * 1.13);
}

function actualVehiclePriceLabel(vehicle: ScoredVehicle, quotes: DealQuoteDocument[]) {
  return quotes.some((quote) => quote.vehicleId === vehicle.id) ? 'Best quote' : 'Est. drive-away';
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


function AppSelectionPage({ onSelectApp }: { onSelectApp: (app: WorkspaceApp) => void }) {
  return <main className="shell app-selector-shell"><section className="card app-selector"><div className="section-heading"><div><p className="eyebrow">FlexSpace launcher</p><h2>Choose a workspace app</h2></div><span>Double-click an app name in either app header to return here.</span></div><div className="app-tiles"><button type="button" onClick={() => onSelectApp('CarMatch')}><strong>CarMatch</strong><span>Vehicle research, scoring, shared notes, quotes, test-drive planning, and decision support.</span><small>Open CarMatch</small></button><button type="button" onClick={() => onSelectApp('SenStats')}><strong>SenStats</strong><span>Canadian Senate dashboard with senators, groups, committees, expenses, public sources, sync status, and change history.</span><small>Open SenStats</small></button></div></section></main>;
}

type SenStatsThemeMode = 'light' | 'dark' | 'auto';

function SenStatsApp({ onOpenAppSelection }: { onOpenAppSelection: () => void }) {
  const [themeMode, setThemeMode] = useState<SenStatsThemeMode>(() => (localStorage.getItem('senstats.themeMode') as SenStatsThemeMode | null) || (localStorage.getItem('senstats.darkMode') === 'true' ? 'dark' : 'auto'));
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const darkMode = themeMode === 'auto' ? systemPrefersDark : themeMode === 'dark';

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    localStorage.setItem('senstats.themeMode', themeMode);
    localStorage.setItem('senstats.darkMode', String(darkMode));
    document.body.classList.toggle('senstats-body-dark', darkMode);
    return () => document.body.classList.remove('senstats-body-dark');
  }, [darkMode, themeMode]);

  return <main className={`shell senstats-shell ${darkMode ? 'senstats-shell-dark' : ''}`}><section className="hero card"><div className="hero-topline"><button className="app-name senstats-name" type="button" onDoubleClick={onOpenAppSelection} title="Double-click to switch apps">SenStats</button><button className="settings-button" type="button" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">Settings</button></div></section><SenStatsDashboard darkMode={darkMode} />{settingsOpen && <div className="settings-modal-layer" role="presentation"><button type="button" className="settings-modal-backdrop" aria-label="Close settings" onClick={() => setSettingsOpen(false)} /><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="senstats-settings-title"><header><div><span>SenStats settings</span><strong id="senstats-settings-title">Display preferences</strong></div><button type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>×</button></header><div className="settings-section"><span>Theme</span><div className="theme-mode-options" role="radiogroup" aria-label="Theme mode">{(['light', 'dark', 'auto'] as SenStatsThemeMode[]).map((mode) => <button key={mode} type="button" role="radio" aria-checked={themeMode === mode} className={themeMode === mode ? 'active' : ''} onClick={() => setThemeMode(mode)}><strong>{mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'Auto'}</strong><small>{mode === 'auto' ? 'Match system' : `${mode} mode`}</small></button>)}</div></div><div className="settings-section placeholder"><span>More settings coming soon</span><p className="muted">This panel is ready for future defaults, sync display preferences, and accessibility controls.</p></div></section></div>}</main>;
}

function AuthenticatedSession({ activeUser }: { activeUser: User }) {
  const [sessionId, setSessionId] = useState<string | null>(getSessionIdFromUrl);
  const [session, setSession] = useState<SessionDocument | null>(null);
  const [sessionStatus, setSessionStatus] = useState('Preparing your shared profile...');
  const [filters, setFilters] = useLocalStorageState<Filters>('carmatch.filters', defaultFilters);
  const [mustHaves, setMustHaves] = useLocalStorageState<MustHaveSettings>('carmatch.mustHaves', defaultMustHaves);
  const [selectedVehicleIds, setSelectedVehicleIds] = useLocalStorageState<string[]>('carmatch.compareVehicleIds', CANADIAN_VEHICLES.slice(0, 3).map((vehicle) => vehicle.id));
  const [testDriveEntries, setTestDriveEntries] = useState<TestDriveEntry[]>([]);
  const [dealQuotes, setDealQuotes] = useState<DealQuoteDocument[]>([]);
  const [vehicleNotes, setVehicleNotes] = useState<Record<string, VehicleNoteDocument>>({});
  const [activeSection, setActiveSection] = useLocalStorageState<AppSection>('carmatch.activeSection', 'dashboard');
  const [activeWorkspaceApp, setActiveWorkspaceApp] = useLocalStorageState<WorkspaceApp>('carmatch.workspaceApp', 'CarMatch');
  const [compareMessage, setCompareMessage] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeProfile, setActiveProfile] = useState<ProfileName>('Emily');
  const [favoritesByProfile, setFavoritesByProfile] = useState<Record<ProfileName, string[]>>({ Emily: [], Nick: [] });
  const [profileWeights, setProfileWeights] = useState<Record<ProfileName, CriteriaWeights>>({ Emily: DEFAULT_WEIGHTS, Nick: DEFAULT_WEIGHTS });
  const [profileMeta, setProfileMeta] = useState<Record<ProfileName, ProfilePreferenceMeta>>({ Emily: {}, Nick: {} });

  const canReadSharedCollections = Boolean(sessionId && session?.partnerIds?.includes(activeUser.uid));
  const preferencesQuery = useMemo(() => (sessionId && canReadSharedCollections ? collection(db, 'sessions', sessionId, 'userPreferences') : null), [canReadSharedCollections, sessionId]);
  const globalPreferencesQuery = useMemo(() => collection(db, 'profilePreferences'), []);
  const notesQuery = useMemo(() => (sessionId && canReadSharedCollections ? collection(db, 'sessions', sessionId, 'vehicleNotes') : null), [canReadSharedCollections, sessionId]);
  const diaryQuery = useMemo(() => (sessionId && canReadSharedCollections ? collection(db, 'sessions', sessionId, 'testDriveDiary') : null), [canReadSharedCollections, sessionId]);
  const quotesQuery = useMemo(() => (sessionId && canReadSharedCollections ? collection(db, 'sessions', sessionId, 'dealQuotes') : null), [canReadSharedCollections, sessionId]);
  const [preferencesSnapshot, preferencesLoading, preferencesError] = useCollection(preferencesQuery as any);
  const [globalPreferencesSnapshot] = useCollection(globalPreferencesQuery as any);
  const [notesSnapshot] = useCollection(notesQuery as any);
  const [diarySnapshot] = useCollection(diaryQuery as any);
  const [quotesSnapshot] = useCollection(quotesQuery as any);

  const profilePreferences = useMemo<UserPreferenceDocument[]>(() => [
    { userId: 'Emily', criteriaWeights: profileWeights.Emily, personalNotes: {}, favoriteVehicleIds: favoritesByProfile.Emily },
    { userId: 'Nick', criteriaWeights: profileWeights.Nick, personalNotes: {}, favoriteVehicleIds: favoritesByProfile.Nick },
  ], [favoritesByProfile, profileWeights]);

  useEffect(() => {
    const nextWeights: Record<ProfileName, CriteriaWeights> = { Emily: DEFAULT_WEIGHTS, Nick: DEFAULT_WEIGHTS };
    const nextFavorites: Record<ProfileName, string[]> = { Emily: [], Nick: [] };
    const nextMeta: Record<ProfileName, ProfilePreferenceMeta> = { Emily: {}, Nick: {} };
    const applyPreferenceDocs = (docs?: Array<{ data: () => Partial<UserPreferenceDocument> }>) => {
      docs?.forEach((preferenceDoc) => {
        const data = preferenceDoc.data();
        if (data.userId === 'Emily' || data.userId === 'Nick') {
          nextWeights[data.userId] = { ...DEFAULT_WEIGHTS, ...(data.criteriaWeights ?? {}) };
          nextFavorites[data.userId] = data.favoriteVehicleIds ?? [];
          nextMeta[data.userId] = { updatedByUid: data.updatedByUid, updatedByProfile: data.updatedByProfile, version: data.version };
        }
      });
    };
    applyPreferenceDocs(preferencesSnapshot?.docs);
    applyPreferenceDocs(globalPreferencesSnapshot?.docs);
    setProfileWeights(nextWeights);
    setFavoritesByProfile(nextFavorites);
    setProfileMeta(nextMeta);
  }, [globalPreferencesSnapshot, preferencesSnapshot]);

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
      setSessionStatus('connected');
    }
    void bootstrapSession().catch((error: unknown) => setSessionStatus(error instanceof Error ? error.message : 'Unable to initialize the shared session.'));
  }, [activeUser.uid, sessionId]);

  useEffect(() => {
    async function ensureGlobalProfilePreferenceDocs() {
      await Promise.all(profileNames.map(async (profileName) => {
        const preferenceRef = doc(db, 'profilePreferences', profileName);
        const snapshot = await getDoc(preferenceRef);
        if (!snapshot.exists()) await setDoc(preferenceRef, { userId: profileName, criteriaWeights: DEFAULT_WEIGHTS, personalNotes: {}, favoriteVehicleIds: [], updatedAt: serverTimestamp(), updatedByUid: activeUser.uid, updatedByProfile: profileName, version: 1 });
      }));
    }
    void ensureGlobalProfilePreferenceDocs().catch((error: unknown) => setSessionStatus(error instanceof Error ? error.message : 'Unable to initialize universal profile preferences.'));
  }, [activeUser.uid]);

  useEffect(() => {
    if (!sessionId || !canReadSharedCollections) return;
    const activeSessionId = sessionId;
    async function ensureProfilePreferenceDocs() {
      await Promise.all(profileNames.map(async (profileName) => {
        const preferenceRef = doc(db, 'sessions', activeSessionId, 'userPreferences', profileName);
        const snapshot = await getDoc(preferenceRef);
        if (!snapshot.exists()) await setDoc(preferenceRef, { userId: profileName, criteriaWeights: DEFAULT_WEIGHTS, personalNotes: {}, favoriteVehicleIds: [], updatedAt: serverTimestamp(), updatedByUid: activeUser.uid, updatedByProfile: profileName, version: 1 });
      }));
    }
    void ensureProfilePreferenceDocs().catch((error: unknown) => setSessionStatus(error instanceof Error ? error.message : 'Unable to initialize saved profile preferences.'));
  }, [canReadSharedCollections, sessionId]);

  const saveProfilePreference = useCallback((profileName: ProfileName, weights: CriteriaWeights, favoriteVehicleIds: string[]) => {
    const preferenceDocument = { userId: profileName, criteriaWeights: weights, personalNotes: {}, favoriteVehicleIds, updatedAt: serverTimestamp(), updatedByUid: activeUser.uid, updatedByProfile: profileName, version: increment(1) };
    const writes = [setDoc(doc(db, 'profilePreferences', profileName), preferenceDocument, { merge: true })];
    if (sessionId) writes.push(setDoc(doc(db, 'sessions', sessionId, 'userPreferences', profileName), preferenceDocument, { merge: true }));
    void Promise.all(writes).catch((error: unknown) => setSessionStatus(error instanceof Error ? error.message : 'Unable to save universal profile preferences.'));
  }, [activeUser.uid, sessionId]);

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
        && (filters.stage === 'All' || note.stage === filters.stage)
        && (!filters.hideRejected || note.stage !== 'Rejected');
    });
  }, [dealQuotes, filters, scoredVehicles, testDriveEntries, vehicleNotes]);

  const selectedVehicle = scoredVehicles.find((vehicle) => vehicle.id === selectedVehicleIds[0]) ?? scoredVehicles[0]!;
  const selectedVehicles = selectedVehicleIds.map((vehicleId) => scoredVehicles.find((vehicle) => vehicle.id === vehicleId)).filter(Boolean) as ScoredVehicle[];
  const readinessByVehicle = useMemo(() => Object.fromEntries(scoredVehicles.map((vehicle) => [vehicle.id, vehicleReadiness(vehicle, favoritesByProfile, vehicleNotes[vehicle.id] ?? emptyVehicleNote(vehicle.id), dealQuotes, testDriveEntries, filters.maxMonthlyPayment, mustHaves)])), [dealQuotes, favoritesByProfile, filters.maxMonthlyPayment, mustHaves, scoredVehicles, testDriveEntries, vehicleNotes]);
  const showCompareTray = activeSection === 'browse' || activeSection === 'compare';
  const activeSectionLabel = sectionLabels[activeSection as AppSection];

  const reorderComparedVehicles = useCallback((fromIndex: number, toIndex: number) => {
    setSelectedVehicleIds((current) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= current.length || toIndex >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, [setSelectedVehicleIds]);

  const openVehicleProfile = useCallback((vehicleId: string) => {
    setSelectedVehicleIds((current) => [vehicleId, ...current.filter((id) => id !== vehicleId)].slice(0, 4));
    window.setTimeout(() => document.getElementById('vehicle-profile')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [setSelectedVehicleIds]);

  useEffect(() => {
    if (!compareMessage) return;
    const timeout = window.setTimeout(() => setCompareMessage(''), 2200);
    return () => window.clearTimeout(timeout);
  }, [compareMessage]);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [activeSection]);

  const toggleComparedVehicle = useCallback((vehicleId: string) => {
    setSelectedVehicleIds((current) => {
      if (current.includes(vehicleId)) {
        setCompareMessage('Removed from compare tray.');
        return current.filter((id) => id !== vehicleId);
      }

      if (current.length >= 4) {
        setCompareMessage('Compare tray is full. Remove a model before adding another.');
        return current;
      }

      setCompareMessage('Added to compare tray. Reorder columns from the Compare page.');
      return [vehicleId, ...current];
    });
  }, [setSelectedVehicleIds]);

  if (activeWorkspaceApp === 'AppSelection') return <AppSelectionPage onSelectApp={setActiveWorkspaceApp} />;
  if (activeWorkspaceApp === 'SenStats') return <SenStatsApp onOpenAppSelection={() => setActiveWorkspaceApp('AppSelection')} />;

  return (
    <main className={`shell profile-${activeProfile.toLowerCase()}`}>
      <section className="hero card">
        <div className="hero-topline"><div className="brand-status"><button className="app-name" type="button" onDoubleClick={() => setActiveWorkspaceApp('AppSelection')} title="Double-click to switch apps">CarMatch</button><SessionStatusIcon status={sessionStatus} /></div><div className="profile-switcher" aria-label="User profile selector">{profileNames.map((profileName) => <button key={profileName} className={activeProfile === profileName ? 'active' : ''} onClick={() => setActiveProfile(profileName)}>{profileName}</button>)}</div></div>
      </section>

      <button className="menu-toggle" type="button" aria-expanded={isMenuOpen} aria-controls="primary-app-menu" onClick={() => setIsMenuOpen((open: boolean) => !open)}><span className="menu-icon" aria-hidden="true"><span /><span /><span /></span><span>{activeSectionLabel}</span></button>
      <nav id="primary-app-menu" className={`app-menu ${isMenuOpen ? 'open' : ''}`} aria-label="Primary app sections">
        <button className={activeSection === 'dashboard' ? 'active' : ''} onClick={() => setActiveSection('dashboard')}>Shared priorities</button>
        <button className={activeSection === 'browse' ? 'active' : ''} onClick={() => setActiveSection('browse')}>Browse vehicles</button>
        <button className={activeSection === 'compare' ? 'active' : ''} onClick={() => setActiveSection('compare')}>Compare</button>
        <button className={activeSection === 'calculator' ? 'active' : ''} onClick={() => setActiveSection('calculator')}>Payment calculator</button>
        <button className={activeSection === 'deals' ? 'active' : ''} onClick={() => setActiveSection('deals')}>Deal tracker</button>
        <button className={activeSection === 'diary' ? 'active' : ''} onClick={() => setActiveSection('diary')}>Test drive diary</button>
        <button className={activeSection === 'decision' ? 'active' : ''} onClick={() => setActiveSection('decision')}>Decision Room</button>
      </nav>

      {showCompareTray && <CompareTray selectedVehicles={selectedVehicles} onCompareNow={() => setActiveSection('compare')} onClear={() => { setSelectedVehicleIds([]); setCompareMessage('Compare tray cleared.'); }} onRemove={(vehicleId) => { setSelectedVehicleIds((current) => current.filter((id) => id !== vehicleId)); setCompareMessage('Vehicle removed from comparison.'); }} />}
      {compareMessage && <div className="toast" role="status">✓ {compareMessage}</div>}

      {activeSection === 'decision' && <DecisionRoom vehicles={scoredVehicles} notes={vehicleNotes} quotes={dealQuotes} readinessByVehicle={readinessByVehicle} favoritesByProfile={favoritesByProfile} budgetLimit={filters.maxMonthlyPayment} />}
      {activeSection === 'dashboard' && <section className="grid"><PrioritySliders profileName={activeProfile} currentWeights={profileWeights[activeProfile]} onWeightsChange={handleProfileWeightsChange} /><Dashboard scoredVehicles={filteredVehicles} quotes={dealQuotes} readinessByVehicle={readinessByVehicle} combinedWeights={combinedWeights} loading={!sessionId || preferencesLoading} error={preferencesError?.message} partnerCount={profilePreferences.length} onSelectVehicle={(vehicleId) => { setSelectedVehicleIds([vehicleId, ...selectedVehicleIds.filter((id) => id !== vehicleId)].slice(0, 4)); setActiveSection('compare'); }} /><PriorityComparison profileWeights={profileWeights} profileMeta={profileMeta} /></section>}
      {activeSection === 'browse' && <VehicleBrowser filters={filters} onFiltersChange={setFilters} mustHaves={mustHaves} onMustHavesChange={setMustHaves} vehicles={filteredVehicles} readinessByVehicle={readinessByVehicle} quotes={dealQuotes} activeProfile={activeProfile} favorites={favoritesByProfile[activeProfile]} selectedVehicleIds={selectedVehicleIds} notes={vehicleNotes} onToggleFavorite={handleToggleFavorite} onToggleCompare={toggleComparedVehicle} onSelectVehicle={openVehicleProfile} />}
      {activeSection === 'compare' && <EnhancedComparisonTable vehicles={selectedVehicles.length ? selectedVehicles : scoredVehicles.slice(0, 3)} favoritesByProfile={favoritesByProfile} notes={vehicleNotes} quotes={dealQuotes} entries={testDriveEntries} onStageChange={(vehicleId, stage) => saveVehicleNote(vehicleId, { stage })} onReorder={reorderComparedVehicles} onRemove={(vehicleId) => { setSelectedVehicleIds((current) => current.filter((id) => id !== vehicleId)); setCompareMessage('Vehicle removed from comparison.'); }} />}
      {activeSection === 'calculator' && <EnhancedPaymentCalculator vehicle={selectedVehicle} initialPrice={actualVehiclePrice(selectedVehicle, dealQuotes)} budgetLimit={filters.maxMonthlyPayment} onBudgetLimitChange={(maxMonthlyPayment) => setFilters((current) => ({ ...current, maxMonthlyPayment }))} />}
      {activeSection === 'deals' && <DealTracker vehicles={scoredVehicles} quotes={dealQuotes} onSaveQuote={saveDealQuote} />}
      {activeSection === 'diary' && <EnhancedTestDriveDiary vehicles={scoredVehicles} entries={testDriveEntries} onSaveEntry={saveDiaryEntry} />}

      <VehicleProfile vehicle={selectedVehicle} activeProfile={activeProfile} isFavorite={favoritesByProfile[activeProfile].includes(selectedVehicle.id)} note={vehicleNotes[selectedVehicle.id] ?? emptyVehicleNote(selectedVehicle.id)} quotes={dealQuotes.filter((quote) => quote.vehicleId === selectedVehicle.id)} entries={testDriveEntries.filter((entry) => entry.vehicleId === selectedVehicle.id)} onToggleFavorite={() => handleToggleFavorite(selectedVehicle.id)} onNoteChange={(patch) => saveVehicleNote(selectedVehicle.id, patch)} />
    </main>
  );
}


function SessionStatusIcon({ status }: { status: string }) {
  const lowerStatus = status.toLowerCase();
  const state = lowerStatus.includes('unable') || lowerStatus.includes('failed') || lowerStatus.includes('error') ? 'failed' : lowerStatus.includes('connected') ? 'connected' : 'syncing';
  const label = state === 'connected' ? 'Connected' : state === 'failed' ? 'Sync failed' : 'Syncing';
  return <span className={`session-icon ${state}`} role="status" aria-label={label} title={status}>{state === 'connected' ? '✓' : state === 'failed' ? '!' : '↻'}</span>;
}

function DecisionRoom({ vehicles, notes, quotes, readinessByVehicle, favoritesByProfile, budgetLimit }: { vehicles: ScoredVehicle[]; notes: Record<string, VehicleNoteDocument>; quotes: DealQuoteDocument[]; readinessByVehicle: Record<string, VehicleReadiness>; favoritesByProfile: Record<ProfileName, string[]>; budgetLimit: number }) {
  const topThree = vehicles.slice(0, 3);
  const bestEmily = vehicles.find((vehicle) => favoritesByProfile.Emily.includes(vehicle.id)) ?? topThree[0];
  const bestNick = vehicles.find((vehicle) => favoritesByProfile.Nick.includes(vehicle.id)) ?? topThree[0];
  const bestDeal = [...vehicles].sort((a, b) => actualVehiclePrice(a, quotes) - actualVehiclePrice(b, quotes))[0];
  const bestTestDrive = [...vehicles].sort((a, b) => b.testDriveScore - a.testDriveScore)[0];
  const lowestMonthly = [...vehicles].sort((a, b) => estimateMonthlyPayment(a) - estimateMonthlyPayment(b))[0];
  const mostComplete = [...vehicles].sort((a, b) => (readinessByVehicle[b.id]?.score ?? 0) - (readinessByVehicle[a.id]?.score ?? 0))[0];
  const openTasks = topThree.flatMap((vehicle) => (readinessByVehicle[vehicle.id]?.missing ?? []).slice(0, 3).map((task) => `${vehicle.name}: ${task}`)).slice(0, 7);
  return <section className="card stack decision-room"><div className="section-heading"><div><p className="eyebrow">Decision Room</p><h2>What is ready, and what still needs work?</h2></div><span>{budgetLimit ? `Budget guardrail $${budgetLimit}/mo` : 'No monthly guardrail set'}</span></div><div className="decision-grid"><DecisionWidget label="Top Recommendation" vehicle={topThree[0]} detail={`${readinessByVehicle[topThree[0]?.id ?? '']?.score ?? 0}% ready`} /><DecisionWidget label="Best for Emily" vehicle={bestEmily} detail={bestEmily ? notes[bestEmily.id]?.reactions?.Emily ?? 'No reaction yet' : '—'} /><DecisionWidget label="Best for Nick" vehicle={bestNick} detail={bestNick ? notes[bestNick.id]?.reactions?.Nick ?? 'No reaction yet' : '—'} /><DecisionWidget label="Best Deal" vehicle={bestDeal} detail={bestDeal ? `$${actualVehiclePrice(bestDeal, quotes).toLocaleString('en-CA')}` : '—'} /><DecisionWidget label="Best Test Drive" vehicle={bestTestDrive} detail={bestTestDrive ? `${bestTestDrive.testDriveScore}/100` : '—'} /><DecisionWidget label="Lowest Monthly" vehicle={lowestMonthly} detail={lowestMonthly ? `$${estimateMonthlyPayment(lowestMonthly).toLocaleString('en-CA')}/mo` : '—'} /><DecisionWidget label="Most Complete Evidence" vehicle={mostComplete} detail={mostComplete ? `${readinessByVehicle[mostComplete.id]?.status}` : '—'} /></div><div className="finalist-strip">{topThree.map((vehicle) => <article key={vehicle.id}><strong>{vehicle.name}</strong><span className={`readiness-badge ${readinessByVehicle[vehicle.id]?.blocked ? 'blocked' : readinessByVehicle[vehicle.id]?.score >= 85 ? 'ready' : ''}`}>{readinessByVehicle[vehicle.id]?.status}</span><ul>{readinessByVehicle[vehicle.id]?.missing.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul></article>)}</div><div className="open-tasks"><strong>Open tasks</strong>{openTasks.length ? <ul>{openTasks.map((task) => <li key={task}>{task}</li>)}</ul> : <p className="muted">No major blockers for the current finalists.</p>}</div></section>;
}

function DecisionWidget({ label, vehicle, detail }: { label: string; vehicle?: ScoredVehicle; detail: string }) {
  return <article className="decision-widget"><span>{label}</span><strong>{vehicle?.name ?? 'Not enough data'}</strong><small>{detail}</small></article>;
}

function vehicleReadiness(vehicle: ScoredVehicle, favoritesByProfile: Record<ProfileName, string[]>, note: VehicleNoteDocument, quotes: DealQuoteDocument[], entries: TestDriveEntry[], maxMonthlyPayment: number, mustHaves: MustHaveSettings): VehicleReadiness {
  const vehicleEntries = entries.filter((entry) => entry.vehicleId === vehicle.id);
  const completedDrive = vehicleEntries.some((entry) => entry.status === 'Completed');
  const carSeatAndStroller = vehicleEntries.some((entry) => entry.carSeatFits && entry.strollerFits);
  const quoteReceived = quotes.some((quote) => quote.vehicleId === vehicle.id);
  const emilyReviewed = favoritesByProfile.Emily.includes(vehicle.id) || note.reactions.Emily !== 'Unrated';
  const nickReviewed = favoritesByProfile.Nick.includes(vehicle.id) || note.reactions.Nick !== 'Unrated';
  const sharedNote = note.sharedNote.trim().length > 0;
  const withinBudget = !maxMonthlyPayment || estimateMonthlyPayment(vehicle) <= maxMonthlyPayment;
  const explicitDealBreaker = note.stage === 'Rejected' || /deal\s*breaker|hard no|reject/i.test(note.sharedNote);
  const mustHaveFailures = unmetMustHaves(vehicle, vehicleEntries, maxMonthlyPayment, mustHaves);
  const checklist = [
    { label: 'Needs Emily review or favourite', complete: emilyReviewed },
    { label: 'Needs Nick review or favourite', complete: nickReviewed },
    { label: 'Needs a shared note', complete: sharedNote },
    { label: 'Needs completed test drive', complete: completedDrive },
    { label: 'Needs dealer quote', complete: quoteReceived },
    { label: 'Needs payment within budget', complete: withinBudget },
    { label: 'Needs car seat and stroller checks', complete: carSeatAndStroller },
    { label: 'Needs deal-breaker review', complete: !explicitDealBreaker && mustHaveFailures.length === 0 },
  ];
  const missing = checklist.filter((item) => !item.complete).map((item) => item.label).concat(mustHaveFailures);
  const score = Math.round((checklist.filter((item) => item.complete).length / checklist.length) * 100);
  const blocked = explicitDealBreaker || mustHaveFailures.length > 0;
  let status: ReadinessStatus = 'Ready to decide';
  if (blocked) status = 'Deal breaker';
  else if (note.stage === 'Finalist' && score >= 75) status = 'Emily marked as finalist';
  else if (!nickReviewed) status = 'Nick has not reviewed';
  else if (!completedDrive) status = 'Needs test drive';
  else if (!quoteReceived) status = 'Needs quote';
  else if (!sharedNote) status = 'Needs shared note';
  return { score, status, checklist, missing, blocked };
}

function unmetMustHaves(vehicle: ScoredVehicle, entries: TestDriveEntry[], maxMonthlyPayment: number, mustHaves: MustHaveSettings) {
  const failures: string[] = [];
  const hasCarSeat = entries.some((entry) => entry.carSeatFits);
  const isHybrid = vehicle.powertrain === 'Hybrid' || vehicle.powertrain === 'Plug-in Hybrid' || vehicle.powertrain === 'Electric';
  if (mustHaves.mustHaveAwd && vehicle.drivetrain !== 'AWD' && vehicle.drivetrain !== '4WD') failures.push('Deal breaker: AWD / 4WD required');
  if (mustHaves.mustFitCarSeat && !hasCarSeat) failures.push('Deal breaker: car-seat fit not confirmed');
  if (mustHaves.mustBeUnderBudget && maxMonthlyPayment && estimateMonthlyPayment(vehicle) > maxMonthlyPayment) failures.push('Deal breaker: over monthly budget');
  if (mustHaves.mustHaveHybrid && !isHybrid) failures.push('Deal breaker: hybrid/electric required');
  if (mustHaves.mustHaveHeatedRearSeats && !vehicle.hasHeatedRearSeats) failures.push('Deal breaker: heated rear seats required');
  if (mustHaves.mustHaveMemorySeats && !vehicle.hasMemorySeats) failures.push('Deal breaker: memory seats required');
  if (mustHaves.mustHaveSpareTire && vehicle.hasSpareTire === false) failures.push('Deal breaker: spare tire required');
  if (mustHaves.mustAvoidCvt && vehicle.hasCvt) failures.push('Deal breaker: CVT avoided');
  if (mustHaves.mustHavePhysicalClimateControls && vehicle.physicalClimateControls === false) failures.push('Deal breaker: physical climate controls required');
  return failures;
}

function SavedFilterPresets({ onApply }: { onApply: (patch: Partial<Filters>) => void }) {
  const presets: Array<{ label: string; patch: Partial<Filters> }> = [
    { label: 'Budget-friendly', patch: { maxPrice: 38000, maxMonthlyPayment: 650 } },
    { label: 'Best for winter', patch: { drivetrain: 'AWD', mustHaveAwd: true } },
    { label: 'Hybrid only', patch: { powertrain: 'Hybrid', mustHaveHybrid: true } },
    { label: '3-row options', patch: { bodyStyle: 'Midsize SUV', minSeats: 6 } },
    { label: 'Shortlist', patch: { stage: 'Shortlisted' } },
    { label: 'Rejected hidden', patch: { stage: 'All', hideRejected: true } },
    { label: 'Needs test drive', patch: { stage: 'Browsing' } },
  ];
  return <div className="saved-views"><span>Saved views</span>{presets.map((preset) => <button type="button" key={preset.label} onClick={() => onApply(preset.patch)}>{preset.label}</button>)}</div>;
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
  return <form className="card sliders" onSubmit={(event: FormEvent) => event.preventDefault()}><div className="section-heading"><p className="eyebrow">{profileName}'s priorities</p><span>{saveState}</span></div><h2>Balance what matters most for {profileName}.</h2><p className="edit-warning">You are editing {profileName}'s universal priorities. These values are visible across sessions and devices.</p>{sliderConfig.map((slider) => <label className="slider-row" key={slider.key}><span className="slider-label"><strong>{slider.label}</strong><small>{slider.help}</small></span><input type="range" min="1" max="10" value={draftWeights[slider.key]} onChange={(event) => { setHasUserEdited(true); setDraftWeights((current) => ({ ...current, [slider.key]: Number(event.target.value) })); }} /><b>{draftWeights[slider.key]}</b></label>)}</form>;
}

function Dashboard({ scoredVehicles, quotes, readinessByVehicle, combinedWeights, loading, error, partnerCount, onSelectVehicle }: { scoredVehicles: ScoredVehicle[]; quotes: DealQuoteDocument[]; readinessByVehicle: Record<string, VehicleReadiness>; combinedWeights: CriteriaWeights; loading: boolean; error?: string; partnerCount: number; onSelectVehicle: (vehicleId: string) => void; }) {
  const weights = [
    { label: 'Space', value: combinedWeights.space },
    { label: 'Winter', value: combinedWeights.winterTraction },
    { label: 'Value', value: combinedWeights.valueMSRP },
    { label: 'Reliability', value: combinedWeights.reliability },
    { label: 'Efficiency', value: combinedWeights.fuelEfficiency },
    { label: 'Safety', value: combinedWeights.safetyTech },
    { label: 'Comfort', value: combinedWeights.comfort },
  ];
  return <section className="card dashboard"><div className="section-heading"><p className="eyebrow">Live ranking</p><span>{partnerCount} partner profiles connected</span></div><h2>Recommendation Score</h2>{loading && <p className="muted">Preparing shared profile scoring...</p>}{error && <p className="error-text">Preference stream error: {error}</p>}<div className="weight-summary" aria-label="Combined recommendation priorities">{weights.map((weight) => <span className="weight-chip" key={weight.label}><small>{weight.label}</small><strong>{weight.value.toFixed(1)}</strong><em><i style={{ width: `${weight.value * 10}%` }} /></em></span>)}</div><div className="bars">{scoredVehicles.slice(0, 8).map((vehicle) => <button className="vehicle-row" key={vehicle.id} onClick={() => onSelectVehicle(vehicle.id)}><span><strong>{vehicle.name}</strong><small>{actualVehiclePriceLabel(vehicle, quotes)} ${actualVehiclePrice(vehicle, quotes).toLocaleString('en-CA')} • match {vehicle.familyCompatibilityScore} • confidence {vehicle.confidenceScore}</small><small className="readiness-inline">{readinessByVehicle[vehicle.id]?.status ?? 'Needs evidence'} • {readinessByVehicle[vehicle.id]?.score ?? 0}% ready</small></span><span className="bar-shell"><span className="bar-fill" style={{ width: `${vehicle.overallRecommendationScore}%` }} /></span><b>{vehicle.overallRecommendationScore}</b></button>)}</div></section>;
}

function PriorityComparison({ profileWeights, profileMeta }: { profileWeights: Record<ProfileName, CriteriaWeights>; profileMeta: Record<ProfileName, ProfilePreferenceMeta> }) {
  return <section className="card priority-board"><div className="section-heading"><div><p className="eyebrow">Shared priority board</p><h2>See each other's priorities.</h2></div><span>Universal profile priorities</span></div><p className="muted">Emily and Nick's sliders are universal profile settings, so any connected session or device can see the same saved values after Firestore syncs.</p><div className="priority-columns">{profileNames.map((profileName) => <article className={`priority-card profile-${profileName.toLowerCase()}`} key={profileName}><strong>{profileName}</strong><small>Last updated by {profileMeta[profileName].updatedByProfile ?? 'unknown'}{profileMeta[profileName].version ? ` • v${profileMeta[profileName].version}` : ''}</small>{sliderConfig.map((slider) => <div className="priority-meter" key={`${profileName}-${slider.key}`}><span>{slider.label}</span><b>{profileWeights[profileName][slider.key]}</b><em><i style={{ width: `${profileWeights[profileName][slider.key] * 10}%` }} /></em></div>)}</article>)}</div></section>;
}

function VehicleBrowser({ filters, onFiltersChange, mustHaves, onMustHavesChange, vehicles, readinessByVehicle, quotes, activeProfile, favorites, selectedVehicleIds, notes, onToggleFavorite, onToggleCompare, onSelectVehicle }: { filters: Filters; onFiltersChange: (filters: Filters) => void; mustHaves: MustHaveSettings; onMustHavesChange: (settings: MustHaveSettings) => void; vehicles: ScoredVehicle[]; readinessByVehicle: Record<string, VehicleReadiness>; quotes: DealQuoteDocument[]; activeProfile: ProfileName; favorites: string[]; selectedVehicleIds: string[]; notes: Record<string, VehicleNoteDocument>; onToggleFavorite: (vehicleId: string) => void; onToggleCompare: (vehicleId: string) => void; onSelectVehicle: (vehicleId: string) => void; }) {
  const activeFilterCount = [filters.bodyStyle !== 'All', filters.drivetrain !== 'All', filters.powertrain !== 'All', filters.stage !== 'All', filters.minSeats > 0, filters.maxMonthlyPayment > 0, filters.hideRejected, ...Object.values(mustHaves)].filter(Boolean).length;
  return (
    <section className="card stack browser-panel">
      <div className="section-heading"><div><p className="eyebrow">Browse models</p><h2>Find the right shortlist.</h2></div><span>{vehicles.length} matches</span></div>
      <label className="field-control browse-search"><span>Search</span><input value={filters.query} onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })} placeholder="Search make or model" /></label>
      <SavedFilterPresets onApply={(patch) => onFiltersChange({ ...filters, ...patch })} />
      <details className="filter-drawer">
        <summary><span>Filters, budget & deal breakers</span><b>{activeFilterCount ? `${activeFilterCount} active` : 'Optional'}</b></summary>
        <div className="filters advanced-filters">
          <SelectControl label="Body style" value={filters.bodyStyle} onChange={(value) => onFiltersChange({ ...filters, bodyStyle: value as 'All' | BodyStyle })} options={bodyStyleOptions} />
          <SelectControl label="Drivetrain" value={filters.drivetrain} onChange={(value) => onFiltersChange({ ...filters, drivetrain: value as 'All' | Drivetrain })} options={drivetrainOptions} />
          <SelectControl label="Powertrain" value={filters.powertrain} onChange={(value) => onFiltersChange({ ...filters, powertrain: value as 'All' | Powertrain })} options={powertrainOptions} />
          <SelectControl label="Stage" value={filters.stage} onChange={(value) => onFiltersChange({ ...filters, stage: value as 'All' | VehicleStage })} options={['All', ...stageOptions]} />
          <label className="field-control"><span>Min seats</span><input type="number" value={filters.minSeats} onChange={(event) => onFiltersChange({ ...filters, minSeats: Number(event.target.value) })} /></label>
        </div>
        <div className="budget-panel">
          <div><p className="eyebrow">Budget preferences</p><strong>Price and payment constraints</strong></div>
          <label className="field-control"><span>Max monthly</span><input type="number" value={filters.maxMonthlyPayment} onChange={(event) => onFiltersChange({ ...filters, maxMonthlyPayment: Number(event.target.value) })} placeholder="$ / mo" /></label>
          <label className="range-control"><span>Max total price <b>${filters.maxPrice.toLocaleString('en-CA')}</b></span><input type="range" min="30000" max="95000" step="1000" value={filters.maxPrice} onChange={(event) => onFiltersChange({ ...filters, maxPrice: Number(event.target.value) })} /></label>
        </div>
        <div className="must-have-panel"><div><p className="eyebrow">Must-haves & deal breakers</p><strong>Mark requirements that can disqualify a vehicle.</strong></div><div className="toggle-row">{(Object.keys(mustHaveLabels) as MustHaveKey[]).map((key) => <PillToggle key={key} checked={mustHaves[key]} onChange={(checked) => onMustHavesChange({ ...mustHaves, [key]: checked })}>{mustHaveLabels[key]}</PillToggle>)}</div></div>
        <div className="toggle-row" aria-label="Requirement filters">
          <PillToggle checked={filters.mustHaveAwd} onChange={(checked) => onFiltersChange({ ...filters, mustHaveAwd: checked })}>AWD / 4WD required</PillToggle>
          <PillToggle checked={filters.mustHaveHybrid} onChange={(checked) => onFiltersChange({ ...filters, mustHaveHybrid: checked })}>Hybrid / electric required</PillToggle>
          <PillToggle checked={filters.mustFitCarSeat} onChange={(checked) => onFiltersChange({ ...filters, mustFitCarSeat: checked })}>Car seat tested</PillToggle>
          <PillToggle checked={filters.hideRejected} onChange={(checked) => onFiltersChange({ ...filters, hideRejected: checked })}>Hide rejected</PillToggle>
        </div>
      </details>
      <div className="vehicle-cards">{vehicles.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} readiness={readinessByVehicle[vehicle.id]} actualPrice={actualVehiclePrice(vehicle, quotes)} actualPriceLabel={actualVehiclePriceLabel(vehicle, quotes)} isFavorite={favorites.includes(vehicle.id)} isCompared={selectedVehicleIds.includes(vehicle.id)} activeProfile={activeProfile} note={notes[vehicle.id] ?? emptyVehicleNote(vehicle.id)} onToggleFavorite={() => onToggleFavorite(vehicle.id)} onToggleCompare={() => onToggleCompare(vehicle.id)} onSelect={() => onSelectVehicle(vehicle.id)} />)}</div>
    </section>
  );
}

function SelectControl({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="field-control select-control"><span>{label}</span><div className="select-shell"><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></div></label>;
}

function PillToggle({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: string }) {
  return <label className={`pill-toggle ${checked ? 'active' : ''}`}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span aria-hidden="true" />{children}</label>;
}

function VehicleCard({ vehicle, readiness, actualPrice, actualPriceLabel, isFavorite, isCompared, activeProfile, note, onToggleFavorite, onToggleCompare, onSelect }: { vehicle: ScoredVehicle; readiness?: VehicleReadiness; actualPrice: number; actualPriceLabel: string; isFavorite: boolean; isCompared: boolean; activeProfile: ProfileName; note: VehicleNoteDocument; onToggleFavorite: () => void; onToggleCompare: () => void; onSelect: () => void }) {
  return <article className="vehicle-card"><button className="star-button" onClick={onToggleFavorite} aria-label={`${isFavorite ? 'Remove from' : 'Add to'} ${activeProfile}'s favourites`}>{isFavorite ? '★' : '☆'}</button><button className="compare-toggle" onClick={onToggleCompare}>{isCompared ? '✓ Compare' : '+ Compare'}</button><button className="vehicle-card-main" onClick={onSelect}><VehicleImage vehicle={vehicle} /><strong>{vehicle.name}</strong><span>{actualPriceLabel} ${actualPrice.toLocaleString('en-CA')} • {vehicle.drivetrain} • {vehicle.powertrain}</span><span>{note.stage} • {activeProfile}: {note.reactions[activeProfile]}</span><b>{vehicle.overallRecommendationScore}/100</b>{readiness && <span className={`readiness-badge ${readiness.blocked ? 'blocked' : readiness.score >= 85 ? 'ready' : ''}`}>{readiness.status} • {readiness.score}%</span>}</button></article>;
}

function VehicleImage({ vehicle }: { vehicle: ScoredVehicle }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (vehicle.imageUrl && !imageFailed) return <img className="vehicle-photo" src={vehicle.imageUrl} alt={`${vehicle.name} exterior`} loading="lazy" onError={() => setImageFailed(true)} />;
  return <div className="vehicle-photo photo-fallback"><strong>{vehicle.make}</strong><span>Open manufacturer gallery</span></div>;
}


function defaultTrimOptions(vehicle: ScoredVehicle): VehicleTrimOption[] {
  const midPrice = Math.round(vehicle.msrp * 1.1);
  const topPrice = Math.round(vehicle.msrp * 1.22);
  return [
    { name: 'Entry / core trim', price: vehicle.msrp, powertrain: vehicle.powertrain, drivetrain: vehicle.drivetrain, keyFeatures: ['Core safety tech', `${vehicle.seats} seats`, vehicle.fuelEfficiency] },
    { name: 'Family sweet spot', price: midPrice, powertrain: vehicle.powertrain, drivetrain: vehicle.drivetrain, keyFeatures: ['Convenience package', 'Heated seats', 'Power liftgate or equivalent'] },
    { name: 'Top comfort trim', price: topPrice, powertrain: vehicle.powertrain, drivetrain: vehicle.drivetrain, keyFeatures: ['Premium cabin upgrades', 'More driver assistance', 'Best audio/comfort options'] },
  ];
}

function VehicleProfile({ vehicle, activeProfile, isFavorite, note, quotes, entries, onToggleFavorite, onNoteChange }: { vehicle: ScoredVehicle; activeProfile: ProfileName; isFavorite: boolean; note: VehicleNoteDocument; quotes: DealQuoteDocument[]; entries: TestDriveEntry[]; onToggleFavorite: () => void; onNoteChange: (patch: Partial<VehicleNoteDocument>) => void }) {
  const bestQuote = quotes.sort((a, b) => quoteNetPrice(a) - quoteNetPrice(b))[0];
  const trimOptions = vehicle.trimOptions?.length ? vehicle.trimOptions : defaultTrimOptions(vehicle);
  return <section id="vehicle-profile" className="card profile"><VehicleImage vehicle={vehicle} /><div><div className="section-heading"><p className="eyebrow">Model profile</p><button className="star-inline" onClick={onToggleFavorite}>{isFavorite ? '★' : '☆'} {activeProfile}'s favourite</button></div><h2>{vehicle.year} {vehicle.name}</h2><div className="spec-grid"><span>{actualVehiclePriceLabel(vehicle, quotes)} <b>${actualVehiclePrice(vehicle, quotes).toLocaleString('en-CA')}</b></span><span>MSRP <b>${vehicle.msrp.toLocaleString('en-CA')}</b></span><span>Overall <b>{vehicle.overallRecommendationScore}</b></span><span>Confidence <b>{vehicle.confidenceScore}</b></span><span>Test drive <b>{vehicle.testDriveScore}</b></span><span>Deal <b>{vehicle.dealScore}</b></span><span>Est. monthly <b>${estimateMonthlyPayment(vehicle)}</b></span><span>Stage <b>{note.stage}</b></span><span>Best quote <b>{bestQuote ? `$${quoteNetPrice(bestQuote).toLocaleString('en-CA')}` : 'None'}</b></span></div><div className="inline-controls"><label>Stage<select value={note.stage} onChange={(event) => onNoteChange({ stage: event.target.value as VehicleStage })}>{stageOptions.map((stage) => <option key={stage}>{stage}</option>)}</select></label><label>{activeProfile} reaction<select value={note.reactions[activeProfile]} onChange={(event) => onNoteChange({ reactions: { ...note.reactions, [activeProfile]: event.target.value as UserReaction } })}>{reactionOptions.map((reaction) => <option key={reaction}>{reaction}</option>)}</select></label></div>{trimOptions.length > 0 && <><h3>Trim options</h3><div className="trim-options">{trimOptions.map((trim) => <article key={trim.name}><div><strong>{trim.name}</strong><span>${trim.price.toLocaleString('en-CA')} MSRP</span></div><small>{trim.drivetrain} • {trim.powertrain}</small><ul>{trim.keyFeatures.map((feature) => <li key={feature}>{feature}</li>)}</ul></article>)}</div></>}<h3>Why it fits</h3><ul>{vehicle.highlights.map((item) => <li key={item}>{item}</li>)}</ul><h3>Watch-outs</h3><ul>{vehicle.tradeoffs.map((item) => <li key={item}>{item}</li>)}</ul><h3>Ownership estimate</h3><p className="muted">Approx. monthly fuel + maintenance planning: ${(estimateOwnershipCost(vehicle)).toLocaleString('en-CA')} / month, before insurance and parking.</p><label className="shared-note">Shared notes<textarea value={note.sharedNote} onChange={(event) => onNoteChange({ sharedNote: event.target.value })} placeholder="Add shared observations, must-have trim notes, dealer quotes, or partner comments..." /></label><a href={vehicle.manufacturerUrl} target="_blank" rel="noreferrer">Open manufacturer page / gallery</a><small>Photo/source: {vehicle.photoCredit}</small><div className="mini-summary"><span>{entries.length} test drives</span><span>{quotes.length} quotes</span><span>Emily: {note.reactions.Emily}</span><span>Nick: {note.reactions.Nick}</span></div></div></section>;
}

function DealTracker({ vehicles, quotes, onSaveQuote }: { vehicles: ScoredVehicle[]; quotes: DealQuoteDocument[]; onSaveQuote: (quote: DealQuoteDocument) => void }) {
  const [draft, setDraft] = useState<DealQuoteDocument>(defaultDealQuote(vehicles[0]?.id ?? ''));
  useEffect(() => { if (!draft.vehicleId && vehicles[0]) setDraft(defaultDealQuote(vehicles[0].id)); }, [draft.vehicleId, vehicles]);
  function submit(event: FormEvent) { event.preventDefault(); onSaveQuote(draft); setDraft({ ...defaultDealQuote(draft.vehicleId), dealer: draft.dealer }); }
  return <section className="card stack"><div className="section-heading"><p className="eyebrow">Deal tracker</p><span>{quotes.length} saved quotes</span></div><form className="calculator-grid deal-form" onSubmit={submit}><label>Vehicle<select value={draft.vehicleId} onChange={(event) => setDraft({ ...draft, vehicleId: event.target.value })}>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}</select></label><label>Dealer<input value={draft.dealer} onChange={(event) => setDraft({ ...draft, dealer: event.target.value })} /></label><label>Trim<input value={draft.trim} onChange={(event) => setDraft({ ...draft, trim: event.target.value })} /></label><label>Price<input type="number" value={draft.price} onChange={(event) => setDraft({ ...draft, price: Number(event.target.value) })} /></label><label>Discount<input type="number" value={draft.discount} onChange={(event) => setDraft({ ...draft, discount: Number(event.target.value) })} /></label><label>Fees<input type="number" value={draft.fees} onChange={(event) => setDraft({ ...draft, fees: Number(event.target.value) })} /></label><label>Accessories<input type="number" value={draft.accessories} onChange={(event) => setDraft({ ...draft, accessories: Number(event.target.value) })} /></label><label>Trade-in<input type="number" value={draft.tradeIn} onChange={(event) => setDraft({ ...draft, tradeIn: Number(event.target.value) })} /></label><label>Finance %<input type="number" value={draft.financeRate} onChange={(event) => setDraft({ ...draft, financeRate: Number(event.target.value) })} /></label><label>Lease %<input type="number" value={draft.leaseRate} onChange={(event) => setDraft({ ...draft, leaseRate: Number(event.target.value) })} /></label><label>Quote expiry<input type="date" value={draft.expiryDate} onChange={(event) => setDraft({ ...draft, expiryDate: event.target.value })} /></label><label>Contact<input value={draft.contact} onChange={(event) => setDraft({ ...draft, contact: event.target.value })} /></label><label>Listing URL<input value={draft.listingUrl} onChange={(event) => setDraft({ ...draft, listingUrl: event.target.value })} /></label><label>Used year<input type="number" value={draft.usedYear ?? ''} onChange={(event) => setDraft({ ...draft, usedYear: Number(event.target.value) })} /></label><label>Mileage km<input type="number" value={draft.mileageKm ?? ''} onChange={(event) => setDraft({ ...draft, mileageKm: Number(event.target.value) })} /></label><label>Accident history<input value={draft.accidentHistory ?? ''} onChange={(event) => setDraft({ ...draft, accidentHistory: event.target.value })} /></label><label className="check"><input type="checkbox" checked={draft.cpo ?? false} onChange={(event) => setDraft({ ...draft, cpo: event.target.checked })} /> Certified pre-owned</label><label className="wide">Inspection notes<textarea value={draft.inspectionNotes ?? ''} onChange={(event) => setDraft({ ...draft, inspectionNotes: event.target.value })} /></label><button type="submit">Save quote</button></form><div className="quote-list">{quotes.map((quote) => <article key={quote.id ?? `${quote.vehicleId}-${quote.dealer}`}><strong>{vehicles.find((vehicle) => vehicle.id === quote.vehicleId)?.name ?? quote.vehicleId} • {quote.dealer || 'Dealer TBD'}</strong><span>{quote.trim || 'Trim TBD'} • net ${quoteNetPrice(quote).toLocaleString('en-CA')} • finance {quote.financeRate}% • expires {quote.expiryDate || 'not set'}</span><small>{quote.listingUrl && <a href={quote.listingUrl} target="_blank" rel="noreferrer">Listing</a>} {quote.usedYear ? `Used ${quote.usedYear}, ${quote.mileageKm?.toLocaleString('en-CA') ?? 0} km` : 'New quote'}</small></article>)}</div></section>;
}

function defaultDiaryDraft(vehicleId: string): TestDriveEntry { return { vehicleId, date: new Date().toISOString().slice(0, 10), appointmentTime: '', reminderDate: '', dealer: '', notes: '', carSeatFits: false, strollerFits: false, doorsOpen90: false, passengerLegroom: false, cargoFloorWorks: false, winterTireQuote: false, outTheDoorQuote: false, prepaymentRules: false, winterConfidence: 5, partnerRating: 5, photoUrls: [], status: 'Planned' }; }
function defaultDealQuote(vehicleId: string): DealQuoteDocument { return { vehicleId, dealer: '', trim: '', price: CANADIAN_VEHICLES.find((vehicle) => vehicle.id === vehicleId)?.msrp ?? 0, discount: 0, fees: 2495, accessories: 0, tradeIn: 0, financeRate: 5.99, leaseRate: 6.49, expiryDate: '', contact: '', listingUrl: '', usedYear: undefined, mileageKm: undefined, accidentHistory: '', cpo: false, inspectionNotes: '' }; }
function toggleProfileFavorite(current: Record<ProfileName, string[]>, profile: ProfileName, vehicleId: string) { const currentFavorites = current[profile]; return { ...current, [profile]: currentFavorites.includes(vehicleId) ? currentFavorites.filter((favoriteId) => favoriteId !== vehicleId) : [...currentFavorites, vehicleId] }; }
function toggleCompareVehicle(current: string[], vehicleId: string) { return current.includes(vehicleId) ? current.filter((id) => id !== vehicleId) : [vehicleId, ...current].slice(0, 4); }
function quoteNetPrice(quote: DealQuoteDocument) { return Math.max(quote.price - quote.discount + quote.fees + quote.accessories - quote.tradeIn, 0); }
function estimateOwnershipCost(vehicle: ScoredVehicle) { return Math.round((vehicle.powertrain.includes('Hybrid') ? 120 : 175) + 90 + (vehicle.msrp * 0.0008)); }
function enrichScores(vehicles: ScoredVehicle[], entries: TestDriveEntry[], quotes: DealQuoteDocument[]) { return vehicles.map((vehicle) => { const vehicleEntries = entries.filter((entry) => entry.vehicleId === vehicle.id); const vehicleQuotes = quotes.filter((quote) => quote.vehicleId === vehicle.id); const testDriveScore = vehicleEntries.length ? Math.round(vehicleEntries.reduce((sum, entry) => sum + entry.partnerRating * 7 + entry.winterConfidence * 3 + (entry.carSeatFits ? 5 : 0) + (entry.strollerFits ? 5 : 0), 0) / vehicleEntries.length) : vehicle.testDriveScore; const bestNet = vehicleQuotes.length ? Math.min(...vehicleQuotes.map(quoteNetPrice)) : vehicle.msrp; const dealScore = vehicleQuotes.length ? Math.max(60, Math.min(100, Math.round(100 - ((bestNet - vehicle.msrp) / vehicle.msrp) * 100))) : vehicle.dealScore; const confidenceScore = Math.min(100, vehicle.confidenceScore + Math.min(vehicleEntries.length * 4, 12) + Math.min(vehicleQuotes.length * 3, 9)); return { ...vehicle, testDriveScore, dealScore, confidenceScore, overallRecommendationScore: Math.round(vehicle.familyCompatibilityScore * 0.45 + confidenceScore * 0.2 + testDriveScore * 0.2 + dealScore * 0.15) }; }).sort((a, b) => b.overallRecommendationScore - a.overallRecommendationScore); }

export default App;
