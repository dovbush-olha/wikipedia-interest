import { UserError } from "./cli.ts";

// Months are "YYYY-MM" strings; all arithmetic is in UTC. Such strings also compare correctly as text.

export type MonthRange = { start: string; end: string };
export type Period = MonthRange & { months: number };

/** The first 12 and the last 12 months of a requested period must not overlap. */
export const MIN_MONTHS = 24;
export const DEFAULT_MONTHS = 24;
/** The first month the Wikimedia Pageviews API has data for. */
export const FIRST_MONTH = "2015-07";

/** The raw --start, --end and --months arguments. */
export type PeriodArgs = { start?: string; end?: string; months?: string };

/**
 * The requested period: --start with --end, or --months with --end.
 * --end defaults to the last completed month before `today` (YYYY-MM-DD), --months to DEFAULT_MONTHS.
 */
export function requestedPeriod(args: PeriodArgs, today: string): Period {
  const lastCompleted = addMonths(today.slice(0, 7), -1);
  if (args.start !== undefined && args.months !== undefined) {
    throw new UserError(
      "--start and --months cannot be used together: both set where the period begins. " +
        "Rerun and pass --start with --end, or --months with --end.",
    );
  }
  const end = args.end === undefined ? lastCompleted : parseMonthArg("--end", args.end, lastCompleted);
  if (end > lastCompleted) {
    throw new UserError(
      `--end ${end} is not a completed month yet (today is ${today}, UTC). ` +
        `Rerun with --end ${lastCompleted} or earlier, or without --end to end at ${lastCompleted}.`,
    );
  }
  const start = args.start === undefined ? startFromLength(args.months, end) : startFromArg(args.start, end, lastCompleted);

  const months = monthsBetween(start, end);
  if (months < MIN_MONTHS) {
    const fix = args.start === undefined ? `--months ${MIN_MONTHS} or more` : `--start ${addMonths(end, -(MIN_MONTHS - 1))} or earlier`;
    throw new UserError(
      `the requested period ${start} - ${end} has ${months} months; it must have at least ${MIN_MONTHS}, ` +
        `so the first and the last 12 months do not overlap. Rerun with ${fix}.`,
    );
  }
  return { start, end, months };
}

function startFromArg(value: string, end: string, lastCompleted: string): string {
  const start = parseMonthArg("--start", value, addMonths(lastCompleted, -(DEFAULT_MONTHS - 1)));
  if (start > end) {
    throw new UserError(`--start ${start} is after --end ${end}. Rerun with --start earlier than --end.`);
  }
  if (start < FIRST_MONTH) {
    throw new UserError(`--start ${start} is before ${FIRST_MONTH}, the first month of Wikimedia pageviews. Rerun with --start ${FIRST_MONTH} or later.`);
  }
  return start;
}

/** The first month of `--months` (default DEFAULT_MONTHS) months ending at `end`. */
function startFromLength(value: string | undefined, end: string): string {
  const months = value === undefined ? DEFAULT_MONTHS : parseMonthsArg(value);
  // Compared before any date arithmetic: a huge --months would overflow Date.
  const available = monthsBetween(FIRST_MONTH, end);
  if (months > available) {
    const length = value === undefined ? `the default ${months} months` : `--months ${months}`;
    const fix = available >= MIN_MONTHS ? `--months ${available} or fewer` : `--end ${addMonths(FIRST_MONTH, MIN_MONTHS - 1)} or later`;
    throw new UserError(`${length} ending ${end} starts before ${FIRST_MONTH}, the first month of Wikimedia pageviews. Rerun with ${fix}.`);
  }
  return addMonths(end, -(months - 1));
}

export function monthsOf(period: Period): string[] {
  return Array.from({ length: period.months }, (_, i) => addMonths(period.start, i));
}

export function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = splitMonth(month);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/** Last calendar day of a month, as DD. */
export function lastDayOf(month: string): string {
  const [year, monthNumber] = splitMonth(month);
  return String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0");
}

/** Number of months from `start` to `end`, both included. */
function monthsBetween(start: string, end: string): number {
  const [startYear, startMonth] = splitMonth(start);
  const [endYear, endMonth] = splitMonth(end);
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
}

function parseMonthArg(flag: string, value: string, example: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new UserError(`${flag} must be a month as YYYY-MM, got ${JSON.stringify(value)}. Rerun with e.g. ${flag} ${example}.`);
  }
  return value;
}

function parseMonthsArg(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new UserError(`--months must be a positive whole number of months, got ${JSON.stringify(value)}. Rerun with e.g. --months 36.`);
  }
  return Number(value);
}

function splitMonth(month: string): [year: number, month: number] {
  const [year, monthNumber] = month.split("-").map(Number);
  return [year, monthNumber];
}
