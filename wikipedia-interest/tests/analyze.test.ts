import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  analyzeAstronomy as analyzeAstronomyWith,
  analyzeFasting,
  analyzeHistory,
  ASTRONOMY,
  fixtureEnv,
  noNetworkEnv,
  runCli,
  tempDir,
} from "./helpers.ts";

// Seam A: the analyze CLI, replaying recorded Wikimedia responses offline.
const QUESTION = "Чи зростає інтерес до астрономії в україномовній Wikipedia?";

function analyzeAstronomy(outDir: string, periodArgs: string[] = [], env = ASTRONOMY) {
  return analyzeAstronomyWith(outDir, QUESTION, { periodArgs, env });
}

// Offline with an empty cache: a failure here happened before any network request.
function analyzeWithoutNetwork(args: string[]) {
  return runCli("analyze", ["--qid", "Q333", "--user-question", QUESTION, "--out-dir", tempDir(), ...args], noNetworkEnv("2026-09-15"));
}

function analysisIn(outDir: string) {
  return JSON.parse(readFileSync(join(outDir, "analysis.json"), "utf8"));
}

describe("analyze --qid", () => {
  it("returns views_per_million for every language over the last 24 completed months", () => {
    const outDir = tempDir();
    const result = analyzeAstronomy(outDir);
    assert.equal(result.status, 0, result.stderr);

    const out = JSON.parse(result.stdout);
    assert.equal(out.status, "ok");
    assert.equal(out.user_question, QUESTION);
    assert.equal(out.report_lang, "uk");
    assert.deepEqual(out.period, { start: "2024-09", end: "2026-08", months: 24 });
    assert.equal(out.measured_topic.qid, "Q333");
    assert.equal(out.measured_topic.label, "астрономія");
    assert.equal(out.measured_topic.label_lang, "uk");
    assert.deepEqual(
      out.languages.map((l: { lang: string; title: string }) => [l.lang, l.title]),
      [
        ["uk", "Астрономія"],
        ["cs", "Astronomie"],
        ["pl", "Astronomia"],
      ],
    );
    for (const language of out.languages) {
      assert.equal(typeof language.views_per_million, "number");
      assert.ok(language.views_per_million > 0);
    }
    assert.equal(out.files.analysis, join(outDir, "analysis.json"));
    assert.match(out.next_step, /report\.ts --run-dir/);
  });

  it("keeps monthly series out of stdout and writes them to analysis.json", () => {
    const outDir = tempDir();
    const result = analyzeAstronomy(outDir);
    assert.equal(result.status, 0, result.stderr);

    assert.doesNotMatch(result.stdout, /"series"/);
    const analysis = JSON.parse(readFileSync(join(outDir, "analysis.json"), "utf8"));
    const uk = analysis.languages[0];
    assert.equal(uk.series.length, 24);
    assert.equal(uk.series[0].month, "2024-09");
    assert.equal(uk.series[23].month, "2026-08");
  });

  it("computes relative attention as article views per million edition views", () => {
    const outDir = tempDir();
    assert.equal(analyzeAstronomy(outDir).status, 0);

    const analysis = JSON.parse(readFileSync(join(outDir, "analysis.json"), "utf8"));
    const [uk, cs, pl] = analysis.languages;
    // Expected values were computed by hand from the recorded Wikimedia responses.
    assert.deepEqual(uk.series[23], EXPECTED_UK_2026_08);
    assert.equal(uk.views_per_million, EXPECTED_VIEWS_PER_MILLION.uk);
    assert.equal(cs.views_per_million, EXPECTED_VIEWS_PER_MILLION.cs);
    assert.equal(pl.views_per_million, EXPECTED_VIEWS_PER_MILLION.pl);
  });

  it("returns trend metrics and trend reliability for every language, and names the compared months", () => {
    const outDir = tempDir();
    const result = analyzeAstronomy(outDir);
    assert.equal(result.status, 0, result.stderr);

    const out = JSON.parse(result.stdout);
    assert.deepEqual(out.growth_compares, {
      first_12_months: { start: "2024-09", end: "2025-08" },
      last_12_months: { start: "2025-09", end: "2026-08" },
    });
    for (const [i, expected] of EXPECTED_TREND_METRICS.entries()) {
      const { lang, title: _title, historical_titles: _historical, redirect_candidates_checked: _checked, views_per_million: _views, ...metrics } =
        out.languages[i];
      assert.deepEqual({ lang, ...metrics }, expected);
    }
    assert.deepEqual(analysisIn(outDir).growth_compares, out.growth_compares);
  });

  it("produces a byte-for-byte identical analysis for the same input and fixtures", () => {
    const first = tempDir();
    const second = tempDir();
    assert.equal(analyzeAstronomy(first).status, 0);
    assert.equal(analyzeAstronomy(second).status, 0);

    assert.ok(readFileSync(join(first, "analysis.json")).equals(readFileSync(join(second, "analysis.json"))));
  });

  it("requires --user-question and says how to fix it", () => {
    const result = runCli("analyze", ["--qid", "Q333", "--langs", "uk", "--out-dir", tempDir()], ASTRONOMY);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^Error: --user-question is required/);
    assert.match(result.stderr, /--user-question "/);
  });

  it("fails in offline mode when a response was never recorded, without touching the network", () => {
    const result = runCli(
      "analyze",
      ["--qid", "Q333", "--langs", "de", "--user-question", QUESTION, "--out-dir", tempDir()],
      ASTRONOMY,
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Error: offline mode/);
    assert.match(result.stderr, /wikidata\.org/);
  });

  it("refuses to write run results inside the skill folder", () => {
    const result = runCli(
      "analyze",
      ["--qid", "Q333", "--langs", "uk", "--user-question", QUESTION, "--out-dir", "runs/inside"],
      ASTRONOMY,
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Error: --out-dir .* is inside the skill folder/);
  });
});

describe("analyze insufficient data", () => {
  const question = "Порівняй зростання інтересу до інтервального голодування в pl і cs за останні два роки";

  it("marks a language edition without an article linked to the measured topic as no_linked_article", () => {
    const outDir = tempDir();
    const result = analyzeFasting(outDir, question);
    assert.equal(result.status, 0, result.stderr);

    const pl = JSON.parse(result.stdout).languages.find((l: { lang: string }) => l.lang === "pl");
    assert.deepEqual(pl, {
      lang: "pl",
      title: null,
      data_status: "insufficient_data",
      reason: "no_linked_article",
      trend: null,
      trend_reliability: null,
    });
    assert.deepEqual(analysisIn(outDir).languages[1], pl);
  });

  it("marks an article younger than the requested period as short_history with the months available up to --end", () => {
    const outDir = tempDir();
    const result = analyzeFasting(outDir, question);
    assert.equal(result.status, 0, result.stderr);

    // The xh article has views from 2025-04: 2025-04..2026-08 is 17 of the 24 requested months.
    const xh = JSON.parse(result.stdout).languages.find((l: { lang: string }) => l.lang === "xh");
    assert.deepEqual(xh, {
      lang: "xh",
      title: "Intermitent fasting",
      historical_titles: [],
      redirect_candidates_checked: 0,
      data_status: "insufficient_data",
      reason: "short_history",
      max_months_available: 17,
      trend: null,
      trend_reliability: null,
      flags: [],
    });
    // Not silently analyzed over a shorter period: no series and no metrics.
    assert.deepEqual(analysisIn(outDir).languages[2], xh);
  });

  it("keeps assessing the other languages over the whole requested period, in the --langs order", () => {
    const outDir = tempDir();
    const result = analyzeFasting(outDir, question);
    assert.equal(result.status, 0, result.stderr);

    const out = JSON.parse(result.stdout);
    assert.deepEqual(out.period, { start: "2024-09", end: "2026-08", months: 24 });
    assert.deepEqual(
      out.languages.map((l: { lang: string; data_status: string }) => [l.lang, l.data_status]),
      [
        ["cs", "ok"],
        ["pl", "insufficient_data"],
        ["xh", "insufficient_data"],
        ["uk", "ok"],
      ],
    );
    for (const i of [0, 3]) {
      assert.equal(analysisIn(outDir).languages[i].series.length, 24);
      assert.ok(["up", "down", "flat"].includes(out.languages[i].trend));
    }
  });

  it("still fails for a language code without a Wikipedia, instead of reporting no linked article", () => {
    const result = analyzeFasting(tempDir(), question, { langs: "cs,ua" });

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^Error: Wikimedia has no pageviews for ua\.wikipedia\. Check the language code in --langs\./);
  });
});

describe("analyze article history", () => {
  /** The one language of a run, from analysis.json, with its monthly article views keyed by month. */
  function onlyLanguage(outDir: string) {
    const [language] = analysisIn(outDir).languages;
    const views = new Map<string, number>(language.series?.map((point: { month: string; article_views: number }) => [point.month, point.article_views]));
    return { language, views };
  }

  it("adds the views of a title the article was renamed from, over the whole period", () => {
    // "Aldizkako baraualdi" was renamed to "Aldizkako barau" on 2025-12-02; the current title alone has views only from 2025-12.
    const outDir = tempDir();
    const result = analyzeFasting(outDir, "Is interest in intermittent fasting growing in Basque Wikipedia?", { reportLang: "en", langs: "eu" });
    assert.equal(result.status, 0, result.stderr);

    const [eu] = JSON.parse(result.stdout).languages;
    assert.equal(eu.title, "Aldizkako barau");
    assert.deepEqual(eu.historical_titles, ["Aldizkako baraualdi"]);
    assert.equal(eu.redirect_candidates_checked, 1);
    assert.equal(eu.data_status, "ok");
    const { views } = onlyLanguage(outDir);
    // Recorded views of the current + the historical title: before the rename, after it, and at the end of the period.
    assert.equal(views.get("2024-09"), 0 + 3);
    assert.equal(views.get("2025-12"), 3 + 1);
    assert.equal(views.get("2026-08"), 2 + 1);
  });

  it("adds the views of every title in a chain of renames", () => {
    // Малярчук Тетяна Володимирівна → Малярчук Таня → Таня Малярчук, both on 2025-02-01.
    const outDir = tempDir();
    const result = analyzeHistory(outDir, "Q9357655", "uk");
    assert.equal(result.status, 0, result.stderr);

    const [uk] = JSON.parse(result.stdout).languages;
    assert.equal(uk.title, "Таня Малярчук");
    assert.deepEqual(uk.historical_titles, ["Малярчук Тетяна Володимирівна", "Малярчук Таня"]);
    assert.equal(uk.redirect_candidates_checked, 4);
    const { views } = onlyLanguage(outDir);
    assert.equal(views.get("2024-09"), 8 + 224 + 0);
    assert.equal(views.get("2025-02"), 147 + 65 + 1);
  });

  it("leaves out synonym redirects that were never a title of the article", () => {
    // cs Astronomie has 3 redirects (Hvězdářství, Hvězdář, Hvězdoprava) and no move logged for any of them.
    const outDir = tempDir();
    const result = analyzeAstronomy(outDir);
    assert.equal(result.status, 0, result.stderr);

    const cs = JSON.parse(result.stdout).languages[1];
    assert.deepEqual(cs.historical_titles, []);
    assert.equal(cs.redirect_candidates_checked, 3);
    // The recorded views of the current title alone.
    assert.equal(analysisIn(outDir).languages[1].series[23].article_views, 333);
  });

  it("leaves out a redirect whose logged move was of another page", () => {
    // "Планети" now redirects to "Планета", but the move logged for it moved the Holst suite, another page, away from it.
    const outDir = tempDir();
    const result = analyzeHistory(outDir, "Q634", "uk");
    assert.equal(result.status, 0, result.stderr);

    const [uk] = JSON.parse(result.stdout).languages;
    assert.equal(uk.title, "Планета");
    assert.deepEqual(uk.historical_titles, []);
    assert.equal(uk.redirect_candidates_checked, 3);
    assert.equal(onlyLanguage(outDir).views.get("2024-09"), 2639);
  });

  it("checks at most 50 redirects, flags the check as truncated and lowers trend reliability one step", () => {
    const outDir = tempDir();
    const result = analyzeHistory(outDir, "Q49740", "en");
    assert.equal(result.status, 0, result.stderr);

    const [en] = JSON.parse(result.stdout).languages;
    assert.equal(en.title, "Minecraft");
    assert.equal(en.redirect_candidates_checked, 50);
    assert.deepEqual(en.historical_titles, []);
    assert.equal(en.trend, "down");
    // 9 of 12 recent months down is high; the truncated check lowers it to moderate.
    assert.equal(en.trend_reliability, "moderate");
    assert.deepEqual(en.reliability_reasons, ["direction_matches_in_9_of_12_recent_months", "history_check_truncated"]);
    assert.deepEqual(en.flags, ["history_check_truncated"]);
  });
});

describe("analyze requested period", () => {
  it("analyzes exactly the --start/--end period", () => {
    const outDir = tempDir();
    const result = analyzeAstronomy(outDir, ["--start", "2024-03", "--end", "2026-08"]);
    assert.equal(result.status, 0, result.stderr);

    assert.deepEqual(JSON.parse(result.stdout).period, { start: "2024-03", end: "2026-08", months: 30 });
    const uk = analysisIn(outDir).languages[0];
    assert.equal(uk.series.length, 30);
    assert.equal(uk.series[0].month, "2024-03");
    assert.equal(uk.series[29].month, "2026-08");
  });

  it("gives --months with --end the same analysis as the matching --start/--end", () => {
    const byMonths = tempDir();
    const byStart = tempDir();
    assert.equal(analyzeAstronomy(byMonths, ["--months", "30", "--end", "2026-08"]).status, 0);
    assert.equal(analyzeAstronomy(byStart, ["--start", "2024-03", "--end", "2026-08"]).status, 0);

    assert.deepEqual(analysisIn(byMonths).period, { start: "2024-03", end: "2026-08", months: 30 });
    assert.ok(readFileSync(join(byMonths, "analysis.json")).equals(readFileSync(join(byStart, "analysis.json"))));
  });

  it("ends a --start period at the last completed month by default", () => {
    const result = analyzeAstronomy(tempDir(), ["--start", "2024-03"]);
    assert.equal(result.status, 0, result.stderr);

    assert.deepEqual(JSON.parse(result.stdout).period, { start: "2024-03", end: "2026-08", months: 30 });
  });

  it("keeps an explicit --end when today is much later", () => {
    const result = analyzeAstronomy(tempDir(), ["--end", "2026-08"], fixtureEnv("astronomy-uk-cs-pl", "2027-03-10"));
    assert.equal(result.status, 0, result.stderr);

    const out = JSON.parse(result.stdout);
    assert.equal(out.as_of, "2027-03-10");
    assert.deepEqual(out.period, { start: "2024-09", end: "2026-08", months: 24 });
  });

  it("derives the same default period on any day of the same month", () => {
    for (const now of ["2026-09-01", "2026-09-30"]) {
      const result = analyzeAstronomy(tempDir(), [], fixtureEnv("astronomy-uk-cs-pl", now));
      assert.equal(result.status, 0, result.stderr);

      const out = JSON.parse(result.stdout);
      assert.equal(out.as_of, now);
      assert.deepEqual(out.period, { start: "2024-09", end: "2026-08", months: 24 });
    }
  });

  it("stops when Wikimedia has not published the --end month yet", () => {
    // On 2026-10-01 the default --end is 2026-09, which Wikimedia had not published when the fixtures were recorded.
    const outDir = tempDir();
    const result = analyzeAstronomy(outDir, [], fixtureEnv("astronomy-uk-cs-pl", "2026-10-01"));

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^Error: Wikimedia has not published uk\.wikipedia pageviews for 2026-09 yet/);
    assert.match(result.stderr, /--end 2026-08/);
    assert.throws(() => readFileSync(join(outDir, "analysis.json")));
  });
});

describe("analyze requested period errors", () => {
  const cases: { name: string; args: string[]; error: RegExp; nextStep: RegExp }[] = [
    {
      name: "--start together with --months",
      args: ["--start", "2023-01", "--months", "36"],
      error: /^Error: --start and --months cannot be used together/,
      nextStep: /pass --start with --end, or --months with --end/,
    },
    {
      name: "a --start/--end period shorter than 24 months",
      args: ["--start", "2025-01", "--end", "2026-06"],
      error: /^Error: the requested period 2025-01 - 2026-06 has 18 months; it must have at least 24/,
      nextStep: /--start 2024-07 or earlier/,
    },
    {
      name: "--months below 24",
      args: ["--months", "12"],
      error: /^Error: the requested period 2025-09 - 2026-08 has 12 months; it must have at least 24/,
      nextStep: /--months 24 or more/,
    },
    {
      name: "--start earlier than 2015-07",
      args: ["--start", "2015-06"],
      error: /^Error: --start 2015-06 is before 2015-07, the first month of Wikimedia pageviews/,
      nextStep: /--start 2015-07 or later/,
    },
    {
      name: "--months reaching back before 2015-07",
      args: ["--months", "200", "--end", "2026-08"],
      error: /^Error: --months 200 ending 2026-08 starts before 2015-07/,
      nextStep: /--months 134 or fewer/,
    },
    {
      name: "--months far beyond the available history",
      args: ["--months", "9999999", "--end", "2026-08"],
      error: /^Error: --months 9999999 ending 2026-08 starts before 2015-07/,
      nextStep: /--months 134 or fewer/,
    },
    {
      name: "--end that is not a completed month yet",
      args: ["--end", "2026-09"],
      error: /^Error: --end 2026-09 is not a completed month yet/,
      nextStep: /--end 2026-08 or earlier/,
    },
    {
      name: "--start after --end",
      args: ["--start", "2026-01", "--end", "2025-01"],
      error: /^Error: --start 2026-01 is after --end 2025-01/,
      nextStep: /--start earlier than --end/,
    },
    {
      name: "a month that is not YYYY-MM",
      args: ["--end", "2026-8"],
      error: /^Error: --end must be a month as YYYY-MM, got "2026-8"/,
      nextStep: /e\.g\. --end 2026-08/,
    },
    {
      name: "a month number out of range",
      args: ["--start", "2024-13"],
      error: /^Error: --start must be a month as YYYY-MM, got "2024-13"/,
      nextStep: /e\.g\. --start /,
    },
    {
      name: "--months that is not a whole number",
      args: ["--months", "2.5"],
      error: /^Error: --months must be a positive whole number of months, got "2.5"/,
      nextStep: /e\.g\. --months 36/,
    },
  ];

  for (const { name, args, error, nextStep } of cases) {
    it(`rejects ${name} and says what to change`, () => {
      const result = analyzeWithoutNetwork(["--langs", "uk", ...args]);

      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, error);
      assert.match(result.stderr, nextStep);
    });
  }
});

describe("analyze language limit", () => {
  it("rejects more than MAX_LANGUAGES languages before any network request", () => {
    const result = analyzeWithoutNetwork(["--langs", "uk,pl,cs,de,fr,es,it"]);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^Error: 7 languages requested, at most 6 allowed in one analysis/);
    assert.match(result.stderr, /shortlist up to 6 languages/);
    assert.doesNotMatch(result.stderr, /offline mode/);
  });

  it("accepts exactly MAX_LANGUAGES languages", () => {
    const result = analyzeWithoutNetwork(["--langs", "uk,pl,cs,de,fr,es"]);

    // Past the limit check, the run reaches the network and stops at the empty offline cache.
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Error: offline mode/);
  });
});

// 360 / 50,720,483 × 1,000,000 = 7.098 (rounded to 3 decimals).
const EXPECTED_UK_2026_08 = { month: "2026-08", article_views: 360, edition_views: 50720483, relative_attention: 7.098 };
// Median of the 12 monthly values 2025-09..2026-08, rounded to 2 decimals.
const EXPECTED_VIEWS_PER_MILLION = { uk: 7.91, cs: 8.72, pl: 6.1 };
// Computed independently from the recorded responses for 2024-09..2026-08 (medians of 2024-09..2025-08 and 2025-09..2026-08).
// uk spikes in 2024-09, before the last 12 months; pl spikes in 2025-11, inside them, which lowers high to moderate.
const EXPECTED_TREND_METRICS = [
  {
    lang: "uk",
    data_status: "ok",
    relative_attention_growth_pct: -47.2,
    raw_growth_pct: -63,
    edition_growth_pct: -28.2,
    recent_trend_consistency: { positive_months: 2, months_compared: 12 },
    trend: "down",
    trend_reliability: "high",
    reliability_method: "heuristic_v1",
    reliability_reasons: ["direction_matches_in_10_of_12_recent_months"],
    flags: ["spike:2024-09"],
  },
  {
    lang: "cs",
    data_status: "ok",
    relative_attention_growth_pct: -23.1,
    raw_growth_pct: -34.6,
    edition_growth_pct: -16.1,
    recent_trend_consistency: { positive_months: 2, months_compared: 12 },
    trend: "down",
    trend_reliability: "high",
    reliability_method: "heuristic_v1",
    reliability_reasons: ["direction_matches_in_10_of_12_recent_months"],
    flags: [],
  },
  {
    lang: "pl",
    data_status: "ok",
    relative_attention_growth_pct: -29.6,
    raw_growth_pct: -36.8,
    edition_growth_pct: -11.9,
    recent_trend_consistency: { positive_months: 3, months_compared: 12 },
    trend: "down",
    trend_reliability: "moderate",
    reliability_method: "heuristic_v1",
    reliability_reasons: ["direction_matches_in_9_of_12_recent_months", "recent_spike:2025-11"],
    flags: ["spike:2025-11"],
  },
];
