import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { growthCompares, languageMetrics } from "../scripts/lib/metrics.ts";
import type { MonthlyViews } from "../scripts/lib/pageviews.ts";
import { addMonths, monthsOf } from "../scripts/lib/period.ts";

// Seam C: the metrics of one language edition, from its two monthly series.

/** Consecutive months from `start`, one per value; null leaves the month out of the series. */
function views(start: string, values: (number | null)[]): Map<string, number> {
  const map = new Map<string, number>();
  values.forEach((value, i) => {
    if (value !== null) map.set(addMonths(start, i), value);
  });
  return map;
}

function months(start: string, count: number): string[] {
  return monthsOf({ start, end: addMonths(start, count - 1), months: count });
}

const flat = (count: number, value: number) => Array<number>(count).fill(value);

/** The metrics of a language edition that has enough data to be assessed. */
function assessed(periodMonths: string[], article: MonthlyViews, edition: MonthlyViews) {
  const metrics = languageMetrics(periodMonths, article, edition);
  assert.ok(metrics.data_status === "ok", `expected an assessed language, got ${JSON.stringify(metrics)}`);
  return metrics;
}

const MONTHS_24 = months("2024-09", 24);
/** 1,000,000 edition views every month, so relative attention equals article views. */
const EDITION_24 = views("2024-09", flat(24, 1_000_000));

describe("growth", () => {
  it("compares the median of the last 12 months with the median of the first 12", () => {
    // Article: first year 100..111 (median 105.5), last year 150 flat; edition halves from 2,000,000 to 1,000,000.
    const article = views("2024-09", [...Array.from({ length: 12 }, (_, i) => 100 + i), ...flat(12, 150)]);
    const edition = views("2024-09", [...flat(12, 2_000_000), ...flat(12, 1_000_000)]);

    const metrics = assessed(MONTHS_24, article, edition);

    // Raw: 150 / 105.5 - 1 = +42.2%. Edition: -50%. Relative: 150 / 52.75 - 1 = +184.4%.
    assert.equal(metrics.raw_growth_pct, 42.2);
    assert.equal(metrics.edition_growth_pct, -50);
    assert.equal(metrics.relative_attention_growth_pct, 184.4);
  });

  it("names the compared months of a 24-month period", () => {
    assert.deepEqual(growthCompares({ start: "2024-09", end: "2026-08", months: 24 }), {
      first_12_months: { start: "2024-09", end: "2025-08" },
      last_12_months: { start: "2025-09", end: "2026-08" },
    });
  });

  it("names the compared months of a 60-month period, leaving the middle out", () => {
    assert.deepEqual(growthCompares({ start: "2021-09", end: "2026-08", months: 60 }), {
      first_12_months: { start: "2021-09", end: "2022-08" },
      last_12_months: { start: "2025-09", end: "2026-08" },
    });
  });

  it("uses only the first and the last 12 months of a 60-month period", () => {
    // 100 in the first year, 1,000 in the three middle years, 200 in the last year.
    const article = views("2021-09", [...flat(12, 100), ...flat(36, 1_000), ...flat(12, 200)]);

    const metrics = assessed(months("2021-09", 60), article, views("2021-09", flat(60, 1_000_000)));

    assert.equal(metrics.raw_growth_pct, 100);
    assert.equal(metrics.relative_attention_growth_pct, 100);
    assert.equal(metrics.edition_growth_pct, 0);
  });
});

/** 12 months at `first`, then 12 recent months given one by one. Edition views stay at 1,000,000. */
function lastYear(first: number, recent: number[]) {
  return assessed(MONTHS_24, views("2024-09", [...flat(12, first), ...recent]), EDITION_24);
}

describe("recent trend consistency", () => {
  it("counts the last 12 months with relative attention strictly above the same month a year earlier", () => {
    // Against 100 a year earlier: 7 months above, 2 equal, 3 below.
    const metrics = lastYear(100, [150, 150, 150, 150, 150, 150, 150, 100, 100, 90, 90, 90]);

    assert.deepEqual(metrics.recent_trend_consistency, { positive_months: 7, months_compared: 12 });
  });

  it("compares each month with the same month a year earlier, not with the first-year median", () => {
    // The first year rises 100..210 and the last year repeats it 5 lower: most recent months beat the first months, none its own month.
    const firstYear = Array.from({ length: 12 }, (_, i) => 100 + 10 * i);
    const metrics = assessed(MONTHS_24, views("2024-09", [...firstYear, ...firstYear.map((v) => v - 5)]), EDITION_24);

    assert.deepEqual(metrics.recent_trend_consistency, { positive_months: 0, months_compared: 12 });
  });
});

describe("trend", () => {
  const cases: [growth: string, recent: number, trend: string][] = [
    ["+10.1%", 1101, "up"],
    ["+10%", 1100, "flat"],
    ["0%", 1000, "flat"],
    ["-10%", 900, "flat"],
    ["-10.1%", 899, "down"],
  ];
  for (const [growth, recent, trend] of cases) {
    it(`is ${trend} at ${growth}`, () => {
      assert.equal(lastYear(1000, flat(12, recent)).trend, trend);
    });
  }
});

/** A first year at 1,000, then `matching` recent months at `moved` and the rest at `rest`. */
function trending(matching: number, moved: number, rest: number) {
  return lastYear(1000, [...flat(12 - matching, rest), ...flat(matching, moved)]);
}

describe("trend reliability, heuristic_v1", () => {
  const levels: [matching: number, reliability: string][] = [
    [12, "high"],
    [9, "high"],
    [8, "moderate"],
    [7, "moderate"],
    [6, "low"],
  ];
  for (const [matching, reliability] of levels) {
    it(`is ${reliability} for an up trend with ${matching} of 12 recent months up`, () => {
      // The rest dip to 900; 6 up of 12 still gives a +20% median.
      const metrics = trending(matching, 1500, 900);

      assert.equal(metrics.trend, "up");
      assert.equal(metrics.trend_reliability, reliability);
      assert.equal(metrics.reliability_method, "heuristic_v1");
      assert.deepEqual(metrics.reliability_reasons, [`direction_matches_in_${matching}_of_12_recent_months`]);
      assert.deepEqual(metrics.flags, []);
    });

    it(`is ${reliability} for a down trend with ${matching} of 12 recent months down`, () => {
      // The rest stay level at 1,000, which is not down.
      const metrics = trending(matching, 600, 1000);

      assert.equal(metrics.trend, "down");
      assert.equal(metrics.trend_reliability, reliability);
      assert.deepEqual(metrics.reliability_reasons, [`direction_matches_in_${matching}_of_12_recent_months`]);
      // Consistency still counts the months up, not the months in the trend's direction.
      assert.deepEqual(metrics.recent_trend_consistency, { positive_months: 0, months_compared: 12 });
    });
  }

  it("is null for a flat trend", () => {
    const metrics = lastYear(1000, flat(12, 1050));

    assert.equal(metrics.trend, "flat");
    assert.equal(metrics.trend_reliability, null);
    assert.equal(metrics.reliability_method, "heuristic_v1");
    assert.deepEqual(metrics.reliability_reasons, []);
  });
});

describe("trend reliability downgrades", () => {
  it("lowers high to moderate for low volume", () => {
    // Raw views median of the last 12 months: 80, below 100.
    const metrics = lastYear(50, [...flat(3, 45), ...flat(9, 80)]);

    assert.equal(metrics.trend, "up");
    assert.equal(metrics.trend_reliability, "moderate");
    assert.deepEqual(metrics.reliability_reasons, ["direction_matches_in_9_of_12_recent_months", "low_volume"]);
    assert.deepEqual(metrics.flags, ["low_volume"]);
  });

  it("keeps the level at a raw views median of exactly 100", () => {
    const metrics = lastYear(80, [...flat(3, 70), ...flat(9, 100)]);

    assert.equal(metrics.trend_reliability, "high");
    assert.deepEqual(metrics.flags, []);
  });

  it("lowers high to moderate for a spike in the last 12 months", () => {
    // Period median of raw views: 1,250, so 5,000 is a spike.
    const metrics = lastYear(1000, [...flat(11, 1500), 5000]);

    assert.equal(metrics.trend_reliability, "moderate");
    assert.deepEqual(metrics.reliability_reasons, ["direction_matches_in_12_of_12_recent_months", "recent_spike:2026-08"]);
    assert.deepEqual(metrics.flags, ["spike:2026-08"]);
  });

  it("lowers moderate to low for a recent spike", () => {
    const metrics = lastYear(1000, [...flat(4, 900), ...flat(7, 1500), 5000]);

    assert.equal(metrics.trend_reliability, "low");
    assert.deepEqual(metrics.reliability_reasons, ["direction_matches_in_8_of_12_recent_months", "recent_spike:2026-08"]);
  });

  it("lowers only once however many recent months spike", () => {
    const metrics = lastYear(1000, [5000, ...flat(10, 1500), 5000]);

    assert.equal(metrics.trend_reliability, "moderate");
    assert.deepEqual(metrics.reliability_reasons, [
      "direction_matches_in_12_of_12_recent_months",
      "recent_spike:2025-09",
      "recent_spike:2026-08",
    ]);
    assert.deepEqual(metrics.flags, ["spike:2025-09", "spike:2026-08"]);
  });

  it("flags a spike before the last 12 months without lowering reliability", () => {
    // 2024-10 at 5,000: its own month a year later is not up, so 11 of 12 recent months are.
    const article = views("2024-09", [1000, 5000, ...flat(10, 1000), ...flat(12, 1500)]);
    const metrics = assessed(MONTHS_24, article, EDITION_24);

    assert.equal(metrics.trend_reliability, "high");
    assert.deepEqual(metrics.reliability_reasons, ["direction_matches_in_11_of_12_recent_months"]);
    assert.deepEqual(metrics.flags, ["spike:2024-10"]);
  });

  it("lowers high by two steps to low for low volume and a recent spike", () => {
    const metrics = lastYear(50, [...flat(3, 45), ...flat(8, 80), 400]);

    assert.equal(metrics.trend_reliability, "low");
    assert.deepEqual(metrics.reliability_reasons, ["direction_matches_in_9_of_12_recent_months", "low_volume", "recent_spike:2026-08"]);
    assert.deepEqual(metrics.flags, ["spike:2026-08", "low_volume"]);
  });

  it("never lowers below low", () => {
    const fromModerate = lastYear(50, [...flat(5, 45), ...flat(6, 80), 400]);
    const fromLow = lastYear(50, [...flat(6, 45), ...flat(5, 80), 400]);

    assert.equal(fromModerate.trend_reliability, "low");
    assert.deepEqual(fromModerate.reliability_reasons, ["direction_matches_in_7_of_12_recent_months", "low_volume", "recent_spike:2026-08"]);
    assert.equal(fromLow.trend, "up");
    assert.equal(fromLow.trend_reliability, "low");
    assert.deepEqual(fromLow.reliability_reasons, ["direction_matches_in_6_of_12_recent_months", "low_volume", "recent_spike:2026-08"]);
  });
});

describe("spikes", () => {
  it("is a month with raw views above 3 times the period median", () => {
    assert.deepEqual(lastYear(1000, [...flat(11, 1000), 3001]).flags, ["spike:2026-08"]);
  });

  it("is not a month at exactly 3 times the period median", () => {
    assert.deepEqual(lastYear(1000, [...flat(11, 1000), 3000]).flags, []);
  });

  it("is flagged for a flat trend too, which has no reliability to lower", () => {
    const metrics = lastYear(1000, [...flat(11, 1000), 5000]);

    assert.equal(metrics.trend, "flat");
    assert.equal(metrics.trend_reliability, null);
    assert.deepEqual(metrics.reliability_reasons, []);
    assert.deepEqual(metrics.flags, ["spike:2026-08"]);
  });
});

describe("raw/relative divergence", () => {
  // The edition halves after the first year.
  const halvingEdition = views("2024-09", [...flat(12, 2_000_000), ...flat(12, 1_000_000)]);
  const withRawRecent = (recent: number) =>
    assessed(MONTHS_24, views("2024-09", [...flat(12, 1000), ...flat(12, recent)]), halvingEdition);

  it("is flagged when raw views go down and relative attention goes up, without lowering reliability", () => {
    const metrics = withRawRecent(800);

    assert.equal(metrics.raw_growth_pct, -20);
    assert.equal(metrics.relative_attention_growth_pct, 60);
    assert.equal(metrics.trend_reliability, "high");
    assert.deepEqual(metrics.reliability_reasons, ["direction_matches_in_12_of_12_recent_months"]);
    assert.deepEqual(metrics.flags, ["raw_relative_diverge"]);
  });

  it("is flagged when raw views go up and relative attention goes down", () => {
    const edition = views("2024-09", [...flat(12, 1_000_000), ...flat(12, 2_000_000)]);
    const metrics = assessed(MONTHS_24, views("2024-09", [...flat(12, 1000), ...flat(12, 1500)]), edition);

    assert.equal(metrics.trend, "down");
    assert.deepEqual(metrics.flags, ["raw_relative_diverge"]);
  });

  it("is not flagged when raw views stay within ±10%", () => {
    const metrics = withRawRecent(900);

    assert.equal(metrics.raw_growth_pct, -10);
    assert.equal(metrics.trend, "up");
    assert.deepEqual(metrics.flags, []);
  });
});

describe("series preparation", () => {
  it("counts a month without data after the article's first month as zero views", () => {
    const article = views("2024-09", [...flat(12, 1000), null, ...flat(11, 1000)]);
    const metrics = assessed(MONTHS_24, article, EDITION_24);

    assert.deepEqual(metrics.series[12], { month: "2025-09", article_views: 0, edition_views: 1_000_000, relative_attention: 0 });
    assert.deepEqual(metrics.recent_trend_consistency, { positive_months: 0, months_compared: 12 });
  });

  it("computes relative attention as article views per million edition views", () => {
    const metrics = assessed(MONTHS_24, views("2024-09", flat(24, 360)), views("2024-09", flat(24, 50_720_483)));

    // 360 / 50,720,483 × 1,000,000 = 7.0977..., rounded to 3 decimals.
    assert.equal(metrics.series[0].relative_attention, 7.098);
    assert.equal(metrics.views_per_million, 7.1);
  });
});

describe("precision", () => {
  it("computes growth from unrounded relative attention in a large edition", () => {
    // 7,000,000,000 edition views: 100 views are 0.0142857... per million, 110 views 0.0157142..., a +10% growth.
    // Rounded to 3 decimals first, these would be 0.014 and 0.016, a +14.3% growth and an `up` trend.
    const edition = views("2024-09", flat(24, 7_000_000_000));
    const metrics = assessed(MONTHS_24, views("2024-09", [...flat(12, 100), ...flat(12, 110)]), edition);

    assert.equal(metrics.relative_attention_growth_pct, 10);
    assert.equal(metrics.trend, "flat");
  });

  it("counts a small year-over-year rise that rounding would hide", () => {
    // 100 and 101 views of 7,000,000,000 both round to 0.014 per million.
    const edition = views("2024-09", flat(24, 7_000_000_000));
    const metrics = assessed(MONTHS_24, views("2024-09", [...flat(12, 100), ...flat(12, 101)]), edition);

    assert.deepEqual(metrics.recent_trend_consistency, { positive_months: 12, months_compared: 12 });
  });
});

describe("spikes with a zero period median", () => {
  it("are not flagged, since 3 times zero says nothing about a spike", () => {
    // A first-year median of 1, then zero views but one month: the period median is 0.
    const article = views("2024-09", [...flat(7, 1), ...flat(5, 0), ...flat(11, 0), 7]);

    assert.deepEqual(assessed(MONTHS_24, article, EDITION_24).flags.filter((flag) => flag.startsWith("spike:")), []);
  });
});

describe("insufficient data", () => {
  it("is short_history when the article has no data in the first months of the period", () => {
    // The article appears in 2024-11: 22 of the 24 requested months are available.
    const metrics = languageMetrics(MONTHS_24, views("2024-09", [null, null, ...flat(22, 100)]), EDITION_24);

    assert.deepEqual(metrics, {
      data_status: "insufficient_data",
      reason: "short_history",
      max_months_available: 22,
      trend: null,
      trend_reliability: null,
    });
  });

  it("counts the available months from the article's first month to the end, zero-view gaps included", () => {
    // First data in 2026-03, then a month without views: 2026-03..2026-08 is 6 months.
    const article = views("2024-09", [...Array<null>(18).fill(null), 50, null, 60, 70, 80, 90]);

    assert.deepEqual(languageMetrics(MONTHS_24, article, EDITION_24), {
      data_status: "insufficient_data",
      reason: "short_history",
      max_months_available: 6,
      trend: null,
      trend_reliability: null,
    });
  });

  it("is short_history with no available months when the article has no views in the whole period", () => {
    const metrics = languageMetrics(MONTHS_24, new Map(), EDITION_24);

    assert.deepEqual(metrics, {
      data_status: "insufficient_data",
      reason: "short_history",
      max_months_available: 0,
      trend: null,
      trend_reliability: null,
    });
  });

  it("is zero_baseline when the median relative attention of the first 12 months is zero", () => {
    // 5 months with views and 7 without in the first year: its median is 0, whatever the last year does.
    const article = views("2024-09", [...flat(5, 40), ...flat(7, 0), ...flat(12, 500)]);

    assert.deepEqual(languageMetrics(MONTHS_24, article, EDITION_24), {
      data_status: "insufficient_data",
      reason: "zero_baseline",
      trend: null,
      trend_reliability: null,
    });
  });

  it("is assessed at a first-year median just above zero", () => {
    // 6 months with views and 6 without: the median is (0 + 1) / 2 = 0.5.
    const article = views("2024-09", [...flat(6, 1), ...flat(6, 0), ...flat(12, 1)]);
    const metrics = assessed(MONTHS_24, article, EDITION_24);

    assert.equal(metrics.relative_attention_growth_pct, 100);
    assert.equal(metrics.trend, "up");
  });

  it("marks an assessed language with data_status ok", () => {
    assert.equal(languageMetrics(MONTHS_24, views("2024-09", flat(24, 100)), EDITION_24).data_status, "ok");
  });
});
