import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BudgetStoreContext,
  BUDGET_KEY,
  type BudgetStore,
} from "./BudgetStoreContext";
import {
  legacyWasMigrated,
  markLegacyMigrated,
  activateBudget,
  budgetIdentity,
  createCloudBudget,
  forgetCloudBudget,
  joinCloudBudget,
  lastBudget,
  listenBudget,
  listenBudgets,
  privateBudgetLink,
  rememberBudget,
  renameCloudBudget,
  saveCloudBudget,
  type BudgetReference,
  type CloudBudget,
} from "./cloudRepository";
import { emptyBudget, validateBudget, type BudgetData } from "./model";
import { decodeSetup, consumeSetupFragment } from "./preload";
export interface CloudView {
  onManage: () => void;
  name: string;
  saving: boolean;
  cloud: boolean;
}
function legacyBudget() {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    return raw ? validateBudget(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function consumeInvite() {
  const hash = window.location.hash;
  if (!hash.startsWith("#budget-invite=")) return "";
  window.history.replaceState(
    {},
    "",
    window.location.pathname + window.location.search,
  );
  return hash.slice(15);
}
export function BudgetCloud({
  children,
  onSwitchApp,
}: {
  children: (view: CloudView) => ReactNode;
  onSwitchApp: () => void;
}) {
  const [uid, setUid] = useState("");
  const [items, setItems] = useState<BudgetReference[] | null>(null);
  const [active, setActive] = useState("");
  const [budget, setBudget] = useState<CloudBudget | null>(null);
  const [manager, setManager] = useState(false);
  const [error, setError] = useState("");
  const [remoteNotice, setRemoteNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("Household budget");
  const [invite, setInvite] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [legacy] = useState(legacyBudget);
  const [upload, setUpload] = useState<BudgetData | null>(null);
  const [booting, setBooting] = useState(true);
  const [retry, setRetry] = useState(0);
  const current = useRef<CloudBudget | null>(null);
  current.current = budget;
  const pending = useRef(false);
  const undo = useRef<{ value: BudgetData; revision: number } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const migrationStarted = useRef(false);
  const [migrated, setMigrated] = useState(false);
  const bootInputs = useRef<{ setup: string | null; key: string } | null>(null);
  const boot = useRef<Promise<{
    uid: string;
    id: string;
    upload?: BudgetData;
    migrated?: boolean;
  }> | null>(null);
  useEffect(() => {
    let live = true;
    if (!boot.current)
      boot.current = (async () => {
        if (!bootInputs.current)
          bootInputs.current = {
            setup: consumeSetupFragment(),
            key: consumeInvite(),
          };
        const { setup, key } = bootInputs.current;
        let initial: BudgetData | null = null;
        if (setup) initial = await decodeSetup(setup);
        const identity = await budgetIdentity();
        if (initial) {
          return { uid: identity, id: "", upload: initial };
        }
        if (key) {
          const joined = await joinCloudBudget(identity, key);
          return { uid: identity, id: joined.id };
        }
        return {
          uid: identity,
          id: await lastBudget(identity),
          migrated: await legacyWasMigrated(identity),
        };
      })();
    boot.current
      .then((value) => {
        if (!live) return;
        setUid(value.uid);
        setMigrated(Boolean(value.migrated));
        if (value.upload) setUpload(value.upload);
        setActive(value.id);
        setManager(!value.id);
        setBooting(false);
      })
      .catch((e) => {
        if (live) {
          setError(e.message || "Could not connect to cloud budgets.");
          setBooting(false);
          boot.current = null;
        }
      });
    return () => {
      live = false;
    };
  }, [retry]);
  useEffect(() => {
    const changed = () => {
      if (
        window.location.hash.startsWith("#budget-invite=") ||
        window.location.hash.startsWith("#flow-plan=")
      )
        window.location.reload();
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (!uid) return;
    return listenBudgets(uid, setItems, (e) => setError(e.message));
  }, [uid]);
  useEffect(() => {
    if (!uid || !active) return;
    setBudget(null);
    setCanUndo(false);
    undo.current = null;
    setError("");
    return listenBudget(
      active,
      (value) => {
        if (
          current.current &&
          current.current.data.revision !== value.data.revision &&
          !pending.current
        )
          setRemoteNotice(
            "Budget updated on another device. Unsaved drafts are kept; review before saving.",
          );
        setBudget(value);
        if (undo.current && undo.current.revision !== value.data.revision) {
          undo.current = null;
          setCanUndo(false);
        }
      },
      (e) => {
        setError(
          "Could not open this budget. Use its private invite link on a new device. " +
            e.message,
        );
        setManager(true);
      },
    );
  }, [uid, active]);
  useEffect(() => {
    if (
      !uid ||
      items === null ||
      items.length ||
      active ||
      upload ||
      !legacy ||
      migrated ||
      migrationStarted.current
    )
      return;
    migrationStarted.current = true;
    setBusy(true);
    void createCloudBudget(uid, "Household budget", legacy, "legacy-" + uid)
      .then(async (created) => {
        await markLegacyMigrated(uid);
        setMigrated(true);
        setActive(created.id);
        setManager(false);
      })
      .catch((e) =>
        setError(
          "Your browser budget is intact. Cloud migration failed: " + e.message,
        ),
      )
      .finally(() => setBusy(false));
  }, [uid, items, active, upload, legacy, migrated]);
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }
  function open(id: string) {
    if (pending.current)
      throw new Error("Wait for the current save to finish.");
    if (id !== active) setBudget(null);
    setActive(id);
    setManager(false);
    setError("");
    void activateBudget(uid, id).catch((e) => setError(e.message));
  }
  async function commit(next: BudgetData) {
    if (pending.current)
      throw new Error("A save is already in progress. Wait for it to finish.");
    const source = current.current;
    if (!source || manager)
      throw new Error("Open a cloud budget before saving.");
    if (!navigator.onLine)
      throw new Error(
        "You are offline. Reconnect to save to Firestore. Your draft is kept.",
      );
    if (next.revision !== source.data.revision)
      throw new Error(
        "This budget changed on another device. Review your draft against the latest budget and save again.",
      );
    pending.current = true;
    setSaving(true);
    try {
      const saved = await saveCloudBudget(source.id, next);
      setBudget((previous) =>
        previous && previous.data.revision > saved.revision
          ? previous
          : { ...(previous ?? source), data: saved },
      );
      undo.current = { value: source.data, revision: saved.revision };
      setCanUndo(true);
      setError("");
      setRemoteNotice("");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  const store: BudgetStore = {
    data: budget?.data ?? emptyBudget(),
    commit,
    storageError: remoteNotice,
    canUndo,
    mode: "cloud",
    saving,
    undo: async () => {
      const previous = undo.current;
      if (!previous || !current.current) return;
      if (current.current.data.revision !== previous.revision)
        throw new Error("This budget changed. Undo is no longer available.");
      await commit({ ...previous.value, revision: previous.revision });
      undo.current = null;
      setCanUndo(false);
    },
  };
  if (booting)
    return (
      <div className="flow-cloud-page">
        <h1>Opening your cloud budgets…</h1>
        <p>Connecting to Firestore.</p>
      </div>
    );
  if (!manager && budget)
    return (
      <BudgetStoreContext.Provider value={store}>
        {children({
          name: budget.name,
          saving,
          cloud: true,
          onManage: () => {
            if (pending.current) return;
            setName(budget.name);
            setManager(true);
            setError("");
          },
        })}
      </BudgetStoreContext.Provider>
    );
  return (
    <div className="flow-cloud-page">
      <header>
        <div>
          <span className="flow-eyebrow">FLOWBUDGET · FIRESTORE</span>
          <h1>Budget manager</h1>
          <p>Separate budgets, shared across your devices.</p>
        </div>
        <button onClick={onSwitchApp} className="flow-button">
          Switch app
        </button>
      </header>
      {error && (
        <p className="flow-error" role="alert">
          {error}
        </p>
      )}
      {!uid ? (
        <button
          className="flow-button"
          onClick={() => {
            setBooting(true);
            setRetry(retry + 1);
          }}
        >
          Retry connection
        </button>
      ) : (
        <>
          {active && !budget && !manager && (
            <p role="status">Loading budget…</p>
          )}
          <div className="flow-cloud-grid">
            <section className="flow-panel">
              <h2>Your budgets</h2>
              {items === null ? (
                <p>Loading your list…</p>
              ) : items.length === 0 ? (
                <p>
                  No cloud budgets yet. Create one or open a private invitation.
                </p>
              ) : (
                <ul className="flow-cloud-list">
                  {items.map((item) => (
                    <li key={item.id}>
                      <button
                        className="flow-button"
                        disabled={busy}
                        onClick={() => open(item.id)}
                      >
                        {item.name}
                      </button>
                      <button
                        className="flow-text-button"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            if (
                              !window.confirm(
                                "Remove this budget from your list? Its data stays in Firestore. Keep its private link to open it again.",
                              )
                            )
                              return;
                            await forgetCloudBudget(uid, item.id);
                            if (active === item.id) {
                              setActive("");
                              setBudget(null);
                            }
                          })
                        }
                      >
                        Remove from my list
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {budget && (
                <>
                  <h3>Sharing: {budget.name}</h3>
                  <p>
                    Anyone with this private invitation can join and edit this
                    budget. Send it to your wife or open it on your phone. Keep
                    the link for access after clearing browser sign-in.
                  </p>
                  <label>
                    Private budget link
                    <input
                      readOnly
                      value={privateBudgetLink(budget.accessKey)}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <button
                    className="flow-button"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(privateBudgetLink(budget.accessKey))
                        .then(
                          () => setCopyMessage("Private link copied."),
                          () =>
                            setCopyMessage(
                              "Select and copy the private link above.",
                            ),
                        )
                    }
                  >
                    Copy private link
                  </button>
                  {copyMessage && <p role="status">{copyMessage}</p>}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void perform(async () => {
                        await renameCloudBudget(uid, budget, name);
                        setCopyMessage("Budget renamed.");
                      });
                    }}
                  >
                    <label>
                      Rename current budget
                      <input
                        value={name}
                        maxLength={100}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <button className="flow-button" disabled={busy}>
                      Rename budget
                    </button>
                  </form>
                </>
              )}
            </section>
            <section className="flow-panel">
              <h2>Create a budget</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform(async () => {
                    const created = await createCloudBudget(
                      uid,
                      name,
                      upload ?? emptyBudget(),
                    );
                    setUpload(null);
                    open(created.id);
                  });
                }}
              >
                <label>
                  Budget name
                  <input
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button className="flow-button primary" disabled={busy}>
                  {busy
                    ? "Saving…"
                    : upload
                      ? "Create budget from imported plan"
                      : "Create empty budget"}
                </button>
              </form>
              <label>
                Import JSON backup
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={async (e) => {
                    try {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 1000000)
                        throw new Error(
                          "Backup is too large for a cloud budget.",
                        );
                      setUpload(validateBudget(JSON.parse(await file.text())));
                      setError("");
                    } catch (err) {
                      setError(String(err));
                    }
                    e.target.value = "";
                  }}
                />
              </label>
              {upload && (
                <p>
                  Imported plan ready: {upload.accounts.length} accounts,{" "}
                  {upload.entries.length} transactions. Creating a budget will
                  upload the whole plan.
                </p>
              )}
              {legacy && (
                <div className="flow-cloud-migration">
                  <h3>Your previous browser budget was found</h3>
                  <p>
                    Upload its accounts, transactions, schedules and scenarios
                    to Firestore. The old browser copy is kept as a migration
                    backup and is no longer updated.
                  </p>
                  <button
                    className="flow-button"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const migrated = await createCloudBudget(
                          uid,
                          name,
                          legacy,
                          "legacy-" + uid,
                        );
                        await markLegacyMigrated(uid);
                        open(migrated.id);
                      })
                    }
                  >
                    Move existing budget to Firestore
                  </button>
                </div>
              )}
              <h2>Open a shared budget</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform(async () => {
                    const key = invite.includes("#budget-invite=")
                      ? invite.split("#budget-invite=")[1]
                      : invite.trim();
                    const joined = await joinCloudBudget(uid, key);
                    open(joined.id);
                    setInvite("");
                  });
                }}
              >
                <label>
                  Private invitation link or code
                  <input
                    required
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                  />
                </label>
                <button className="flow-button" disabled={busy}>
                  Open shared budget
                </button>
              </form>
            </section>
          </div>
          <p className="flow-help">
            Budget data is saved in Firestore. This browser keeps only its
            Firebase sign-in; it does not store the cloud budget locally.
            Removing a budget from your list does not delete its data.
          </p>
        </>
      )}
    </div>
  );
}
