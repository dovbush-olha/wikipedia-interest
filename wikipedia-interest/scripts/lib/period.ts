// Months are "YYYY-MM" strings; all arithmetic is in UTC.

export type Period = { start: string; end: string; months: number };

export const DEFAULT_MONTHS = 24;

/** The last DEFAULT_MONTHS fully completed months before `today` (YYYY-MM-DD). */
export function defaultPeriod(today: string): Period {
  const end = addMonths(today.slice(0, 7), -1);
  return { start: addMonths(end, -(DEFAULT_MONTHS - 1)), end, months: DEFAULT_MONTHS };
}

export function monthsOf(period: Period): string[] {
  return Array.from({ length: period.months }, (_, i) => addMonths(period.start, i));
}

export function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = parseMonth(month);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/** Last calendar day of a month, as DD. */
export function lastDayOf(month: string): string {
  const [year, monthNumber] = parseMonth(month);
  return String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0");
}

function parseMonth(month: string): [year: number, month: number] {
  const [year, monthNumber] = month.split("-").map(Number);
  return [year, monthNumber];
}
