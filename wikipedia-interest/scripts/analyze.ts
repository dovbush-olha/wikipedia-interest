// Step 1: measured topic → pageviews → relative attention → analysis.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ANALYSIS_FILE, MAX_LANGUAGES, REPORT_LANGS, type Analysis, type LanguageResult, type ReportLang } from "./lib/analysis.ts";
import { parseCliArgs, printJson, runMain, UserError } from "./lib/cli.ts";
import { isInsideSkillDir, SKILL_DIR, today } from "./lib/env.ts";
import { relativeAttentionSeries, viewsPerMillion } from "./lib/metrics.ts";
import { articleViews, editionViews } from "./lib/pageviews.ts";
import { monthsOf, requestedPeriod, type Period } from "./lib/period.ts";
import { resolveQid } from "./lib/resolve.ts";

const USAGE =
  'node analyze.ts --qid <Q...> --langs <codes> --user-question "<question>" [--report-lang uk|en] ' +
  "[--start YYYY-MM | --months N] [--end YYYY-MM] --out-dir <path>";

await runMain(async () => {
  const args = parseCliArgs(
    {
      qid: { type: "string" },
      langs: { type: "string" },
      "user-question": { type: "string" },
      "report-lang": { type: "string", default: "en" },
      start: { type: "string" },
      end: { type: "string" },
      months: { type: "string" },
      "out-dir": { type: "string" },
    },
    USAGE,
  );

  const userQuestion = args["user-question"]?.trim();
  if (!userQuestion) {
    throw new UserError(
      "--user-question is required: pass the user's question verbatim or briefly, " +
        'e.g. --user-question "Is interest in astronomy growing in Ukrainian Wikipedia?". ' +
        "The report shows it next to the measured topic.",
    );
  }
  const qid = args.qid?.trim().toUpperCase();
  if (!qid || !/^Q[1-9]\d*$/.test(qid)) {
    throw new UserError(`--qid must be a Wikidata item ID like Q333, got ${JSON.stringify(args.qid ?? "")}.\nUsage: ${USAGE}`);
  }
  const langs = parseLangs(args.langs);
  const reportLang = args["report-lang"] as ReportLang;
  if (!REPORT_LANGS.includes(reportLang)) {
    throw new UserError(`--report-lang must be uk or en, got "${reportLang}". Use uk for Ukrainian requests, otherwise en.`);
  }
  if (!args["out-dir"]) throw new UserError(`--out-dir is required.\nUsage: ${USAGE}`);
  const outDir = resolve(args["out-dir"]);
  if (isInsideSkillDir(outDir)) {
    throw new UserError(`--out-dir ${outDir} is inside the skill folder. Write runs to the user's working directory instead.`);
  }

  const asOf = today();
  const period = requestedPeriod({ start: args.start, end: args.end, months: args.months }, asOf);
  const { topic, titles } = await resolveQid(qid, langs, reportLang);
  const languages = await allInOrder(langs.map((lang) => analyzeLanguage(lang, titles.get(lang) ?? null, topic.qid, period)));

  const analysis: Analysis = {
    status: "ok",
    user_question: userQuestion,
    report_lang: reportLang,
    as_of: asOf,
    measured_topic: topic,
    period,
    languages,
  };
  const analysisFile = join(outDir, ANALYSIS_FILE);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(analysisFile, `${JSON.stringify(analysis, null, 2)}\n`);

  printJson({
    ...analysis,
    languages: languages.map(({ series: _series, ...summary }) => summary),
    files: { analysis: analysisFile },
    next_step: `Run: node ${join(SKILL_DIR, "scripts", "report.ts")} --run-dir ${outDir}`,
  });
});

async function analyzeLanguage(lang: string, title: string | null, qid: string, period: Period): Promise<LanguageResult> {
  if (title === null) {
    throw new UserError(
      `${qid} has no article linked in ${lang}.wikipedia, so relative attention cannot be measured there; ` +
        `this says nothing about interest. Rerun without ${lang} and tell the user ${lang} could not be assessed.`,
    );
  }
  // Edition first: it fails while the --end month is unpublished, before the article's incomplete views get cached for good.
  const edition = await editionViews(lang, period);
  const article = await articleViews(lang, title, period);
  const series = relativeAttentionSeries(monthsOf(period), article, edition);
  return { lang, title, views_per_million: viewsPerMillion(series), series };
}

/** Like Promise.all, but a failure is always the first one in input order, not whichever settled first. */
async function allInOrder<T>(promises: Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(promises);
  const failure = settled.find((result) => result.status === "rejected");
  if (failure !== undefined) throw failure.reason;
  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
}

function parseLangs(value: string | undefined): string[] {
  const langs = (value ?? "")
    .split(",")
    .map((lang) => lang.trim().toLowerCase())
    .filter((lang) => lang !== "");
  if (langs.length === 0) {
    throw new UserError(`--langs is required: comma-separated Wikipedia language codes, e.g. --langs uk,pl,cs.`);
  }
  const invalid = langs.filter((lang) => !/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(lang));
  if (invalid.length > 0) {
    throw new UserError(`--langs has invalid language codes: ${invalid.join(", ")}. Use Wikipedia codes such as uk, pl, cs.`);
  }
  const duplicates = langs.filter((lang, i) => langs.indexOf(lang) !== i);
  if (duplicates.length > 0) {
    throw new UserError(`--langs lists ${[...new Set(duplicates)].join(", ")} more than once. List each language once.`);
  }
  if (langs.length > MAX_LANGUAGES) {
    throw new UserError(
      `${langs.length} languages requested, at most ${MAX_LANGUAGES} allowed in one analysis (one-page PDF). ` +
        `Ask the user to shortlist up to ${MAX_LANGUAGES} languages and rerun with that --langs. ` +
        "Separate analyses are possible, but each produces its own report and they are not one shared comparison.",
    );
  }
  return langs;
}
