import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readPdf, runCli, runReport, tempDir, type CliResult } from "./helpers.ts";

// Live smoke tests: the three example requests of the task against the real Wikimedia API, as SKILL.md turns them into commands.
// Not part of `npm test`: run them with `npm run smoke` before a release. Each run starts from an empty cache,
// so every response comes from Wikimedia today; the assertions hold only what live data should not change.

// An empty cache folder of its own: responses are saved there, but never read from an earlier run.
function liveEnv(): Record<string, string> {
  return { EVAL_WIKI_INTEREST_CACHE_DIR: tempDir() };
}

function analyze(args: string[], env: Record<string, string>): CliResult & { outDir: string } {
  const outDir = tempDir();
  return { ...runCli("analyze", [...args, "--out-dir", outDir], env), outDir };
}

type LanguageOut = { lang: string; data_status: string; reason?: string; views_per_million?: number; trend?: string | null };

function languages(stdout: string): Map<string, LanguageOut> {
  const out = JSON.parse(stdout) as { languages: LanguageOut[] };
  return new Map(out.languages.map((language) => [language.lang, language]));
}

function assertAssessed(language: LanguageOut | undefined): void {
  assert.ok(language, "the language is missing from the result");
  assert.equal(language.data_status, "ok", `${language.lang} is not assessed: ${language.reason}`);
  assert.ok((language.views_per_million ?? 0) > 0, `${language.lang} has no relative attention`);
  assert.ok(["up", "down", "flat"].includes(language.trend ?? ""), `${language.lang} has no trend`);
}

async function assertOnePageReport(outDir: string, env: Record<string, string>): Promise<void> {
  const result = runReport(outDir, env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await readPdf(join(outDir, "report.pdf"))).pages, 1);
}

describe("live: the three example requests of the task", { timeout: 300_000 }, () => {
  it("example 1: intermittent fasting in pl and cs, where pl has no article linked in Wikidata", async () => {
    const env = liveEnv();
    const run = analyze(
      [
        "--topic", "Intermittent fasting", "--topic-lang", "en", "--langs", "pl,cs", "--months", "24", "--report-lang", "uk",
        "--user-question", "Порівняй зростання інтересу до інтервального голодування в польськомовній та чеськомовній Wikipedia за останні два роки.",
      ],
      env,
    );
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.status, "ok");
    assert.equal(out.measured_topic.qid, "Q1666254");
    assert.equal(out.period.months, 24);
    const byLang = languages(run.stdout);
    assert.equal(byLang.get("pl")?.reason, "no_linked_article");
    assertAssessed(byLang.get("cs"));
    await assertOnePageReport(run.outDir, env);
  });

  it("example 2: astronomy in uk", async () => {
    const env = liveEnv();
    const run = analyze(
      [
        "--topic", "Astronomy", "--topic-lang", "en", "--langs", "uk", "--months", "24", "--report-lang", "uk",
        "--user-question", "Ми думаємо додати курс з астрономії до освітнього застосунку. Чи зростає інтерес до цієї теми в україномовній Wikipedia, і наскільки цьому зростанню можна довіряти?",
      ],
      env,
    );
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.measured_topic.qid, "Q333");
    assert.equal(out.measured_topic.relation_to_question, "direct");
    assertAssessed(languages(run.stdout).get("uk"));
    await assertOnePageReport(run.outDir, env);
  });

  it("example 3: learning English is a disambiguation page, then English language is measured as a proxy in uk, pl and cs", async () => {
    const env = liveEnv();
    const question = "Ми створюємо застосунок для вивчення мов. Порівняй інтерес до вивчення англійської у вибраних нами мовних розділах та підготуй короткий звіт: які аудиторії варто дослідити наступними й чому?";
    const common = ["--langs", "uk,pl,cs", "--months", "24", "--report-lang", "uk", "--user-question", question];

    const choice = analyze(["--topic", "learning English", "--topic-lang", "en", ...common], env);
    assert.equal(choice.status, 0, choice.stderr);
    const needsChoice = JSON.parse(choice.stdout);
    assert.equal(needsChoice.status, "needs_choice");
    assert.equal(needsChoice.reason, "disambiguation_page");
    assert.ok(needsChoice.candidates.length > 0);

    const run = analyze(
      ["--topic", "English language", "--topic-lang", "en", "--proxy-reason", "Увага до англійської мови загалом, а не лише до її вивчення.", ...common],
      env,
    );
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.measured_topic.qid, "Q1860");
    assert.equal(out.measured_topic.relation_to_question, "proxy");
    const byLang = languages(run.stdout);
    for (const lang of ["uk", "pl", "cs"]) assertAssessed(byLang.get(lang));
    await assertOnePageReport(run.outDir, env);
  });
});
