import { useEffect, useState } from "react";
export const app = {},
  db = {},
  auth = {};
export const analyticsPromise = Promise.resolve(null);
const user = { uid: "browser-test-user" };
const records = new Map<string, any>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
export const serverTimestamp = () => ({ seconds: 1 });
export const deleteField = () => ({ op: "delete" });
export const increment = (n: number) => ({ op: "increment", n });
export const arrayUnion = (id: string) => ({ op: "union", id });
export function collection(_db: any, ...parts: string[]) {
  return { path: parts.join("/") };
}
export function doc(first: any, ...parts: string[]) {
  const path = first.path
    ? `${first.path}/${parts.length ? parts.join("/") : crypto.randomUUID()}`
    : parts.join("/");
  return { path, id: path.split("/").at(-1) };
}
function snapshot(path: string) {
  return {
    id: path.split("/").at(-1),
    exists: () => records.has(path),
    data: () => records.get(path),
  };
}
export async function getDoc(ref: any) {
  return snapshot(ref.path);
}
function merge(a: any, b: any): any {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && (v as any).op === "delete") delete out[k];
    else if (v && typeof v === "object" && (v as any).op === "increment")
      out[k] = (a?.[k] ?? 0) + (v as any).n;
    else if (v && typeof v === "object" && (v as any).op === "union")
      out[k] = [...new Set([...(a?.[k] ?? []), (v as any).id])];
    else if (v && typeof v === "object" && !Array.isArray(v))
      out[k] = merge(a?.[k] ?? {}, v);
    else out[k] = v;
  }
  return out;
}
export async function setDoc(ref: any, data: any, options?: any) {
  if (
    (window as any).__failNextWrite &&
    /dealQuotes|testDriveDiary|vehicleNotes/.test(ref.path)
  ) {
    (window as any).__failNextWrite = false;
    throw new Error("Simulated connection failure");
  }
  records.set(
    ref.path,
    options?.merge ? merge(records.get(ref.path) ?? {}, data) : merge({}, data),
  );
  notify();
}
export const updateDoc = (ref: any, data: any) =>
  setDoc(ref, data, { merge: true });
export const signInAnonymously = async () => ({ user });
export function useAuthState() {
  return [user, false, undefined];
}
function collectionSnapshot(path: string) {
  return {
    docs: [...records.keys()]
      .filter(
        (k) =>
          k.startsWith(path + "/") && !k.slice(path.length + 1).includes("/"),
      )
      .map(snapshot),
  };
}
export function useCollection(ref: any) {
  const [value, setValue] = useState<any>();
  useEffect(() => {
    if (!ref) {
      setValue(undefined);
      return;
    }
    const update = () => setValue(collectionSnapshot(ref.path));
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, [ref?.path]);
  return [value, false, undefined];
}
export const query = (ref: any, ..._args: any[]) => ref;
export const orderBy = (..._args: any[]) => null;
export function onSnapshot(ref: any, next: any) {
  const update = () => next(collectionSnapshot(ref.path));
  update();
  listeners.add(update);
  return () => listeners.delete(update);
}
