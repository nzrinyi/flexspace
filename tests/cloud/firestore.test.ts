import { readFileSync } from "node:fs";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  writeBatch,
  updateDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
let env: RulesTestEnvironment;
const key = "a".repeat(64),
  id = "household";
function context(uid: string) {
  return env.authenticatedContext(uid).firestore();
}
function payload(ownerId = "owner") {
  return {
    name: "Household",
    ownerId,
    accessKey: key,
    dataJSON: JSON.stringify({ revision: 0 }),
    revision: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}
async function create() {
  const db = context("owner"),
    batch = writeBatch(db);
  batch.set(doc(db, "flowBudgets", id), payload());
  batch.set(doc(db, "flowBudgetInvites", key), {
    budgetId: id,
    ownerId: "owner",
  });
  batch.set(doc(db, "flowBudgetUsers", "owner", "budgets", id), {
    budgetId: id,
    name: "Household",
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return db;
}
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-flexspace",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
});
after(async () => {
  await env.cleanup();
});
test("owner creates a private budget and directory entry in an atomic batch", async () => {
  const db = await create();
  assert.equal(
    (await getDoc(doc(db, "flowBudgets", id))).data()?.name,
    "Household",
  );
  await assertSucceeds(
    getDocs(collection(db, "flowBudgetUsers", "owner", "budgets")),
  );
});
test("strangers cannot read, list or modify financial data or another device's budget directory", async () => {
  await create();
  const stranger = context("stranger");
  await assertFails(getDoc(doc(stranger, "flowBudgets", id)));
  await assertFails(getDocs(collection(stranger, "flowBudgets")));
  await assertFails(getDocs(collection(stranger, "flowBudgetInvites")));
  await assertFails(
    getDocs(collection(stranger, "flowBudgetUsers", "owner", "budgets")),
  );
  await assertFails(
    updateDoc(doc(stranger, "flowBudgets", id), {
      dataJSON: "{}",
      revision: 1,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    getDoc(doc(env.unauthenticatedContext().firestore(), "flowBudgets", id)),
  );
});
test("a second device joins with a private invite and receives and writes live budget updates", async () => {
  const owner = await create(),
    phone = context("phone");
  const invitation = await getDoc(doc(phone, "flowBudgetInvites", key));
  assert.equal(invitation.data()?.budgetId, id);
  await setDoc(doc(phone, "flowBudgetInvites", key, "members", "phone"), {
    uid: "phone",
  });
  await assertSucceeds(getDoc(doc(phone, "flowBudgets", id)));
  await setDoc(doc(phone, "flowBudgetUsers", "phone", "budgets", id), {
    budgetId: id,
    name: "Household",
    updatedAt: serverTimestamp(),
  });
  await runTransaction(phone, async (tx) => {
    const target = doc(phone, "flowBudgets", id),
      snapshot = await tx.get(target);
    tx.update(target, {
      dataJSON: JSON.stringify({ revision: 1, shared: true }),
      revision: snapshot.data()!.revision + 1,
      updatedAt: serverTimestamp(),
    });
  });
  assert.equal(
    JSON.parse((await getDoc(doc(owner, "flowBudgets", id))).data()!.dataJSON)
      .shared,
    true,
  );
});
test("membership cannot be forged without an existing invitation or on behalf of someone else", async () => {
  await create();
  const db = context("intruder");
  await assertFails(
    setDoc(
      doc(db, "flowBudgetInvites", "b".repeat(64), "members", "intruder"),
      { uid: "intruder" },
    ),
  );
  await assertFails(
    setDoc(doc(db, "flowBudgetInvites", key, "members", "owner"), {
      uid: "owner",
    }),
  );
  await assertFails(
    setDoc(doc(db, "flowBudgetInvites", "b".repeat(64)), {
      budgetId: id,
      ownerId: "intruder",
    }),
  );
  await assertFails(
    setDoc(doc(db, "flowBudgetUsers", "intruder", "budgets", id), {
      budgetId: id,
      name: "Stolen",
      updatedAt: serverTimestamp(),
    }),
  );
});
test("revision checks reject stale updates and access-control fields cannot be overwritten", async () => {
  const db = await create();
  await updateDoc(doc(db, "flowBudgets", id), {
    dataJSON: JSON.stringify({ revision: 1 }),
    revision: 1,
    updatedAt: serverTimestamp(),
  });
  await assertFails(
    updateDoc(doc(db, "flowBudgets", id), {
      dataJSON: "{}",
      revision: 1,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    updateDoc(doc(db, "flowBudgets", id), {
      ownerId: "someone-else",
      revision: 2,
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    updateDoc(doc(db, "flowBudgets", id), {
      accessKey: "b".repeat(64),
      revision: 2,
      updatedAt: serverTimestamp(),
    }),
  );
});
