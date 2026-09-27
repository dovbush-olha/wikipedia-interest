import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chartGeometry, type ChartSeries } from "../scripts/lib/chart-geometry.ts";
import { addMonths, monthsOf } from "../scripts/lib/period.ts";

// Seam D: the chart geometry, from the months, the indexed series and the plot area.

function months(start: string, count: number): string[] {
  return monthsOf({ start, end: addMonths(start, count - 1), months: count });
}

const AREA = { left: 50, top: 100, width: 480, height: 160 };
const BOTTOM = AREA.top + AREA.height;
/** Width of a "2024-09" label at the chart's font size. */
const X_LABEL_WIDTH = 28;

function geometry(values: (number | null)[][], count = values[0].length) {
  const series: ChartSeries[] = values.map((v, i) => ({ lang: `l${i}`, values: v }));
  return chartGeometry(months("2024-09", count), series, AREA, X_LABEL_WIDTH);
}

describe("chart geometry: y domain", () => {
  it("widens the domain of a flat series at 100, keeping the baseline inside the plot", () => {
    const chart = geometry([Array(24).fill(100)]);

    assert.ok(chart.domain.min < 100 && chart.domain.max > 100, JSON.stringify(chart.domain));
    assert.ok(chart.baselineY > AREA.top && chart.baselineY < BOTTOM, String(chart.baselineY));
  });

  it("widens the domain when every series has the same value away from the baseline", () => {
    const chart = geometry([Array(24).fill(100.4), Array(24).fill(100.4)]);

    assert.ok(chart.domain.max - chart.domain.min >= 10, JSON.stringify(chart.domain));
    assert.ok(chart.domain.min <= 100 && chart.domain.max >= 100.4, JSON.stringify(chart.domain));
  });

  it("keeps whole-number ticks from 0 to the top for a very large index, with the baseline inside", () => {
    const chart = geometry([[100, 5_000, 250_000, ...Array(21).fill(120_000)]]);

    assert.deepEqual(
      chart.yTicks.map((tick) => tick.value),
      [0, 50_000, 100_000, 150_000, 200_000, 250_000],
    );
    assert.deepEqual(chart.domain, { min: 0, max: 250_000 });
    assert.ok(chart.baselineY < BOTTOM && chart.baselineY > AREA.top, String(chart.baselineY));
  });

  it("keeps the baseline in the domain when every value is very small", () => {
    const chart = geometry([Array(24).fill(0.001)]);

    assert.deepEqual(
      chart.yTicks.map((tick) => tick.value),
      [0, 20, 40, 60, 80, 100],
    );
    assert.equal(chart.baselineY, AREA.top);
  });

  it("places ticks evenly from the bottom to the top of the plot", () => {
    const chart = geometry([[40, ...Array(23).fill(180)]]);

    const ys = chart.yTicks.map((tick) => tick.y);
    assert.equal(ys[0], BOTTOM);
    assert.equal(ys.at(-1), AREA.top);
    const gaps = ys.slice(1).map((y, i) => ys[i] - y);
    for (const gap of gaps) assert.ok(Math.abs(gap - gaps[0]) < 1e-9, JSON.stringify(ys));
    assert.ok(chart.yTicks.length >= 3 && chart.yTicks.length <= 7, JSON.stringify(chart.yTicks));
  });
});

describe("chart geometry: series", () => {
  it("draws a zero at the bottom of a domain that starts at 0", () => {
    const chart = geometry([[0, 100, 0, ...Array(21).fill(150)]]);

    assert.equal(chart.domain.min, 0);
    const [segment] = chart.series[0].segments;
    assert.equal(segment.length, 24);
    assert.equal(segment[0].y, BOTTOM);
    assert.equal(segment[2].y, BOTTOM);
  });

  it("breaks the line at a missing month instead of joining its neighbours", () => {
    const chart = geometry([[100, 110, null, 120, 130, null, null, 140, ...Array(16).fill(100)]]);

    const segments = chart.series[0].segments;
    assert.deepEqual(
      segments.map((segment) => segment.length),
      [2, 2, 17],
    );
    // Each point keeps the x of its own month.
    const step = AREA.width / 23;
    assert.equal(segments[1][0].x, AREA.left + 3 * step);
    assert.equal(segments[2][0].x, AREA.left + 7 * step);
  });

  it("spans the plot width from the first month to the last, one series per language", () => {
    const chart = geometry([Array(24).fill(100), Array(24).fill(90)]);

    assert.deepEqual(
      chart.series.map((s) => s.lang),
      ["l0", "l1"],
    );
    const [segment] = chart.series[1].segments;
    assert.equal(segment[0].x, AREA.left);
    assert.equal(segment.at(-1)?.x, AREA.left + AREA.width);
  });
});

describe("chart geometry: x ticks", () => {
  /** Tick labels are centred on their tick: none overlaps its neighbour or sticks out of the plot. */
  function assertReadable(xTicks: { month: string; x: number }[]) {
    for (const [i, tick] of xTicks.entries()) {
      assert.ok(tick.x - X_LABEL_WIDTH / 2 >= AREA.left && tick.x + X_LABEL_WIDTH / 2 <= AREA.left + AREA.width, tick.month);
      if (i > 0) assert.ok(tick.x - xTicks[i - 1].x > X_LABEL_WIDTH, `${xTicks[i - 1].month} and ${tick.month} overlap`);
    }
  }

  it("labels every quarter of a 24-month period", () => {
    const chart = geometry([Array(24).fill(100)]);

    assert.deepEqual(
      chart.xTicks.map((tick) => tick.month),
      ["2024-10", "2025-01", "2025-04", "2025-07", "2025-10", "2026-01", "2026-04", "2026-07"],
    );
    assertReadable(chart.xTicks);
    // A tick sits at the x of its own month.
    assert.equal(chart.xTicks[0].x, chart.series[0].segments[0][1].x);
  });

  it("labels every January of a 120-month period", () => {
    const chart = chartGeometry(months("2016-09", 120), [{ lang: "uk", values: Array(120).fill(100) }], AREA, X_LABEL_WIDTH);

    assert.deepEqual(
      chart.xTicks.map((tick) => tick.month),
      ["2017-01", "2018-01", "2019-01", "2020-01", "2021-01", "2022-01", "2023-01", "2024-01", "2025-01", "2026-01"],
    );
    assertReadable(chart.xTicks);
  });

  it("keeps labels apart for every period length from 24 months to all the data since 2015-07", () => {
    for (let count = 24; count <= 134; count++) {
      const chart = chartGeometry(months("2015-07", count), [{ lang: "uk", values: Array(count).fill(100) }], AREA, X_LABEL_WIDTH);
      assert.ok(chart.xTicks.length >= 4, `${count} months: ${chart.xTicks.length} ticks`);
      assertReadable(chart.xTicks);
    }
  });
});
