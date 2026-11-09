import { validateBudget, type BudgetData } from "./model";
// The fragment is never part of an HTTP request. Consume it before any navigation.
export function consumeSetupFragment(): string | null {
  const fragment = window.location.hash;
  if (!fragment.startsWith("#flow-plan=")) return null;
  const value = fragment.slice("#flow-plan=".length);
  window.history.replaceState(
    {},
    "",
    window.location.pathname + window.location.search,
  );
  return value;
}
export async function decodeSetup(encoded: string): Promise<BudgetData> {
  if (encoded.length > 32000)
    throw new Error("Setup link is too large. Restore a JSON backup instead.");
  if (typeof DecompressionStream === "undefined")
    throw new Error(
      "This browser cannot open compressed setup links. Restore the JSON backup in Settings instead.",
    );
  const input = Uint8Array.from(
    atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  const reader = new Blob([input])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1000000) {
      await reader.cancel();
      throw new Error("Setup data is too large.");
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  return validateBudget(JSON.parse(new TextDecoder().decode(all)));
}
