import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SKILL_DIR } from "../scripts/lib/env.ts";
import { runCli, tempDir } from "./helpers.ts";

// The `claude plugin eval` suite in evals/: every case replays recorded Wikimedia responses offline,
// so the fixtures of a case must answer every analyze command SKILL.md leads the model to for its prompt.

const EVALS_DIR = join(SKILL_DIR, "evals");
// Every case checks the whole flow with the same graders: analyze before report, conclusion.json, the PDF, report.ts succeeding.
const SHARED_GRADERS = ["analyze-before-report.md", "conclusion-written.md", "report-pdf-created.md", "report-succeeded.md"];

type Expected = { args: string[]; status: "ok" | "needs_choice"; qid?: string };

// The analyze commands a model may run for each case: the topic as English and as Ukrainian text, and the chosen --qid.
const CASES: Record<string, Expected[]> = {
  "fasting-pl-cs": [
    { args: ["--topic", "Intermittent fasting", "--topic-lang", "en", "--langs", "pl,cs"], status: "ok", qid: "Q1666254" },
    { args: ["--topic", "інтервальне голодування", "--topic-lang", "uk", "--langs", "pl,cs"], status: "ok", qid: "Q1666254" },
    { args: ["--qid", "Q1666254", "--langs", "cs,pl"], status: "ok", qid: "Q1666254" },
  ],
  "astronomy-uk": [
    { args: ["--topic", "Astronomy", "--topic-lang", "en", "--langs", "uk"], status: "ok", qid: "Q333" },
    { args: ["--topic", "астрономія", "--topic-lang", "uk", "--langs", "uk"], status: "ok", qid: "Q333" },
  ],
  "learning-english-proxy": [
    { args: ["--topic", "learning English", "--topic-lang", "en", "--langs", "uk,pl,cs"], status: "needs_choice" },
    {
      args: ["--topic", "English language", "--topic-lang", "en", "--langs", "uk,pl,cs", "--proxy-reason", "Увага до англійської мови загалом."],
      status: "ok",
      qid: "Q1860",
    },
    { args: ["--qid", "Q1860", "--langs", "uk,pl,cs", "--proxy-reason", "Увага до англійської мови загалом."], status: "ok", qid: "Q1860" },
  ],
  "mercury-ambiguous": [
    { args: ["--topic", "Mercury", "--topic-lang", "en", "--langs", "uk,cs,pl"], status: "needs_choice", qid: "Q308" },
    { args: ["--topic", "Меркурій", "--topic-lang", "uk", "--langs", "uk,cs,pl"], status: "needs_choice", qid: "Q308" },
    { args: ["--qid", "Q308", "--langs", "uk,cs,pl"], status: "ok", qid: "Q308" },
  ],
  "follow-up-add-slovak": [
    { args: ["--qid", "Q1666254", "--langs", "pl,cs,sk"], status: "ok", qid: "Q1666254" },
    { args: ["--qid", "Q1666254", "--langs", "cs,pl,sk"], status: "ok", qid: "Q1666254" },
  ],
};

/** The EVAL_ variables of a case's prompt.md frontmatter. */
function caseEnv(name: string): Record<string, string> {
  const prompt = readFileSync(join(EVALS_DIR, name, "prompt.md"), "utf8");
  const frontmatter = prompt.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
  return Object.fromEntries([...frontmatter.matchAll(/^ {2}(EVAL_[A-Z0-9_]+): "?([^"\n]*)"?$/gm)].map(([, key, value]) => [key, value]));
}

function caseNames(): string[] {
  return readdirSync(EVALS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(EVALS_DIR, entry.name, "prompt.md")))
    .map((entry) => entry.name)
    .sort();
}

describe("evals", () => {
  it("has exactly the five cases of the plan", () => {
    assert.deepEqual(caseNames(), Object.keys(CASES).sort());
  });

  it("gives every case the same shared graders", () => {
    const [first, ...rest] = caseNames();
    for (const grader of SHARED_GRADERS) {
      const expected = readFileSync(join(EVALS_DIR, first, "graders", grader), "utf8");
      for (const name of rest) assert.equal(readFileSync(join(EVALS_DIR, name, "graders", grader), "utf8"), expected, `${name}/graders/${grader}`);
    }
  });

  it("continues the follow-up from a first session of example 1 that the resume can walk whole", () => {
    const history = readFileSync(join(EVALS_DIR, "follow-up-add-slovak", "first-session.jsonl"), "utf8").trim().split("\n");
    const records = history.map((line) => JSON.parse(line));
    // The resume walks parentUuid back from the last record and silently drops every record it does not reach.
    records.forEach((record, i) => assert.equal(record.parentUuid, i === 0 ? null : records[i - 1].uuid, `record ${i}`));
    const firstPrompt = readFileSync(join(EVALS_DIR, "fasting-pl-cs", "prompt.md"), "utf8").split("\n---\n")[1].trim();
    assert.equal(records[0].message.content, firstPrompt);
    assert.ok(records.some((record) => JSON.stringify(record.message.content).includes("scripts/report.ts")), "the first session ran report.ts");
  });

  for (const [name, commands] of Object.entries(CASES)) {
    describe(name, () => {
      it("runs offline on a fixture folder of the skill with a fixed today", () => {
        const env = caseEnv(name);
        assert.equal(env.EVAL_WIKI_INTEREST_OFFLINE, "1");
        assert.match(env.EVAL_WIKI_INTEREST_NOW ?? "", /^\d{4}-\d{2}-\d{2}$/);
        assert.match(env.EVAL_WIKI_INTEREST_CACHE_DIR ?? "", /^tests\/fixtures\/[\w-]+$/);
        assert.ok(existsSync(join(SKILL_DIR, env.EVAL_WIKI_INTEREST_CACHE_DIR)), env.EVAL_WIKI_INTEREST_CACHE_DIR);
      });

      for (const { args, status, qid } of commands) {
        it(`answers analyze ${args.join(" ")} from the fixtures`, () => {
          const result = runCli(
            "analyze",
            [...args, "--report-lang", "uk", "--user-question", "Питання користувача", "--out-dir", tempDir()],
            caseEnv(name),
          );
          assert.equal(result.status, 0, result.stderr);
          const out = JSON.parse(result.stdout);
          assert.equal(out.status, status);
          if (status === "ok") assert.equal(out.measured_topic.qid, qid);
          if (status === "needs_choice" && qid !== undefined) assert.ok(out.candidates.some((c: { qid: string }) => c.qid === qid), `no ${qid} candidate`);
        });
      }
    });
  }
});
