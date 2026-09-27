import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SKILL_DIR } from "../scripts/lib/env.ts";

export type CliResult = { status: number | null; stdout: string; stderr: string };

export function runCli(script: "analyze" | "report", args: string[], env: Record<string, string> = {}): CliResult {
  const result = spawnSync(process.execPath, [join(SKILL_DIR, "scripts", `${script}.ts`), ...args], {
    cwd: SKILL_DIR,
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "wikipedia-interest-test-"));
}

// Offline replay of recorded Wikimedia responses with a fixed "today".
export function fixtureEnv(fixture: string, now: string): Record<string, string> {
  return {
    EVAL_WIKI_INTEREST_NOW: now,
    EVAL_WIKI_INTEREST_CACHE_DIR: `tests/fixtures/${fixture}`,
    EVAL_WIKI_INTEREST_OFFLINE: "1",
  };
}

// Offline with an empty cache: any attempt to reach Wikimedia fails with an "offline mode" error.
export function noNetworkEnv(now: string): Record<string, string> {
  return {
    EVAL_WIKI_INTEREST_NOW: now,
    EVAL_WIKI_INTEREST_CACHE_DIR: tempDir(),
    EVAL_WIKI_INTEREST_OFFLINE: "1",
  };
}

// Q333 (astronomy) in uk, cs and pl, recorded on 2026-09-15: the default period is 2024-09..2026-08.
export const ASTRONOMY = fixtureEnv("astronomy-uk-cs-pl", "2026-09-15");

// Also recorded for 2024-03..2026-08, and for 2024-10..2026-09 on 2026-09-27, before Wikimedia published 2026-09.
export function analyzeAstronomy(
  outDir: string,
  question: string,
  { reportLang = "uk", periodArgs = [], env = ASTRONOMY }: { reportLang?: "uk" | "en"; periodArgs?: string[]; env?: Record<string, string> } = {},
): CliResult {
  return runCli(
    "analyze",
    ["--qid", "Q333", "--langs", "uk,cs,pl", "--user-question", question, "--report-lang", reportLang, "--out-dir", outDir, ...periodArgs],
    env,
  );
}

// Q1666254 (intermittent fasting) in cs, pl, eu and uk, recorded on 2026-09-27 for the period 2024-09..2026-08,
// the default period of a fixed "today" of 2026-09-15: pl has no article linked in Wikidata, and the eu article has views only from 2025-12.
// Also recorded: pl and eu alone in English, and cs with ua, a language code without a Wikipedia.
export const FASTING = fixtureEnv("fasting-cs-pl-eu-uk", "2026-09-15");

export function analyzeFasting(
  outDir: string,
  question: string,
  { reportLang = "uk", langs = "cs,pl,eu,uk" }: { reportLang?: "uk" | "en"; langs?: string } = {},
): CliResult {
  return runCli(
    "analyze",
    ["--qid", "Q1666254", "--langs", langs, "--user-question", question, "--report-lang", reportLang, "--out-dir", outDir],
    FASTING,
  );
}
