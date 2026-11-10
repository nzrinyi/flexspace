import { readFileSync } from "node:fs";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
let env: RulesTestEnvironment;
function context(uid: string) {
  return env.authenticatedContext(uid).firestore();
}
function payload() {
  return {
    name: "Household",
    dataJSON: JSON.stringify({ revision: 0 }),
    revision: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
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
test("all devices can list and open household budgets without invitations", async () => {
  const desktop = context("desktop"),
    phone = context("phone");
  await setDoc(doc(desktop, "flowBudgets", "household"), payload());
  assert.equal((await getDocs(collection(phone, "flowBudgets"))).size, 1);
  assert.equal(
    (await getDoc(doc(phone, "flowBudgets", "household"))).data()?.name,
    "Household",
  );
});
test("the selected household budget is shared across devices", async () => {
  const desktop = context("desktop"),
    phone = context("phone");
  await setDoc(doc(desktop, "flowBudgetWorkspace", "household"), {
    activeBudgetId: "household",
  });
  assert.equal(
    (await getDoc(doc(phone, "flowBudgetWorkspace", "household"))).data()
      ?.activeBudgetId,
    "household",
  );
});
test("a second device can save the same budget while stale revisions are rejected", async () => {
  const desktop = context("desktop"),
    phone = context("phone");
  await setDoc(doc(desktop, "flowBudgets", "household"), payload());
  await updateDoc(doc(phone, "flowBudgets", "household"), {
    dataJSON: JSON.stringify({ revision: 1 }),
    revision: 1,
    updatedAt: serverTimestamp(),
  });
  assert.equal(
    (await getDoc(doc(desktop, "flowBudgets", "household"))).data()?.revision,
    1,
  );
  await assertFails(
    updateDoc(doc(desktop, "flowBudgets", "household"), {
      dataJSON: "{}",
      revision: 1,
      updatedAt: serverTimestamp(),
    }),
  );
});
test("existing budgets remain accessible regardless of their former owner metadata", async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "flowBudgets", "old"), {
      ...payload(),
      ownerId: "old-device",
      accessKey: "a".repeat(64),
    });
  });
  const phone = context("new-phone");
  assert.equal(
    (await getDoc(doc(phone, "flowBudgets", "old"))).data()?.name,
    "Household",
  );
  await updateDoc(doc(phone, "flowBudgets", "old"), {
    dataJSON: JSON.stringify({ revision: 1 }),
    revision: 1,
    updatedAt: serverTimestamp(),
  });
});
test("invalid budget documents and destructive deletes remain rejected", async () => {
  const db = context("desktop");
  await assertFails(
    setDoc(doc(db, "flowBudgets", "invalid"), { name: "Missing budget data" }),
  );
  await assertFails(
    getDocs(
      collection(env.unauthenticatedContext().firestore(), "flowBudgets"),
    ),
  );
});
