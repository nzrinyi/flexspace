import { addDays, dateObject, localDate } from "./dates";
export type BusinessDayPolicy = "none" | "weekdays" | "canada-on";
function easter(year: number) {
  const a = year % 19,
    b = Math.floor(year / 100),
    c = year % 100,
    d = Math.floor(b / 4),
    e = b % 4,
    f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31),
    day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
const cache = new Map<number, Set<string>>();
export function canadianBankHolidays(year: number) {
  if (cache.has(year)) return cache.get(year)!;
  const dates = new Set<string>();
  const add = (month: number, day: number) => {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    dates.add(date);
    let observed = date;
    while (
      [0, 6].includes(dateObject(observed).getDay()) ||
      (dates.has(observed) && observed !== date)
    )
      observed = addDays(observed, 1);
    dates.add(observed);
  };
  const monday = (month: number, n: number) => {
    const first = new Date(year, month - 1, 1, 12);
    const day = 1 + ((8 - first.getDay()) % 7) + 7 * (n - 1);
    dates.add(localDate(new Date(year, month - 1, day, 12)));
  };
  add(1, 1);
  monday(2, 3);
  dates.add(addDays(easter(year), -2));
  const may25 = `${year}-05-25`;
  let victoria = addDays(may25, -1);
  while (dateObject(victoria).getDay() !== 1) victoria = addDays(victoria, -1);
  dates.add(victoria);
  add(7, 1);
  monday(8, 1);
  monday(9, 1);
  add(9, 30);
  monday(10, 2);
  add(11, 11);
  // Distinct substitute days when Christmas and Boxing Day fall on a weekend.
  dates.add(`${year}-12-25`);
  dates.add(`${year}-12-26`);
  for (const raw of [`${year}-12-25`, `${year}-12-26`]) {
    let observed = raw;
    if ([0, 6].includes(dateObject(raw).getDay())) {
      do {
        observed = addDays(observed, 1);
      } while (
        [0, 6].includes(dateObject(observed).getDay()) ||
        dates.has(observed)
      );
      dates.add(observed);
    }
  }
  cache.set(year, dates);
  return dates;
}
export function businessDate(date: string, policy: BusinessDayPolicy = "none") {
  if (policy === "none") return date;
  let result = date;
  for (let i = 0; i < 14; i++) {
    const day = dateObject(result).getDay();
    if (
      day !== 0 &&
      day !== 6 &&
      (policy !== "canada-on" ||
        !canadianBankHolidays(+result.slice(0, 4)).has(result))
    )
      return result;
    result = addDays(result, 1);
  }
  throw new Error("Could not resolve a posting business day.");
}
