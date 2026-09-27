// Step 1: measured topic → pageviews → relative attention → analysis.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ANALYSIS_FILE, MAX_LANGUAGES, REPORT_LANGS, type Analysis, type LanguageResult, type ReportLang } from "./lib/analysis.ts";
import { parseCliArgs, printJson, runMain, UserError } from "./lib/cli.ts";
import { isInsideSkillDir, SKILL_DIR, today } from "./lib/env.ts";
import { growthCompares, insufficientData, languageMetrics } from "./lib/metrics.ts";
import { articleViews, editionViews } from "./lib/pageviews.ts";
import { monthsOf, requestedPeriod, type Period } from "./lib/period.ts";
import { resolveQid, resolveTopic, type TopicMatch } from "./lib/resolve.ts";

const USAGE =
  'node analyze.ts (--topic "<text>" [--topic-lang <code>] | --qid <Q...>) --langs <codes> --user-question "<question>" ' +
  '[--proxy-reason "<reason>"] [--report-lang uk|en] [--start YYYY-MM | --months N] [--end YYYY-MM] --out-dir <path>';

const DEFAULT_TOPIC_LANG = "en";
const LANG_CODE = /^[a-z]{2,3}(-[a-z0-9]+)*$/;

const NEEDS_CHOICE_NEXT_STEP =
  "Pick the candidate whose meaning matches the user's question; coverage comes second, and its missing_langs will not be assessed. " +
  "Rerun the same command with --qid <qid> in place of --topic and --topic-lang, and add --proxy-reason \"<how it differs>\" " +
  "if the candidate is broader or narrower than the topic of the question. " +
  "If no candidate is both close in meaning and covered in enough of the requested languages, tell the user instead of measuring another topic.";

type TopicSource = { kind: "qid"; qid: string } | { kind: "topic"; query: string; topicLang: string };

await runMain(async () => {
  const args = parseCliArgs(
    {
      topic: { type: "string" },
      "topic-lang": { type: "string" },
      qid: { type: "string" },
      "proxy-reason": { type: "string" },
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
  const source = parseTopicSource(args.topic, args["topic-lang"], args.qid);
  const proxyReason = args["proxy-reason"]?.trim();
  if (proxyReason === "") {
    throw new UserError(
      "--proxy-reason is empty: say briefly how the measured topic differs from the topic of the question, " +
        "or leave --proxy-reason out when the measured topic is the topic of the question.",
    );
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
  let qid: string;
  let topicMatch: TopicMatch | null = null;
  if (source.kind === "qid") {
    qid = source.qid;
  } else {
    const { query, topicLang } = source;
    const resolution = await resolveTopic(query, topicLang, langs, reportLang);
    if (resolution.status === "needs_choice") {
      printJson({
        status: resolution.status,
        query,
        topic_lang: topicLang,
        reason: resolution.reason,
        candidates: resolution.candidates,
        next_step: NEEDS_CHOICE_NEXT_STEP,
      });
      return;
    }
    if (resolution.status === "not_found") {
      printJson({ status: resolution.status, query, topic_lang: topicLang, next_step: notFoundNextStep(query, topicLang) });
      return;
    }
    qid = resolution.qid;
    topicMatch = resolution.match;
  }

  const { topic, titles } = await resolveQid(qid, langs, reportLang);
  const relation = proxyReason === undefined
    ? { relation_to_question: "direct" as const, proxy_reason: null }
    : { relation_to_question: "proxy" as const, proxy_reason: proxyReason };
  const languages = await allInOrder(langs.map((lang) => analyzeLanguage(lang, titles.get(lang) ?? null, period)));

  const analysis: Analysis = {
    status: "ok",
    user_question: userQuestion,
    report_lang: reportLang,
    as_of: asOf,
    measured_topic: { ...topic, ...relation },
    topic_match: topicMatch,
    period,
    growth_compares: growthCompares(period),
    languages,
  };
  const analysisFile = join(outDir, ANALYSIS_FILE);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(analysisFile, `${JSON.stringify(analysis, null, 2)}\n`);

  printJson({
    ...analysis,
    languages: languages.map(withoutSeries),
    files: { analysis: analysisFile },
    next_step: `Run: node ${join(SKILL_DIR, "scripts", "report.ts")} --run-dir ${outDir}`,
  });
});

function notFoundNextStep(query: string, topicLang: string): string {
  return (
    `No article in ${topicLang}.wikipedia matches ${JSON.stringify(query)}. ` +
    "Rephrase the topic, e.g. as the likely article title or a shorter phrase, " +
    "or pass --topic-lang with the language the topic is written in, and rerun."
  );
}

function parseTopicSource(topic: string | undefined, topicLang: string | undefined, qidArg: string | undefined): TopicSource {
  if (topic !== undefined && qidArg !== undefined) {
    throw new UserError("--topic and --qid cannot be used together: pass --qid once the topic is chosen, otherwise --topic.");
  }
  if (qidArg !== undefined) {
    if (topicLang !== undefined) {
      throw new UserError("--topic-lang applies only to --topic, the language its text is written in. Leave it out with --qid.");
    }
    const qid = qidArg.trim().toUpperCase();
    if (!/^Q[1-9]\d*$/.test(qid)) {
      throw new UserError(`--qid must be a Wikidata item ID like Q333, got ${JSON.stringify(qidArg)}.\nUsage: ${USAGE}`);
    }
    return { kind: "qid", qid };
  }
  if (topic === undefined) {
    throw new UserError(
      'pass the topic as --topic "<text>" or, once chosen, as --qid <Q...>, ' +
        'e.g. --topic "intermittent fasting" --topic-lang en.\nUsage: ' + USAGE,
    );
  }
  const query = topic.trim().replace(/\s+/g, " ");
  if (query === "") throw new UserError('--topic is empty: pass the topic in a few words, e.g. --topic "intermittent fasting".');
  const lang = (topicLang ?? DEFAULT_TOPIC_LANG).trim().toLowerCase();
  if (!LANG_CODE.test(lang)) {
    throw new UserError(
      `--topic-lang must be a Wikipedia language code, the language --topic is written in, e.g. en or uk; got ${JSON.stringify(topicLang)}.`,
    );
  }
  return { kind: "topic", query, topicLang: lang };
}

async function analyzeLanguage(lang: string, title: string | null, period: Period): Promise<LanguageResult> {
  // Edition first: it fails while the --end month is unpublished, before the article's incomplete views get cached for good.
  // Also without a linked article, so a mistyped language code fails instead of reading as "no linked article".
  const edition = await editionViews(lang, period);
  if (title === null) return { lang, title, ...insufficientData({ reason: "no_linked_article" }) };
  const article = await articleViews(lang, title, period);
  return { lang, title, ...languageMetrics(monthsOf(period), article, edition) };
}

/** A language result for stdout: the monthly series stay in analysis.json. */
function withoutSeries(language: LanguageResult): Omit<LanguageResult, "series"> {
  if (language.data_status !== "ok") return language;
  const { series: _series, ...summary } = language;
  return summary;
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
  const invalid = langs.filter((lang) => !LANG_CODE.test(lang));
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
