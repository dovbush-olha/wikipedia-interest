import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { analyzeAstronomy as analyzeAstronomyWith, ASTRONOMY, runCli, tempDir } from "./helpers.ts";

// Seam A: the analyze CLI, replaying recorded Wikimedia responses offline.
const QUESTION = "Чи зростає інтерес до астрономії в україномовній Wikipedia?";

function analyzeAstronomy(outDir: string) {
  return analyzeAstronomyWith(outDir, QUESTION);
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

// 360 / 50,720,483 × 1,000,000 = 7.098 (rounded to 3 decimals).
const EXPECTED_UK_2026_08 = { month: "2026-08", article_views: 360, edition_views: 50720483, relative_attention: 7.098 };
// Median of the 12 monthly values 2025-09..2026-08, rounded to 2 decimals.
const EXPECTED_VIEWS_PER_MILLION = { uk: 7.91, cs: 8.72, pl: 6.1 };
