import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Analysis } from "./analysis.ts";
import { UserError } from "./cli.ts";
import { unsupportedCharacters } from "./glyphs.ts";

// The conclusion: written by the model to conclusion.json, read by report.ts.
// It holds only the interpretation, without numbers or facts: every fact on the page comes from analysis.json.
// The checks are deterministic and never judge whether a recommendation is right.

export const CONCLUSION_FILE = "conclusion.json";

/** A next-research action for one language edition, not a product launch decision. */
export const ACTIONS = ["investigate_next", "consider", "lower_priority"] as const;
export type Action = (typeof ACTIONS)[number];

/** Limits that keep every valid conclusion on the one page, with MAX_LANGUAGES languages and the longest texts: see the worst-case test. */
export const SUMMARY_MAX_CHARACTERS = 200;
export const RATIONALE_MAX_CHARACTERS = 120;

export type LanguageConclusion = { lang: string; action: Action; rationale: string };

/** `languages` has exactly one entry per assessed language, in the order of analysis.json. */
export type Conclusion = { summary: string; languages: LanguageConclusion[] };

const CONCLUSION_FIELDS = ["summary", "languages"];
const LANGUAGE_FIELDS = ["lang", "action", "rationale"];

export function readConclusion(runDir: string, analysis: Analysis): Conclusion {
  const file = join(runDir, CONCLUSION_FILE);
  const assessed = analysis.languages.filter((language) => language.data_status === "ok").map((language) => language.lang);
  const assessedList = assessed.length === 0 ? "none" : assessed.join(", ");

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new UserError(
      `no ${CONCLUSION_FILE} in ${runDir}. Write it as {"summary": "...", "languages": [...]}: ` +
        `"summary" answers the question about the assessed languages in at most ${SUMMARY_MAX_CHARACTERS} characters, and "languages" holds ` +
        `"lang", "action" and "rationale" for each assessed language (${assessedList}), ` +
        `with "action" one of ${ACTIONS.join(", ")} and "rationale" in at most ${RATIONALE_MAX_CHARACTERS} characters. ` +
        "No digits: report.ts renders every number from analysis.json. Then rerun report.ts.",
    );
  }
  let value: unknown;
  try {
    // A byte order mark is invisible in most editors, and JSON.parse rejects it.
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new UserError(`${file} is not valid JSON (${(error as Error).message}). Fix it and rerun report.ts.`);
  }
  if (!isObject(value)) {
    throw new UserError(`${CONCLUSION_FILE} must be a JSON object with "summary" and "languages". Fix it and rerun report.ts.`);
  }

  const problems: string[] = [];
  problems.push(...unknownFields(value, CONCLUSION_FIELDS, CONCLUSION_FILE));
  problems.push(...textProblems(value.summary, "summary", SUMMARY_MAX_CHARACTERS, analysis));

  const entries = value.languages;
  if (entries === undefined) {
    problems.push(`languages is missing. Add one entry for each assessed language (${assessedList}).`);
  } else if (!Array.isArray(entries)) {
    problems.push(`languages must be an array with one entry for each assessed language (${assessedList}).`);
  } else {
    const seen = new Map<string, number>();
    entries.forEach((entry: unknown, i) => {
      const at = `languages[${i}]`;
      if (!isObject(entry)) {
        problems.push(`${at} must be an object with "lang", "action" and "rationale".`);
        return;
      }
      problems.push(...unknownFields(entry, LANGUAGE_FIELDS, at));
      const langIssues = langProblems(entry.lang, at, analysis, assessedList);
      const first = typeof entry.lang === "string" ? seen.get(entry.lang) : undefined;
      if (langIssues.length === 0 && first !== undefined) {
        langIssues.push(`${at}.lang "${entry.lang}" repeats languages[${first}]. Keep exactly one entry per assessed language.`);
      } else if (langIssues.length === 0) {
        seen.set(entry.lang as string, i);
      }
      problems.push(...langIssues);
      problems.push(...actionProblems(entry.action, at));
      problems.push(...textProblems(entry.rationale, `${at}.rationale`, RATIONALE_MAX_CHARACTERS, analysis));
    });
    for (const lang of assessed) {
      if (!seen.has(lang)) problems.push(`missing assessed language "${lang}" in languages. Add one entry for it.`);
    }
  }

  if (problems.length === 1) throw new UserError(`${problems[0]} Fix ${CONCLUSION_FILE} and rerun report.ts.`);
  if (problems.length > 1) {
    throw new UserError(
      `${CONCLUSION_FILE} has ${problems.length} problems; fix them all and rerun report.ts.\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
    );
  }
  // Every check passed, so the entries are complete; order them as the analysis does.
  const byLang = new Map((entries as LanguageConclusion[]).map((entry) => [entry.lang, entry]));
  return {
    summary: value.summary as string,
    languages: assessed.map((lang) => {
      const { action, rationale } = byLang.get(lang)!;
      return { lang, action, rationale };
    }),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownFields(value: Record<string, unknown>, allowed: string[], where: string): string[] {
  const names = allowed.map((field) => `"${field}"`);
  const list = names.length === 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return Object.keys(value)
    .filter((field) => !allowed.includes(field))
    .map((field) => `unknown field "${field}" in ${where}. Only ${list} are allowed; remove it.`);
}

/** Whether `lang` names an assessed language of the analysis; repeats are checked by the caller, across entries. */
function langProblems(lang: unknown, at: string, analysis: Analysis, assessedList: string): string[] {
  if (lang === undefined) return [`${at}.lang is missing. Use one of the assessed languages (${assessedList}).`];
  if (typeof lang !== "string") return [`${at}.lang must be a string: one of the assessed languages (${assessedList}).`];
  const language = analysis.languages.find((candidate) => candidate.lang === lang);
  if (language === undefined) {
    return [`${at}.lang "${lang}" is not a language edition of this analysis. Use only the assessed languages: ${assessedList}.`];
  }
  if (language.data_status !== "ok") {
    return [`${at}.lang "${lang}" is not assessed (${language.reason}). Remove it; report.ts renders not-assessed languages itself.`];
  }
  return [];
}

function actionProblems(action: unknown, at: string): string[] {
  const allowed = `Use one of: ${ACTIONS.join(", ")}.`;
  if (action === undefined) return [`${at}.action is missing. ${allowed}`];
  if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) {
    return [`${at}.action ${JSON.stringify(action)} is not allowed. ${allowed}`];
  }
  return [];
}

/** A text of the model: present, not blank, within its limit, without digits, and drawable by the PDF font. */
function textProblems(text: unknown, field: string, limit: number, analysis: Analysis): string[] {
  const inWords = `Write it in words, in the report language (${analysis.report_lang}).`;
  if (text === undefined) return [`${field} is missing. ${inWords}`];
  if (typeof text !== "string") return [`${field} must be a string. ${inWords}`];
  if (text.trim() === "") return [`${field} is empty. ${inWords}`];

  const problems: string[] = [];
  // Characters, not UTF-16 units or bytes: a Cyrillic letter counts once.
  const length = [...text].length;
  if (length > limit) problems.push(`${field} is ${length} characters long; the limit is ${limit}. Shorten it.`);
  // Any numeric character: decimal digits of every script, superscripts, fractions, numerals.
  const withDigits = [...new Set(text.split(/\s+/).filter((word) => /\p{N}/u.test(word)))];
  if (withDigits.length > 0) {
    problems.push(
      `digit in ${field} (${quoted(withDigits)}). Numbers are rendered from analysis.json; describe the finding in words.`,
    );
  }
  const unsupported = unsupportedCharacters(text);
  if (unsupported.length > 0) {
    problems.push(
      `${field} contains characters not supported by the PDF font (${quoted(unsupported)}). ` +
        `Write the conclusion in the report language (${analysis.report_lang}).`,
    );
  }
  return problems;
}

function quoted(values: string[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}
