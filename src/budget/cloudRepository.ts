import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
  deleteDoc,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import { emptyBudget, validateBudget, type BudgetData } from "./model";
export interface CloudBudget {
  id: string;
  name: string;
  ownerId: string;
  accessKey: string;
  data: BudgetData;
}
export interface BudgetReference {
  id: string;
  name: string;
}
let identity: Promise<string> | undefined;
export function budgetIdentity() {
  if (!identity)
    identity = new Promise<string>((resolve, reject) => {
      let off: (() => void) | undefined;
      off = onAuthStateChanged(
        auth,
        (user) => {
          off?.();
          if (user) resolve(user.uid);
          else
            signInAnonymously(auth).then(
              (result) => resolve(result.user.uid),
              reject,
            );
        },
        reject,
      );
    }).catch((e) => {
      identity = undefined;
      throw e;
    });
  return identity;
}
export function accessKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function serializeBudget(value: BudgetData) {
  const data = validateBudget(value);
  const dataJSON = JSON.stringify(data);
  if (new TextEncoder().encode(dataJSON).length > 750000)
    throw new Error(
      "This budget is too large for a cloud save. Export a backup and split older records into another budget.",
    );
  return { data, dataJSON };
}
export function readCloud(
  id: string,
  raw: Record<string, unknown>,
): CloudBudget {
  if (
    typeof raw.name !== "string" ||
    typeof raw.ownerId !== "string" ||
    typeof raw.accessKey !== "string" ||
    typeof raw.dataJSON !== "string"
  )
    throw new Error(
      "This cloud budget could not be read. It has not been overwritten.",
    );
  const data = validateBudget(JSON.parse(raw.dataJSON));
  if (data.revision !== raw.revision)
    throw new Error("Cloud budget revision is invalid.");
  return {
    id,
    name: raw.name,
    ownerId: raw.ownerId,
    accessKey: raw.accessKey,
    data,
  };
}
function ref(uid: string, id: string) {
  return doc(db, "flowBudgetUsers", uid, "budgets", id);
}
export function listenBudgets(
  uid: string,
  next: (items: BudgetReference[]) => void,
  error: (e: Error) => void,
) {
  return onSnapshot(
    collection(db, "flowBudgetUsers", uid, "budgets"),
    (snap) =>
      next(
        snap.docs
          .map((d) => ({
            id: d.id,
            name: String(d.data().name || "Untitled budget"),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    error,
  );
}
export function listenBudget(
  id: string,
  next: (budget: CloudBudget) => void,
  error: (e: Error) => void,
) {
  return onSnapshot(
    doc(db, "flowBudgets", id),
    { includeMetadataChanges: true },
    (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      try {
        if (!snap.exists()) throw new Error("This budget no longer exists.");
        next(readCloud(id, snap.data()));
      } catch (e) {
        error(e as Error);
      }
    },
    error,
  );
}
export async function rememberBudget(uid: string, budget: BudgetReference) {
  await setDoc(ref(uid, budget.id), {
    name: budget.name,
    budgetId: budget.id,
    updatedAt: serverTimestamp(),
  });
  await setDoc(
    doc(db, "flowBudgetUsers", uid),
    { activeBudgetId: budget.id },
    { merge: true },
  );
}
export async function lastBudget(uid: string) {
  const snap = await getDoc(doc(db, "flowBudgetUsers", uid));
  return snap.exists() && typeof snap.data().activeBudgetId === "string"
    ? (snap.data().activeBudgetId as string)
    : "";
}
export async function createCloudBudget(
  uid: string,
  name: string,
  value = emptyBudget(),
  id: string = crypto.randomUUID(),
) {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 100)
    throw new Error("Enter a budget name of 1–100 characters.");
  const { data, dataJSON } = serializeBudget({ ...value, revision: 0 });
  const key = accessKey();
  const existing = await getDoc(doc(db, "flowBudgets", id));
  if (existing.exists()) {
    const found = readCloud(id, existing.data());
    await rememberBudget(uid, found);
    return found;
  }
  const batch = writeBatch(db);
  batch.set(doc(db, "flowBudgets", id), {
    name: cleanName,
    ownerId: uid,
    accessKey: key,
    dataJSON,
    revision: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, "flowBudgetInvites", key), { budgetId: id, ownerId: uid });
  batch.set(ref(uid, id), {
    budgetId: id,
    name: cleanName,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  const budget = { id, name: cleanName, ownerId: uid, accessKey: key, data };
  await rememberBudget(uid, budget);
  return budget;
}
export async function joinCloudBudget(uid: string, key: string) {
  if (!/^[a-f0-9]{64}$/.test(key))
    throw new Error("That private budget link is invalid.");
  const invite = await getDoc(doc(db, "flowBudgetInvites", key));
  if (!invite.exists())
    throw new Error(
      "That invitation is unavailable. Ask for a new private budget link.",
    );
  const id = invite.data().budgetId;
  if (typeof id !== "string") throw new Error("That invitation is invalid.");
  await setDoc(doc(db, "flowBudgetInvites", key, "members", uid), { uid });
  const snap = await getDoc(doc(db, "flowBudgets", id));
  if (!snap.exists()) throw new Error("This budget is unavailable.");
  const budget = readCloud(id, snap.data());
  await rememberBudget(uid, budget);
  return budget;
}
export async function saveCloudBudget(id: string, next: BudgetData) {
  const expected = next.revision;
  const { data, dataJSON } = serializeBudget({
    ...next,
    revision: expected + 1,
  });
  await runTransaction(db, async (tx) => {
    const target = doc(db, "flowBudgets", id),
      snap = await tx.get(target);
    if (!snap.exists()) throw new Error("This budget is unavailable.");
    if (snap.data().revision !== expected)
      throw new Error(
        "This budget changed on another device. The latest data is loading. Your draft is kept; review it before saving again.",
      );
    tx.update(target, {
      dataJSON,
      revision: data.revision,
      updatedAt: serverTimestamp(),
    });
  });
  return data;
}
export async function renameCloudBudget(
  uid: string,
  budget: CloudBudget,
  name: string,
) {
  name = name.trim();
  if (!name || name.length > 100)
    throw new Error("Enter a budget name of 1–100 characters.");
  await runTransaction(db, async (tx) => {
    const target = doc(db, "flowBudgets", budget.id),
      snap = await tx.get(target);
    if (!snap.exists()) throw new Error("Budget unavailable.");
    tx.update(target, {
      name,
      revision: snap.data().revision + 1,
      dataJSON: JSON.stringify({
        ...validateBudget(JSON.parse(snap.data().dataJSON)),
        revision: snap.data().revision + 1,
      }),
      updatedAt: serverTimestamp(),
    });
  });
  await rememberBudget(uid, { id: budget.id, name });
}
export async function forgetCloudBudget(uid: string, id: string) {
  await deleteDoc(ref(uid, id));
  await setDoc(
    doc(db, "flowBudgetUsers", uid),
    { activeBudgetId: "" },
    { merge: true },
  );
}
export function privateBudgetLink(key: string) {
  return (
    window.location.origin +
    window.location.pathname +
    "?app=budget#budget-invite=" +
    key
  );
}

export async function legacyWasMigrated(uid: string) {
  const snap = await getDoc(doc(db, "flowBudgetUsers", uid));
  return snap.exists() && snap.data().legacyMigrated === true;
}
export async function markLegacyMigrated(uid: string) {
  await setDoc(
    doc(db, "flowBudgetUsers", uid),
    { legacyMigrated: true },
    { merge: true },
  );
}

export async function activateBudget(uid: string, id: string) {
  const snap = await getDoc(doc(db, "flowBudgets", id));
  if (!snap.exists()) throw new Error("Budget unavailable.");
  await rememberBudget(uid, readCloud(id, snap.data()));
}
