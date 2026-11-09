export const TODAY = () => localDate(new Date());
export function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function dateObject(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
export function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = +s.slice(0, 4);
  return y >= 2000 && y <= 2100 && localDate(dateObject(s)) === s;
}
export function addDays(s: string, n: number) {
  const d = dateObject(s);
  d.setDate(d.getDate() + n);
  return localDate(d);
}
export function nextMonth(month: string, n: number) {
  const d = dateObject(`${month}-01`);
  d.setMonth(d.getMonth() + n);
  return localDate(d).slice(0, 7);
}
export function displayDate(s: string, short = false, includeYear = !short) {
  return dateObject(s).toLocaleDateString("en-CA", {
    month: short ? "short" : "long",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}
