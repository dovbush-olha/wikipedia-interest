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
const RECENT_SPIKE = "recent_spike:";

/** The spike month of a `recent_spike:YYYY-MM` reason, else null. */
export function recentSpikeMonth(reason: string): string | null {
  return reason.startsWith(RECENT_SPIKE) ? reason.slice(RECENT_SPIKE.length) : null;
}
export type RecentTrendConsistency = { positive_months: number; months_compared: number };

export type LanguageMetrics = {
  series: MonthPoint[];
  views_per_million: number | null;
  relative_attention_growth_pct: number | null;
  raw_growth_pct: number | null;
  edition_growth_pct: number | null;
  recent_trend_consistency: RecentTrendConsistency;
  /** Null when relative attention growth is null. */
  trend: Trend | null;
  /** A product heuristic, not a statistical confidence. Null unless the trend is up or down. */
  trend_reliability: TrendReliability | null;
  reliability_method: typeof RELIABILITY_METHOD;
  /** Machine codes: why trend_reliability has its level. */
  reliability_reasons: string[];
  /** Machine codes: facts about the data worth a limitation in the report. */
  flags: string[];
};

export type GrowthCompares = { first_12_months: MonthRange; last_12_months: MonthRange };

/** Every metric of one language edition over the requested `months`, from its article and edition views. */
export function languageMetrics(months: string[], article: MonthlyViews, edition: MonthlyViews): LanguageMetrics {
  const series = relativeAttentionSeries(months, article, edition);
  const raw = series.map((point) => point.article_views);
  // Unrounded: in a large edition, rounding to the series' 3 decimals would distort growth and tie months.
  const relative = series.map((point) => (point.article_views === null ? null : (point.article_views / point.edition_views) * PER_MILLION));
  const relativeGrowth = growthPct(relative);
  const rawGrowth = growthPct(raw);
  // Decided on the rounded growth, so the reported number and the trend never disagree.
  const trend = relativeGrowth === null ? null : trendOf(relativeGrowth);
  const changes = yearOverYear(relative);

  const spikes = spikeMonths(series);
  const recentSpikes = spikes.filter((month) => month >= months[months.length - YEAR]);
  const lowVolume = (medianOf(raw.slice(-YEAR)) ?? 0) < LOW_VOLUME_MEDIAN_VIEWS;
  const diverge = trend !== null && trend !== "flat" && rawGrowth !== null && trendOf(rawGrowth) === opposite(trend);

  return {
    series,
    views_per_million: roundOrNull(medianOf(relative.slice(-YEAR)), 2),
    relative_attention_growth_pct: relativeGrowth,
    raw_growth_pct: rawGrowth,
    edition_growth_pct: growthPct(series.map((point) => point.edition_views)),
    recent_trend_consistency: { positive_months: changes.filter((change) => change > 0).length, months_compared: changes.length },
    trend,
    ...reliability(trend, changes, lowVolume, recentSpikes),
    flags: [
      ...spikes.map((month) => `spike:${month}`),
      ...(lowVolume ? [LOW_VOLUME] : []),
      ...(diverge ? ["raw_relative_diverge"] : []),
    ],
  };
}

/**
 * heuristic_v1: the level from the recent months in the trend's direction, then one step lower (never below `low`)
 * for low volume and one for any spike in the last 12 months. Raw/relative divergence does not lower it.
 */
function reliability(
  trend: Trend | null,
  changes: number[],
  lowVolume: boolean,
  recentSpikes: string[],
): Pick<LanguageMetrics, "trend_reliability" | "reliability_method" | "reliability_reasons"> {
  if (trend === null || trend === "flat") {
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
  return { trend_reliability: RELIABILITY_LEVELS[level], reliability_method: RELIABILITY_METHOD, reliability_reasons: reasons };
}

/**
 * Months whose raw views are above SPIKE_MEDIAN_MULTIPLE times the raw views median of the period.
 * None at a zero median: any month with views would be above it, which says nothing about a spike.
 */
function spikeMonths(series: MonthPoint[]): string[] {
  const periodMedian = medianOf(series.map((point) => point.article_views));
  if (periodMedian === null || periodMedian === 0) return [];
  return series
    .filter((point) => point.article_views !== null && point.article_views > SPIKE_MEDIAN_MULTIPLE * periodMedian)
    .map((point) => point.month);
}

function opposite(trend: "up" | "down"): Trend {
  return trend === "up" ? "down" : "up";
}

function trendOf(growthPct: number): Trend {
  if (growthPct > FLAT_GROWTH_PCT) return "up";
  if (growthPct < -FLAT_GROWTH_PCT) return "down";
  return "flat";
}

/** Each of the last 12 months minus the same month a year earlier; months without data on either side are left out. */
function yearOverYear(values: (number | null)[]): number[] {
  const changes: number[] = [];
  for (let i = values.length - YEAR; i < values.length; i++) {
    const current = values[i];
    const yearEarlier = values[i - YEAR];
    if (current !== null && yearEarlier !== null) changes.push(current - yearEarlier);
  }
  return changes;
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
 * Null when the first 12 months have no data or a zero median, so there is nothing to compare against.
 */
function growthPct(values: (number | null)[]): number | null {
  const first = medianOf(values.slice(0, YEAR));
  const last = medianOf(values.slice(-YEAR));
  if (first === null || last === null || first === 0) return null;
  return round((last / first - 1) * 100, 1);
}

function roundOrNull(value: number | null, digits: number): number | null {
  return value === null ? null : round(value, digits);
}

function medianOf(values: (number | null)[]): number | null {
  const known = values.filter((value) => value !== null);
  return known.length === 0 ? null : median(known);
}

/**
 * Relative attention per month: article views per million views of the language edition.
 * Gaps after the article's first month with data are zero views; months before it are missing (null).
 */
function relativeAttentionSeries(months: string[], article: MonthlyViews, edition: MonthlyViews): MonthPoint[] {
  const first = months.findIndex((month) => article.has(month));
  return months.map((month, i) => {
    // editionViews() fails unless every month of the period is published.
    const editionViews = edition.get(month) as number;
    const articleViews = first === -1 || i < first ? null : (article.get(month) ?? 0);
    return {
      month,
      article_views: articleViews,
      edition_views: editionViews,
      relative_attention: articleViews === null ? null : round((articleViews / editionViews) * PER_MILLION, 3),
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
