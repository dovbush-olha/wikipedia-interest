import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { analyzeAstronomy, ASTRONOMY, FASTING, noNetworkEnv, runCli, tempDir, TOPIC_SEARCH } from "./helpers.ts";

// Seam A: the analyze CLI resolving the measured topic from free text, replaying recorded responses offline.
const QUESTION = "Чи зростає інтерес до астрономії в україномовній Wikipedia?";

function analyze(args: string[], env: Record<string, string>, outDir = tempDir()) {
  return runCli("analyze", ["--user-question", QUESTION, "--report-lang", "uk", "--out-dir", outDir, ...args], env);
}

function analysisIn(outDir: string) {
  return JSON.parse(readFileSync(join(outDir, "analysis.json"), "utf8"));
}

describe("analyze --topic, exact match", () => {
  it("takes the QID of the article with exactly that title, and analyzes it like --qid", () => {
    const byTopic = tempDir();
    const byQid = tempDir();
    const result = analyze(["--topic", "Astronomy", "--langs", "uk,cs,pl"], ASTRONOMY, byTopic);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(analyzeAstronomy(byQid, QUESTION).status, 0);

    const out = JSON.parse(result.stdout);
    assert.equal(out.status, "ok");
    assert.equal(out.measured_topic.qid, "Q333");
    assert.deepEqual(out.topic_match, { query: "Astronomy", topic_lang: "en", title: "Astronomy", redirected_from: null });
    const { topic_match: _match, ...analysis } = analysisIn(byTopic);
    const { topic_match: qidMatch, ...qidAnalysis } = analysisIn(byQid);
    assert.equal(qidMatch, null);
    assert.deepEqual(analysis, qidAnalysis);
  });

  it("matches in the --topic-lang edition regardless of the case of the first letter", () => {
    const result = analyze(["--topic", "астрономія", "--topic-lang", "uk", "--langs", "uk,cs,pl"], ASTRONOMY);
    assert.equal(result.status, 0, result.stderr);

    const out = JSON.parse(result.stdout);
    assert.equal(out.measured_topic.qid, "Q333");
    assert.deepEqual(out.topic_match, { query: "астрономія", topic_lang: "uk", title: "Астрономія", redirected_from: null });
  });

  it("follows a redirect to the whole article and says it did", () => {
    const result = analyze(["--topic", "Periodic fasting", "--langs", "cs,pl,eu,uk"], FASTING);
    assert.equal(result.status, 0, result.stderr);

    const out = JSON.parse(result.stdout);
    assert.equal(out.measured_topic.qid, "Q1666254");
    assert.deepEqual(out.topic_match, {
      query: "Periodic fasting",
      topic_lang: "en",
      title: "Intermittent fasting",
      redirected_from: "Periodic fasting",
    });
  });
});

describe("analyze --topic, needs_choice", () => {
  it("never picks a disambiguation page: it returns search candidates and downloads nothing else", () => {
    const outDir = tempDir();
    const result = analyze(["--topic", "Mercury", "--langs", "uk,cs,pl"], TOPIC_SEARCH, outDir);
    assert.equal(result.status, 0, result.stderr);

    const out = JSON.parse(result.stdout);
    assert.equal(out.status, "needs_choice");
    assert.equal(out.query, "Mercury");
    assert.equal(out.topic_lang, "en");
    assert.equal(out.reason, "disambiguation_page");
    // Search order, without the disambiguation page itself (Q48397), at most 5.
    assert.deepEqual(
      out.candidates.map((c: { qid: string; title: string }) => [c.qid, c.title]),
      [
        ["Q15869", "Freddie Mercury"],
        ["Q925", "Mercury (element)"],
        ["Q308", "Mercury (planet)"],
        ["Q165745", "Mercury Records"],
        ["Q52162", "Project Mercury"],
      ],
    );
    assert.match(out.next_step, /--qid/);
    assert.equal(existsSync(join(outDir, "analysis.json")), false);
  });

  it("gives every candidate its coverage of the requested languages and the languages it misses", () => {
    const result = analyze(["--topic", "learning English", "--langs", "uk,cs,pl"], TOPIC_SEARCH);
    assert.equal(result.status, 0, result.stderr);

    const out = JSON.parse(result.stdout);
    assert.equal(out.status, "needs_choice");
    assert.equal(out.reason, "disambiguation_page");
    const byQid = new Map(out.candidates.map((c: { qid: string }) => [c.qid, c]));
    // English as a second or foreign language: no article in any requested edition, and no Ukrainian description.
    assert.deepEqual(byQid.get("Q130192"), {
      qid: "Q130192",
      title: "English as a second or foreign language",
      description: EXPECTED_ESL_DESCRIPTION,
      description_lang: "en",
      coverage: "0/3",
      missing_langs: ["uk", "cs", "pl"],
    });
    for (const candidate of out.candidates) {
      assert.match(candidate.coverage, /^[0-3]\/3$/);
      assert.equal(Number(candidate.coverage[0]), 3 - candidate.missing_langs.length);
    }
  });

  it("returns even a single candidate for the agent to choose", () => {
    const query = '"alternate-day fasting" "periodic fasting" "5:2 diet"';
    const result = analyze(["--topic", query, "--langs", "uk,cs,pl"], TOPIC_SEARCH);
    assert.equal(result.status, 0, result.stderr);

    const out = JSON.parse(result.stdout);
    assert.equal(out.status, "needs_choice");
    assert.equal(out.reason, "no_exact_match");
    assert.deepEqual(
      out.candidates.map((c: { qid: string; coverage: string; missing_langs: string[] }) => [c.qid, c.coverage, c.missing_langs]),
      [["Q1666254", "2/3", ["pl"]]],
    );
  });

  it("does not take a redirect to a section as the topic, and offers the article of that section first", () => {
    const result = analyze(["--topic", "Stellar astronomy", "--langs", "uk,cs,pl"], TOPIC_SEARCH);
    assert.equal(result.status, 0, result.stderr);

    const out = JSON.parse(result.stdout);
    assert.equal(out.status, "needs_choice");
    assert.equal(out.reason, "redirect_to_section");
    assert.deepEqual(out.candidates[0], {
      qid: "Q333",
      title: "Astronomy",
      description: "одна з найдавніших наук, що включає спостереження і пояснення подій, які відбуваються за межами Землі та її атмосфери",
      description_lang: "uk",
      coverage: "3/3",
      missing_langs: [],
    });
    assert.equal(out.candidates.filter((c: { qid: string }) => c.qid === "Q333").length, 1);
  });
});

describe("analyze --topic, not_found", () => {
  it("says nothing matched and how to rephrase", () => {
    const outDir = tempDir();
    const result = analyze(["--topic", "qzxvwkjhplm", "--langs", "uk,cs,pl"], TOPIC_SEARCH, outDir);
    assert.equal(result.status, 0, result.stderr);

    const out = JSON.parse(result.stdout);
    assert.equal(out.status, "not_found");
    assert.equal(out.query, "qzxvwkjhplm");
    assert.equal(out.topic_lang, "en");
    assert.match(out.next_step, /--topic-lang/);
    assert.match(out.next_step, /rephrase/i);
    assert.equal(existsSync(join(outDir, "analysis.json")), false);
  });
});

describe("analyze relation to the question", () => {
  it("is direct without --proxy-reason", () => {
    const result = analyze(["--qid", "Q333", "--langs", "uk,cs,pl"], ASTRONOMY);
    assert.equal(result.status, 0, result.stderr);

    const topic = JSON.parse(result.stdout).measured_topic;
    assert.equal(topic.relation_to_question, "direct");
    assert.equal(topic.proxy_reason, null);
  });

  it("is proxy with --proxy-reason, which is kept verbatim", () => {
    const outDir = tempDir();
    const reason = "Статті про аматорську астрономію немає в усіх мовах; астрономія ширша за неї.";
    const result = analyze(["--qid", "Q333", "--langs", "uk,cs,pl", "--proxy-reason", ` ${reason} `], ASTRONOMY, outDir);
    assert.equal(result.status, 0, result.stderr);

    const topic = JSON.parse(result.stdout).measured_topic;
    assert.equal(topic.relation_to_question, "proxy");
    assert.equal(topic.proxy_reason, reason);
    assert.deepEqual(analysisIn(outDir).measured_topic, topic);
  });
});

describe("analyze measured topic terms", () => {
  it("falls back to the English description when Wikidata has none in the report language", () => {
    const result = analyze(["--qid", "Q1666254", "--langs", "cs,pl,eu,uk"], FASTING);
    assert.equal(result.status, 0, result.stderr);

    const topic = JSON.parse(result.stdout).measured_topic;
    assert.equal(topic.label, "Інтервальне голодування");
    assert.equal(topic.label_lang, "uk");
    assert.equal(topic.description, "a diet that cycles between a period of fasting and non-fasting");
    assert.equal(topic.description_lang, "en");
  });

  it("falls back to the English label when Wikidata has none in the report language", () => {
    const result = analyze(["--qid", "Q130192", "--langs", "uk,cs,pl"], ASTRONOMY);
    assert.equal(result.status, 0, result.stderr);

    const topic = JSON.parse(result.stdout).measured_topic;
    assert.equal(topic.label, "English as a second or foreign language");
    assert.equal(topic.label_lang, "en");
    assert.equal(topic.description, EXPECTED_ESL_DESCRIPTION);
    assert.equal(topic.description_lang, "en");
  });
});

describe("analyze topic argument errors", () => {
  const cases: { name: string; args: string[]; error: RegExp }[] = [
    { name: "neither --topic nor --qid", args: [], error: /^Error: pass the topic as --topic "<text>" or, once chosen, as --qid <Q\.\.\.>/ },
    { name: "both --topic and --qid", args: ["--topic", "Astronomy", "--qid", "Q333"], error: /^Error: --topic and --qid cannot be used together/ },
    { name: "an empty --topic", args: ["--topic", "  "], error: /^Error: --topic is empty/ },
    { name: "--topic-lang with --qid", args: ["--qid", "Q333", "--topic-lang", "uk"], error: /^Error: --topic-lang applies only to --topic/ },
    { name: "an invalid --topic-lang", args: ["--topic", "Astronomy", "--topic-lang", "english"], error: /^Error: --topic-lang must be a Wikipedia language code/ },
    { name: "an empty --proxy-reason", args: ["--qid", "Q333", "--proxy-reason", " "], error: /^Error: --proxy-reason is empty/ },
  ];

  for (const { name, args, error } of cases) {
    it(`rejects ${name} before any network request`, () => {
      const result = analyze(["--langs", "uk", ...args], noNetworkEnv("2026-09-15"));

      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, error);
      assert.doesNotMatch(result.stderr, /offline mode/);
    });
  }
});

const EXPECTED_ESL_DESCRIPTION = "use of English by speakers with different native languages";
