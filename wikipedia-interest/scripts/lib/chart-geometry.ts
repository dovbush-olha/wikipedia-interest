import { BASELINE_INDEX } from "./metrics.ts";

// The geometry of the relative attention chart, in PDF points: chart.ts only draws it.

/** The narrowest y domain, in index points: a flat series still gets readable whole-number ticks around it. */
const MIN_SPAN = 10;
/** About this many intervals between y ticks. */
const Y_INTERVALS = 5;
/** Months between x ticks, each aligned to the calendar: quarters, half-years, years, then every few Januaries. */
const X_STEPS = [1, 3, 6, 12, 24, 60, 120];
/** The least room between two neighbouring x labels, in points. */
const X_LABEL_GAP = 8;
/** The room between the right edge of a y label and the plot, in points. */
const Y_LABEL_GAP = 6;

export type ChartArea = { left: number; top: number; width: number; height: number };
/** One language edition: its indexed relative attention per month; null is a month without a value. */
export type ChartSeries = { lang: string; values: (number | null)[] };
/** Widths of the axis labels in the chart's font: a month label (YYYY-MM), centred on its tick, and the label of a y tick value. */
export type LabelWidths = { xWidth: number; yWidth: (value: number) => number };
export type Point = { x: number; y: number };
export type ChartGeometry = {
  /** The frame without the y labels at its left: the months span its width, the domain its height. */
  plot: ChartArea;
  /** From the lowest to the highest y tick: every value and the baseline are inside it. */
  domain: { min: number; max: number };
  /** `labelRight` is where the tick's label ends, right-aligned before the plot. */
  yTicks: { value: number; y: number; labelRight: number }[];
  xTicks: { month: string; x: number }[];
  baselineY: number;
  /** A line per language edition, broken into segments at months without a value. */
  series: { lang: string; segments: Point[][] }[];
};

/** The geometry of `series` over `months` (at least 2) in `frame`, which also holds the y labels at its left. */
export function chartGeometry(months: string[], series: ChartSeries[], frame: ChartArea, labels: LabelWidths): ChartGeometry {
  if (months.length < 2) throw new Error(`a chart needs at least 2 months, got ${months.length}`);
  const { domain, step } = yScale(series.flatMap((s) => s.values.filter((value) => value !== null)));
  const tickValues = Array.from({ length: Math.round((domain.max - domain.min) / step) + 1 }, (_, i) => domain.min + i * step);
  const gutter = Math.max(...tickValues.map(labels.yWidth)) + Y_LABEL_GAP;
  const plot = { ...frame, left: frame.left + gutter, width: frame.width - gutter };

  const bottom = plot.top + plot.height;
  const y = (value: number) => bottom - ((value - domain.min) / (domain.max - domain.min)) * plot.height;
  const x = (i: number) => plot.left + (i * plot.width) / (months.length - 1);

  return {
    plot,
    domain,
    yTicks: tickValues.map((value) => ({ value, y: y(value), labelRight: plot.left - Y_LABEL_GAP })),
    xTicks: xTicks(months, x, plot, labels.xWidth),
    baselineY: y(BASELINE_INDEX),
    series: series.map(({ lang, values }) => ({ lang, segments: segments(values, (value, i) => ({ x: x(i), y: y(value) })) })),
  };
}

/**
 * The months of the smallest calendar-aligned step whose labels do not overlap,
 * leaving out a label that would stick out of the plot.
 */
function xTicks(months: string[], x: (i: number) => number, area: ChartArea, labelWidth: number): { month: string; x: number }[] {
  const monthWidth = area.width / (months.length - 1);
  const step = X_STEPS.find((s) => s * monthWidth >= labelWidth + X_LABEL_GAP) ?? (X_STEPS.at(-1) as number);
  return months
    .map((month, i) => ({ month, x: x(i) }))
    .filter(({ month, x }) => {
      const [year, monthOfYear] = month.split("-").map(Number);
      const aligned = step <= 12 ? (monthOfYear - 1) % step === 0 : monthOfYear === 1 && year % (step / 12) === 0;
      return aligned && x - labelWidth / 2 >= area.left && x + labelWidth / 2 <= area.left + area.width;
    });
}

/** Runs of consecutive months with a value: a missing month breaks the line. */
function segments(values: (number | null)[], point: (value: number, i: number) => Point): Point[][] {
  const result: Point[][] = [];
  let current: Point[] = [];
  values.forEach((value, i) => {
    if (value === null) {
      if (current.length > 0) result.push(current);
      current = [];
    } else {
      current.push(point(value, i));
    }
  });
  if (current.length > 0) result.push(current);
  return result;
}

/**
 * The range of every value and the baseline, widened to MIN_SPAN around its middle when narrower,
 * then extended to whole multiples of a 1, 2 or 5 × 10^n tick step.
 */
function yScale(values: number[]): { domain: { min: number; max: number }; step: number } {
  let min = Math.min(BASELINE_INDEX, ...values);
  let max = Math.max(BASELINE_INDEX, ...values);
  if (max - min < MIN_SPAN) {
    const middle = (min + max) / 2;
    min = middle - MIN_SPAN / 2;
    max = middle + MIN_SPAN / 2;
  }
  const step = niceStep((max - min) / Y_INTERVALS);
  return { domain: { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step }, step };
}

/** The smallest 1, 2 or 5 × 10^n not below `rough`. */
function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 5, 10].map((m) => m * power).find((step) => step >= rough) as number;
}
