import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, it } from "node:test";
import { MAX_LANGUAGES } from "../scripts/lib/analysis.ts";
import { ACTIONS, RATIONALE_MAX_CHARACTERS, SUMMARY_MAX_CHARACTERS } from "../scripts/lib/conclusion.ts";
import { SKILL_DIR } from "../scripts/lib/env.ts";
import {
  FLAT_GROWTH_PCT,
  HISTORY_CHECK_TRUNCATED,
  LOW_VOLUME,
  LOW_VOLUME_MEDIAN_VIEWS,
  RAW_RELATIVE_DIVERGE,
  RECENT_SPIKE,
  SPIKE,
  SPIKE_MEDIAN_MULTIPLE,
  type InsufficientData,
  type Trend,
  type TrendReliability,
} from "../scripts/lib/metrics.ts";
import { FIRST_MONTH, MIN_MONTHS } from "../scripts/lib/period.ts";
import type { ChoiceReason } from "../scripts/lib/resolve.ts";
import { analyzeAstronomy, analyzeFasting, readPdf, runCli, runReport, TASK_EXAMPLES, tempDir } from "./helpers.ts";

// The SKILL.md contract: the Agent Skills format, and a fixed wording for every machine code the agent reads,
// so a cheap model never words a trend, its reliability or missing data on its own.

const SKILL = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
const [, FRONTMATTER = "", BODY = ""] = SKILL.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];

// Records keyed by the code unions: a code added to or removed from the code fails the typecheck until it is listed here.
const TRENDS: Record<Trend, null> = { up: null, down: null, flat: null };
const RELIABILITY_LEVELS: Record<TrendReliability, null> = { high: null, moderate: null, low: null };
const INSUFFICIENT_REASONS: Record<InsufficientData["reason"], null> = { no_linked_article: null, short_history: null, zero_baseline: null };
const CHOICE_REASONS: Record<ChoiceReason, null> = { disambiguation_page: null, redirect_to_section: null, no_exact_match: null };

// The code as a template: the variable parts of a code read in the JSON, as SKILL.md writes them.
const DIRECTION_MATCHES = "direction_matches_in_<N>_of_<M>_recent_months";
const MONTH = "YYYY-MM";
function template(code: string): string {
  return code.replace(/^direction_matches_in_\d+_of_\d+_recent_months$/, DIRECTION_MATCHES).replace(/\d{4}-\d{2}$/, MONTH);
}

const RELIABILITY_REASONS = [DIRECTION_MATCHES, LOW_VOLUME, `${RECENT_SPIKE}${MONTH}`, HISTORY_CHECK_TRUNCATED];
const FLAGS = [`${SPIKE}${MONTH}`, LOW_VOLUME, RAW_RELATIVE_DIVERGE, HISTORY_CHECK_TRUNCATED];

/** The cells after the code of every table row that starts with the code. */
function wordingRows(code: string): string[][] {
  return BODY.split("\n")
    .filter((line) => line.startsWith(`| \`${code}\``))
    .map((line) => line.split("|").slice(2, -1).map((cell) => cell.trim()));
}

function assertFixedWording(code: string): void {
  const rows = wordingRows(code);
  assert.ok(rows.length > 0, `SKILL.md has no table row for \`${code}\``);
  for (const cells of rows) {
    // The English and the Ukrainian wording, at least.
    assert.ok(cells.filter((cell) => cell !== "").length >= 2, `\`${code}\` lacks an English and a Ukrainian wording: ${cells.join(" | ")}`);
  }
}

describe("SKILL.md", () => {
  describe("the Agent Skills format", () => {
    it("starts with YAML frontmatter holding only fields of the specification", () => {
      assert.ok(FRONTMATTER !== "", "SKILL.md must start with --- frontmatter ---");
      const fields = [...FRONTMATTER.matchAll(/^([a-z-]+):/gm)].map(([, field]) => field);
      const allowed = ["name", "description", "license", "compatibility", "metadata", "allowed-tools"];
      assert.deepEqual(fields.filter((field) => !allowed.includes(field)), []);
    });

    it("is named like the skill folder and the plugin", () => {
      const name = FRONTMATTER.match(/^name: (.+)$/m)?.[1];
      assert.equal(name, basename(SKILL_DIR));
      assert.match(name!, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.ok(name!.length <= 64);
      const plugin = JSON.parse(readFileSync(join(SKILL_DIR, ".claude-plugin", "plugin.json"), "utf8"));
      assert.equal(plugin.name, name);
    });

    it("has a one-line description within the limit", () => {
      const description = FRONTMATTER.match(/^description: (.+)$/m)?.[1] ?? "";
      assert.ok(description.length > 0 && description.length <= 1024, `description is ${description.length} characters`);
    });

    it("keeps the body short enough to load whole", () => {
      assert.ok(BODY.split("\n").length <= 500);
    });

    it("runs only scripts that exist in the skill folder", () => {
      const paths = [...SKILL.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([\w./-]+)/g)].map(([, path]) => path);
      assert.ok(paths.length > 0);
      for (const path of new Set(paths)) assert.ok(existsSync(join(SKILL_DIR, path)), `${path} does not exist`);
    });

    it("does not point the agent at documents written for people", () => {
      assert.doesNotMatch(SKILL, /README|docs\/|PLAN\.md|ROADMAP|AI-VERIFICATION|CONTEXT\.md|TASK\.md/);
    });
  });

  describe("a fixed wording in English and Ukrainian", () => {
    for (const code of Object.keys(TRENDS)) it(`for the trend ${code}`, () => assertFixedWording(code));
    for (const code of [...Object.keys(RELIABILITY_LEVELS), "null"]) it(`for the trend reliability ${code}`, () => assertFixedWording(code));
    for (const code of RELIABILITY_REASONS) it(`for the reliability reason ${code}`, () => assertFixedWording(code));
    for (const code of FLAGS) it(`for the flag ${code}`, () => assertFixedWording(code));
    for (const code of Object.keys(INSUFFICIENT_REASONS)) it(`for the not-assessed reason ${code}`, () => assertFixedWording(code));
    for (const code of ACTIONS) it(`for the action ${code}`, () => assertFixedWording(code));

    it("for every code in real analysis results", () => {
      const fasting = tempDir();
      const astronomy = tempDir();
      assert.equal(analyzeFasting(fasting, "Порівняй інтерес до інтервального голодування").status, 0);
      assert.equal(analyzeAstronomy(astronomy, "Чи зростає інтерес до астрономії?").status, 0);
      const languages = [fasting, astronomy].flatMap((dir) => JSON.parse(readFileSync(join(dir, "analysis.json"), "utf8")).languages);
      const codes = new Set<string>(
        languages.flatMap((language) => [
          ...(language.reliability_reasons ?? []),
          ...(language.flags ?? []),
          ...(language.reason === undefined ? [] : [language.reason]),
        ]),
      );
      assert.ok(codes.size >= 3, `too few codes to check: ${[...codes].join(", ")}`);
      for (const code of codes) assertFixedWording(template(code));
    });
  });

  it("explains every needs_choice reason", () => {
    for (const code of Object.keys(CHOICE_REASONS)) assert.ok(BODY.includes(`\`${code}\``), `SKILL.md does not explain \`${code}\``);
  });

  it("states the limits the CLI enforces, as the CLI enforces them", () => {
    assert.ok(BODY.includes(`At most ${MAX_LANGUAGES} language editions`), "MAX_LANGUAGES");
    assert.ok(BODY.includes(`\`summary\`: at most ${SUMMARY_MAX_CHARACTERS} characters`), "SUMMARY_MAX_CHARACTERS");
    assert.ok(BODY.includes(`\`rationale\`: at most ${RATIONALE_MAX_CHARACTERS} characters`), "RATIONALE_MAX_CHARACTERS");
    assert.ok(BODY.includes(`at least ${MIN_MONTHS} months`), "MIN_MONTHS");
    assert.ok(BODY.includes(`not before ${FIRST_MONTH}`), "FIRST_MONTH");
    assert.ok(BODY.includes(`±${FLAT_GROWTH_PCT}%`), "FLAT_GROWTH_PCT");
    assert.ok(BODY.includes(`below ${LOW_VOLUME_MEDIAN_VIEWS}`), "LOW_VOLUME_MEDIAN_VIEWS");
    assert.ok(BODY.includes(`${SPIKE_MEDIAN_MULTIPLE}×`), "SPIKE_MEDIAN_MULTIPLE");
  });

  it("has an example conclusion.json that report.ts accepts", () => {
    const example = JSON.parse(BODY.match(/```json\n([\s\S]*?)\n```/)![1]);
    const runDir = tempDir();
    const analyzed = runCli("analyze", ["--qid", "Q333", "--langs", "uk,cs", "--report-lang", "uk", "--user-question", "q", "--out-dir", runDir], TASK_EXAMPLES);
    assert.equal(analyzed.status, 0, analyzed.stderr);
    const reported = runReport(runDir, TASK_EXAMPLES, example);
    assert.equal(reported.status, 0, reported.stderr);
  });

  // The example requests of the task, with the commands SKILL.md builds for them, offline on the recorded fixtures.
  describe("runs the example requests to a one-page PDF", () => {
    const examples = {
      "intermittent fasting in pl and cs, where pl is not assessed": [
        ["--topic", "Intermittent fasting", "--topic-lang", "en", "--langs", "pl,cs", "--months", "24"],
        ["cs"],
      ],
      "astronomy in uk": [["--topic", "астрономія", "--topic-lang", "uk", "--langs", "uk"], ["uk"]],
      "learning English through the English language as a proxy": [
        ["--topic", "English language", "--topic-lang", "en", "--langs", "uk,pl,cs", "--proxy-reason", "Увага до англійської мови загалом."],
        ["uk", "pl", "cs"],
      ],
    };
    for (const [name, [args, assessed]] of Object.entries(examples)) {
      it(name, async () => {
        const runDir = tempDir();
        const analyzed = runCli("analyze", [...args, "--report-lang", "uk", "--user-question", name, "--out-dir", runDir], TASK_EXAMPLES);
        assert.equal(analyzed.status, 0, analyzed.stderr);
        const languages: { lang: string; data_status: string }[] = JSON.parse(analyzed.stdout).languages;
        assert.deepEqual(languages.filter((language) => language.data_status === "ok").map((language) => language.lang), assessed);

        const reported = runReport(runDir, TASK_EXAMPLES);
        assert.equal(reported.status, 0, reported.stderr);
        assert.equal((await readPdf(JSON.parse(reported.stdout).files.report)).pages, 1);
      });
    }
  });
});
