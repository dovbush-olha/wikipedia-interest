import type { MonthPoint } from "./analysis.ts";
import type { MonthlyViews } from "./pageviews.ts";

const PER_MILLION = 1_000_000;
const RECENT_MONTHS = 12;

/**
 * Relative attention per month: article views per million views of the language edition.
 * Gaps after the article's first month with data are zero views; months before it are missing (null).
 */
export function relativeAttentionSeries(months: string[], article: MonthlyViews, edition: MonthlyViews): MonthPoint[] {
  const first = months.findIndex((month) => article.has(month));
  return months.map((month, i) => {
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

/** Median relative attention over the last 12 months of the series; null when there is no data. */
export function viewsPerMillion(series: MonthPoint[]): number | null {
  const recent = series
    .slice(-RECENT_MONTHS)
    .map((point) => point.relative_attention)
    .filter((value) => value !== null);
  return recent.length === 0 ? null : round(median(recent), 2);
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
