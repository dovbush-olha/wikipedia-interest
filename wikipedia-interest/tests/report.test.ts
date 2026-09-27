import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { MAX_LANGUAGES, type Analysis } from "../scripts/lib/analysis.ts";
import { RATIONALE_MAX_CHARACTERS, SUMMARY_MAX_CHARACTERS, type Conclusion } from "../scripts/lib/conclusion.ts";
import { HISTORY_CHECK_TRUNCATED, LOW_VOLUME, RAW_RELATIVE_DIVERGE, RECENT_SPIKE, SPIKE } from "../scripts/lib/metrics.ts";
import { monthsOf } from "../scripts/lib/period.ts";
import { STRINGS, type Strings } from "../scripts/lib/strings.ts";
import {
  analyzeAstronomy,
  analyzeFasting,
  analyzeHistory,
  analyzeLongPeriod,
  ARTICLE_HISTORY,
  editAnalysis,
  ASTRONOMY,
  FASTING,
  LONG_PERIOD,
  runCli,
  readPdf,
  runReport,
  squash,
  tempDir,
  validConclusion,
} from "./helpers.ts";

// Seam B: the report CLI, fed by a real analyze run on recorded fixtures.
function analyze(reportLang: "uk" | "en", question: string): string {
  const runDir = tempDir();
  const result = analyzeAstronomy(runDir, question, { reportLang });
  assert.equal(result.status, 0, result.stderr);
  return runDir;
}

/** The page text before and after the heading of the not-assessed group, which follows the table. */
function splitAtNotAssessed(text: string, heading: string): { table: string; notAssessed: string } {
  const at = text.indexOf(squash(heading));
  assert.ok(at !== -1, `no "${heading}" in ${text}`);
  return { table: text.slice(0, at), notAssessed: text.slice(at) };
}

describe("report", () => {
  it("renders a one-page Ukrainian PDF with the question, the measured topic and every language", async () => {
    const question = "Чи зростає інтерес до астрономії в україномовній Wikipedia і наскільки цьому можна довіряти?";
    const runDir = analyze("uk", question);

    const result = runReport(runDir, ASTRONOMY);
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.status, "ok");
    assert.equal(out.files.report, join(runDir, "report.pdf"));

    const pdf = await readPdf(out.files.report);
    assert.equal(pdf.pages, 1);
    const text = squash(pdf.text);
    assert.ok(text.includes(squash(question)), pdf.text);
    assert.ok(text.includes(squash("астрономія (Q333)")), pdf.text);
    for (const title of ["Астрономія", "Astronomie", "Astronomia"]) assert.ok(text.includes(title), pdf.text);
    assert.ok(text.includes(squash("Переглядів на мільйон")), pdf.text);
    assert.ok(text.includes("7,91"), pdf.text);
    assert.ok(text.includes(squash("2024-09 - 2026-08")), pdf.text);
    assert.ok(text.includes(squash("Згенеровано 2026-09-15")), pdf.text);
  });

  it("shows trend metrics and trend reliability per language, with the heuristic_v1 note under the table", async () => {
    const runDir = analyze("uk", "Чи зростає інтерес до астрономії?");
    assert.equal(runReport(runDir, ASTRONOMY).status, 0);

    const text = squash((await readPdf(join(runDir, "report.pdf"))).text);
    // uk: relative attention, raw views and edition growth, months up of 12, trend and reliability.
    for (const fact of ["-47,2%", "-63,0%", "-28,2%", "2 з 12", "спад", "висока"]) assert.ok(text.includes(squash(fact)), fact);
    // pl: a recent spike lowers high to moderate, and the line under its facts says why.
    assert.ok(text.includes(squash("помірна Надійність знижено: сплеск 2025-11")), text);
    assert.ok(text.includes(squash("медіана за 2025-09 - 2026-08 відносно медіани за 2024-09 - 2025-08")), text);
    assert.ok(text.includes(squash("heuristic_v1 - проста продуктова евристика, а не статистична довіра чи ймовірність")), text);
  });

  it("renders the same page in English", async () => {
    const question = "Is interest in astronomy growing in Ukrainian Wikipedia?";
    const runDir = analyze("en", question);

    const result = runReport(runDir, ASTRONOMY);
    assert.equal(result.status, 0, result.stderr);

    const pdf = await readPdf(join(runDir, "report.pdf"));
    assert.equal(pdf.pages, 1);
    const text = squash(pdf.text);
    assert.ok(text.includes(squash(question)), pdf.text);
    assert.ok(text.includes(squash("astronomy (Q333)")), pdf.text);
    assert.ok(text.includes(squash("Views per million")), pdf.text);
    assert.ok(text.includes("7.91"), pdf.text);
    assert.ok(text.includes(squash("Generated 2026-09-15")), pdf.text);
    for (const fact of ["-47.2%", "2 of 12", "down", "high", "moderate Reliability lowered by: spike 2025-11"]) assert.ok(text.includes(squash(fact)), fact);
    assert.ok(text.includes(squash("heuristic_v1 is a simple product heuristic, not a statistical confidence or probability")), pdf.text);
  });

  const proxyCases = [
    {
      reportLang: "uk",
      question: "Чи зростає інтерес до аматорської астрономії?",
      reason: "Статті про аматорську астрономію немає в усіх мовах; астрономія ширша за неї.",
      assumption: "Припущення: виміряна тема - проксі теми питання, вона може бути ширшою або вужчою за тему питання.",
    },
    {
      reportLang: "en",
      question: "Is interest in amateur astronomy growing?",
      reason: "Amateur astronomy has no article in every language; astronomy is broader.",
      assumption: "Assumption: the measured topic is a proxy for the topic of the question; it may be broader or narrower than that topic.",
    },
  ] as const;
  for (const c of proxyCases) {
    it(`states the proxy as an explicit assumption with its reason, after the question and the measured topic (${c.reportLang})`, async () => {
      const runDir = tempDir();
      const result = analyzeAstronomy(runDir, c.question, { reportLang: c.reportLang, extraArgs: ["--proxy-reason", c.reason] });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(runReport(runDir, ASTRONOMY).status, 0);

      const pdf = await readPdf(join(runDir, "report.pdf"));
      assert.equal(pdf.pages, 1);
      const text = squash(pdf.text);
      const question = text.indexOf(squash(c.question));
      const topic = text.indexOf(squash("(Q333)"));
      const assumption = text.indexOf(squash(`${c.assumption} ${c.reason}`));
      assert.ok(question !== -1 && question < topic && topic < assumption, pdf.text);
    });
  }

  it("states no assumption for a direct measured topic", async () => {
    const runDir = analyze("uk", "Чи зростає інтерес до астрономії?");
    assert.equal(runReport(runDir, ASTRONOMY).status, 0);

    const text = squash((await readPdf(join(runDir, "report.pdf"))).text);
    assert.ok(!text.includes(squash(`${STRINGS.uk.assumption}:`)), text);
    assert.ok(!text.includes(squash("проксі")), text);
  });

  const notAssessedCases = [
    {
      reportLang: "uk",
      question: "Порівняй інтерес до інтервального голодування в pl і cs",
      heading: "Не оцінено",
      pl: "pl - польська",
      xh: "xh - кхоса",
      phrases: ["Тема може бути описана в іншій статті або розділі", "Це не означає ні низької, ні високої уваги"],
      shortHistory: "є лише за останні 17 з 24 міс. запитаного періоду",
    },
    {
      reportLang: "en",
      question: "Compare interest in intermittent fasting in pl and cs",
      heading: "Not assessed",
      pl: "pl - Polish",
      xh: "xh - Xhosa",
      phrases: ["The topic may be covered in another article or section", "This means neither low nor high attention"],
      shortHistory: "only for the last 17 of the 24 requested months",
    },
  ] as const;
  for (const c of notAssessedCases) {
    it(`shows languages with insufficient data only in the group «${c.heading}», with fixed wording (${c.reportLang})`, async () => {
      const runDir = tempDir();
      assert.equal(analyzeFasting(runDir, c.question, { reportLang: c.reportLang }).status, 0);
      assert.equal(runReport(runDir, FASTING).status, 0);

      const pdf = await readPdf(join(runDir, "report.pdf"));
      assert.equal(pdf.pages, 1);
      const t = STRINGS[c.reportLang];
      const { table, notAssessed } = splitAtNotAssessed(squash(pdf.text), c.heading);
      assert.ok(notAssessed.includes(squash(t.notAssessedNote)), notAssessed);
      assert.ok(notAssessed.includes(squash(`${c.pl}${t.noLinkedArticle}`)), notAssessed);
      assert.ok(notAssessed.includes(squash(`${c.xh}${t.shortHistory("Intermitent fasting", 17, 24)}`)), notAssessed);
      for (const phrase of [...c.phrases, c.shortHistory]) assert.ok(notAssessed.includes(squash(phrase)), phrase);
      // The assessed languages stay in the table, the others only in their group.
      assert.ok(table.includes(squash("Přerušovaný půst")), table);
      for (const shown of [c.pl, c.xh, "Intermitent fasting"]) assert.ok(!table.includes(squash(shown)), shown);
    });
  }

  it("renders only the group, without a table, when no language is assessed", async () => {
    const runDir = tempDir();
    assert.equal(analyzeFasting(runDir, "Compare interest in intermittent fasting in pl and xh", { reportLang: "en", langs: "pl,xh" }).status, 0);
    assert.equal(runReport(runDir, FASTING).status, 0);

    const pdf = await readPdf(join(runDir, "report.pdf"));
    assert.equal(pdf.pages, 1);
    const { table, notAssessed } = splitAtNotAssessed(squash(pdf.text), "Not assessed");
    assert.ok(notAssessed.includes(squash("pl - Polish")) && notAssessed.includes(squash("xh - Xhosa")), notAssessed);
    // The history check of a not-assessed article is shown too; pl has no article to check.
    assert.ok(notAssessed.includes(squash("No historical titles found. Redirect candidates checked: xh 0.")), notAssessed);
    assert.ok(!table.includes(squash(STRINGS.en.columnViewsPerMillion)), table);
    assert.ok(!squash(pdf.text).includes(squash(STRINGS.en.chartTitle)), pdf.text);
  });

  it("names the historical titles counted in article views and the redirects checked, per language (uk)", async () => {
    const runDir = tempDir();
    assert.equal(analyzeHistory(runDir, "Q9357655", "uk", "uk").status, 0);
    assert.equal(runReport(runDir, ARTICLE_HISTORY).status, 0);

    const pdf = await readPdf(join(runDir, "report.pdf"));
    assert.equal(pdf.pages, 1);
    const text = squash(pdf.text);
    assert.ok(text.includes(squash("Перегляди статті включають її історичні назви, підтверджені журналом перейменувань")), pdf.text);
    assert.ok(
      text.includes(squash("Історичні назви: uk «Малярчук Тетяна Володимирівна», «Малярчук Таня». Перевірено кандидатів на історичну назву: uk 4.")),
      pdf.text,
    );
  });

  it("says when a language has no historical titles, and how many redirects were checked (en)", async () => {
    const runDir = analyze("en", "Is interest in astronomy growing?");
    assert.equal(runReport(runDir, ASTRONOMY).status, 0);

    const text = squash((await readPdf(join(runDir, "report.pdf"))).text);
    assert.ok(text.includes(squash("Article views include its historical titles confirmed by the move log; other redirects are not counted.")), text);
    assert.ok(text.includes(squash("No historical titles found. Redirect candidates checked: uk 1, cs 3, pl 0.")), text);
  });

  it("shows a truncated history check as a limitation and as what lowered trend reliability", async () => {
    const runDir = tempDir();
    assert.equal(analyzeHistory(runDir, "Q49740", "en").status, 0);
    assert.equal(runReport(runDir, ARTICLE_HISTORY).status, 0);

    const pdf = await readPdf(join(runDir, "report.pdf"));
    assert.equal(pdf.pages, 1);
    const text = squash(pdf.text);
    assert.ok(text.includes(squash("moderate Reliability lowered by: history check truncated")), pdf.text);
    assert.ok(
      text.includes(squash("en: only the first 50 redirect candidates checked, so historical titles may be missing.")),
      pdf.text,
    );
  });

  it("has fixed wording for every reason of insufficient data in both report languages", () => {
    const compares = { first_12_months: { start: "2024-09", end: "2025-08" }, last_12_months: { start: "2025-09", end: "2026-08" } };
    assert.ok(STRINGS.uk.shortHistory("Стаття", 0, 24).includes("немає даних про перегляди"));
    assert.ok(STRINGS.en.shortHistory("Article", 0, 24).includes("has no views data"));
    assert.ok(STRINGS.uk.zeroBaseline(compares).includes("2024-09 - 2025-08"));
    assert.ok(STRINGS.en.zeroBaseline(compares).includes("2024-09 - 2025-08"));
  });

  it("leaves the group out when every language is assessed", async () => {
    const runDir = analyze("en", "Is interest in astronomy growing?");
    assert.equal(runReport(runDir, ASTRONOMY).status, 0);

    const text = squash((await readPdf(join(runDir, "report.pdf"))).text);
    assert.ok(!text.includes(squash("Not assessed")), text);
  });

  /** The page text of the chart: from its title to the header of the table under it. */
  function chartText(text: string, reportLang: "uk" | "en"): string {
    const t = STRINGS[reportLang];
    const start = text.indexOf(squash(t.chartTitle));
    const end = text.indexOf(squash(t.columnLanguage));
    assert.ok(start !== -1 && start < end, `no chart before the table in ${text}`);
    return text.slice(start, end);
  }

  it("draws the indexed relative attention chart between the measured topic and the table (uk)", async () => {
    const runDir = analyze("uk", "Чи зростає інтерес до астрономії?");
    assert.equal(runReport(runDir, ASTRONOMY).status, 0);

    const pdf = await readPdf(join(runDir, "report.pdf"));
    assert.equal(pdf.pages, 1);
    const text = squash(pdf.text);
    assert.ok(text.indexOf(squash("(Q333)")) < text.indexOf(squash(STRINGS.uk.chartTitle)), pdf.text);
    const chart = chartText(text, "uk");
    assert.ok(chart.includes(squash("100 = медіана за 2024-09 - 2025-08")), chart);
    // Quarterly month labels of the 24-month period, and one legend entry per language edition code.
    for (const label of ["2024-10", "2025-01", "2026-07", "uk", "cs", "pl"]) assert.ok(chart.includes(label), `${label} in ${chart}`);
  });

  it("keeps a chart of MAX_LANGUAGES assessed language editions over 120 months, a long question and a proxy on one page", async () => {
    const runDir = tempDir();
    const question =
      "Which of these three language editions shows the most promising relative attention to astronomy for our next research round, " +
      "and how far can we trust the trend over the last ten years?";
    const reason = "No article covers amateur astronomy in every language edition; astronomy as a whole is broader than the topic of the question.";
    const result = analyzeLongPeriod(runDir, "Q333", "uk,cs,en", { extraArgs: ["--user-question", question, "--proxy-reason", reason] });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(runReport(runDir, LONG_PERIOD).status, 0);

    const pdf = await readPdf(join(runDir, "report.pdf"));
    assert.equal(pdf.pages, 1);
    const chart = chartText(squash(pdf.text), "en");
    assert.ok(chart.includes(squash("100 = median of 2016-09 - 2017-08")), chart);
    for (const label of ["2017-01", "2026-01", "ukcsen100="]) assert.ok(chart.includes(label), `${label} in ${chart}`);
  });

  it("leaves not-assessed language editions off the chart", async () => {
    const runDir = tempDir();
    const result = analyzeLongPeriod(runDir, "Q1666254", "cs,en,pl", { extraArgs: ["--user-question", "Where is intermittent fasting gaining attention?"] });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(runReport(runDir, LONG_PERIOD).status, 0);

    const pdf = await readPdf(join(runDir, "report.pdf"));
    assert.equal(pdf.pages, 1);
    const chart = chartText(squash(pdf.text), "en");
    // The legend: en alone, then what 100 means.
    assert.ok(chart.includes(squash("en 100 = median of")), chart);
    for (const lang of ["cs", "pl"]) assert.ok(!chart.includes(lang), `${lang} in ${chart}`);
  });

  it("refuses a report that does not fit on one page and says what to shorten", () => {
    const runDir = analyze("en", "Is interest in astronomy growing? ".repeat(150));

    const result = runReport(runDir, ASTRONOMY);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Error: the report does not fit on one page\. Shorten --user-question or --proxy-reason and rerun analyze\.ts/);
    assert.ok(!existsSync(join(runDir, "report.pdf")));
  });

  /** The page text from the heading «Assumptions and limitations» on, the last block before the footer. */
  function limitationsText(text: string, reportLang: "uk" | "en"): string {
    const at = text.indexOf(squash(STRINGS[reportLang].limitationsHeading));
    assert.ok(at !== -1, `no limitations in ${text}`);
    return text.slice(at);
  }

  const limitationCases = [
    {
      reportLang: "uk",
      question: "Порівняй інтерес до інтервального голодування в pl і cs",
      fixed: [
        "Відносна увага - частка уваги до теми всередині Wikipedia, а не кількість зацікавлених людей, ринковий попит чи готовність платити.",
        "Переглядів на мільйон порівнюють цю частку між мовними розділами, а не їхнє населення чи кількість читачів.",
        "Лише одна стаття на тему і лише перегляди людьми (agent=user)",
      ],
      proxy: "Виміряна тема - проксі: звіт вимірює увагу до теми «Інтервальне голодування», яка може бути ширшою або вужчою за тему питання.",
      spikes: ["cs 2025-04", "uk 8 міс. у 2024-09 - 2025-04"],
    },
    {
      reportLang: "en",
      question: "Compare interest in intermittent fasting in pl and cs",
      fixed: [
        "Relative attention is the topic's share of attention inside Wikipedia, not the number of interested people, market demand or willingness to pay.",
        "Views per million compare that share between language editions, not their population or number of readers.",
        "One article per topic and human views only (agent=user)",
      ],
      proxy: "The measured topic is a proxy: the report measures attention to “intermittent fasting”, which may be broader or narrower than the topic of the question.",
      spikes: ["cs 2025-04", "uk 8 months in 2024-09 - 2025-04"],
    },
  ] as const;
  for (const c of limitationCases) {
    it(`closes with «${STRINGS[c.reportLang].limitationsHeading}»: fixed limitations, the proxy and the spikes of the data (${c.reportLang})`, async () => {
      const runDir = tempDir();
      const extraArgs = ["--proxy-reason", "Broader than the topic of the question."];
      assert.equal(runCli("analyze", ["--qid", "Q1666254", "--langs", "cs,pl,uk", "--user-question", c.question, "--report-lang", c.reportLang, "--out-dir", runDir, ...extraArgs], FASTING).status, 0);
      assert.equal(runReport(runDir, FASTING).status, 0);

      const pdf = await readPdf(join(runDir, "report.pdf"));
      assert.equal(pdf.pages, 1);
      const text = squash(pdf.text);
      const t = STRINGS[c.reportLang];
      // The order of the page's end: the not-assessed group, the heuristic_v1 note, the limitations, the footer.
      const notAssessed = text.indexOf(squash(t.notAssessedHeading));
      const heuristic = text.indexOf(squash(t.heuristicNote));
      const limitations = text.indexOf(squash(t.limitationsHeading));
      const footer = text.indexOf(squash(t.source));
      assert.ok(notAssessed !== -1 && notAssessed < heuristic && heuristic < limitations && limitations < footer, pdf.text);

      const block = limitationsText(text, c.reportLang);
      for (const item of [...c.fixed, c.proxy, t.spikesIntro, ...c.spikes]) assert.ok(block.includes(squash(item)), `${item} in ${block}`);
      // The history check of every article is a limitation of its views.
      assert.ok(block.includes(squash(c.reportLang === "uk" ? "Перевірено кандидатів на історичну назву: cs" : "Redirect candidates checked: cs")), block);
    });
  }

  it("says nothing about a proxy, spikes or divergence the data does not have", async () => {
    const runDir = analyze("en", "Is interest in astronomy growing?");
    editAnalysis(runDir, (analysis) => {
      for (const language of analysis.languages) if (language.data_status === "ok") language.flags = [];
    });
    assert.equal(runReport(runDir, ASTRONOMY).status, 0);

    const block = limitationsText(squash((await readPdf(join(runDir, "report.pdf"))).text), "en");
    for (const absent of ["proxy", STRINGS.en.spikesIntro, "raw views", STRINGS.en.titleNotShownNote]) {
      assert.ok(!block.includes(squash(absent)), `${absent} in ${block}`);
    }
  });

  it("shows a truncated history check under the limitations", async () => {
    const runDir = tempDir();
    assert.equal(analyzeHistory(runDir, "Q49740", "en").status, 0);
    assert.equal(runReport(runDir, ARTICLE_HISTORY).status, 0);

    const block = limitationsText(squash((await readPdf(join(runDir, "report.pdf"))).text), "en");
    assert.ok(block.includes(squash("en: only the first 50 redirect candidates checked, so historical titles may be missing.")), block);
  });

  const divergenceCases = [
    {
      reportLang: "en",
      fewer: "uk, pl: fewer raw views, but the topic takes a larger share of attention inside Wikipedia; this does not mean that more people read about it.",
      more: "cs: more raw views, but the language edition as a whole grew faster, so the topic's share of attention fell.",
    },
    {
      reportLang: "uk",
      fewer: "uk, pl: сирих переглядів стало менше, але тема займає більшу частку уваги всередині Wikipedia; це не означає, що про тему читає більше людей.",
      more: "cs: сирих переглядів більше, але мовний розділ загалом зростав швидше, тож частка уваги до теми зменшилась.",
    },
  ] as const;
  for (const c of divergenceCases) {
    it(`explains raw views and relative attention moving in opposite directions, per direction (${c.reportLang})`, async () => {
      const runDir = analyze(c.reportLang, c.reportLang === "uk" ? "Чи зростає інтерес до астрономії?" : "Is interest in astronomy growing?");
      // No recorded language diverges: uk and pl gain relative attention on fewer raw views, cs the other way round.
      editAnalysis(runDir, (analysis) => {
        for (const language of analysis.languages) {
          if (language.data_status !== "ok") continue;
          const up = language.lang !== "cs";
          language.trend = up ? "up" : "down";
          language.relative_attention_growth_pct = up ? 24.5 : -24.5;
          language.raw_growth_pct = up ? -12.5 : 12.5;
          language.flags.push(RAW_RELATIVE_DIVERGE);
        }
      });
      assert.equal(runReport(runDir, ASTRONOMY).status, 0);

      const block = limitationsText(squash((await readPdf(join(runDir, "report.pdf"))).text), c.reportLang);
      for (const line of [c.fewer, c.more]) assert.ok(block.includes(squash(line)), `${line} in ${block}`);
    });
  }

  const glyphCases = [
    {
      reportLang: "uk",
      stand: "астрономія (Q333, uk)*",
      note: "*: локальну назву статті не показано через обмеження PDF-шрифту.",
      historical: "Історичні назви: uk «Астрономія (наука)» та ще 1*.",
    },
    {
      reportLang: "en",
      stand: "astronomy (Q333, uk)*",
      note: "*: the local article title is not shown because of a PDF font limitation.",
      historical: "Historical titles: uk “Астрономія (наука)” and 1 more*.",
    },
  ] as const;
  for (const c of glyphCases) {
    it(`replaces an article title the font cannot draw with the language code, the QID and the label, and keeps its metrics (${c.reportLang})`, async () => {
      const runDir = analyze(c.reportLang, "Is interest in astronomy growing?");
      editAnalysis(runDir, (analysis) => {
        const uk = analysis.languages.find((language) => language.lang === "uk")!;
        uk.title = "天文学";
        if (uk.data_status === "ok") uk.historical_titles = ["天文", "Астрономія (наука)"];
      });
      assert.equal(runReport(runDir, ASTRONOMY).status, 0);

      const pdf = await readPdf(join(runDir, "report.pdf"));
      assert.equal(pdf.pages, 1);
      const text = squash(pdf.text);
      assert.ok(!text.includes("天"), pdf.text);
      const table = text.slice(0, text.indexOf(squash(STRINGS[c.reportLang].limitationsHeading)));
      assert.ok(table.includes(squash(c.stand)), table);
      // Every metric of uk stays.
      for (const fact of [c.reportLang === "uk" ? "7,91" : "7.91", "-47", "-63"]) assert.ok(table.includes(fact), fact);
      const block = limitationsText(text, c.reportLang);
      assert.ok(block.includes(squash(c.note)), block);
      // A historical title the font cannot draw is counted and marked for the note; a drawable one stays.
      assert.ok(block.includes(squash(c.historical)), block);
    });
  }

  it("replaces a title the font cannot draw in the not-assessed group too", async () => {
    const runDir = tempDir();
    assert.equal(analyzeFasting(runDir, "Compare interest in intermittent fasting", { reportLang: "en" }).status, 0);
    editAnalysis(runDir, (analysis) => {
      analysis.languages.find((language) => language.lang === "xh")!.title = "間欠的断食";
    });
    assert.equal(runReport(runDir, FASTING).status, 0);

    const text = squash((await readPdf(join(runDir, "report.pdf"))).text);
    assert.ok(!text.includes("断"), text);
    const { notAssessed } = splitAtNotAssessed(text, "Not assessed");
    assert.ok(notAssessed.includes(squash("Views of the article “intermittent fasting (Q1666254, xh)*” exist only for the last 17")), notAssessed);
  });

  it("keeps each report language's fixed texts in that language", () => {
    const compares = { first_12_months: { start: "2024-09", end: "2025-08" }, last_12_months: { start: "2025-09", end: "2026-08" } };
    // Every text function of the dictionary with sample data, "X" and codes for the data: a new function fails typecheck here.
    const calls: { [K in keyof Strings as Strings[K] extends (...args: never[]) => string ? K : never]: (t: Strings) => string[] } = {
      title: (t) => [t.title("X")],
      chartBaseline: (t) => [t.chartBaseline(compares)],
      monthsUp: (t) => [t.monthsUp(3, 12)],
      spike: (t) => [t.spike(["2025-11"]), t.spike(["2025-09", "2026-08"])],
      growthNote: (t) => [t.growthNote(compares)],
      historyNote: (t) => [
        t.historyNote([
          { lang: "uk", titles: ["X", "X"], more: 2, undrawable: true, checked: 50, truncated: true },
          { lang: "cs", titles: ["X"], more: 0, undrawable: false, checked: 1, truncated: false },
          { lang: "cs", titles: [], more: 1, undrawable: true, checked: 1, truncated: false },
          { lang: "pl", titles: [], more: 0, undrawable: false, checked: 3, truncated: false },
        ]),
      ],
      shortHistory: (t) => [t.shortHistory("X", 0, 24), t.shortHistory("X", 17, 24)],
      zeroBaseline: (t) => [t.zeroBaseline(compares)],
      proxyLimitation: (t) => [t.proxyLimitation("X")],
      spikeMonths: (t) => [t.spikeMonths("uk", ["2024-09"]), t.spikeMonths("uk", ["2024-09", "2025-04"])],
      fewerRawViews: (t) => [t.fewerRawViews(["uk", "cs"])],
      moreRawViews: (t) => [t.moreRawViews(["uk"])],
      titleNotShown: (t) => [t.titleNotShown("X", "Q1", "uk")],
    };
    const texts = (t: Strings): string[] => [
      ...Object.values(t).flatMap((value) => (typeof value === "string" ? [value] : typeof value === "object" ? Object.values(value) : [])),
      ...Object.values(calls).flatMap((call) => call(t)),
    ];
    // Latin words in Ukrainian only as names: of data sources, the heuristic, API parameters and the sample data.
    const names = new Set(["Wikipedia", "Wikidata", "Wikimedia", "Pageviews", "API", "heuristic_v1", "all", "access", "user", "agent", "PDF", "X", "Q1", "uk", "cs", "pl"]);
    const latin = texts(STRINGS.uk).flatMap((text) => text.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []);
    assert.deepEqual(latin.filter((word) => !names.has(word)), []);
    assert.deepEqual(texts(STRINGS.en).flatMap((text) => text.match(/\p{Script=Cyrillic}+/gu) ?? []), []);
  });

  it("keeps the Ukrainian and English dictionaries on the same set of keys", () => {
    assert.deepEqual(Object.keys(STRINGS.uk).sort(), Object.keys(STRINGS.en).sort());
  });

  it("explains how to get an analysis when the run folder has none", () => {
    const runDir = tempDir();
    const result = runCli("report", ["--run-dir", runDir], ASTRONOMY);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Error: no analysis\.json in .*Run analyze\.ts with --out-dir/);
  });
});

// Seam B, the worst case of the page: MAX_LANGUAGES language editions over 120 months, a long question with a proxy reason,
// the longest summary and rationales in the widest action label, long titles and every limitation the data can add,
// in both report languages: with every language assessed, the longest table; with one not assessed, the not-assessed group too,
// for no linked article and for a short history, whose text names the article.
describe("report worst-case layout", () => {
  const worstCases = [
    { qid: "Q333", langs: "uk,cs,en", reportLang: "en", shortHistory: false },
    { qid: "Q333", langs: "uk,cs,en", reportLang: "uk", shortHistory: false },
    { qid: "Q1666254", langs: "en,de,pl", reportLang: "en", shortHistory: false },
    { qid: "Q1666254", langs: "en,de,pl", reportLang: "uk", shortHistory: false },
    { qid: "Q1666254", langs: "en,de,pl", reportLang: "en", shortHistory: true },
    { qid: "Q1666254", langs: "en,de,pl", reportLang: "uk", shortHistory: true },
  ] as const;
  type WorstCase = (typeof worstCases)[number];

  const longHistory = (title: string) =>
    Array.from({ length: 6 }, (_, n) => `${title} (${["history", "overview", "research", "practice", "theory", "terms"][n]} and related subtopics)`);

  /**
   * Every limitation at once for every assessed language: both divergences, low volume, a recent spike each month,
   * a truncated history with long historical titles; a long title, and a title the font cannot draw.
   */
  function worsen(analysis: Analysis, shortHistory: boolean): void {
    const months = monthsOf(analysis.period);
    const recent = months.slice(-12);
    analysis.languages.forEach((language, i) => {
      if (language.data_status !== "ok") return;
      const up = i % 2 === 0;
      language.trend = up ? "up" : "down";
      language.relative_attention_growth_pct = up ? 1234.5 : -99.9;
      language.raw_growth_pct = up ? -99.9 : 1234.5;
      language.edition_growth_pct = -99.9;
      language.trend_reliability = "moderate";
      language.reliability_reasons = [
        "direction_matches_in_12_of_12_recent_months",
        LOW_VOLUME,
        ...recent.map((month) => `${RECENT_SPIKE}${month}`),
        HISTORY_CHECK_TRUNCATED,
      ];
      language.flags = [...months.filter((_, m) => m % 2 === 1).map((month) => `${SPIKE}${month}`), LOW_VOLUME, RAW_RELATIVE_DIVERGE, HISTORY_CHECK_TRUNCATED];
      language.historical_titles = longHistory(language.title);
      language.redirect_candidates_checked = 50;
    });
    const first = analysis.languages[0];
    first.title = `${first.title} (history and practice)`;
    // A title in a script the font cannot draw, replaced by the longer language code, QID and label.
    analysis.languages[1].title = "天文学と断食の総合的な研究";
    if (shortHistory) {
      const title = "Post przerywany: historia, badania i codzienna praktyka";
      analysis.languages[2] = {
        lang: "pl",
        title,
        historical_titles: longHistory(title),
        redirect_candidates_checked: 50,
        data_status: "insufficient_data",
        reason: "short_history",
        max_months_available: 119,
        trend: null,
        trend_reliability: null,
        flags: [HISTORY_CHECK_TRUNCATED],
      };
    }
  }

  /** The worst case's run folder, its analysis edited by `edit` after the worst limitations, and its longest conclusion. */
  function worstCaseRun(c: WorstCase, edit: (analysis: Analysis) => void = () => {}): { runDir: string; conclusion: Conclusion } {
    const runDir = tempDir();
    const uk = c.reportLang === "uk";
    const question = uk
      ? "Які з цих трьох мовних розділів показують найперспективнішу відносну увагу до теми для нашого наступного раунду досліджень, і наскільки можна довіряти тренду за останні десять років?"
      : "Which of these three language editions shows the most promising relative attention to the topic for our next research round, and how far can we trust the trend over the last ten years?";
    const reason = uk
      ? "Статті саме про тему питання немає в усіх мовних розділах; виміряна тема ширша за тему питання і охоплює суміжні підтеми."
      : "No article covers the exact topic of the question in every language edition; the measured topic is broader and covers related subtopics.";
    const result = analyzeLongPeriod(runDir, c.qid, c.langs, { reportLang: c.reportLang, extraArgs: ["--user-question", question, "--proxy-reason", reason] });
    assert.equal(result.status, 0, result.stderr);
    editAnalysis(runDir, (analysis) => {
      worsen(analysis, c.shortHistory);
      edit(analysis);
    });

    const words = uk
      ? "Відносна увага стабільно зростає у більшості місяців, дані надійні, розбіжностей немає; "
      : "Relative attention grows steadily in most months, the data is reliable, with no divergence; ";
    const fill = (length: number) => words.repeat(Math.ceil(length / words.length)).slice(0, length).trimEnd().padEnd(length, "ш");
    const conclusion = validConclusion(runDir);
    conclusion.summary = fill(SUMMARY_MAX_CHARACTERS);
    for (const language of conclusion.languages) {
      language.action = "investigate_next";
      language.rationale = fill(RATIONALE_MAX_CHARACTERS);
    }
    return { runDir, conclusion };
  }

  for (const c of worstCases) {
    const variant = c.shortHistory ? ", a short history" : "";
    it(`fits MAX_LANGUAGES language editions and the longest texts on one page (${c.qid} ${c.langs}${variant}, ${c.reportLang})`, async () => {
      assert.equal(c.langs.split(",").length, MAX_LANGUAGES);
      const { runDir, conclusion } = worstCaseRun(c);
      const report = runReport(runDir, LONG_PERIOD, conclusion);
      assert.equal(report.status, 0, report.stderr);

      const pdf = await readPdf(join(runDir, "report.pdf"));
      assert.equal(pdf.pages, 1);
      // Everything is on it, the footer last.
      const text = squash(pdf.text);
      const t = STRINGS[c.reportLang];
      for (const part of [conclusion.summary, t.chartTitle, t.heuristicNote, t.limitationsHeading, t.titleNotShownNote, t.source]) {
        assert.ok(text.includes(squash(part)), `${part} in ${pdf.text}`);
      }
    });
  }

  // The other side of the calibration: one language edition more does not fit, even in the roomiest of the worst cases.
  for (const c of worstCases.filter((c) => c.qid === "Q333")) {
    it(`does not fit MAX_LANGUAGES + 1 language editions on one page (${c.reportLang})`, () => {
      const { runDir, conclusion } = worstCaseRun(c, (analysis) => {
        analysis.languages.push({ ...structuredClone(analysis.languages[0]), lang: "de" });
      });
      assert.equal(conclusion.languages.length, MAX_LANGUAGES + 1);
      const report = runReport(runDir, LONG_PERIOD, conclusion);
      assert.equal(report.status, 1, report.stdout);
      assert.match(report.stderr, /^Error: the report does not fit on one page\./);
    });
  }
});
