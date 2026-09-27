import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { ACTIONS, RATIONALE_MAX_CHARACTERS as RATIONALE, SUMMARY_MAX_CHARACTERS as SUMMARY } from "../scripts/lib/conclusion.ts";
import { STRINGS } from "../scripts/lib/strings.ts";
import {
  analyzeAstronomy,
  analyzeFasting,
  ASTRONOMY,
  FASTING,
  readPdf,
  runCli,
  runReport,
  squash,
  tempDir,
  validConclusion,
} from "./helpers.ts";

// Seam B: the conclusion.json contract of the report CLI. The model writes only the interpretation; report.ts rejects
// any conclusion it cannot render as is, with an error that names the field and what to change.

const ALLOWED_ACTIONS = ACTIONS.join(", ");

describe("conclusion", () => {
  describe("rejects", () => {
    // One analysis for every rejection: none of them may leave a report.pdf behind.
    let astronomy: string;
    let fasting: string;
    before(() => {
      astronomy = tempDir();
      assert.equal(analyzeAstronomy(astronomy, "Чи зростає інтерес до астрономії?").status, 0);
      fasting = tempDir();
      assert.equal(analyzeFasting(fasting, "Порівняй інтерес до інтервального голодування в pl і cs").status, 0);
    });

    /** Runs report.ts on the astronomy analysis (uk, cs, pl, all assessed) and returns its error. */
    function reject(conclusion: unknown, runDir = astronomy, env = ASTRONOMY): string {
      const result = runReport(runDir, env, conclusion);
      assert.equal(result.status, 1, result.stdout);
      assert.ok(!existsSync(join(runDir, "report.pdf")), "a rejected conclusion must not produce a report");
      return result.stderr;
    }

    /** A valid astronomy conclusion with one entry changed. */
    function withEntry(index: number, change: Record<string, unknown>) {
      const conclusion = validConclusion(astronomy);
      conclusion.languages[index] = { ...conclusion.languages[index], ...change };
      return conclusion;
    }

    it("when there is no conclusion.json, and says what to write", () => {
      rmSync(join(astronomy, "conclusion.json"), { force: true });
      const result = runCli("report", ["--run-dir", astronomy], ASTRONOMY);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^Error: no conclusion\.json in /);
      assert.match(result.stderr, /"summary"/);
      assert.match(result.stderr, /"lang", "action" and "rationale" for each assessed language \(uk, cs, pl\)/);
    });

    it("that is not valid JSON", () => {
      const stderr = reject('{"summary": "Відносна увага зростає", "languages": [}');
      assert.match(stderr, /^Error: .*conclusion\.json is not valid JSON \(.+\)\. Fix it and rerun report\.ts\./);
    });

    it("that is not an object with summary and languages", () => {
      assert.match(reject([]), /^Error: conclusion\.json must be a JSON object with "summary" and "languages"\./);
      assert.match(reject({ languages: validConclusion(astronomy).languages }), /summary is missing\./);
      assert.match(reject({ ...validConclusion(astronomy), summary: ["Так"] }), /summary must be a string\./);
      assert.match(reject({ summary: "Так" }), /languages is missing\. Add one entry for each assessed language \(uk, cs, pl\)\./);
      assert.match(reject({ ...validConclusion(astronomy), languages: {} }), /languages must be an array with one entry for each assessed language/);
      assert.match(reject({ ...validConclusion(astronomy), notes: "" }), /unknown field "notes" in conclusion\.json\. Only "summary" and "languages" are allowed; remove it\./);
    });

    it("an entry that is not an object with lang, action and rationale", () => {
      const conclusion = validConclusion(astronomy);
      conclusion.languages.push("pl" as never);
      assert.match(reject(conclusion), /languages\[3\] must be an object with "lang", "action" and "rationale"\./);
      assert.match(reject(withEntry(1, { confidence: "high" })), /unknown field "confidence" in languages\[1\]\. Only "lang", "action" and "rationale" are allowed; remove it\./);
      assert.match(reject(withEntry(0, { rationale: undefined })), /languages\[0\]\.rationale is missing\./);
      assert.match(reject(withEntry(0, { lang: 7 })), /languages\[0\]\.lang must be a string: one of the assessed languages \(uk, cs, pl\)\./);
    });

    it("an assessed language that is missing", () => {
      const conclusion = validConclusion(astronomy);
      conclusion.languages = conclusion.languages.filter((language) => language.lang !== "cs");
      assert.match(reject(conclusion), /^Error: missing assessed language "cs" in languages\. Add one entry for it\./);
    });

    it("an assessed language given twice", () => {
      const conclusion = validConclusion(astronomy);
      conclusion.languages.push({ ...conclusion.languages[1] });
      assert.match(reject(conclusion), /^Error: languages\[3\]\.lang "cs" repeats languages\[1\]\. Keep exactly one entry per assessed language\./);
    });

    it("a language code that is not in the analysis", () => {
      const conclusion = validConclusion(astronomy);
      conclusion.languages.push({ lang: "de", action: "consider", rationale: "Німецький розділ." });
      assert.match(
        reject(conclusion),
        /^Error: languages\[3\]\.lang "de" is not a language edition of this analysis\. Use only the assessed languages: uk, cs, pl\./,
      );
    });

    it("a language that is not assessed, with the reason it is not", () => {
      const conclusion = validConclusion(fasting);
      conclusion.languages.push({ lang: "pl", action: "lower_priority", rationale: "Статті немає." });
      conclusion.languages.push({ lang: "xh", action: "lower_priority", rationale: "Мало даних." });
      const stderr = reject(conclusion, fasting, FASTING);
      assert.match(stderr, /^Error: conclusion\.json has 2 problems; fix them all and rerun report\.ts\./);
      const notAssessed = "Remove it; report.ts renders not-assessed languages itself.";
      assert.ok(stderr.includes(`- languages[1].lang "pl" is not assessed (no_linked_article). ${notAssessed}`), stderr);
      assert.ok(stderr.includes(`- languages[2].lang "xh" is not assessed (short_history). ${notAssessed}`), stderr);
    });

    it("an action outside the enum", () => {
      assert.match(reject(withEntry(2, { action: "deprioritize" })), /^Error: languages\[2\]\.action "deprioritize" is not allowed\. Use one of: investigate_next, consider, lower_priority\./);
      assert.ok(reject(withEntry(0, { action: undefined })).includes(`languages[0].action is missing. Use one of: ${ALLOWED_ACTIONS}.`));
    });

    it("text fields that are too long or empty, counting characters rather than bytes", () => {
      const summary = { ...validConclusion(astronomy), summary: "а".repeat(SUMMARY + 1) };
      assert.ok(reject(summary).startsWith(`Error: summary is ${SUMMARY + 1} characters long; the limit is ${SUMMARY}. Shorten it.`));
      const rationale = reject(withEntry(1, { rationale: "б".repeat(RATIONALE + 1) }));
      assert.ok(rationale.startsWith(`Error: languages[1].rationale is ${RATIONALE + 1} characters long; the limit is ${RATIONALE}. Shorten it.`));
      assert.match(reject({ ...validConclusion(astronomy), summary: "  " }), /^Error: summary is empty\./);
      assert.match(reject(withEntry(0, { rationale: "" })), /^Error: languages\[0\]\.rationale is empty\./);
    });

    it("digits in text fields, quoting each word they are in", () => {
      const stderr = reject(withEntry(1, { rationale: "Відносна увага зросла на 23% з 2025 року." }));
      assert.match(
        stderr,
        /^Error: digit in languages\[1\]\.rationale \("23%", "2025"\)\. Numbers are rendered from analysis\.json; describe the finding in words\./,
      );
      const summary = { ...validConclusion(astronomy), summary: "Увага зросла вдвічі, до ²⁄₃ від рівня uk." };
      assert.match(reject(summary), /^Error: digit in summary \("²⁄₃"\)\./);
    });

    it("characters the PDF font has no glyphs for, in the report language", () => {
      assert.match(
        reject(withEntry(0, { rationale: "Тема 英語 має стабільний тренд." })),
        /^Error: languages\[0\]\.rationale contains characters not supported by the PDF font \("英語"\)\. Write the conclusion in the report language \(uk\)\./,
      );
    });

    it("spaces other than a plain space and a line break that the PDF font cannot draw, such as a tab", () => {
      assert.match(reject(withEntry(0, { rationale: "Тренд\u3000стабільний, а\tдані надійні." })), /languages\[0\]\.rationale contains characters not supported by the PDF font/);
    });

    it("with every problem at once, each naming its field", () => {
      const conclusion = { summary: "Увага зросла на 5%.", languages: [{ lang: "uk", action: "go", rationale: "Добре." }] };
      const stderr = reject(conclusion);
      assert.match(stderr, /^Error: conclusion\.json has 4 problems; fix them all and rerun report\.ts\.\n/);
      for (const field of ['digit in summary ("5%.")', 'languages[0].action "go"', 'missing assessed language "cs"', 'missing assessed language "pl"']) {
        assert.ok(stderr.includes(`\n- ${field}`), `${field} in ${stderr}`);
      }
    });
  });

  describe("renders", () => {
    const conclusions = {
      uk: {
        summary: "Україномовна аудиторія виглядає найперспективнішою для наступного дослідження, хоча відносна увага там спадає.",
        languages: [
          { lang: "uk", action: "investigate_next", rationale: "Відносна увага висока, а спад повторює спад трафіку розділу." },
          { lang: "cs", action: "consider", rationale: "Тренд помірно надійний, варто перевірити іншими джерелами." },
          { lang: "pl", action: "lower_priority", rationale: "Сплеск робить тренд ненадійним." },
        ],
      },
      en: {
        summary: "The Ukrainian audience looks the most promising for the next research round, although its relative attention falls.",
        languages: [
          { lang: "uk", action: "investigate_next", rationale: "Relative attention is high, and its fall follows the edition views." },
          { lang: "cs", action: "consider", rationale: "The trend is moderately reliable; check it against other sources." },
          { lang: "pl", action: "lower_priority", rationale: "A spike makes the trend unreliable." },
        ],
      },
    } as const;
    const actionLabels = {
      uk: ["досліджувати наступною", "розглянути", "нижчий пріоритет"],
      en: ["investigate next", "consider", "lower priority"],
    } as const;
    const launch = { uk: "не рішення про запуск продукту", en: "not a product launch decision" } as const;

    for (const reportLang of ["uk", "en"] as const) {
      it(`a one-page PDF with the recommendation block before the chart, and each action next to its facts (${reportLang})`, async () => {
        const runDir = tempDir();
        assert.equal(analyzeAstronomy(runDir, "Is interest in astronomy growing?", { reportLang }).status, 0);
        const result = runReport(runDir, ASTRONOMY, conclusions[reportLang]);
        assert.equal(result.status, 0, result.stderr);

        const pdf = await readPdf(join(runDir, "report.pdf"));
        assert.equal(pdf.pages, 1);
        const text = squash(pdf.text);
        const t = STRINGS[reportLang];
        // The block says it is a next-research recommendation from the Wikipedia signal, not a launch decision.
        assert.ok(t.recommendationHeading.includes(launch[reportLang]), t.recommendationHeading);
        const heading = text.indexOf(squash(t.recommendationHeading));
        const summary = text.indexOf(squash(conclusions[reportLang].summary));
        const chart = text.indexOf(squash(t.chartTitle));
        assert.ok(text.indexOf("(Q333)") < heading && heading < summary && summary < chart, pdf.text);

        // Each language's action and rationale follow its row of facts, before the next language's row.
        const rows = ["Астрономія", "Astronomie", "Astronomia", squash(t.viewsPerMillionNote)].map((marker) => text.indexOf(marker, chart));
        conclusions[reportLang].languages.forEach((language, i) => {
          const interpretation = text.indexOf(squash(`${actionLabels[reportLang][i]}: ${language.rationale}`), chart);
          assert.ok(rows[i] < interpretation && interpretation < rows[i + 1], `${language.lang} in ${pdf.text}`);
        });
      });
    }

    it("a conclusion.json that starts with a byte order mark", async () => {
      const runDir = tempDir();
      assert.equal(analyzeAstronomy(runDir, "Чи зростає інтерес до астрономії?").status, 0);
      const result = runReport(runDir, ASTRONOMY, `\uFEFF${JSON.stringify(validConclusion(runDir))}`);
      assert.equal(result.status, 0, result.stderr);
      assert.equal((await readPdf(join(runDir, "report.pdf"))).pages, 1);
    });

    it("a conclusion with only the assessed languages when some are not assessed", async () => {
      const runDir = tempDir();
      assert.equal(analyzeFasting(runDir, "Порівняй інтерес до інтервального голодування в pl і cs").status, 0);
      const conclusion = validConclusion(runDir);
      assert.deepEqual(conclusion.languages.map((language) => language.lang), ["cs"]);
      assert.equal(runReport(runDir, FASTING, conclusion).status, 0);

      const pdf = await readPdf(join(runDir, "report.pdf"));
      assert.equal(pdf.pages, 1);
      assert.ok(squash(pdf.text).includes(squash(conclusion.summary)), pdf.text);
    });

    it("the summary alone when no language is assessed", async () => {
      const runDir = tempDir();
      assert.equal(analyzeFasting(runDir, "Compare interest in intermittent fasting in pl and xh", { reportLang: "en", langs: "pl,xh" }).status, 0);
      const summary = "Neither language edition has enough Wikipedia data for this topic; other data sources are needed for these audiences.";
      assert.equal(runReport(runDir, FASTING, { summary, languages: [] }).status, 0);

      const text = squash((await readPdf(join(runDir, "report.pdf"))).text);
      assert.ok(text.includes(squash(STRINGS.en.recommendationHeading)) && text.includes(squash(summary)), text);
    });
  });
});
