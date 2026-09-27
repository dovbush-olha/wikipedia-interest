import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Conclusion } from "../scripts/lib/conclusion.ts";
import { SKILL_DIR } from "../scripts/lib/env.ts";

export type CliResult = { status: number | null; stdout: string; stderr: string };

export function runCli(script: "analyze" | "report", args: string[], env: Record<string, string> = {}): CliResult {
  const result = spawnSync(process.execPath, [join(SKILL_DIR, "scripts", `${script}.ts`), ...args], {
    cwd: SKILL_DIR,
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "wikipedia-interest-test-"));
}

// Offline replay of recorded Wikimedia responses with a fixed "today".
export function fixtureEnv(fixture: string, now: string): Record<string, string> {
  return {
    EVAL_WIKI_INTEREST_NOW: now,
    EVAL_WIKI_INTEREST_CACHE_DIR: `tests/fixtures/${fixture}`,
    EVAL_WIKI_INTEREST_OFFLINE: "1",
  };
}

// Offline with an empty cache: any attempt to reach Wikimedia fails with an "offline mode" error.
export function noNetworkEnv(now: string): Record<string, string> {
  return {
    EVAL_WIKI_INTEREST_NOW: now,
    EVAL_WIKI_INTEREST_CACHE_DIR: tempDir(),
    EVAL_WIKI_INTEREST_OFFLINE: "1",
  };
}

// Q333 (astronomy) in uk, cs and pl, recorded on 2026-09-15: the default period is 2024-09..2026-08.
export const ASTRONOMY = fixtureEnv("astronomy-uk-cs-pl", "2026-09-15");

// Also recorded for 2024-03..2026-08, and for 2024-10..2026-09 on 2026-09-27, before Wikimedia published 2026-09.
// Also recorded on 2026-09-27: --topic Astronomy (en) and астрономія (uk), and Q130192, which has no uk label and no article in uk, cs or pl.
export function analyzeAstronomy(
  outDir: string,
  question: string,
  {
    reportLang = "uk",
    periodArgs = [],
    extraArgs = [],
    env = ASTRONOMY,
  }: { reportLang?: "uk" | "en"; periodArgs?: string[]; extraArgs?: string[]; env?: Record<string, string> } = {},
): CliResult {
  return runCli(
    "analyze",
    ["--qid", "Q333", "--langs", "uk,cs,pl", "--user-question", question, "--report-lang", reportLang, "--out-dir", outDir, ...periodArgs, ...extraArgs],
    env,
  );
}

// Q1666254 (intermittent fasting) in cs, pl, xh and uk, recorded on 2026-09-27 for the period 2024-09..2026-08,
// the default period of a fixed "today" of 2026-09-15: pl has no article linked in Wikidata, and the xh article, created on 2025-04-25,
// has views only from 2025-04. Also recorded: pl and xh alone in English, cs with ua, a language code without a Wikipedia,
// --topic "Periodic fasting" (en), and eu alone in English: the eu article was renamed from "Aldizkako baraualdi" on 2025-12-02,
// and its current title has views only from 2025-12.
export const FASTING = fixtureEnv("fasting-cs-pl-eu-xh-uk", "2026-09-15");

// Topic search in English Wikipedia for uk, cs and pl, recorded on 2026-09-27: "Mercury" and "learning English" are
// disambiguation pages, "Stellar astronomy" redirects to a section of Astronomy, a quoted fasting query has one search result,
// and "qzxvwkjhplm" has none. Only resolver responses: nothing past needs_choice or not_found.
export const TOPIC_SEARCH = fixtureEnv("topic-search-uk-cs-pl", "2026-09-15");

export function analyzeFasting(
  outDir: string,
  question: string,
  { reportLang = "uk", langs = "cs,pl,xh,uk" }: { reportLang?: "uk" | "en"; langs?: string } = {},
): CliResult {
  return runCli(
    "analyze",
    ["--qid", "Q1666254", "--langs", langs, "--user-question", question, "--report-lang", reportLang, "--out-dir", outDir],
    FASTING,
  );
}

// Historical titles, recorded on 2026-09-27 for the period 2024-09..2026-08 with a fixed "today" of 2026-09-15:
// - Q9357655 (Таня Малярчук) in uk, in both report languages: renamed from "Малярчук Тетяна Володимирівна" to "Малярчук Таня"
//   and then to "Таня Малярчук" on 2025-02-01; its other two redirects are synonyms with no move logged.
// - Q634 (planet) in uk: its redirect "Планети" was the title of another page, the Holst suite, until that page moved away
//   on 2025-03-28; an older move of "Планети", from 2008, has no page ID logged.
// - Q49740 (Minecraft) in en: 179 redirects, more than the history check covers.
export const ARTICLE_HISTORY = fixtureEnv("article-history-uk-en", "2026-09-15");

export function analyzeHistory(outDir: string, qid: string, lang: string, reportLang: "uk" | "en" = "en"): CliResult {
  return runCli(
    "analyze",
    ["--qid", qid, "--langs", lang, "--user-question", `How does interest in ${qid} change?`, "--report-lang", reportLang, "--out-dir", outDir],
    ARTICLE_HISTORY,
  );
}

// 120 months (2016-09..2026-08), recorded on 2026-09-27 with a fixed "today" of 2026-09-15, in both report languages:
// Q333 (astronomy) in uk, cs, en and de, all assessed, and Q1666254 (intermittent fasting) in en, de, fr and pl,
// where pl has no article linked in Wikidata. Also recorded in English: Q1666254 in cs, en, de and pl, where cs has a short history.
export const LONG_PERIOD = fixtureEnv("report-120-months-4-langs", "2026-09-15");

export function analyzeLongPeriod(
  outDir: string,
  qid: "Q333" | "Q1666254",
  langs: string,
  { reportLang = "en", extraArgs = [] }: { reportLang?: "uk" | "en"; extraArgs?: string[] } = {},
): CliResult {
  return runCli(
    "analyze",
    ["--qid", qid, "--langs", langs, "--months", "120", "--report-lang", reportLang, "--out-dir", outDir, ...extraArgs],
    LONG_PERIOD,
  );
}

/** A conclusion.json that passes every check: one entry per assessed language of the run's analysis.json. */
export function validConclusion(runDir: string): Conclusion {
  const analysis = JSON.parse(readFileSync(join(runDir, "analysis.json"), "utf8"));
  const uk = analysis.report_lang === "uk";
  return {
    summary: uk
      ? "Відносна увага до теми відрізняється між мовними розділами; наступним варто дослідити розділ з найстабільнішим трендом."
      : "Relative attention to the topic differs between the language editions; research the one with the steadiest trend next.",
    languages: analysis.languages
      .filter((language: { data_status: string }) => language.data_status === "ok")
      .map((language: { lang: string }) => ({
        lang: language.lang,
        action: "consider" as const,
        rationale: uk ? "Тренд відносної уваги узгоджений з трафіком розділу." : "The relative attention trend agrees with the edition views.",
      })),
  };
}

/** Writes conclusion.json into the run folder: a value as JSON, a string as is. */
export function writeConclusion(runDir: string, conclusion: unknown): void {
  writeFileSync(join(runDir, "conclusion.json"), typeof conclusion === "string" ? conclusion : JSON.stringify(conclusion, null, 2));
}

/** Runs report.ts on a run folder, with a valid conclusion.json unless one is given. */
export function runReport(runDir: string, env: Record<string, string>, conclusion: unknown = validConclusion(runDir)): CliResult {
  writeConclusion(runDir, conclusion);
  return runCli("report", ["--run-dir", runDir], env);
}

/** The page count and the text of a PDF, as a reader extracts it. */
export async function readPdf(file: string): Promise<{ pages: number; text: string }> {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(file)) }).promise;
  let text = "";
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    text += content.items.map((item) => ("str" in item ? item.str : "")).join("");
  }
  return { pages: pdf.numPages, text };
}

// Line wrapping and text runs split words unpredictably, so compare text without whitespace.
export function squash(text: string): string {
  return text.replace(/\s+/g, "");
}
