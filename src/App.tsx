import { recommendationLabel, fitSummary } from "./domain/recommendations";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { signInAnonymously, type User } from "firebase/auth";
import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { useAuthState } from "react-firebase-hooks/auth";
import { useCollection } from "react-firebase-hooks/firestore";
import { auth, db } from "./firebase";
import {
  averagePartnerWeights,
  CANADIAN_VEHICLES,
  DEFAULT_WEIGHTS,
  scoreVehicles,
} from "./scoring";
import type {
  BodyStyle,
  CriteriaKey,
  CriteriaWeights,
  DealQuoteDocument,
  Drivetrain,
  Powertrain,
  ProfileName,
  ScoredVehicle,
  SessionDocument,
  TestDriveEntry,
  UserPreferenceDocument,
  UserReaction,
  VehicleNoteDocument,
  VehicleStage,
} from "./types";
import { CompareTray } from "./components/CompareTray";
import { ComparisonTable as EnhancedComparisonTable } from "./components/ComparisonTable";
import { PaymentCalculator as EnhancedPaymentCalculator } from "./components/PaymentCalculator";
import { TestDriveDiary as EnhancedTestDriveDiary } from "./components/TestDriveDiary";
import { lazy, Suspense } from "react";
const SenStatsDashboard = lazy(() =>
  import("./components/SenStatsDashboard").then((m) => ({
    default: m.SenStatsDashboard,
  })),
);
import {
  DealTracker,
  defaultDealQuote as makeDealQuote,
} from "./components/DealTracker";
import { defaultDiaryDraft as makeDiaryDraft } from "./components/TestDriveDiary";
import { HomeDashboard } from "./components/HomeDashboard";
import { VehicleDetails } from "./components/VehicleDetails";
import {
  actualVehiclePrice,
  actualVehiclePriceLabel,
  estimateMonthlyPayment,
  resolveFinance,
  DEFAULT_FINANCE,
  type FinanceSettings,
  type PurchaseSelection,
} from "./domain/finance";
import { enrichScores } from "./domain/evidence";
import {
  mustHaveLabels,
  vehicleReadiness,
  type MustHaveKey,
  type MustHaveSettings,
  type VehicleReadiness,
} from "./domain/readiness";
import { useLocalStorageState } from "./hooks/useLocalStorageState";
import "./styles.css";

const sliderConfig: Array<{ key: CriteriaKey; label: string; help: string }> = [
  {
    key: "space",
    label: "Car Seat & Cabin Space",
    help: "Second-row room, cargo access, and family ergonomics.",
  },
  {
    key: "winterTraction",
    label: "Winter Traction",
    help: "Snow confidence, AWD behavior, and cold-weather stability.",
  },
  {
    key: "valueMSRP",
    label: "Value & MSRP Budget",
    help: "Purchase price, features per dollar, and resale value.",
  },
  {
    key: "reliability",
    label: "Long-Term Reliability",
    help: "Dependable ownership and fewer surprise repairs.",
  },
  {
    key: "fuelEfficiency",
    label: "Fuel Economy & Hybrid Efficiency",
    help: "Lower fuel use and electrified options.",
  },
  {
    key: "safetyTech",
    label: "Safety & Driver Assistance",
    help: "Active safety, visibility, and family protection.",
  },
  {
    key: "comfort",
    label: "Ride Comfort & Quiet Cabin",
    help: "Calm highway manners, supportive seats, and low road noise.",
  },
];

const bodyStyleOptions: Array<"All" | BodyStyle> = [
  "All",
  "Compact SUV",
  "Midsize SUV",
  "Wagon",
];
const drivetrainOptions: Array<"All" | Drivetrain> = [
  "All",
  "AWD",
  "FWD",
  "4WD",
];
const powertrainOptions: Array<"All" | Powertrain> = [
  "All",
  "Gas",
  "Hybrid",
  "Plug-in Hybrid",
  "Electric",
];
const profileNames: ProfileName[] = ["Emily", "Nick"];
const stageOptions: VehicleStage[] = [
  "Browsing",
  "Shortlisted",
  "Test drive booked",
  "Test driven",
  "Quote received",
  "Finalist",
  "Rejected",
  "Winner",
];
const reactionOptions: UserReaction[] = ["Unrated", "Love", "Maybe", "No"];
type AppSection =
  | "dashboard"
  | "browse"
  | "compare"
  | "calculator"
  | "deals"
  | "diary"
  | "decision";
type WorkspaceApp = "CarMatch" | "SenStats" | "AppSelection";

const sectionLabels: Record<AppSection, string> = {
  dashboard: "Home",
  browse: "Browse vehicles",
  compare: "Compare",
  calculator: "Payment calculator",
  deals: "Deal tracker",
  diary: "Test drive diary",
  decision: "Decision Room",
};

interface Filters {
  query: string;
  bodyStyle: "All" | BodyStyle;
  drivetrain: "All" | Drivetrain;
  powertrain: "All" | Powertrain;
  maxPrice: number;
  minSeats: number;
  mustHaveAwd: boolean;
  mustHaveHybrid: boolean;
  mustFitCarSeat: boolean;
  maxMonthlyPayment: number;
  stage: "All" | VehicleStage;
  hideRejected: boolean;
}

const defaultFilters: Filters = {
  query: "",
  bodyStyle: "All",
  drivetrain: "All",
  powertrain: "All",
  maxPrice: 70000,
  minSeats: 0,
  mustHaveAwd: false,
  mustHaveHybrid: false,
  mustFitCarSeat: false,
  maxMonthlyPayment: 0,
  stage: "All",
  hideRejected: false,
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

interface ProfilePreferenceMeta {
  updatedByUid?: string;
  updatedByProfile?: ProfileName;
  version?: number;
}

function getSessionIdFromUrl() {
  return new URLSearchParams(window.location.search).get("session");
}

function readSessionId() {
  try {
    return localStorage.getItem("carmatch.sessionId");
  } catch {
    return null;
  }
}

function emptyVehicleNote(vehicleId: string): VehicleNoteDocument {
  return {
    vehicleId,
    sharedNote: "",
    stage: "Browsing",
    reactions: { Emily: "Unrated", Nick: "Unrated" },
  };
}

function App() {
  const [user, authLoading, authError] = useAuthState(auth);
  const [anonymousSignInError, setAnonymousSignInError] = useState<
    string | null
  >(null);
  const [authAttempt, setAuthAttempt] = useState(0);

  useEffect(() => {
    if (authLoading || user) return;
    void signInAnonymously(auth)
      .then(() => setAnonymousSignInError(null))
      .catch((error: unknown) => {
        setAnonymousSignInError(
          error instanceof Error ? error.message : "Anonymous sign-in failed.",
        );
      });
  }, [authLoading, user, authAttempt]);

  const authFailureMessage = authError?.message ?? anonymousSignInError;
  if (authFailureMessage) {
    return (
      <main className="shell error">
        <section className="card">
          <p className="eyebrow">Connection interrupted</p>
          <h1>We couldn’t open your shared workspace.</h1>
          <p>
            Check your connection and try again. Your saved data stays in your
            existing session.
          </p>
          <button
            onClick={() => {
              setAnonymousSignInError(null);
              setAuthAttempt((n) => n + 1);
            }}
          >
            Retry connection
          </button>
          <details>
            <summary>Connection details</summary>
            <p>{authFailureMessage}</p>
          </details>
        </section>
      </main>
    );
  }
  if (authLoading || !user)
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        Initializing secure session...
      </div>
    );
  return <AuthenticatedSession activeUser={user} />;
}

function AppSelectionPage({
  onSelectApp,
}: {
  onSelectApp: (app: WorkspaceApp) => void;
}) {
  return (
    <main className="shell app-selector-shell">
      <section className="card app-selector">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>Choose an app</h2>
          </div>
          <span>Use the app menu to switch at any time.</span>
        </div>
        <div className="app-tiles">
          <button type="button" onClick={() => onSelectApp("CarMatch")}>
            <strong>CarMatch</strong>
            <span>
              Vehicle research, scoring, notes, quotes, and test-drive planning.
            </span>
            <small>Open existing app</small>
          </button>
          <button type="button" onClick={() => onSelectApp("SenStats")}>
            <strong>SenStats</strong>
            <span>Explore Canadian senators and expenses.</span>
            <small>Open SenStats</small>
          </button>
        </div>
      </section>
    </main>
  );
}

function SenStatsApp({
  onOpenAppSelection,
  onBackToCarMatch,
}: {
  onOpenAppSelection: () => void;
  onBackToCarMatch: () => void;
}) {
  return (
    <main className="shell senstats-shell">
      <section className="hero card">
        <div className="hero-topline">
          <button
            className="app-name senstats-name"
            type="button"
            onClick={onOpenAppSelection}
            aria-label="Switch app"
          >
            SenStats
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={onBackToCarMatch}
          >
            Back to CarMatch
          </button>
        </div>
      </section>
      <section className="card blank-app">
        <Suspense fallback={<p>Loading SenStats…</p>}>
          <SenStatsDashboard />
        </Suspense>
      </section>
    </main>
  );
}

function AuthenticatedSession({ activeUser }: { activeUser: User }) {
  const [sessionId, setSessionId] = useState<string | null>(
    () => getSessionIdFromUrl() ?? readSessionId(),
  );
  const [session, setSession] = useState<SessionDocument | null>(null);
  const [sessionStatus, setSessionStatus] = useState(
    "Preparing your shared profile...",
  );
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [filters, setFilters] = useLocalStorageState<Filters>(
    "carmatch.filters",
    defaultFilters,
  );
  const [mustHaves, setMustHaves] = useLocalStorageState<MustHaveSettings>(
    "carmatch.mustHaves",
    defaultMustHaves,
  );
  const [selectedVehicleIds, setSelectedVehicleIds] = useLocalStorageState<
    string[]
  >(
    "carmatch.compareVehicleIds",
    CANADIAN_VEHICLES.slice(0, 3).map((vehicle) => vehicle.id),
  );
  const [viewedVehicleId, setViewedVehicleId] = useState<string | null>(null);
  const [reviewRequested, setReviewRequested] = useState(false);
  const [formVehicleId, setFormVehicleId] = useState<string | undefined>();
  const [calculatorVehicleId, setCalculatorVehicleId] = useLocalStorageState(
    "carmatch.calculatorVehicle",
    CANADIAN_VEHICLES[0].id,
  );
  const [financeSettings, setFinanceSettings, financeStorageError] =
    useLocalStorageState<FinanceSettings>(
      "carmatch.financeSettings",
      DEFAULT_FINANCE,
    );
  const [purchaseSelections, setPurchaseSelections, selectionStorageError] =
    useLocalStorageState<Record<string, PurchaseSelection>>(
      "carmatch.purchaseSelections",
      {},
    );
  const [writeStatus, setWriteStatus] = useState("");
  const [writeError, setWriteError] = useState("");
  const retryWrite = useRef<(() => Promise<void>) | null>(null);
  const pendingWrites = useRef(0);
  async function performWrite(action: () => Promise<void>, retryable = true) {
    pendingWrites.current++;
    setWriteStatus("Saving…");
    try {
      await action();
      setWriteStatus("Saved");
    } catch (error) {
      setWriteStatus("Could not save");
      if (retryable) {
        retryWrite.current = action;
        setWriteError(
          error instanceof Error ? error.message : "Could not save.",
        );
      }
      throw error;
    } finally {
      pendingWrites.current--;
      if (pendingWrites.current) setWriteStatus("Saving…");
    }
  }
  const [testDriveEntries, setTestDriveEntries] = useState<TestDriveEntry[]>(
    [],
  );
  const [dealQuotes, setDealQuotes] = useState<DealQuoteDocument[]>([]);
  const [vehicleNotes, setVehicleNotes] = useState<
    Record<string, VehicleNoteDocument>
  >({});
  const [activeSection, setActiveSection] = useLocalStorageState<AppSection>(
    "carmatch.activeSection",
    "dashboard",
  );
  const [activeWorkspaceApp, setActiveWorkspaceApp] =
    useLocalStorageState<WorkspaceApp>("carmatch.workspaceApp", "CarMatch");
  const [compareMessage, setCompareMessage] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeProfile, setActiveProfile] = useLocalStorageState<ProfileName>(
    "carmatch.activeProfile",
    "Emily",
  );
  const [favoritesByProfile, setFavoritesByProfile] = useState<
    Record<ProfileName, string[]>
  >({ Emily: [], Nick: [] });
  const [profileWeights, setProfileWeights] = useState<
    Record<ProfileName, CriteriaWeights>
  >({ Emily: DEFAULT_WEIGHTS, Nick: DEFAULT_WEIGHTS });
  const [profileMeta, setProfileMeta] = useState<
    Record<ProfileName, ProfilePreferenceMeta>
  >({ Emily: {}, Nick: {} });

  const canReadSharedCollections = Boolean(
    sessionId && session?.partnerIds?.includes(activeUser.uid),
  );
  const preferencesQuery = useMemo(
    () =>
      sessionId && canReadSharedCollections
        ? collection(db, "sessions", sessionId, "userPreferences")
        : null,
    [canReadSharedCollections, sessionId],
  );
  const globalPreferencesQuery = useMemo(
    () => collection(db, "profilePreferences"),
    [],
  );
  const notesQuery = useMemo(
    () =>
      sessionId && canReadSharedCollections
        ? collection(db, "sessions", sessionId, "vehicleNotes")
        : null,
    [canReadSharedCollections, sessionId],
  );
  const diaryQuery = useMemo(
    () =>
      sessionId && canReadSharedCollections
        ? collection(db, "sessions", sessionId, "testDriveDiary")
        : null,
    [canReadSharedCollections, sessionId],
  );
  const quotesQuery = useMemo(
    () =>
      sessionId && canReadSharedCollections
        ? collection(db, "sessions", sessionId, "dealQuotes")
        : null,
    [canReadSharedCollections, sessionId],
  );
  const [preferencesSnapshot, preferencesLoading, preferencesError] =
    useCollection(preferencesQuery as any);
  const [globalPreferencesSnapshot, , globalPreferencesError] = useCollection(
    globalPreferencesQuery as any,
  );
  const [notesSnapshot, , notesError] = useCollection(notesQuery as any);
  const [diarySnapshot, , diaryError] = useCollection(diaryQuery as any);
  const [quotesSnapshot, , quotesError] = useCollection(quotesQuery as any);

  const profilePreferences = useMemo<UserPreferenceDocument[]>(
    () => [
      {
        userId: "Emily",
        criteriaWeights: profileWeights.Emily,
        personalNotes: {},
        favoriteVehicleIds: favoritesByProfile.Emily,
      },
      {
        userId: "Nick",
        criteriaWeights: profileWeights.Nick,
        personalNotes: {},
        favoriteVehicleIds: favoritesByProfile.Nick,
      },
    ],
    [favoritesByProfile, profileWeights],
  );

  useEffect(() => {
    const nextWeights: Record<ProfileName, CriteriaWeights> = {
      Emily: DEFAULT_WEIGHTS,
      Nick: DEFAULT_WEIGHTS,
    };
    const nextFavorites: Record<ProfileName, string[]> = {
      Emily: [],
      Nick: [],
    };
    const nextMeta: Record<ProfileName, ProfilePreferenceMeta> = {
      Emily: {},
      Nick: {},
    };
    const applyPreferenceDocs = (
      docs?: Array<{ data: () => Partial<UserPreferenceDocument> }>,
    ) => {
      docs?.forEach((preferenceDoc) => {
        const data = preferenceDoc.data();
        if (data.userId === "Emily" || data.userId === "Nick") {
          nextWeights[data.userId] = {
            ...DEFAULT_WEIGHTS,
            ...(data.criteriaWeights ?? {}),
          };
          nextFavorites[data.userId] = data.favoriteVehicleIds ?? [];
          nextMeta[data.userId] = {
            updatedByUid: data.updatedByUid,
            updatedByProfile: data.updatedByProfile,
            version: data.version,
          };
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
    notesSnapshot.docs.forEach(
      (noteDoc: { id: string; data: () => Partial<VehicleNoteDocument> }) => {
        const data = noteDoc.data();
        const vehicleId = data.vehicleId ?? noteDoc.id;
        nextNotes[vehicleId] = {
          ...emptyVehicleNote(vehicleId),
          ...data,
          vehicleId,
          reactions: {
            Emily: "Unrated",
            Nick: "Unrated",
            ...(data.reactions ?? {}),
          },
        };
      },
    );
    setVehicleNotes(nextNotes);
  }, [notesSnapshot]);

  useEffect(() => {
    if (!diarySnapshot) return;
    setTestDriveEntries(
      diarySnapshot.docs.map(
        (entryDoc: { id: string; data: () => Partial<TestDriveEntry> }) => {
          const data = entryDoc.data();
          return {
            ...defaultDiaryDraft(CANADIAN_VEHICLES[0]?.id ?? ""),
            ...data,
            ratings: data.ratings,
            carSeatResult:
              data.carSeatResult ?? (data.carSeatFits ? "Pass" : "Unknown"),
            id: entryDoc.id,
          };
        },
      ),
    );
  }, [diarySnapshot]);

  useEffect(() => {
    if (!quotesSnapshot) return;
    setDealQuotes(
      quotesSnapshot.docs.map(
        (quoteDoc: { id: string; data: () => Partial<DealQuoteDocument> }) => ({
          ...defaultDealQuote(CANADIAN_VEHICLES[0]?.id ?? ""),
          ...quoteDoc.data(),
          id: quoteDoc.id,
        }),
      ),
    );
  }, [quotesSnapshot]);

  useEffect(() => {
    async function bootstrapSession() {
      setSessionStatus("Connecting this device to the shared session...");
      const activeSessionId = sessionId ?? doc(collection(db, "sessions")).id;
      const sessionRef = doc(db, "sessions", activeSessionId);
      const shareLink = `${window.location.origin}/join?session=${activeSessionId}`;
      const snapshot = await getDoc(sessionRef);
      if (!snapshot.exists()) {
        await setDoc(sessionRef, {
          id: activeSessionId,
          dynamicShareLink: shareLink,
          createdAt: serverTimestamp(),
          partnerIds: [activeUser.uid],
          vehiclesShortlist: CANADIAN_VEHICLES.map((vehicle) => vehicle.id),
        });
      } else if (!snapshot.data().partnerIds.includes(activeUser.uid)) {
        await updateDoc(sessionRef, {
          partnerIds: arrayUnion(activeUser.uid),
          dynamicShareLink: shareLink,
        });
      }
      await setDoc(
        doc(db, "sessions", activeSessionId, "userPreferences", activeUser.uid),
        {
          userId: activeUser.uid,
          criteriaWeights: DEFAULT_WEIGHTS,
          personalNotes: {},
          favoriteVehicleIds: [],
        },
        { merge: true },
      );
      const refreshed = await getDoc(sessionRef);
      setSession(refreshed.data() as SessionDocument);
      setSessionId(activeSessionId);
      try {
        localStorage.setItem("carmatch.sessionId", activeSessionId);
      } catch {
        /* The session remains recoverable through its URL. */
      }
      window.history.replaceState({}, "", `/?session=${activeSessionId}`);
      setSessionStatus("connected");
    }
    void bootstrapSession().catch((error: unknown) =>
      setSessionStatus(
        `error: ${error instanceof Error ? error.message : "Unable to initialize the shared session."}`,
      ),
    );
  }, [activeUser.uid, sessionId, sessionAttempt]);

  useEffect(() => {
    async function ensureGlobalProfilePreferenceDocs() {
      await Promise.all(
        profileNames.map(async (profileName) => {
          const preferenceRef = doc(db, "profilePreferences", profileName);
          const snapshot = await getDoc(preferenceRef);
          if (!snapshot.exists())
            await setDoc(preferenceRef, {
              userId: profileName,
              criteriaWeights: DEFAULT_WEIGHTS,
              personalNotes: {},
              favoriteVehicleIds: [],
              updatedAt: serverTimestamp(),
              updatedByUid: activeUser.uid,
              updatedByProfile: profileName,
              version: 1,
            });
        }),
      );
    }
    void ensureGlobalProfilePreferenceDocs().catch((error: unknown) =>
      setSessionStatus(
        error instanceof Error
          ? error.message
          : "Unable to initialize universal profile preferences.",
      ),
    );
  }, [activeUser.uid]);

  useEffect(() => {
    if (!sessionId || !canReadSharedCollections) return;
    const activeSessionId = sessionId;
    async function ensureProfilePreferenceDocs() {
      await Promise.all(
        profileNames.map(async (profileName) => {
          const preferenceRef = doc(
            db,
            "sessions",
            activeSessionId,
            "userPreferences",
            profileName,
          );
          const snapshot = await getDoc(preferenceRef);
          if (!snapshot.exists())
            await setDoc(preferenceRef, {
              userId: profileName,
              criteriaWeights: DEFAULT_WEIGHTS,
              personalNotes: {},
              favoriteVehicleIds: [],
              updatedAt: serverTimestamp(),
              updatedByUid: activeUser.uid,
              updatedByProfile: profileName,
              version: 1,
            });
        }),
      );
    }
    void ensureProfilePreferenceDocs().catch((error: unknown) =>
      setSessionStatus(
        error instanceof Error
          ? error.message
          : "Unable to initialize saved profile preferences.",
      ),
    );
  }, [canReadSharedCollections, sessionId]);

  const saveProfilePreference = useCallback(
    async (
      profileName: ProfileName,
      weights: CriteriaWeights,
      favoriteVehicleIds: string[],
    ) => {
      const preferenceDocument = {
        userId: profileName,
        criteriaWeights: weights,
        personalNotes: {},
        favoriteVehicleIds,
        updatedAt: serverTimestamp(),
        updatedByUid: activeUser.uid,
        updatedByProfile: profileName,
        version: increment(1),
      };
      await performWrite(async () => {
        const writes = [
          setDoc(
            doc(db, "profilePreferences", profileName),
            preferenceDocument,
            { merge: true },
          ),
        ];
        if (sessionId)
          writes.push(
            setDoc(
              doc(db, "sessions", sessionId, "userPreferences", profileName),
              preferenceDocument,
              { merge: true },
            ),
          );
        await Promise.all(writes);
      });
    },
    [activeUser.uid, sessionId],
  );

  const saveVehicleNote = useCallback(
    async (vehicleId: string, patch: Partial<VehicleNoteDocument>) => {
      if (!canReadSharedCollections || !sessionId)
        throw new Error(
          "Still connecting to your shared session. Please retry.",
        );
      const nextPatch = {
        ...patch,
        ...(patch.stage ? { stageSetBy: activeProfile } : {}),
      };
      // Merge only changed fields so a note save cannot overwrite a partner reaction.
      await performWrite(async () => {
        const ref = doc(db, "sessions", sessionId, "vehicleNotes", vehicleId);
        const existing = await getDoc(ref);
        await setDoc(
          ref,
          {
            ...(existing.exists() ? {} : emptyVehicleNote(vehicleId)),
            ...nextPatch,
            vehicleId,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }, false);
    },
    [sessionId, canReadSharedCollections, activeProfile, vehicleNotes],
  );

  const saveDiaryEntry = useCallback(
    async (entry: TestDriveEntry) => {
      if (!canReadSharedCollections || !sessionId)
        throw new Error("Still connecting. Your draft is preserved.");
      const id = entry.id ?? crypto.randomUUID();
      const data = Object.fromEntries(
        Object.entries(entry).filter(([, v]) => v !== undefined),
      );
      await performWrite(
        () =>
          setDoc(
            doc(db, "sessions", sessionId, "testDriveDiary", id),
            {
              ...data,
              id,
              ...(entry.id ? {} : { createdAt: serverTimestamp() }),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          ),
        false,
      );
    },
    [sessionId, canReadSharedCollections],
  );

  const saveDealQuote = useCallback(
    async (quote: DealQuoteDocument) => {
      if (!canReadSharedCollections || !sessionId)
        throw new Error("Still connecting. Your draft is preserved.");
      const id = quote.id ?? crypto.randomUUID();
      const data = Object.fromEntries(
        Object.entries(quote).filter(([, v]) => v !== undefined),
      );
      if (quote.id)
        for (const key of ["usedYear", "mileageKm"] as const)
          if (quote[key] === undefined) data[key] = deleteField();
      await performWrite(
        () =>
          setDoc(
            doc(db, "sessions", sessionId, "dealQuotes", id),
            {
              ...data,
              id,
              ...(quote.id ? {} : { createdAt: serverTimestamp() }),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          ),
        false,
      );
    },
    [sessionId, canReadSharedCollections],
  );

  const handleProfileWeightsChange = useCallback(
    async (profileName: ProfileName, weights: CriteriaWeights) => {
      setProfileWeights((current) => ({ ...current, [profileName]: weights }));
      return saveProfilePreference(
        profileName,
        weights,
        favoritesByProfile[profileName],
      );
    },
    [favoritesByProfile, saveProfilePreference],
  );

  const handleToggleFavorite = useCallback(
    (vehicleId: string) => {
      const next = toggleProfileFavorite(
        favoritesByProfile,
        activeProfile,
        vehicleId,
      );
      setFavoritesByProfile(next);
      void saveProfilePreference(
        activeProfile,
        profileWeights[activeProfile],
        next[activeProfile],
      ).catch(() => {});
    },
    [activeProfile, favoritesByProfile, profileWeights, saveProfilePreference],
  );

  const combinedWeights = useMemo(
    () => averagePartnerWeights(profilePreferences),
    [profilePreferences],
  );
  const baseScoredVehicles = useMemo(
    () => scoreVehicles(combinedWeights),
    [combinedWeights],
  );
  const scoredVehicles = useMemo(
    () =>
      enrichScores(baseScoredVehicles, testDriveEntries, dealQuotes).map(
        (v, _index, peers) => ({
          ...v,
          fitSummary: recommendationLabel(v, peers),
          financials: resolveFinance(
            v,
            dealQuotes,
            financeSettings,
            purchaseSelections[v.id],
          ),
        }),
      ),
    [
      baseScoredVehicles,
      testDriveEntries,
      dealQuotes,
      financeSettings,
      purchaseSelections,
    ],
  );
  const filteredVehicles = useMemo(() => {
    const search = filters.query.trim().toLowerCase();
    return scoredVehicles.filter((vehicle) => {
      const note = vehicleNotes[vehicle.id] ?? emptyVehicleNote(vehicle.id);
      const monthly = estimateMonthlyPayment(vehicle);
      const hasCarSeatPass = testDriveEntries.some(
        (entry) =>
          entry.vehicleId === vehicle.id &&
          entry.status === "Completed" &&
          !entry.archived &&
          entry.carSeatFits,
      );
      const isHybrid =
        vehicle.powertrain === "Hybrid" ||
        vehicle.powertrain === "Plug-in Hybrid" ||
        vehicle.powertrain === "Electric";
      return (
        (!search ||
          `${vehicle.make} ${vehicle.model}`.toLowerCase().includes(search)) &&
        (filters.bodyStyle === "All" ||
          vehicle.bodyStyle === filters.bodyStyle) &&
        (filters.drivetrain === "All" ||
          vehicle.drivetrain === filters.drivetrain) &&
        (filters.powertrain === "All" ||
          vehicle.powertrain === filters.powertrain) &&
        actualVehiclePrice(vehicle, dealQuotes) <= filters.maxPrice &&
        vehicle.seats >= filters.minSeats &&
        (!filters.mustHaveAwd ||
          vehicle.drivetrain === "AWD" ||
          vehicle.drivetrain === "4WD") &&
        (!filters.mustHaveHybrid || isHybrid) &&
        (!filters.mustFitCarSeat || hasCarSeatPass) &&
        (!filters.maxMonthlyPayment || monthly <= filters.maxMonthlyPayment) &&
        (filters.stage === "All" || note.stage === filters.stage) &&
        (!filters.hideRejected || note.stage !== "Rejected")
      );
    });
  }, [dealQuotes, filters, scoredVehicles, testDriveEntries, vehicleNotes]);

  const selectedVehicle =
    scoredVehicles.find((vehicle) => vehicle.id === calculatorVehicleId) ??
    scoredVehicles[0]!;
  const selectedVehicles = selectedVehicleIds
    .map((vehicleId) =>
      scoredVehicles.find((vehicle) => vehicle.id === vehicleId),
    )
    .filter(Boolean) as ScoredVehicle[];
  const readinessByVehicle = useMemo(
    () =>
      Object.fromEntries(
        scoredVehicles.map((vehicle) => [
          vehicle.id,
          vehicleReadiness(
            vehicle,
            favoritesByProfile,
            vehicleNotes[vehicle.id] ?? emptyVehicleNote(vehicle.id),
            dealQuotes,
            testDriveEntries,
            filters.maxMonthlyPayment,
            mustHaves,
          ),
        ]),
      ),
    [
      dealQuotes,
      favoritesByProfile,
      filters.maxMonthlyPayment,
      mustHaves,
      scoredVehicles,
      testDriveEntries,
      vehicleNotes,
    ],
  );
  const showCompareTray =
    activeSection === "browse" || activeSection === "compare";
  const activeSectionLabel = sectionLabels[activeSection as AppSection];

  const reorderComparedVehicles = useCallback(
    (fromIndex: number, toIndex: number) => {
      setSelectedVehicleIds((current) => {
        if (
          fromIndex === toIndex ||
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= current.length ||
          toIndex >= current.length
        )
          return current;
        const next = [...current];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
    [setSelectedVehicleIds],
  );

  const openVehicleProfile = useCallback((vehicleId: string) => {
    setReviewRequested(false);
    setViewedVehicleId(vehicleId);
  }, []);

  const openVehicleReview = (id: string, profile: ProfileName) => {
    setActiveProfile(profile);
    setReviewRequested(true);
    setViewedVehicleId(id);
  };

  useEffect(() => {
    if (!compareMessage) return;
    const timeout = window.setTimeout(() => setCompareMessage(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [compareMessage]);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [activeSection]);

  const toggleComparedVehicle = useCallback(
    (vehicleId: string) => {
      setSelectedVehicleIds((current) => {
        if (current.includes(vehicleId)) {
          setCompareMessage("Removed from compare tray.");
          return current.filter((id) => id !== vehicleId);
        }

        if (current.length >= 4) {
          setCompareMessage(
            "Compare tray is full. Remove a model before adding another.",
          );
          return current;
        }

        setCompareMessage(
          "Added to compare tray. Reorder columns from the Compare page.",
        );
        return [vehicleId, ...current];
      });
    },
    [setSelectedVehicleIds],
  );

  if (activeWorkspaceApp === "AppSelection")
    return <AppSelectionPage onSelectApp={setActiveWorkspaceApp} />;
  if (activeWorkspaceApp === "SenStats")
    return (
      <SenStatsApp
        onOpenAppSelection={() => setActiveWorkspaceApp("AppSelection")}
        onBackToCarMatch={() => setActiveWorkspaceApp("CarMatch")}
      />
    );

  return (
    <main className={`shell profile-${activeProfile.toLowerCase()}`}>
      <section className="hero card app-header">
        <div className="hero-topline">
          <div className="brand-status">
            <button
              className="app-name"
              type="button"
              onClick={() => setActiveWorkspaceApp("AppSelection")}
              aria-label="Switch app"
            >
              CarMatch ▾
            </button>
            <SessionStatusIcon status={sessionStatus} />
          </div>
          <div className="profile-switcher" aria-label="User profile selector">
            {profileNames.map((profileName) => (
              <button
                key={profileName}
                className={activeProfile === profileName ? "active" : ""}
                aria-pressed={activeProfile === profileName}
                onClick={() => setActiveProfile(profileName)}
              >
                {profileName}
              </button>
            ))}
          </div>
        </div>
        <div className="header-utilities">
          <span role="status">{writeStatus}</span>{" "}
          <button
            className="share-session-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${window.location.origin}/?session=${sessionId}`,
                );
                setCompareMessage(
                  "Session link copied. Save it to return on another device.",
                );
              } catch {
                setWriteError(
                  "Could not copy. Save the session URL from your address bar.",
                );
              }
            }}
            disabled={!canReadSharedCollections}
          >
            Copy shared session link
          </button>
        </div>
      </section>

      <button
        className="menu-toggle"
        type="button"
        aria-expanded={isMenuOpen}
        aria-controls="primary-app-menu"
        onClick={() => setIsMenuOpen((open: boolean) => !open)}
      >
        <span className="menu-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>{activeSectionLabel}</span>
      </button>
      <nav
        id="primary-app-menu"
        className={`app-menu ${isMenuOpen ? "open" : ""}`}
        aria-label="Primary app sections"
      >
        <button
          className={activeSection === "dashboard" ? "active" : ""}
          onClick={() => setActiveSection("dashboard")}
        >
          Home
        </button>
        <button
          className={activeSection === "browse" ? "active" : ""}
          onClick={() => setActiveSection("browse")}
        >
          Browse vehicles
        </button>
        <button
          className={activeSection === "compare" ? "active" : ""}
          onClick={() => setActiveSection("compare")}
        >
          Compare
        </button>
        <button
          className={activeSection === "calculator" ? "active" : ""}
          onClick={() => setActiveSection("calculator")}
        >
          Payment calculator
        </button>
        <button
          className={activeSection === "deals" ? "active" : ""}
          onClick={() => setActiveSection("deals")}
        >
          Deal tracker
        </button>
        <button
          className={activeSection === "diary" ? "active" : ""}
          onClick={() => setActiveSection("diary")}
        >
          Test drive diary
        </button>
        <button
          className={activeSection === "decision" ? "active" : ""}
          onClick={() => setActiveSection("decision")}
        >
          Decision Room
        </button>
      </nav>

      {sessionStatus.startsWith("error:") && (
        <div className="error-banner" role="alert">
          <p>Could not open this shared session. {sessionStatus.slice(6)}</p>
          <button onClick={() => setSessionAttempt((n) => n + 1)}>
            Retry session connection
          </button>
        </div>
      )}
      {(financeStorageError || selectionStorageError) && (
        <p role="alert" className="error-text">
          {financeStorageError || selectionStorageError}
        </p>
      )}

      {(writeError ||
        preferencesError ||
        globalPreferencesError ||
        notesError ||
        diaryError ||
        quotesError) && (
        <div className="error-banner" role="alert">
          <p>
            {writeError ||
              preferencesError?.message ||
              globalPreferencesError?.message ||
              notesError?.message ||
              diaryError?.message ||
              quotesError?.message}
          </p>
          {writeError && retryWrite.current && (
            <button
              onClick={() => {
                const retry = retryWrite.current!;
                setWriteError("");
                void performWrite(retry).catch(() => {});
              }}
            >
              Retry last failed save
            </button>
          )}
          <button onClick={() => setWriteError("")}>Dismiss save error</button>
        </div>
      )}
      {showCompareTray && (
        <CompareTray
          selectedVehicles={selectedVehicles}
          onCompareNow={() => setActiveSection("compare")}
          onClear={() => {
            setSelectedVehicleIds([]);
            setCompareMessage("Compare tray cleared.");
          }}
          onRemove={(vehicleId) => {
            setSelectedVehicleIds((current) =>
              current.filter((id) => id !== vehicleId),
            );
            setCompareMessage("Vehicle removed from comparison.");
          }}
        />
      )}
      {compareMessage && (
        <div className="toast" role="status">
          ✓ {compareMessage}
        </div>
      )}

      {activeSection === "decision" && (
        <DecisionRoom
          vehicles={scoredVehicles.filter(
            (v) => !readinessByVehicle[v.id]?.blocked,
          )}
          notes={vehicleNotes}
          quotes={dealQuotes}
          readinessByVehicle={readinessByVehicle}
          favoritesByProfile={favoritesByProfile}
          budgetLimit={filters.maxMonthlyPayment}
        />
      )}
      {activeSection === "dashboard" && (
        <>
          <HomeDashboard
            vehicles={scoredVehicles}
            notes={vehicleNotes}
            favorites={favoritesByProfile}
            entries={testDriveEntries}
            quotes={dealQuotes}
            onOpen={openVehicleProfile}
            onReview={openVehicleReview}
            onNavigate={setActiveSection}
          />
          <details className="card priorities-details">
            <summary>Adjust priorities & view rankings</summary>
            <section className="grid">
              <PrioritySliders
                key={activeProfile}
                profileName={activeProfile}
                currentWeights={profileWeights[activeProfile]}
                onWeightsChange={handleProfileWeightsChange}
              />
              <Dashboard
                scoredVehicles={filteredVehicles}
                quotes={dealQuotes}
                readinessByVehicle={readinessByVehicle}
                combinedWeights={combinedWeights}
                loading={!sessionId || preferencesLoading}
                error={preferencesError?.message}
                partnerCount={profilePreferences.length}
                onSelectVehicle={openVehicleProfile}
              />
              <PriorityComparison
                profileWeights={profileWeights}
                profileMeta={profileMeta}
              />
            </section>
          </details>
        </>
      )}
      {activeSection === "browse" && (
        <VehicleBrowser
          onReviewVehicle={openVehicleReview}
          filters={filters}
          onFiltersChange={setFilters}
          mustHaves={mustHaves}
          onMustHavesChange={setMustHaves}
          vehicles={filteredVehicles}
          readinessByVehicle={readinessByVehicle}
          quotes={dealQuotes}
          activeProfile={activeProfile}
          favorites={favoritesByProfile[activeProfile]}
          selectedVehicleIds={selectedVehicleIds}
          notes={vehicleNotes}
          onToggleFavorite={handleToggleFavorite}
          onToggleCompare={toggleComparedVehicle}
          onSelectVehicle={openVehicleProfile}
        />
      )}
      {activeSection === "compare" && (
        <EnhancedComparisonTable
          vehicles={selectedVehicles}
          favoritesByProfile={favoritesByProfile}
          notes={vehicleNotes}
          quotes={dealQuotes}
          entries={testDriveEntries}
          onStageChange={(vehicleId, stage) => {
            void saveVehicleNote(vehicleId, { stage }).catch((error) =>
              setWriteError(String(error)),
            );
          }}
          onReorder={reorderComparedVehicles}
          onRemove={(vehicleId) => {
            setSelectedVehicleIds((current) =>
              current.filter((id) => id !== vehicleId),
            );
            setCompareMessage("Vehicle removed from comparison.");
          }}
        />
      )}
      {activeSection === "calculator" && (
        <EnhancedPaymentCalculator
          vehicle={selectedVehicle}
          vehicles={scoredVehicles}
          quotes={dealQuotes}
          settings={financeSettings}
          onSettingsChange={setFinanceSettings}
          selection={
            purchaseSelections[selectedVehicle.id] ?? { source: "auto" }
          }
          onSelectionChange={(selection, vehicleId) => {
            const target = vehicleId ?? selectedVehicle.id;
            setPurchaseSelections((current) => ({
              ...current,
              [target]: selection,
            }));
          }}
          onVehicleChange={setCalculatorVehicleId}
          budgetLimit={filters.maxMonthlyPayment}
          onBudgetLimitChange={(maxMonthlyPayment) =>
            setFilters((current) => ({ ...current, maxMonthlyPayment }))
          }
        />
      )}
      {activeSection === "deals" && (
        <DealTracker
          initialVehicleId={formVehicleId}
          vehicles={scoredVehicles}
          quotes={dealQuotes}
          settings={financeSettings}
          onSaveQuote={saveDealQuote}
        />
      )}
      {activeSection === "diary" && (
        <EnhancedTestDriveDiary
          initialVehicleId={formVehicleId}
          vehicles={scoredVehicles}
          entries={testDriveEntries}
          activeProfile={activeProfile}
          onSaveEntry={saveDiaryEntry}
        />
      )}

      {viewedVehicleId &&
        scoredVehicles.find((v) => v.id === viewedVehicleId) && (
          <VehicleDetails
            key={viewedVehicleId}
            focusReview={reviewRequested}
            onPlanDrive={() => {
              setFormVehicleId(viewedVehicleId);
              setViewedVehicleId(null);
              setActiveSection("diary");
            }}
            onAddQuote={() => {
              setFormVehicleId(viewedVehicleId);
              setViewedVehicleId(null);
              setActiveSection("deals");
            }}
            vehicle={scoredVehicles.find((v) => v.id === viewedVehicleId)!}
            activeProfile={activeProfile}
            isFavorite={favoritesByProfile[activeProfile].includes(
              viewedVehicleId,
            )}
            note={
              vehicleNotes[viewedVehicleId] ?? emptyVehicleNote(viewedVehicleId)
            }
            quotes={dealQuotes.filter(
              (q) => q.vehicleId === viewedVehicleId && !q.archived,
            )}
            entries={testDriveEntries.filter(
              (e) => e.vehicleId === viewedVehicleId && !e.archived,
            )}
            weights={combinedWeights}
            readiness={readinessByVehicle[viewedVehicleId]}
            onClose={() => setViewedVehicleId(null)}
            onToggleFavorite={() => handleToggleFavorite(viewedVehicleId)}
            onSave={(patch) => saveVehicleNote(viewedVehicleId, patch)}
            onCalculate={() => {
              setCalculatorVehicleId(viewedVehicleId);
              setViewedVehicleId(null);
              setActiveSection("calculator");
            }}
          />
        )}
    </main>
  );
}

function SessionStatusIcon({ status }: { status: string }) {
  const lowerStatus = status.toLowerCase();
  const state =
    lowerStatus.includes("unable") ||
    lowerStatus.includes("failed") ||
    lowerStatus.includes("error")
      ? "failed"
      : lowerStatus.includes("connected")
        ? "connected"
        : "syncing";
  const label =
    state === "connected"
      ? "Connected"
      : state === "failed"
        ? "Sync failed"
        : "Syncing";
  return (
    <span
      className={`session-icon ${state}`}
      role="status"
      aria-label={label}
      title={status}
    >
      {state === "connected" ? "✓" : state === "failed" ? "!" : "↻"}
    </span>
  );
}

function DecisionRoom({
  vehicles,
  notes,
  quotes,
  readinessByVehicle,
  favoritesByProfile,
  budgetLimit,
}: {
  vehicles: ScoredVehicle[];
  notes: Record<string, VehicleNoteDocument>;
  quotes: DealQuoteDocument[];
  readinessByVehicle: Record<string, VehicleReadiness>;
  favoritesByProfile: Record<ProfileName, string[]>;
  budgetLimit: number;
}) {
  const topThree = vehicles
    .filter((v) => !readinessByVehicle[v.id]?.blocked)
    .slice(0, 3);
  const bestEmily = vehicles.find((vehicle) =>
    favoritesByProfile.Emily.includes(vehicle.id),
  );
  const bestNick = vehicles.find((vehicle) =>
    favoritesByProfile.Nick.includes(vehicle.id),
  );
  const bestDeal = [...vehicles].sort(
    (a, b) => actualVehiclePrice(a, quotes) - actualVehiclePrice(b, quotes),
  )[0];
  const bestTestDrive = vehicles
    .filter((v) => v.hasDriveEvidence)
    .sort((a, b) => b.testDriveScore - a.testDriveScore)[0];
  const lowestMonthly = [...vehicles].sort(
    (a, b) => estimateMonthlyPayment(a) - estimateMonthlyPayment(b),
  )[0];
  const mostComplete = [...vehicles].sort(
    (a, b) =>
      (readinessByVehicle[b.id]?.score ?? 0) -
      (readinessByVehicle[a.id]?.score ?? 0),
  )[0];
  const openTasks = topThree
    .flatMap((vehicle) =>
      (readinessByVehicle[vehicle.id]?.missing ?? [])
        .slice(0, 3)
        .map((task) => `${vehicle.name}: ${task}`),
    )
    .slice(0, 7);
  return (
    <section className="card stack decision-room">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Decision Room</p>
          <h2>What is ready, and what still needs work?</h2>
        </div>
        <span>
          {budgetLimit
            ? `Budget guardrail $${budgetLimit}/mo`
            : "No monthly guardrail set"}
        </span>
      </div>
      <div className="decision-grid">
        <DecisionWidget
          label="Leading contender"
          vehicle={topThree[0]}
          detail={`${readinessByVehicle[topThree[0]?.id ?? ""]?.score ?? 0}% ready`}
        />
        <DecisionWidget
          label="Best for Emily"
          vehicle={bestEmily}
          detail={
            bestEmily
              ? (notes[bestEmily.id]?.reactions?.Emily ?? "No reaction yet")
              : "—"
          }
        />
        <DecisionWidget
          label="Best for Nick"
          vehicle={bestNick}
          detail={
            bestNick
              ? (notes[bestNick.id]?.reactions?.Nick ?? "No reaction yet")
              : "—"
          }
        />
        <DecisionWidget
          label="Lowest out-the-door"
          vehicle={bestDeal}
          detail={
            bestDeal
              ? `$${actualVehiclePrice(bestDeal, quotes).toLocaleString("en-CA")}`
              : "—"
          }
        />
        <DecisionWidget
          label="Best Test Drive"
          vehicle={bestTestDrive}
          detail={bestTestDrive ? `${bestTestDrive.testDriveScore}/100` : "—"}
        />
        <DecisionWidget
          label="Lowest total monthly"
          vehicle={lowestMonthly}
          detail={
            lowestMonthly
              ? `$${estimateMonthlyPayment(lowestMonthly).toLocaleString("en-CA")}/mo`
              : "—"
          }
        />
        <DecisionWidget
          label="Most Complete Evidence"
          vehicle={mostComplete}
          detail={
            mostComplete
              ? `${readinessByVehicle[mostComplete.id]?.status}`
              : "—"
          }
        />
      </div>
      <div className="finalist-strip">
        {topThree.map((vehicle) => (
          <article key={vehicle.id}>
            <strong>{vehicle.name}</strong>
            <span
              className={`readiness-badge ${readinessByVehicle[vehicle.id]?.blocked ? "blocked" : readinessByVehicle[vehicle.id]?.score >= 85 ? "ready" : ""}`}
            >
              {readinessByVehicle[vehicle.id]?.status}
            </span>
            <ul>
              {readinessByVehicle[vehicle.id]?.missing
                .slice(0, 4)
                .map((item) => (
                  <li key={item}>{item}</li>
                ))}
            </ul>
          </article>
        ))}
      </div>
      <div className="open-tasks">
        <strong>Open tasks</strong>
        {openTasks.length ? (
          <ul>
            {openTasks.map((task) => (
              <li key={task}>{task}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No open tasks for the current eligible finalists. Browse vehicles if
            none are shown.
          </p>
        )}
      </div>
    </section>
  );
}

function DecisionWidget({
  label,
  vehicle,
  detail,
}: {
  label: string;
  vehicle?: ScoredVehicle;
  detail: string;
}) {
  return (
    <article className="decision-widget">
      <span>{label}</span>
      <strong>{vehicle?.name ?? "Not enough data"}</strong>
      <small>{detail}</small>
    </article>
  );
}

function SavedFilterPresets({
  onApply,
}: {
  onApply: (patch: Partial<Filters>) => void;
}) {
  const presets: Array<{ label: string; patch: Partial<Filters> }> = [
    {
      label: "Budget-friendly",
      patch: { maxPrice: 38000, maxMonthlyPayment: 650 },
    },
    {
      label: "Best for winter",
      patch: { drivetrain: "AWD", mustHaveAwd: true },
    },
    {
      label: "Hybrid only",
      patch: { powertrain: "Hybrid", mustHaveHybrid: true },
    },
    {
      label: "3-row options",
      patch: { bodyStyle: "Midsize SUV", minSeats: 6 },
    },
    { label: "Shortlist", patch: { stage: "Shortlisted" } },
    { label: "Rejected hidden", patch: { stage: "All", hideRejected: true } },
    { label: "Needs test drive", patch: { stage: "Browsing" } },
  ];
  return (
    <div className="saved-views">
      <span>Saved views</span>
      {presets.map((preset) => (
        <button
          type="button"
          key={preset.label}
          onClick={() => onApply(preset.patch)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

interface PrioritySlidersProps {
  profileName: ProfileName;
  currentWeights: CriteriaWeights;
  onWeightsChange: (
    profileName: ProfileName,
    weights: CriteriaWeights,
  ) => Promise<void>;
}
function PrioritySliders({
  profileName,
  currentWeights,
  onWeightsChange,
}: PrioritySlidersProps) {
  const [draftWeights, setDraftWeights] =
    useState<CriteriaWeights>(currentWeights);
  const [saveState, setSaveState] = useState(
    `${profileName}'s priorities ready`,
  );
  const [hasUserEdited, setHasUserEdited] = useState(false);
  useEffect(() => {
    setDraftWeights(currentWeights);
    setHasUserEdited(false);
    setSaveState(`${profileName}'s priorities ready`);
  }, [currentWeights, profileName]);
  useEffect(() => {
    if (!hasUserEdited) return;
    setSaveState(`Updating ${profileName}...`);
    const timeout = window.setTimeout(() => {
      setHasUserEdited(false);
      void onWeightsChange(profileName, draftWeights)
        .then(() => setSaveState("Saved"))
        .catch(() => setSaveState("Could not save — use Retry above"));
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [draftWeights, hasUserEdited, onWeightsChange, profileName]);
  return (
    <form
      className="card sliders"
      onSubmit={(event: FormEvent) => event.preventDefault()}
    >
      <div className="section-heading">
        <p className="eyebrow">{profileName}'s priorities</p>
        <span>{saveState}</span>
      </div>
      <h2>Balance what matters most for {profileName}.</h2>
      <p className="edit-warning">
        You are editing {profileName}'s universal priorities. These values are
        visible across sessions and devices.
      </p>
      {sliderConfig.map((slider) => (
        <label className="slider-row" key={slider.key}>
          <span className="slider-label">
            <strong>{slider.label}</strong>
            <small>{slider.help}</small>
          </span>
          <input
            type="range"
            min="1"
            max="10"
            value={draftWeights[slider.key]}
            onChange={(event) => {
              setHasUserEdited(true);
              setDraftWeights((current) => ({
                ...current,
                [slider.key]: Number(event.target.value),
              }));
            }}
          />
          <b>{draftWeights[slider.key]}</b>
        </label>
      ))}
    </form>
  );
}

function Dashboard({
  scoredVehicles,
  quotes,
  readinessByVehicle,
  combinedWeights,
  loading,
  error,
  partnerCount,
  onSelectVehicle,
}: {
  scoredVehicles: ScoredVehicle[];
  quotes: DealQuoteDocument[];
  readinessByVehicle: Record<string, VehicleReadiness>;
  combinedWeights: CriteriaWeights;
  loading: boolean;
  error?: string;
  partnerCount: number;
  onSelectVehicle: (vehicleId: string) => void;
}) {
  const weights = [
    { label: "Space", value: combinedWeights.space },
    { label: "Winter", value: combinedWeights.winterTraction },
    { label: "Value", value: combinedWeights.valueMSRP },
    { label: "Reliability", value: combinedWeights.reliability },
    { label: "Efficiency", value: combinedWeights.fuelEfficiency },
    { label: "Safety", value: combinedWeights.safetyTech },
    { label: "Comfort", value: combinedWeights.comfort },
  ];
  return (
    <section className="card dashboard">
      <div className="section-heading">
        <p className="eyebrow">Live ranking</p>
        <span>{partnerCount} shared profiles · switch freely</span>
      </div>
      <h2>Recommendation Score</h2>
      {loading && <p className="muted">Preparing shared profile scoring...</p>}
      {error && <p className="error-text">Preference stream error: {error}</p>}
      <div
        className="weight-summary"
        aria-label="Combined recommendation priorities"
      >
        {weights.map((weight) => (
          <span className="weight-chip" key={weight.label}>
            <small>{weight.label}</small>
            <strong>{weight.value.toFixed(1)}</strong>
            <em>
              <i style={{ width: `${weight.value * 10}%` }} />
            </em>
          </span>
        ))}
      </div>
      <div className="bars">
        {scoredVehicles.slice(0, 8).map((vehicle) => (
          <button
            className="vehicle-row"
            key={vehicle.id}
            onClick={() => onSelectVehicle(vehicle.id)}
          >
            <span>
              <strong>{vehicle.name}</strong>
              <small>
                {actualVehiclePriceLabel(vehicle, quotes)} $
                {actualVehiclePrice(vehicle, quotes).toLocaleString("en-CA")} •
                evidence {vehicle.confidenceScore}%
              </small>
              <small className="readiness-inline">
                {readinessByVehicle[vehicle.id]?.status ?? "Needs evidence"} •{" "}
                {readinessByVehicle[vehicle.id]?.score ?? 0}% ready
              </small>
            </span>
            <span className="bar-shell">
              <span
                className="bar-fill"
                style={{ width: `${vehicle.overallRecommendationScore}%` }}
              />
            </span>
            <span className="fit-badge">{fitSummary(vehicle)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PriorityComparison({
  profileWeights,
  profileMeta,
}: {
  profileWeights: Record<ProfileName, CriteriaWeights>;
  profileMeta: Record<ProfileName, ProfilePreferenceMeta>;
}) {
  return (
    <section className="card priority-board">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Shared priority board</p>
          <h2>See each other's priorities.</h2>
        </div>
        <span>Universal profile priorities</span>
      </div>
      <p className="muted">
        Emily and Nick's sliders are universal profile settings, so any
        connected session or device can see the same saved values after
        Firestore syncs.
      </p>
      <div className="priority-columns">
        {profileNames.map((profileName) => (
          <article
            className={`priority-card profile-${profileName.toLowerCase()}`}
            key={profileName}
          >
            <strong>{profileName}</strong>
            <small>
              Last updated by{" "}
              {profileMeta[profileName].updatedByProfile ?? "unknown"}
              {profileMeta[profileName].version
                ? ` • v${profileMeta[profileName].version}`
                : ""}
            </small>
            {sliderConfig.map((slider) => (
              <div
                className="priority-meter"
                key={`${profileName}-${slider.key}`}
              >
                <span>{slider.label}</span>
                <b>{profileWeights[profileName][slider.key]}</b>
                <em>
                  <i
                    style={{
                      width: `${profileWeights[profileName][slider.key] * 10}%`,
                    }}
                  />
                </em>
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}

function VehicleBrowser({
  filters,
  onFiltersChange,
  mustHaves,
  onMustHavesChange,
  vehicles,
  readinessByVehicle,
  quotes,
  activeProfile,
  favorites,
  selectedVehicleIds,
  notes,
  onToggleFavorite,
  onToggleCompare,
  onSelectVehicle,
  onReviewVehicle,
}: {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  mustHaves: MustHaveSettings;
  onMustHavesChange: (settings: MustHaveSettings) => void;
  vehicles: ScoredVehicle[];
  readinessByVehicle: Record<string, VehicleReadiness>;
  quotes: DealQuoteDocument[];
  activeProfile: ProfileName;
  favorites: string[];
  selectedVehicleIds: string[];
  notes: Record<string, VehicleNoteDocument>;
  onToggleFavorite: (vehicleId: string) => void;
  onToggleCompare: (vehicleId: string) => void;
  onSelectVehicle: (vehicleId: string) => void;
  onReviewVehicle: (vehicleId: string, profile: ProfileName) => void;
}) {
  const activeFilterCount = [
    filters.query.length > 0,
    filters.maxPrice !== defaultFilters.maxPrice,
    filters.bodyStyle !== "All",
    filters.drivetrain !== "All",
    filters.powertrain !== "All",
    filters.stage !== "All",
    filters.minSeats > 0,
    filters.maxMonthlyPayment > 0,
    filters.hideRejected,
    ...Object.values(mustHaves),
  ].filter(Boolean).length;
  return (
    <section className="card stack browser-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Browse models</p>
          <h2>Find the right shortlist.</h2>
        </div>
        <span>{vehicles.length} matches</span>
      </div>
      <label className="field-control browse-search">
        <span>Search</span>
        <input
          value={filters.query}
          onChange={(event) =>
            onFiltersChange({ ...filters, query: event.target.value })
          }
          placeholder="Search make or model"
        />
      </label>
      <SavedFilterPresets
        onApply={(patch) => onFiltersChange({ ...filters, ...patch })}
      />
      <details className="filter-drawer">
        <summary>
          <span>Filters, budget & deal breakers</span>
          <b>
            {activeFilterCount ? `${activeFilterCount} active` : "Optional"}
          </b>
        </summary>
        <div className="filters advanced-filters">
          <SelectControl
            label="Body style"
            value={filters.bodyStyle}
            onChange={(value) =>
              onFiltersChange({
                ...filters,
                bodyStyle: value as "All" | BodyStyle,
              })
            }
            options={bodyStyleOptions}
          />
          <SelectControl
            label="Drivetrain"
            value={filters.drivetrain}
            onChange={(value) =>
              onFiltersChange({
                ...filters,
                drivetrain: value as "All" | Drivetrain,
              })
            }
            options={drivetrainOptions}
          />
          <SelectControl
            label="Powertrain"
            value={filters.powertrain}
            onChange={(value) =>
              onFiltersChange({
                ...filters,
                powertrain: value as "All" | Powertrain,
              })
            }
            options={powertrainOptions}
          />
          <SelectControl
            label="Stage"
            value={filters.stage}
            onChange={(value) =>
              onFiltersChange({
                ...filters,
                stage: value as "All" | VehicleStage,
              })
            }
            options={["All", ...stageOptions]}
          />
          <label className="field-control">
            <span>Min seats</span>
            <input
              type="number"
              value={filters.minSeats}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  minSeats: Number(event.target.value),
                })
              }
            />
          </label>
        </div>
        <div className="budget-panel">
          <div>
            <p className="eyebrow">Budget preferences</p>
            <strong>Price and payment constraints</strong>
          </div>
          <label className="field-control">
            <span>Max total ownership / month</span>
            <input
              type="number"
              value={filters.maxMonthlyPayment}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  maxMonthlyPayment: Number(event.target.value),
                })
              }
              placeholder="$ / mo"
            />
          </label>
          <label className="range-control">
            <span>
              Max out-the-door price{" "}
              <b>${filters.maxPrice.toLocaleString("en-CA")}</b>
            </span>
            <input
              type="range"
              min="30000"
              max="95000"
              step="1000"
              value={filters.maxPrice}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  maxPrice: Number(event.target.value),
                })
              }
            />
          </label>
        </div>
        <div className="must-have-panel">
          <div>
            <p className="eyebrow">Must-haves & deal breakers</p>
            <strong>Mark requirements that can disqualify a vehicle.</strong>
          </div>
          <div className="toggle-row">
            {(Object.keys(mustHaveLabels) as MustHaveKey[]).map((key) => (
              <PillToggle
                key={key}
                checked={mustHaves[key]}
                onChange={(checked) =>
                  onMustHavesChange({ ...mustHaves, [key]: checked })
                }
              >
                {mustHaveLabels[key]}
              </PillToggle>
            ))}
          </div>
        </div>
        <div className="toggle-row" aria-label="Requirement filters">
          <PillToggle
            checked={filters.mustHaveAwd}
            onChange={(checked) =>
              onFiltersChange({ ...filters, mustHaveAwd: checked })
            }
          >
            AWD / 4WD required
          </PillToggle>
          <PillToggle
            checked={filters.mustHaveHybrid}
            onChange={(checked) =>
              onFiltersChange({ ...filters, mustHaveHybrid: checked })
            }
          >
            Hybrid / electric required
          </PillToggle>
          <PillToggle
            checked={filters.mustFitCarSeat}
            onChange={(checked) =>
              onFiltersChange({ ...filters, mustFitCarSeat: checked })
            }
          >
            Car seat tested
          </PillToggle>
          <PillToggle
            checked={filters.hideRejected}
            onChange={(checked) =>
              onFiltersChange({ ...filters, hideRejected: checked })
            }
          >
            Hide rejected
          </PillToggle>
        </div>
      </details>
      <div className="action-row">
        <button
          onClick={() => {
            onFiltersChange(defaultFilters);
            onMustHavesChange(defaultMustHaves);
          }}
        >
          Reset filters & requirements
        </button>
      </div>
      {vehicles.length === 0 && (
        <p role="status">
          No matches. Try resetting filters or increasing the budget.
        </p>
      )}
      <div className="vehicle-cards">
        {vehicles.map((vehicle) => (
          <VehicleCard
            key={vehicle.id}
            vehicle={vehicle}
            readiness={readinessByVehicle[vehicle.id]}
            actualPrice={actualVehiclePrice(vehicle, quotes)}
            actualPriceLabel={actualVehiclePriceLabel(vehicle, quotes)}
            isFavorite={favorites.includes(vehicle.id)}
            isCompared={selectedVehicleIds.includes(vehicle.id)}
            activeProfile={activeProfile}
            note={notes[vehicle.id] ?? emptyVehicleNote(vehicle.id)}
            onToggleFavorite={() => onToggleFavorite(vehicle.id)}
            onToggleCompare={() => onToggleCompare(vehicle.id)}
            onSelect={() => onSelectVehicle(vehicle.id)}
            onReview={(profile) => onReviewVehicle(vehicle.id, profile)}
          />
        ))}
      </div>
    </section>
  );
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-control select-control">
      <span>{label}</span>
      <div className="select-shell">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M5.5 7.5 10 12l4.5-4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </label>
  );
}

function PillToggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: string;
}) {
  return (
    <label className={`pill-toggle ${checked ? "active" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" />
      {children}
    </label>
  );
}

function VehicleCard({
  vehicle,
  readiness,
  actualPrice,
  actualPriceLabel,
  isFavorite,
  isCompared,
  activeProfile,
  note,
  onToggleFavorite,
  onToggleCompare,
  onSelect,
  onReview,
}: {
  vehicle: ScoredVehicle;
  readiness?: VehicleReadiness;
  actualPrice: number;
  actualPriceLabel: string;
  isFavorite: boolean;
  isCompared: boolean;
  activeProfile: ProfileName;
  note: VehicleNoteDocument;
  onToggleFavorite: () => void;
  onToggleCompare: () => void;
  onSelect: () => void;
  onReview: (profile: ProfileName) => void;
}) {
  const reviewMatch = readiness?.status.match(/needs (emily|nick) review/i);
  const reviewProfile: ProfileName | undefined = reviewMatch
    ? reviewMatch[1].toLowerCase() === "emily"
      ? "Emily"
      : "Nick"
    : undefined;
  return (
    <article className="vehicle-card">
      <button
        className="star-button"
        onClick={onToggleFavorite}
        aria-label={`${isFavorite ? "Remove from" : "Add to"} ${activeProfile}'s favourites`}
      >
        {isFavorite ? "★" : "☆"}
      </button>
      <button className="compare-toggle" onClick={onToggleCompare}>
        {isCompared ? "✓ Compare" : "+ Compare"}
      </button>
      <button className="vehicle-card-main" onClick={onSelect}>
        <VehicleImage vehicle={vehicle} />
        <strong>{vehicle.name}</strong>
        <span>
          {actualPriceLabel} ${actualPrice.toLocaleString("en-CA")} •{" "}
          {vehicle.drivetrain} • {vehicle.powertrain}
        </span>
        <span>
          {note.stage} • {activeProfile}: {note.reactions[activeProfile]}
        </span>
        <span className="fit-badge">{fitSummary(vehicle)}</span>
        <small>{vehicle.tradeoffs[0]}</small>
        {readiness && !reviewProfile && (
          <span
            className={`readiness-badge ${readiness.blocked ? "blocked" : readiness.score >= 85 ? "ready" : ""}`}
          >
            {readiness.status} • {readiness.score}%
          </span>
        )}
      </button>
      {reviewProfile && (
        <button
          className="review-card-action"
          onClick={() => onReview(reviewProfile)}
          aria-label={`${reviewProfile}: Needs review — ${vehicle.name}`}
        >
          {reviewProfile}: Needs review
        </button>
      )}
    </article>
  );
}

function VehicleImage({ vehicle }: { vehicle: ScoredVehicle }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (vehicle.imageUrl && !imageFailed)
    return (
      <img
        className="vehicle-photo"
        src={vehicle.imageUrl}
        alt={`${vehicle.name} exterior`}
        loading="lazy"
        onError={() => setImageFailed(true)}
      />
    );
  return (
    <div className="vehicle-photo photo-fallback">
      <strong>{vehicle.make}</strong>
      <span>Open manufacturer gallery</span>
    </div>
  );
}

function defaultDiaryDraft(vehicleId: string) {
  return makeDiaryDraft(vehicleId);
}
function defaultDealQuote(vehicleId: string) {
  return makeDealQuote(
    vehicleId,
    CANADIAN_VEHICLES.find((v) => v.id === vehicleId)?.msrp,
  );
}
function toggleProfileFavorite(
  current: Record<ProfileName, string[]>,
  profile: ProfileName,
  vehicleId: string,
) {
  const currentFavorites = current[profile];
  return {
    ...current,
    [profile]: currentFavorites.includes(vehicleId)
      ? currentFavorites.filter((favoriteId) => favoriteId !== vehicleId)
      : [...currentFavorites, vehicleId],
  };
}
export default App;
