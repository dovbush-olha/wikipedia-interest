import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "./cli.ts";
import { cacheConfig } from "./env.ts";

// Wikimedia requires a User-Agent that identifies the client and a way to contact its authors.
const USER_AGENT = "wikipedia-interest-skill/0.1 (https://github.com/dovbush-olha/wikipedia-interest)";
const RETRIES = 2;

export type JsonResponse = { status: 200 | 404; body: unknown };

type CacheEntry = JsonResponse & { url: string; fetched_at: string };

export type GetJsonOptions = {
  /** Refetch a live cache entry older than this; fixture caches never expire. Default: never. */
  maxAgeDays?: number;
  /**
   * Return a response without caching it, e.g. while the latest month is not published yet.
   * Fixture recording ignores it: a replay must see exactly what Wikimedia answered.
   */
  cacheIf?: (body: unknown) => boolean;
};

/** GET a JSON API through the file cache. 404 is a normal answer ("no data"); other failures throw. */
export async function getJson(url: string, options: GetJsonOptions = {}): Promise<JsonResponse> {
  const config = cacheConfig();
  const file = join(config.dir, `${createHash("sha256").update(url).digest("hex").slice(0, 24)}.json`);

  const cached = readCache(file);
  if (cached !== null && (config.fixtures || isFresh(cached, options.maxAgeDays))) {
    return { status: cached.status, body: cached.body };
  }
  if (config.offline) {
    throw new UserError(
      `offline mode (EVAL_WIKI_INTEREST_OFFLINE=1): no recorded response for ${url} in ${config.dir}. ` +
        "Use only the QIDs, languages and dates the fixtures were recorded for.",
    );
  }

  const response = await fetchJson(url);
  if (config.fixtures || options.cacheIf === undefined || options.cacheIf(response.body)) {
    writeCache(file, { url, ...response, fetched_at: new Date().toISOString() });
  }
  return response;
}

function readCache(file: string): CacheEntry | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as CacheEntry;
  } catch {
    return null;
  }
}

function isFresh(entry: CacheEntry, maxAgeDays: number | undefined): boolean {
  if (maxAgeDays === undefined) return true;
  return Date.now() - Date.parse(entry.fetched_at) < maxAgeDays * 24 * 60 * 60 * 1000;
}

function writeCache(file: string, entry: CacheEntry): void {
  mkdirSync(join(file, ".."), { recursive: true });
  // Write-then-rename, so a concurrent or interrupted run never leaves a half-written entry.
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(entry, null, 2)}\n`);
  renameSync(temporary, file);
}

async function fetchJson(url: string): Promise<JsonResponse> {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    } catch (error) {
      if (attempt < RETRIES) {
        await delay(attempt);
        continue;
      }
      throw new UserError(`could not reach ${host} (${(error as Error).message}). Check the network and rerun.`);
    }
    if (response.status === 200 || response.status === 404) {
      try {
        return { status: response.status, body: await response.json() };
      } catch {
        throw new UserError(`${host} answered HTTP ${response.status} with a body that is not JSON for ${url}. Rerun later.`);
      }
    }
    if ((response.status === 429 || response.status >= 500) && attempt < RETRIES) {
      await delay(attempt);
      continue;
    }
    throw new UserError(`${host} answered HTTP ${response.status} for ${url}. Rerun later.`);
  }
}

function delay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
}
