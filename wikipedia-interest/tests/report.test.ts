import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { STRINGS } from "../scripts/lib/strings.ts";
import { analyzeAstronomy, analyzeFasting, ASTRONOMY, FASTING, runCli, tempDir } from "./helpers.ts";

// Seam B: the report CLI, fed by a real analyze run on recorded fixtures.
function analyze(reportLang: "uk" | "en", question: string): string {
  const runDir = tempDir();
  const result = analyzeAstronomy(runDir, question, { reportLang });
  assert.equal(result.status, 0, result.stderr);
  return runDir;
}

async function readPdf(file: string): Promise<{ pages: number; text: string }> {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(file)) }).promise;
  let text = "";
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    text += content.items.map((item) => ("str" in item ? item.str : "")).join("");
  }
  return { pages: pdf.numPages, text };
}

/** The page text before and after the heading of the not-assessed group, which follows the table. */
function splitAtNotAssessed(text: string, heading: string): { table: string; notAssessed: string } {
  const at = text.indexOf(squash(heading));
  assert.ok(at !== -1, `no "${heading}" in ${text}`);
  return { table: text.slice(0, at), notAssessed: text.slice(at) };
}

// Line wrapping and text runs split words unpredictably, so compare text without whitespace.
function squash(text: string): string {
  return text.replace(/\s+/g, "");
}

describe("report", () => {
  it("renders a one-page Ukrainian PDF with the question, the measured topic and every language", async () => {
    const question = "Чи зростає інтерес до астрономії в україномовній Wikipedia і наскільки цьому можна довіряти?";
    const runDir = analyze("uk", question);

    const result = runCli("report", ["--run-dir", runDir], ASTRONOMY);
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
    assert.equal(runCli("report", ["--run-dir", runDir], ASTRONOMY).status, 0);

    const text = squash((await readPdf(join(runDir, "report.pdf"))).text);
    // uk: relative attention, raw views and edition growth, months up of 12, trend and reliability.
    for (const fact of ["-47,2%", "-63,0%", "-28,2%", "2 з 12", "спад", "висока"]) assert.ok(text.includes(squash(fact)), fact);
    // pl: a recent spike lowers high to moderate, and the table says why.
    assert.ok(text.includes(squash("помірна: сплеск 2025-11")), text);
    assert.ok(text.includes(squash("медіана за 2025-09 - 2026-08 відносно медіани за 2024-09 - 2025-08")), text);
    assert.ok(text.includes(squash("heuristic_v1 - проста продуктова евристика, а не статистична довіра чи ймовірність")), text);
  });

  it("renders the same page in English", async () => {
    const question = "Is interest in astronomy growing in Ukrainian Wikipedia?";
    const runDir = analyze("en", question);

    const result = runCli("report", ["--run-dir", runDir], ASTRONOMY);
    assert.equal(result.status, 0, result.stderr);

    const pdf = await readPdf(join(runDir, "report.pdf"));
    assert.equal(pdf.pages, 1);
    const text = squash(pdf.text);
    assert.ok(text.includes(squash(question)), pdf.text);
    assert.ok(text.includes(squash("astronomy (Q333)")), pdf.text);
    assert.ok(text.includes(squash("Views per million")), pdf.text);
    assert.ok(text.includes("7.91"), pdf.text);
    assert.ok(text.includes(squash("Generated 2026-09-15")), pdf.text);
    for (const fact of ["-47.2%", "2 of 12", "down", "high", "moderate: spike 2025-11"]) assert.ok(text.includes(squash(fact)), fact);
    assert.ok(text.includes(squash("heuristic_v1 is a simple product heuristic, not a statistical confidence or probability")), pdf.text);
  });

  const notAssessedCases = [
    {
      reportLang: "uk",
      question: "Порівняй інтерес до інтервального голодування в pl і cs",
      heading: "Не оцінено",
      pl: "pl - польська",
      eu: "eu - баскська",
      phrases: ["Тема може бути описана в іншій статті або розділі", "Це не означає ні низької, ні високої уваги"],
      shortHistory: "є лише за останні 9 з 24 міс. запитаного періоду",
    },
    {
      reportLang: "en",
      question: "Compare interest in intermittent fasting in pl and cs",
      heading: "Not assessed",
      pl: "pl - Polish",
      eu: "eu - Basque",
      phrases: ["The topic may be covered in another article or section", "This means neither low nor high attention"],
      shortHistory: "only for the last 9 of the 24 requested months",
    },
  ] as const;
  for (const c of notAssessedCases) {
    it(`shows languages with insufficient data only in the group «${c.heading}», with fixed wording (${c.reportLang})`, async () => {
      const runDir = tempDir();
      assert.equal(analyzeFasting(runDir, c.question, { reportLang: c.reportLang }).status, 0);
      assert.equal(runCli("report", ["--run-dir", runDir], FASTING).status, 0);

      const pdf = await readPdf(join(runDir, "report.pdf"));
      assert.equal(pdf.pages, 1);
      const t = STRINGS[c.reportLang];
      const { table, notAssessed } = splitAtNotAssessed(squash(pdf.text), c.heading);
      assert.ok(notAssessed.includes(squash(t.notAssessedNote)), notAssessed);
      assert.ok(notAssessed.includes(squash(`${c.pl}${t.noLinkedArticle}`)), notAssessed);
      assert.ok(notAssessed.includes(squash(`${c.eu}${t.shortHistory("Aldizkako barau", 9, 24)}`)), notAssessed);
      for (const phrase of [...c.phrases, c.shortHistory]) assert.ok(notAssessed.includes(squash(phrase)), phrase);
      // The assessed languages stay in the table, the others only in their group.
      for (const title of ["Přerušovaný půst", "Інтервальне голодування"]) assert.ok(table.includes(squash(title)), table);
      for (const shown of [c.pl, c.eu, "Aldizkako barau"]) assert.ok(!table.includes(squash(shown)), shown);
    });
  }

  it("renders only the group, without a table, when no language is assessed", async () => {
    const runDir = tempDir();
    assert.equal(analyzeFasting(runDir, "Compare interest in intermittent fasting in pl and eu", { reportLang: "en", langs: "pl,eu" }).status, 0);
    assert.equal(runCli("report", ["--run-dir", runDir], FASTING).status, 0);

    const pdf = await readPdf(join(runDir, "report.pdf"));
    assert.equal(pdf.pages, 1);
    const { table, notAssessed } = splitAtNotAssessed(squash(pdf.text), "Not assessed");
    assert.ok(notAssessed.includes(squash("pl - Polish")) && notAssessed.includes(squash("eu - Basque")), notAssessed);
    assert.ok(!table.includes(squash(STRINGS.en.columnViewsPerMillion)), table);
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
    assert.equal(runCli("report", ["--run-dir", runDir], ASTRONOMY).status, 0);

    const text = squash((await readPdf(join(runDir, "report.pdf"))).text);
    assert.ok(!text.includes(squash("Not assessed")), text);
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
