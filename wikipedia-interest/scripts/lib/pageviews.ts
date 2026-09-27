import { UserError } from "./cli.ts";
import { getJson } from "./http.ts";
import { lastDayOf, monthsOf, type Period } from "./period.ts";

// Only human traffic on every platform: bots and crawlers would inflate the signal.
const BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews";
const ACCESS_AGENT = "all-access/user";

/** Monthly views keyed by "YYYY-MM"; months Wikimedia returned nothing for are absent. */
export type MonthlyViews = Map<string, number>;

type Item = { timestamp: string; views: number };

/** All human views of a language edition, per month. Every month of the period must be published. */
export async function editionViews(lang: string, period: Period): Promise<MonthlyViews> {
  const url = `${BASE}/aggregate/${lang}.wikipedia/${ACCESS_AGENT}/monthly/${range(period)}`;
  const isComplete = (body: unknown) => toMonthly(body).size === period.months;
  const { status, body } = await getJson(url, { cacheIf: isComplete });

  if (status === 404) {
    throw new UserError(`Wikimedia has no pageviews for ${lang}.wikipedia. Check the language code in --langs.`);
  }
  const views = toMonthly(body);
  const months = monthsOf(period);
  const missing = months.filter((month) => !views.has(month));
  if (missing.length === 0) return views;

  const lastPublished = months.findLast((month) => views.has(month));
  const unpublished = lastPublished === undefined ? months : months.slice(months.indexOf(lastPublished) + 1);
  if (missing.length === unpublished.length) {
    // Only the latest months are missing: the usual state in the first days of a month.
    const fix =
      lastPublished === undefined
        ? "Rerun later."
        : `Rerun with --end ${lastPublished} to end at the last published month, or rerun later.`;
    throw new UserError(
      `Wikimedia has not published ${lang}.wikipedia pageviews for ${missing.join(", ")} yet; ` +
        `monthly data usually appears within the first days of the next month. ${fix}`,
    );
  }
  throw new UserError(
    `Wikimedia has no ${lang}.wikipedia pageviews for ${missing.join(", ")}, inside the requested period. ` +
      `Rerun without ${lang} and tell the user ${lang} could not be assessed for this period.`,
  );
}

/** Human views of an article under all its `titles`, current and former, summed per month. */
export async function articleViews(lang: string, titles: string[], period: Period): Promise<MonthlyViews> {
  const total: MonthlyViews = new Map();
  for (const views of await Promise.all(titles.map((title) => titleViews(lang, title, period)))) {
    for (const [month, count] of views) total.set(month, (total.get(month) ?? 0) + count);
  }
  return total;
}

/** Human views of one title, per month. */
async function titleViews(lang: string, title: string, period: Period): Promise<MonthlyViews> {
  const article = encodeURIComponent(title.replaceAll(" ", "_"));
  const url = `${BASE}/per-article/${lang}.wikipedia/${ACCESS_AGENT}/${article}/monthly/${range(period)}`;
  const { status, body } = await getJson(url);
  // 404 means no recorded views for this title in the whole range.
  return status === 404 ? new Map() : toMonthly(body);
}

function range(period: Period): string {
  const compact = (month: string) => month.replace("-", "");
  return `${compact(period.start)}0100/${compact(period.end)}${lastDayOf(period.end)}00`;
}

function toMonthly(body: unknown): MonthlyViews {
  const items = (body as { items?: Item[] }).items ?? [];
  return new Map(items.map((item) => [`${item.timestamp.slice(0, 4)}-${item.timestamp.slice(4, 6)}`, item.views]));
}
