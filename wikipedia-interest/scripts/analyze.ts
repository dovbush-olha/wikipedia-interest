// Step 1: measured topic → pageviews → relative attention → analysis.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ANALYSIS_FILE, REPORT_LANGS, type Analysis, type LanguageResult, type ReportLang } from "./lib/analysis.ts";
import { parseCliArgs, printJson, runMain, UserError } from "./lib/cli.ts";
import { isInsideSkillDir, SKILL_DIR, today } from "./lib/env.ts";
import { relativeAttentionSeries, viewsPerMillion } from "./lib/metrics.ts";
import { articleViews, editionViews } from "./lib/pageviews.ts";
import { defaultPeriod, monthsOf, type Period } from "./lib/period.ts";
import { resolveQid } from "./lib/resolve.ts";

const USAGE =
  'node analyze.ts --qid <Q...> --langs <codes> --user-question "<question>" [--report-lang uk|en] --out-dir <path>';

await runMain(async () => {
  const args = parseCliArgs(
    {
      qid: { type: "string" },
      langs: { type: "string" },
      "user-question": { type: "string" },
      "report-lang": { type: "string", default: "en" },
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
  const period = defaultPeriod(asOf);
  const { topic, titles } = await resolveQid(qid, langs, reportLang);
  const languages = await Promise.all(langs.map((lang) => analyzeLanguage(lang, titles.get(lang) ?? null, topic.qid, period)));

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
  const [edition, article] = await Promise.all([editionViews(lang, period), articleViews(lang, title, period)]);
  const series = relativeAttentionSeries(monthsOf(period), article, edition);
  return { lang, title, views_per_million: viewsPerMillion(series), series };
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
  return langs;
}
