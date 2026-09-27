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
  const missing = monthsOf(period).filter((month) => !views.has(month));
  if (missing.length > 0) {
    throw new UserError(
      `Wikimedia has not published ${lang}.wikipedia pageviews for ${missing.join(", ")} yet. ` +
        "Monthly data usually appears within the first days of the next month; rerun later.",
    );
  }
  return views;
}

/** Human views of one article title, per month. */
export async function articleViews(lang: string, title: string, period: Period): Promise<MonthlyViews> {
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
