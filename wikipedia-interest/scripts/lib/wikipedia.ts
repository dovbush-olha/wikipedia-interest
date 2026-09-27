import { UserError } from "./cli.ts";
import { getJson } from "./http.ts";

/** Titles, redirects, renames, labels and search results change rarely, but they do change; refetch them weekly. */
export const MAX_AGE_DAYS = 7;

/**
 * One `action=query` request to the `lang` Wikipedia; `params` go into the URL in the order given,
 * and the URL doubles as the cache key of recorded fixtures.
 * `request` names it in the error when Wikipedia rejects it, e.g. "topic lookup".
 */
export async function wikipediaQuery<T>(lang: string, params: Record<string, string>, request: string): Promise<T> {
  const host = `${lang}.wikipedia.org`;
  const search = new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params });
  const { body } = await getJson(`https://${host}/w/api.php?${search}`, { maxAgeDays: MAX_AGE_DAYS });
  const response = body as T & { error?: { info: string } };
  if (response.error !== undefined) throw new UserError(`${host} rejected the ${request}: ${response.error.info}`);
  return response;
}
