import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { UserError } from "./cli.ts";

export const SKILL_DIR = join(import.meta.dirname, "..", "..");

// Environment variables used by evals and offline tests; `claude plugin eval` only passes the EVAL_ prefix.
// To record fixtures, set EVAL_WIKI_INTEREST_CACHE_DIR without EVAL_WIKI_INTEREST_OFFLINE: live responses are saved there.
const NOW = "EVAL_WIKI_INTEREST_NOW";
const CACHE_DIR = "EVAL_WIKI_INTEREST_CACHE_DIR";
const OFFLINE = "EVAL_WIKI_INTEREST_OFFLINE";

/** Today's UTC date as YYYY-MM-DD, or the fixed date from EVAL_WIKI_INTEREST_NOW. */
export function today(): string {
  const fixed = process.env[NOW];
  if (fixed === undefined || fixed === "") return new Date().toISOString().slice(0, 10);
  // The round trip rejects dates that Date would silently roll over, such as 2026-02-31.
  const parsed = new Date(`${fixed}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fixed) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== fixed) {
    throw new UserError(`${NOW}="${fixed}" is not a date; use YYYY-MM-DD.`);
  }
  return fixed;
}

export type CacheConfig = {
  dir: string;
  /** A fixture directory: entries never expire, so replays stay reproducible. */
  fixtures: boolean;
  offline: boolean;
};

export function cacheConfig(): CacheConfig {
  const fixtureDir = process.env[CACHE_DIR];
  const fixtures = fixtureDir !== undefined && fixtureDir !== "";
  return {
    dir: fixtures ? resolve(SKILL_DIR, fixtureDir) : join(SKILL_DIR, ".cache", "http"),
    fixtures,
    offline: process.env[OFFLINE] === "1",
  };
}

export function isInsideSkillDir(path: string): boolean {
  const fromSkill = relative(SKILL_DIR, resolve(path));
  const outside = fromSkill === ".." || fromSkill.startsWith(`..${sep}`) || isAbsolute(fromSkill);
  return !outside;
}
