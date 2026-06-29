import { FormEvent, useEffect, useMemo, useState } from 'react';
import { signInAnonymously, type User } from 'firebase/auth';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';
import { useCollection } from 'react-firebase-hooks/firestore';
import { auth, db } from './firebase';
import { averagePartnerWeights, CANADIAN_VEHICLES, DEFAULT_WEIGHTS, scoreVehicles } from './scoring';
import type { CriteriaKey, CriteriaWeights, SessionDocument, UserPreferenceDocument } from './types';
import './styles.css';

const sliderConfig: Array<{ key: CriteriaKey; label: string; help: string }> = [
  { key: 'space', label: 'Car Seat & Cabin Space', help: 'Prioritize second-row room, cargo access, and family ergonomics.' },
  { key: 'winterTraction', label: 'Ottawa Winter Traction', help: 'Favor snow confidence, AWD behavior, and cold-weather stability.' },
  { key: 'valueMSRP', label: 'Value & MSRP Budget', help: 'Emphasize purchase price, features per dollar, and long-term value.' },
];

function getSessionIdFromUrl() {
  return new URLSearchParams(window.location.search).get('session');
}

function App() {
  const [user, authLoading, authError] = useAuthState(auth);
  const [anonymousSignInError, setAnonymousSignInError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || user) {
      return;
    }

    void signInAnonymously(auth)
      .then(() => setAnonymousSignInError(null))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Anonymous sign-in failed.';
        setAnonymousSignInError(message);
      });
  }, [authLoading, user]);

  const authFailureMessage = authError?.message ?? anonymousSignInError;

  if (authFailureMessage) {
    return (
      <main className="shell error">
        <section className="card">
          <p className="eyebrow">Firebase Auth setup required</p>
          <h1>Co-Pilot could not start a secure anonymous session.</h1>
          <p>{authFailureMessage}</p>
          <p>
            In Firebase Console, confirm Authentication is enabled for the <strong>flexspace-1</strong> project and
            that the <strong>Anonymous</strong> sign-in provider is enabled.
          </p>
        </section>
      </main>
    );
  }

  if (authLoading || !user) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Initializing Secure Session...</div>;
  }

  const activeUser = user;

  return <AuthenticatedSession activeUser={activeUser} />;
}

interface AuthenticatedSessionProps {
  activeUser: User;
}

function AuthenticatedSession({ activeUser }: AuthenticatedSessionProps) {
  const [sessionId, setSessionId] = useState<string | null>(getSessionIdFromUrl);
  const [session, setSession] = useState<SessionDocument | null>(null);
  const [sessionStatus, setSessionStatus] = useState('Preparing your anonymous co-pilot profile...');
  const preferencesQuery = sessionId ? collection(db, 'sessions', sessionId, 'userPreferences') : null;
  const [preferencesSnapshot, preferencesLoading, preferencesError] = useCollection(preferencesQuery as any);

  const preferences = useMemo<UserPreferenceDocument[]>(() => {
    return (
      preferencesSnapshot?.docs.map((preferenceDoc) => {
        const data = preferenceDoc.data() as Partial<UserPreferenceDocument>;

        return {
          userId: data.userId ?? preferenceDoc.id,
          criteriaWeights: data.criteriaWeights ?? DEFAULT_WEIGHTS,
          personalNotes: data.personalNotes ?? {},
        };
      }) ?? []
    );
  }, [preferencesSnapshot]);

  useEffect(() => {
    async function bootstrapSession() {
      setSessionStatus('Connecting this device to the shared session...');
      const activeSessionId = sessionId ?? doc(collection(db, 'sessions')).id;
      const sessionRef = doc(db, 'sessions', activeSessionId);
      const shareLink = `${window.location.origin}/join?session=${activeSessionId}`;
      const snapshot = await getDoc(sessionRef);

      // First device creates /sessions/{sessionId}; invited devices atomically join partnerIds.
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
        await updateDoc(sessionRef, {
          partnerIds: arrayUnion(activeUser.uid),
          dynamicShareLink: shareLink,
        });
      }

      await setDoc(
        doc(db, 'sessions', activeSessionId, 'userPreferences', activeUser.uid),
        {
          userId: activeUser.uid,
          criteriaWeights: DEFAULT_WEIGHTS,
          personalNotes: {},
        },
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

  return (
    <main className="shell">
      <section className="hero card">
        <p className="eyebrow">Co-Pilot</p>
        <h1>Shared decisions for your next family vehicle.</h1>
        <p>
          Pair two anonymous devices, collect each partner&apos;s priorities, and watch the Family Compatibility
          Score rebalance in real time through Firestore streams.
        </p>
        <div className="invite-panel">
          <span>{sessionStatus}</span>
          <input readOnly value={session?.dynamicShareLink ?? 'Creating invite link...'} aria-label="Invite link" />
        </div>
      </section>

      <section className="grid">
        <PrioritySliders sessionId={sessionId} userId={activeUser.uid} currentWeights={myPreference?.criteriaWeights} />
        <Dashboard
          scoredVehicles={scoredVehicles}
          combinedWeights={combinedWeights}
          loading={preferencesLoading || !sessionId}
          error={preferencesError?.message}
          partnerCount={preferences.length}
        />
      </section>
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
    if (!sessionId || !userId) {
      return;
    }

    setSaveState('Saving...');
    const timeout = window.setTimeout(async () => {
      // Debounced slider writes feed /sessions/{sessionId}/userPreferences/{userId}; both devices listen to this collection.
      await setDoc(
        doc(db, 'sessions', sessionId, 'userPreferences', userId),
        { userId, criteriaWeights: draftWeights, personalNotes: {} },
        { merge: true },
      );
      setSaveState('Synced');
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [draftWeights, sessionId, userId]);

  function handleSliderChange(key: CriteriaKey, value: string) {
    setDraftWeights((current) => ({ ...current, [key]: Number(value) }));
  }

  function preventSubmit(event: FormEvent) {
    event.preventDefault();
  }

  return (
    <form className="card sliders" onSubmit={preventSubmit}>
      <div className="section-heading">
        <p className="eyebrow">Your priorities</p>
        <span>{saveState}</span>
      </div>
      <h2>Balance what matters most.</h2>
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
            onChange={(event) => handleSliderChange(slider.key, event.target.value)}
            disabled={!sessionId || !userId}
          />
          <b>{draftWeights[slider.key]}</b>
        </label>
      ))}
    </form>
  );
}

interface DashboardProps {
  scoredVehicles: ReturnType<typeof scoreVehicles>;
  combinedWeights: CriteriaWeights;
  loading: boolean;
  error?: string;
  partnerCount: number;
}

function Dashboard({ scoredVehicles, combinedWeights, loading, error, partnerCount }: DashboardProps) {
  return (
    <section className="card dashboard">
      <div className="section-heading">
        <p className="eyebrow">Live ranking</p>
        <span>{partnerCount} partner profile{partnerCount === 1 ? '' : 's'} connected</span>
      </div>
      <h2>Family Compatibility Score</h2>
      {loading && <p className="muted">Loading shared Firestore preferences...</p>}
      {error && <p className="error-text">Preference stream error: {error}</p>}
      <div className="weight-summary">
        <span>Space {combinedWeights.space.toFixed(1)}</span>
        <span>Winter {combinedWeights.winterTraction.toFixed(1)}</span>
        <span>Value {combinedWeights.valueMSRP.toFixed(1)}</span>
      </div>
      <div className="bars">
        {scoredVehicles.map((vehicle) => (
          <article className="vehicle-row" key={vehicle.id}>
            <div>
              <strong>{vehicle.name}</strong>
              <small>MSRP from ${vehicle.msrp.toLocaleString('en-CA')}</small>
            </div>
            <div className="bar-shell" aria-label={`${vehicle.name} score ${vehicle.familyCompatibilityScore}`}>
              <div className="bar-fill" style={{ width: `${vehicle.familyCompatibilityScore}%` }} />
            </div>
            <b>{vehicle.familyCompatibilityScore}</b>
          </article>
        ))}
      </div>
    </section>
  );
}

export default App;
