import type { MeasuredTopic, ReportLang } from "./analysis.ts";
import { UserError } from "./cli.ts";
import { getJson } from "./http.ts";

// Labels and sitelinks change rarely, but they do change; refetch them weekly.
const WIKIDATA_MAX_AGE_DAYS = 7;

type Term = { language: string; value: string };
type Entity = {
  id: string;
  missing?: string;
  labels?: Record<string, Term>;
  descriptions?: Record<string, Term>;
  sitelinks?: Record<string, { title: string }>;
};

export type ResolvedTopic = {
  topic: MeasuredTopic;
  /** Current article title per language edition, or null when no article is linked. */
  titles: Map<string, string | null>;
};

/** The measured topic for a QID: its label in the report language and its article in each language edition. */
export async function resolveQid(qid: string, langs: string[], reportLang: ReportLang): Promise<ResolvedTopic> {
  const termLangs = [...new Set([reportLang, "en"])];
  const url =
    "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json" +
    `&ids=${qid}&props=labels%7Cdescriptions%7Csitelinks` +
    `&languages=${termLangs.join("%7C")}&sitefilter=${langs.map(siteKey).join("%7C")}`;
  const { body } = await getJson(url, { maxAgeDays: WIKIDATA_MAX_AGE_DAYS });

  const response = body as { entities?: Record<string, Entity>; error?: { code: string; info: string } };
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

function pickTerm(terms: Record<string, Term> | undefined, preference: string[]): Term | undefined {
  return preference.map((lang) => terms?.[lang]).find((term) => term !== undefined);
}

// Wikidata site IDs use underscores: zh-yue.wikipedia is zh_yuewiki.
function siteKey(lang: string): string {
  return `${lang.replaceAll("-", "_")}wiki`;
}
