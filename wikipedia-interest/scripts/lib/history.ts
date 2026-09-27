import { UserError } from "./cli.ts";
import { getJson } from "./http.ts";

// Pageviews count views by the title a reader opened, so after a rename the article's past views stay under its former title.
// A former title is only a redirect confirmed by the move log to have been a title of this very article:
// other redirects often come from narrower or separate topics whose views have trends of their own.

/** Redirects checked per article; the check is truncated past this many, and may miss former titles. */
export const MAX_REDIRECT_CANDIDATES = 50;
// Redirects and renames change rarely, but they do change; refetch them weekly.
const MAX_AGE_DAYS = 7;
// Move log lookups of one article at a time: Wikimedia asks API clients not to flood it with parallel requests.
const CONCURRENT_LOOKUPS = 4;

export type ArticleHistory = {
  /** Former titles of the article, confirmed by the move log, in redirect order. */
  historical_titles: string[];
  redirect_candidates_checked: number;
  /** The article has more redirects than MAX_REDIRECT_CANDIDATES, and only that many were checked. */
  truncated: boolean;
};

type RedirectsResponse = {
  query?: { pages?: { pageid?: number; missing?: boolean; redirects?: { title: string }[] }[] };
  continue?: Record<string, string>;
  error?: { info: string };
};
type MoveLogResponse = { query?: { logevents?: { logpage: number }[] }; error?: { info: string } };

/** The former titles of the article currently titled `title` in the `lang` edition. */
export async function articleHistory(lang: string, title: string): Promise<ArticleHistory> {
  const { pageId, candidates, truncated } = await redirectCandidates(lang, title);
  const checked = candidates.slice(0, MAX_REDIRECT_CANDIDATES);
  // The page ID survives a rename: a move of the candidate title logged for this page ID is a rename of this very article.
  const confirmed = await mapLimited(checked, CONCURRENT_LOOKUPS, async (candidate) => {
    const log = await wikipediaApi<MoveLogResponse>(lang, "move log", {
      list: "logevents",
      letype: "move",
      letitle: candidate,
      leprop: "ids|title",
      lelimit: "max",
    });
    return (log.query?.logevents ?? []).some((event) => event.logpage === pageId);
  });
  return {
    historical_titles: checked.filter((_, i) => confirmed[i]),
    redirect_candidates_checked: checked.length,
    truncated,
  };
}

/**
 * The article's page ID and the redirects to it in the main namespace, as candidates for former titles.
 * MediaWiki filters the namespace after it applies the limit, so a page of results can be short and still continue:
 * pages are followed until there are more candidates than get checked, or no more pages.
 */
async function redirectCandidates(lang: string, title: string): Promise<{ pageId: number | null; candidates: string[]; truncated: boolean }> {
  const candidates: string[] = [];
  let pageId: number | null = null;
  let next: Record<string, string> | undefined = {};
  while (next !== undefined && candidates.length <= MAX_REDIRECT_CANDIDATES) {
    const response: RedirectsResponse = await wikipediaApi<RedirectsResponse>(lang, "redirect list", {
      prop: "redirects",
      rdprop: "title",
      rdnamespace: "0",
      rdlimit: "max",
      titles: title,
      ...next,
    });
    const page = response.query?.pages?.[0];
    if (page === undefined || page.missing || page.pageid === undefined) break;
    pageId = page.pageid;
    candidates.push(...(page.redirects ?? []).map((redirect) => redirect.title));
    next = response.continue;
  }
  return { pageId, candidates, truncated: candidates.length > MAX_REDIRECT_CANDIDATES };
}

async function wikipediaApi<T extends { error?: { info: string } }>(lang: string, what: string, params: Record<string, string>): Promise<T> {
  const host = `${lang}.wikipedia.org`;
  const search = new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params });
  const { body } = await getJson(`https://${host}/w/api.php?${search}`, { maxAgeDays: MAX_AGE_DAYS });
  const response = body as T;
  if (response.error !== undefined) throw new UserError(`${host} rejected the ${what} request for the article history: ${response.error.info}`);
  return response;
}

/** Like Promise.all over `items.map(task)`, with at most `limit` tasks running at a time; results keep the input order. */
async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
