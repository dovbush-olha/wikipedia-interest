import { CONCURRENT_REQUESTS, mapLimited } from "./http.ts";
import { wikipediaQuery } from "./wikipedia.ts";

// Pageviews count views by the title a reader opened, so after a rename the article's past views stay under its historical title.
// A historical title is only a redirect confirmed by the move log to have been a title of this very article:
// other redirects often come from narrower or separate topics whose views have trends of their own.

/** Redirect candidates checked per article; the check is truncated past this many, and may miss historical titles. */
export const MAX_REDIRECT_CANDIDATES = 50;

export type ArticleHistory = {
  /** Historical titles of the article, confirmed by the move log, in redirect order. */
  historical_titles: string[];
  redirect_candidates_checked: number;
  /** The article has more redirects than MAX_REDIRECT_CANDIDATES, and only that many were checked. */
  truncated: boolean;
};

type RedirectsResponse = {
  query?: { pages?: { pageid?: number; missing?: boolean; redirects?: { title: string }[] }[] };
  continue?: Record<string, string>;
};
type MoveLogResponse = { query?: { logevents?: { logpage: number }[] } };

/** The historical titles of the article currently titled `title` in the `lang` edition. */
export async function articleHistory(lang: string, title: string): Promise<ArticleHistory> {
  const { pageId, candidates, truncated } = await redirectCandidates(lang, title);
  const checked = candidates.slice(0, MAX_REDIRECT_CANDIDATES);
  // The page ID survives a rename: a move of the candidate title logged for this page ID is a rename of this very article.
  const confirmed = await mapLimited(checked, CONCURRENT_REQUESTS, async (candidate) => {
    // A title moved more than 500 times, the most one page of the log holds, is not worth a second page.
    const log = await wikipediaQuery<MoveLogResponse>(
      lang,
      { list: "logevents", letype: "move", letitle: candidate, leprop: "ids|title", lelimit: "max" },
      `move log request for the history of the article "${title}"`,
    );
    return (log.query?.logevents ?? []).some((event) => event.logpage === pageId);
  });
  return {
    historical_titles: checked.filter((_, i) => confirmed[i]),
    redirect_candidates_checked: checked.length,
    truncated,
  };
}

/**
 * The article's page ID and the redirects to it in the main namespace, as candidates for historical titles.
 * MediaWiki filters the namespace after it applies the limit, so a page of results can be short and still continue:
 * pages are followed until there are more candidates than get checked, or no more pages.
 * A title the edition does not have (a stale sitelink) has no candidates; its views then come out as a short history.
 */
async function redirectCandidates(lang: string, title: string): Promise<{ pageId: number | null; candidates: string[]; truncated: boolean }> {
  const candidates: string[] = [];
  let pageId: number | null = null;
  let next: Record<string, string> | undefined = {};
  while (next !== undefined && candidates.length <= MAX_REDIRECT_CANDIDATES) {
    const response: RedirectsResponse = await wikipediaQuery<RedirectsResponse>(
      lang,
      { prop: "redirects", rdprop: "title", rdnamespace: "0", rdlimit: "max", titles: title, ...next },
      `redirect list request for the history of the article "${title}"`,
    );
    const page = response.query?.pages?.[0];
    if (page === undefined || page.missing || page.pageid === undefined) break;
    pageId = page.pageid;
    candidates.push(...(page.redirects ?? []).map((redirect) => redirect.title));
    next = response.continue;
  }
  return { pageId, candidates, truncated: candidates.length > MAX_REDIRECT_CANDIDATES };
}
