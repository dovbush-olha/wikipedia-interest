import type { ReportLang } from "./analysis.ts";
import { UserError } from "./cli.ts";
import { getJson, UnreachableError } from "./http.ts";
import { MAX_AGE_DAYS, wikipediaQuery } from "./wikipedia.ts";

/** Candidates offered to the agent when the topic is not one exact match. */
const MAX_CANDIDATES = 5;
// Search results that are disambiguation pages or lack a Wikidata item are dropped, so ask for more than we keep.
const SEARCH_LIMIT = 10;

type Term = { language: string; value: string };
type Entity = {
  id: string;
  missing?: string;
  labels?: Record<string, Term>;
  descriptions?: Record<string, Term>;
  sitelinks?: Record<string, { title: string }>;
};
type EntitiesResponse = { entities?: Record<string, Entity>; error?: { code: string; info: string } };

/** The Wikidata item behind the measured topic, with its label and description in the report language or English. */
export type WikidataTopic = {
  qid: string;
  label: string;
  /** Language of `label`: the report language, else English; null when Wikidata has neither and the QID is shown. */
  label_lang: string | null;
  description: string | null;
  description_lang: string | null;
};

export type ResolvedTopic = {
  topic: WikidataTopic;
  /** Current article title per language edition, or null when no article is linked. */
  titles: Map<string, string | null>;
};

/** How --topic became the measured topic: the article of that title in the --topic-lang edition. */
export type TopicMatch = {
  query: string;
  topic_lang: string;
  title: string;
  /** The redirect --topic was, when it was one: the article may be broader than the topic of the question. */
  redirected_from: string | null;
};

export type Candidate = {
  qid: string;
  /** The article title in the --topic-lang edition. */
  title: string;
  description: string | null;
  /** Language of `description`: the report language, else English. */
  description_lang: string | null;
  /** "<editions with an article>/<requested editions>". */
  coverage: string;
  missing_langs: string[];
};

/** Why --topic was not taken as the measured topic as is. */
export type ChoiceReason = "disambiguation_page" | "redirect_to_section" | "no_exact_match";

const CHOICE_REASONS: Record<Exclude<ExactMatch["kind"], "article">, ChoiceReason> = {
  disambiguation: "disambiguation_page",
  section: "redirect_to_section",
  none: "no_exact_match",
};

export type TopicResolution =
  | { status: "ok"; qid: string; match: TopicMatch }
  | { status: "needs_choice"; reason: ChoiceReason; candidates: Candidate[] }
  | { status: "not_found" };

/** The measured topic for a QID: its label in the report language and its article in each language edition. */
export async function resolveQid(qid: string, langs: string[], reportLang: ReportLang): Promise<ResolvedTopic> {
  const termLangs = termLangsFor(reportLang);
  const response = await wikidataEntities([qid], "labels%7Cdescriptions%7Csitelinks", termLangs, langs);
  const entity = Object.values(response.entities ?? {})[0];
  if (response.error?.code === "no-such-entity" || entity === undefined || entity.missing !== undefined) {
    throw new UserError(`${qid} does not exist in Wikidata. Check the QID and rerun.`);
  }
  if (response.error !== undefined) {
    throw new UserError(`Wikidata rejected the request for ${qid}: ${response.error.info}`);
  }

  const label = pickTerm(entity.labels, termLangs);
  const description = pickTerm(entity.descriptions, termLangs);
  return {
    topic: {
      qid: entity.id,
      label: label?.value ?? entity.id,
      label_lang: label?.language ?? null,
      description: description?.value ?? null,
      description_lang: description?.language ?? null,
    },
    titles: new Map(langs.map((lang) => [lang, entity.sitelinks?.[siteKey(lang)]?.title ?? null])),
  };
}

/**
 * The measured topic for free text: the article titled exactly `query` in the `topicLang` edition, redirects followed.
 * Otherwise search candidates for the agent to choose from, never picked here, even when there is only one.
 */
export async function resolveTopic(query: string, topicLang: string, langs: string[], reportLang: ReportLang): Promise<TopicResolution> {
  const exact = await exactMatch(query, topicLang);
  if (exact.kind === "article") {
    return {
      status: "ok",
      qid: exact.page.qid,
      match: { query, topic_lang: topicLang, title: exact.page.title, redirected_from: exact.redirectedFrom },
    };
  }

  // The article a section redirect points into is the closest candidate, so it comes first.
  const pages = [...(exact.kind === "section" ? [exact.page] : []), ...(await search(query, topicLang))];
  const unique = pages.filter((page, i) => pages.findIndex((other) => other.qid === page.qid) === i).slice(0, MAX_CANDIDATES);
  const candidates = await withCoverage(unique, langs, reportLang);
  if (candidates.length === 0) return { status: "not_found" };
  return { status: "needs_choice", reason: CHOICE_REASONS[exact.kind], candidates };
}

type ArticleRef = { title: string; qid: string };
type ExactMatch =
  | { kind: "article"; page: ArticleRef; redirectedFrom: string | null }
  | { kind: "section"; page: ArticleRef }
  | { kind: "disambiguation" }
  | { kind: "none" };

type WikipediaPage = {
  ns: number;
  title: string;
  index?: number;
  missing?: boolean;
  invalid?: boolean;
  pageprops?: { wikibase_item?: string; disambiguation?: string };
};
type QueryResponse = {
  query?: { pages?: WikipediaPage[]; redirects?: { from: string; to: string; tofragment?: string }[] };
  error?: { code: string; info: string };
};

async function exactMatch(query: string, topicLang: string): Promise<ExactMatch> {
  // A title never contains "#": MediaWiki would drop it and what follows, so "C#" would match the letter C.
  if (query.includes("#")) return { kind: "none" };
  const response = await topicQuery(topicLang, { titles: query, redirects: "1" });
  const page = response.query?.pages?.[0];
  if (page === undefined || page.missing || page.invalid || page.ns !== 0) return { kind: "none" };
  if (page.pageprops?.disambiguation !== undefined) return { kind: "disambiguation" };
  const qid = page.pageprops?.wikibase_item;
  if (qid === undefined) return { kind: "none" };

  const redirect = response.query?.redirects?.[0];
  if (redirect?.tofragment !== undefined) return { kind: "section", page: { title: page.title, qid } };
  return { kind: "article", page: { title: page.title, qid }, redirectedFrom: redirect?.from ?? null };
}

/** Full-text search results in search order, without disambiguation pages and pages without a Wikidata item. */
async function search(query: string, topicLang: string): Promise<ArticleRef[]> {
  const response = await topicQuery(topicLang, {
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "0",
    gsrlimit: String(SEARCH_LIMIT),
  });
  return (response.query?.pages ?? [])
    .toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .flatMap((page) => {
      const qid = page.pageprops?.wikibase_item;
      return page.pageprops?.disambiguation === undefined && qid !== undefined ? [{ title: page.title, qid }] : [];
    });
}

/** A lookup in the --topic-lang edition, with the Wikidata item and disambiguation flag of every page. */
async function topicQuery(topicLang: string, params: Record<string, string>): Promise<QueryResponse> {
  try {
    return await wikipediaQuery<QueryResponse>(topicLang, { ...params, prop: "pageprops", ppprop: "wikibase_item|disambiguation" }, "topic lookup");
  } catch (error) {
    if (!(error instanceof UnreachableError)) throw error;
    throw new UserError(`${error.message} If the network works, check that --topic-lang ${topicLang} is a Wikipedia language code.`);
  }
}

/** Candidates with a description and their coverage of `langs`, from one batched Wikidata request. */
async function withCoverage(pages: ArticleRef[], langs: string[], reportLang: ReportLang): Promise<Candidate[]> {
  if (pages.length === 0) return [];
  const termLangs = termLangsFor(reportLang);
  const response = await wikidataEntities(pages.map((page) => page.qid), "descriptions%7Csitelinks", termLangs, langs);
  if (response.error !== undefined) throw new UserError(`Wikidata rejected the request for the topic candidates: ${response.error.info}`);

  return pages.flatMap((page) => {
    const entity = response.entities?.[page.qid];
    // A Wikipedia article can still point at an item that was merged or deleted since.
    if (entity === undefined || entity.missing !== undefined) return [];
    const missing = langs.filter((lang) => entity.sitelinks?.[siteKey(lang)] === undefined);
    const description = pickTerm(entity.descriptions, termLangs);
    return [
      {
        qid: page.qid,
        title: page.title,
        description: description?.value ?? null,
        description_lang: description?.language ?? null,
        coverage: `${langs.length - missing.length}/${langs.length}`,
        missing_langs: missing,
      },
    ];
  });
}

/** One wbgetentities request; `props` is already URL-encoded, and the URL doubles as the cache key of recorded fixtures. */
async function wikidataEntities(ids: string[], props: string, termLangs: string[], langs: string[]): Promise<EntitiesResponse> {
  const url =
    "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json" +
    `&ids=${ids.join("%7C")}&props=${props}` +
    `&languages=${termLangs.join("%7C")}&sitefilter=${langs.map(siteKey).join("%7C")}`;
  const { body } = await getJson(url, { maxAgeDays: MAX_AGE_DAYS });
  return body as EntitiesResponse;
}

function termLangsFor(reportLang: ReportLang): string[] {
  return [...new Set([reportLang, "en"])];
}

function pickTerm(terms: Record<string, Term> | undefined, preference: string[]): Term | undefined {
  return preference.map((lang) => terms?.[lang]).find((term) => term !== undefined);
}

// Wikidata site IDs use underscores: zh-yue.wikipedia is zh_yuewiki.
function siteKey(lang: string): string {
  return `${lang.replaceAll("-", "_")}wiki`;
}
