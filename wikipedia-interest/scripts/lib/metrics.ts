import type { MonthPoint } from "./analysis.ts";
import type { MonthlyViews } from "./pageviews.ts";
import { addMonths, type MonthRange, type Period } from "./period.ts";

const PER_MILLION = 1_000_000;
/**
 * Months in a year: growth compares the first and the last this many months of the requested period,
 * and the recent metrics (views per million, consistency, low volume, recent spikes) cover the last this many.
 */
const YEAR = 12;
/** A relative attention growth within ±this many percent (inclusive) is a `flat` trend. */
export const FLAT_GROWTH_PCT = 10;
/** The index of the median relative attention of the first 12 months: the baseline of the chart. */
export const BASELINE_INDEX = 100;

/** heuristic_v1: recent months in the trend's direction needed for `high` and for `moderate`; fewer is `low`. */
export const HIGH_RELIABILITY_MIN_MONTHS = 9;
export const MODERATE_RELIABILITY_MIN_MONTHS = 7;
export const RELIABILITY_METHOD = "heuristic_v1";
/** heuristic_v1 lowers reliability one step when the raw views median of the last 12 months is below this. */
export const LOW_VOLUME_MEDIAN_VIEWS = 100;
/** A spike is a month with raw views above this many times the raw views median of the period. */
export const SPIKE_MEDIAN_MULTIPLE = 3;

export type Trend = "up" | "down" | "flat";
/** Lowest first: a downgrade moves one step towards the start. */
const RELIABILITY_LEVELS = ["low", "moderate", "high"] as const;
export type TrendReliability = (typeof RELIABILITY_LEVELS)[number];

/** Reason codes that lower trend reliability, shared with the report that explains them. */
export const LOW_VOLUME = "low_volume";
export const HISTORY_CHECK_TRUNCATED = "history_check_truncated";
const RECENT_SPIKE = "recent_spike:";

/** The spike month of a `recent_spike:YYYY-MM` reason, else null. */
export function recentSpikeMonth(reason: string): string | null {
  return reason.startsWith(RECENT_SPIKE) ? reason.slice(RECENT_SPIKE.length) : null;
}
export type RecentTrendConsistency = { positive_months: number; months_compared: number };

/** The metrics of a language edition with data for the whole requested period. */
export type AssessedMetrics = {
  data_status: "ok";
  series: MonthPoint[];
  views_per_million: number;
  relative_attention_growth_pct: number;
  raw_growth_pct: number;
  edition_growth_pct: number | null;
  recent_trend_consistency: RecentTrendConsistency;
  trend: Trend;
  /** A product heuristic, not a statistical confidence. Null for a flat trend. */
  trend_reliability: TrendReliability | null;
  reliability_method: typeof RELIABILITY_METHOD;
  /** Machine codes: why trend_reliability has its level. */
  reliability_reasons: string[];
  /** Machine codes: facts about the data worth a limitation in the report. */
  flags: string[];
};

/**
 * Not enough data to assess the topic over the whole requested period; says nothing about low attention.
 * - no_linked_article: the language edition has no article linked to the measured topic in Wikidata.
 * - short_history: the article has data for only `max_months_available` months up to the end of the period.
 * - zero_baseline: the median relative attention of the first 12 months is zero, so there is nothing to compare against.
 */
type Insufficient<Reason> = { data_status: "insufficient_data" } & Reason & { trend: null; trend_reliability: null };
export type NoLinkedArticle = Insufficient<{ reason: "no_linked_article" }>;
/** A linked article whose views cannot assess the topic; `flags` says when a truncated history check may be why. */
export type InsufficientHistory = Insufficient<{ reason: "short_history"; max_months_available: number } | { reason: "zero_baseline" }> & {
  flags: string[];
};
export type InsufficientData = NoLinkedArticle | InsufficientHistory;

export type LanguageMetrics = AssessedMetrics | InsufficientHistory;

export type GrowthCompares = { first_12_months: MonthRange; last_12_months: MonthRange };

/** How completely the article's redirects were checked for historical titles: `truncated` when some were not. */
export type HistoryCheck = { truncated: boolean };

/**
 * Every metric of one language edition over the requested `months`, from its article and edition views;
 * insufficient_data when they cannot assess the topic over the whole period.
 * A truncated `history` check may have missed historical titles, and so views of the article.
 */
export function languageMetrics(
  months: string[],
  article: MonthlyViews,
  edition: MonthlyViews,
  history: HistoryCheck = { truncated: false },
): LanguageMetrics {
  const historyFlags = history.truncated ? [HISTORY_CHECK_TRUNCATED] : [];
  // Months before the article's first month with data are missing (it did not exist yet), not zero views.
  const first = months.findIndex((month) => article.has(month));
  if (first !== 0) {
    const available = first === -1 ? 0 : months.length - first;
    return { ...insufficientData({ reason: "short_history", max_months_available: available }), flags: historyFlags };
  }
  const series = relativeAttentionSeries(months, article, edition);
  const raw = series.map((point) => point.article_views);
  const relative = unroundedAttention(series);
  // Edition views are never zero, so a zero relative attention baseline is also a zero raw views baseline.
  const relativeGrowth = growthPct(relative);
  const rawGrowth = growthPct(raw);
  if (relativeGrowth === null || rawGrowth === null) return { ...insufficientData({ reason: "zero_baseline" }), flags: historyFlags };
  // Decided on the rounded growth, so the reported number and the trend never disagree.
  const trend = trendOf(relativeGrowth);
  const changes = yearOverYear(relative);

  const spikes = spikeMonths(raw, months);
  const recentSpikes = spikes.filter((month) => month >= months[months.length - YEAR]);
  const lowVolume = median(raw.slice(-YEAR)) < LOW_VOLUME_MEDIAN_VIEWS;
  const diverge = trend !== "flat" && trendOf(rawGrowth) === opposite(trend);

  return {
    data_status: "ok",
    series,
    views_per_million: round(median(relative.slice(-YEAR)), 2),
    relative_attention_growth_pct: relativeGrowth,
    raw_growth_pct: rawGrowth,
    edition_growth_pct: growthPct(series.map((point) => point.edition_views)),
    recent_trend_consistency: { positive_months: changes.filter((change) => change > 0).length, months_compared: changes.length },
    trend,
    ...reliability(trend, changes, lowVolume, recentSpikes, history.truncated),
    flags: [
      ...spikes.map((month) => `spike:${month}`),
      ...(lowVolume ? [LOW_VOLUME] : []),
      ...(diverge ? ["raw_relative_diverge"] : []),
      ...historyFlags,
    ],
  };
}

/** A language edition that cannot be assessed: it has no trend and no trend reliability. */
export function insufficientData<Reason extends { reason: InsufficientData["reason"] }>(details: Reason): Insufficient<Reason> {
  return { data_status: "insufficient_data", ...details, trend: null, trend_reliability: null };
}

/**
 * heuristic_v1: the level from the recent months in the trend's direction, then one step lower (never below `low`)
 * for low volume, one for any spike in the last 12 months and one for a truncated history check.
 * Raw/relative divergence does not lower it.
 */
function reliability(
  trend: Trend,
  changes: number[],
  lowVolume: boolean,
  recentSpikes: string[],
  historyTruncated: boolean,
): Pick<AssessedMetrics, "trend_reliability" | "reliability_method" | "reliability_reasons"> {
  if (trend === "flat") {
    return { trend_reliability: null, reliability_method: RELIABILITY_METHOD, reliability_reasons: [] };
  }
  const matching = changes.filter((change) => (trend === "up" ? change > 0 : change < 0)).length;
  let level = matching >= HIGH_RELIABILITY_MIN_MONTHS ? 2 : matching >= MODERATE_RELIABILITY_MIN_MONTHS ? 1 : 0;
  const reasons = [`direction_matches_in_${matching}_of_${changes.length}_recent_months`];
  if (lowVolume) {
    level = Math.max(0, level - 1);
    reasons.push(LOW_VOLUME);
  }
  if (recentSpikes.length > 0) {
    level = Math.max(0, level - 1);
    reasons.push(...recentSpikes.map((month) => `${RECENT_SPIKE}${month}`));
  }
  if (historyTruncated) {
    level = Math.max(0, level - 1);
    reasons.push(HISTORY_CHECK_TRUNCATED);
  }
  return { trend_reliability: RELIABILITY_LEVELS[level], reliability_method: RELIABILITY_METHOD, reliability_reasons: reasons };
}

/**
 * Months whose raw views are above SPIKE_MEDIAN_MULTIPLE times the raw views median of the period.
 * None at a zero median: any month with views would be above it, which says nothing about a spike.
 */
function spikeMonths(raw: number[], months: string[]): string[] {
  const periodMedian = median(raw);
  if (periodMedian === 0) return [];
  return months.filter((_, i) => raw[i] > SPIKE_MEDIAN_MULTIPLE * periodMedian);
}

function opposite(trend: "up" | "down"): Trend {
  return trend === "up" ? "down" : "up";
}

function trendOf(growthPct: number): Trend {
  if (growthPct > FLAT_GROWTH_PCT) return "up";
  if (growthPct < -FLAT_GROWTH_PCT) return "down";
  return "flat";
}

/** Each of the last 12 months minus the same month a year earlier. */
function yearOverYear(values: number[]): number[] {
  return values.slice(-YEAR).map((value, i) => value - values[values.length - 2 * YEAR + i]);
}

/**
 * Relative attention per month as an index: the median of the first 12 months of the requested period is BASELINE_INDEX,
 * the same base as relative_attention_growth_pct. Only for an assessed series, whose first-year median is not zero.
 */
export function indexedAttention(series: MonthPoint[]): number[] {
  const relative = unroundedAttention(series);
  const baseline = median(relative.slice(0, YEAR));
  return relative.map((value) => (value / baseline) * BASELINE_INDEX);
}

/** Unrounded: in a large edition, rounding to the series' 3 decimals would distort growth, tie months and zero the baseline. */
function unroundedAttention(series: MonthPoint[]): number[] {
  return series.map((point) => (point.article_views / point.edition_views) * PER_MILLION);
}

/** The months each growth compares: the first and the last 12 of the requested period. */
export function growthCompares(period: Period): GrowthCompares {
  return {
    first_12_months: { start: period.start, end: addMonths(period.start, YEAR - 1) },
    last_12_months: { start: addMonths(period.end, -(YEAR - 1)), end: period.end },
  };
}

/**
 * Change of the last-12-month median against the first-12-month median, in percent.
 * Null when the first 12 months have a zero median, so there is nothing to compare against.
 */
function growthPct(values: number[]): number | null {
  const first = median(values.slice(0, YEAR));
  if (first === 0) return null;
  return round((median(values.slice(-YEAR)) / first - 1) * 100, 1);
}

/**
 * Relative attention per month: article views per million views of the language edition.
 * The article has data from the first month on, so a month without data is zero views.
 */
function relativeAttentionSeries(months: string[], article: MonthlyViews, edition: MonthlyViews): MonthPoint[] {
  return months.map((month) => {
    // editionViews() fails unless every month of the period is published.
    const editionViews = edition.get(month) as number;
    const articleViews = article.get(month) ?? 0;
    return {
      month,
      article_views: articleViews,
      edition_views: editionViews,
      relative_attention: round((articleViews / editionViews) * PER_MILLION, 3),
    };
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
