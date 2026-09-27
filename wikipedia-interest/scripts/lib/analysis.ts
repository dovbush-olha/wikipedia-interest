import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "./cli.ts";
import type { AssessedMetrics, GrowthCompares, InsufficientHistory, NoLinkedArticle } from "./metrics.ts";
import type { Period } from "./period.ts";

// The analysis result: written by analyze.ts to analysis.json, read by report.ts.

export const REPORT_LANGS = ["uk", "en"] as const;
export type ReportLang = (typeof REPORT_LANGS)[number];

export const ANALYSIS_FILE = "analysis.json";

/** Language editions one analysis may compare: every one of them, assessed or not, takes room on the one-page report. */
export const MAX_LANGUAGES = 6;

export type MeasuredTopic = {
  qid: string;
  label: string;
  /** Language of `label`: the report language, else English; null when Wikidata has neither and the QID is shown. */
  label_lang: string | null;
  description: string | null;
  description_lang: string | null;
};

export type MonthPoint = {
  month: string;
  article_views: number;
  edition_views: number;
  relative_attention: number;
};

/** `title` is the current article title; null only when no article is linked. */
export type AssessedLanguage = { lang: string; title: string } & AssessedMetrics;
export type NotAssessedLanguage = ({ lang: string; title: null } & NoLinkedArticle) | ({ lang: string; title: string } & InsufficientHistory);
export type LanguageResult = AssessedLanguage | NotAssessedLanguage;

export type Analysis = {
  status: "ok";
  user_question: string;
  report_lang: ReportLang;
  /** The date (YYYY-MM-DD) the default --end was derived from. */
  as_of: string;
  measured_topic: MeasuredTopic;
  period: Period;
  /** The months every growth in `languages` compares. */
  growth_compares: GrowthCompares;
  languages: LanguageResult[];
};

export function readAnalysis(runDir: string): Analysis {
  const file = join(runDir, ANALYSIS_FILE);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new UserError(`no ${ANALYSIS_FILE} in ${runDir}. Run analyze.ts with --out-dir ${runDir} first.`);
  }
  let analysis: Analysis;
  try {
    analysis = JSON.parse(text) as Analysis;
  } catch {
    throw new UserError(`${file} is not valid JSON. Rerun analyze.ts with --out-dir ${runDir}.`);
  }
  if (analysis.status !== "ok" || !REPORT_LANGS.includes(analysis.report_lang) || !Array.isArray(analysis.languages)) {
    throw new UserError(`${file} is not a successful analysis result. Rerun analyze.ts with --out-dir ${runDir}.`);
  }
  return analysis;
}
