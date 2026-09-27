import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "./cli.ts";
import type { Period } from "./period.ts";

// The analysis result: written by analyze.ts to analysis.json, read by report.ts.

export const REPORT_LANGS = ["uk", "en"] as const;
export type ReportLang = (typeof REPORT_LANGS)[number];

export const ANALYSIS_FILE = "analysis.json";

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
  article_views: number | null;
  edition_views: number;
  relative_attention: number | null;
};

export type LanguageResult = {
  lang: string;
  title: string;
  views_per_million: number | null;
  series: MonthPoint[];
};

export type Analysis = {
  status: "ok";
  user_question: string;
  report_lang: ReportLang;
  /** The date (YYYY-MM-DD) the default period was derived from. */
  as_of: string;
  measured_topic: MeasuredTopic;
  period: Period;
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
