import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { STRINGS } from "../scripts/lib/strings.ts";
import { analyzeAstronomy, ASTRONOMY, runCli, tempDir } from "./helpers.ts";

// Seam B: the report CLI, fed by a real analyze run on recorded fixtures.
function analyze(reportLang: "uk" | "en", question: string): string {
  const runDir = tempDir();
  const result = analyzeAstronomy(runDir, question, reportLang);
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
