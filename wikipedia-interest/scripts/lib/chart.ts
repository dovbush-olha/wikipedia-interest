import { MAX_LANGUAGES } from "./analysis.ts";
import { chartGeometry, type ChartArea, type ChartGeometry, type ChartSeries } from "./chart-geometry.ts";

// Draws the relative attention chart with pdfkit primitives; every position on the plot comes from chart-geometry.ts.

/** Categorical hues in a fixed order, one per assessed language edition: the order of --langs, never the rank. */
const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
if (SERIES_COLORS.length < MAX_LANGUAGES) {
  throw new Error(`the chart has ${SERIES_COLORS.length} series colors for up to ${MAX_LANGUAGES} language editions`);
}
const GRID = "#e6e6e6";
const TITLE_SIZE = 10;
const LABEL_SIZE = 7;
const LEGEND_SIZE = 8;
const PLOT_HEIGHT = 100;
const SWATCH = 14;
const LINE_WIDTH = 1.5;

/** The fixed texts of the chart, in the report language. */
export type ChartLabels = { title: string; baseline: string };
/** The text and rule colors of the page the chart sits on. */
export type Ink = { text: string; muted: string; rule: string };

/** Draws the chart from `top` across `width` at `left`, and returns the y under it. */
export function drawChart(
  doc: PDFKit.PDFDocument,
  months: string[],
  series: ChartSeries[],
  labels: ChartLabels,
  ink: Ink,
  formatTick: (value: number) => string,
  { left, top, width }: Omit<ChartArea, "height">,
): number {
  doc.fillColor(ink.text).fontSize(TITLE_SIZE).text(labels.title, left, top, { width });
  const legendBottom = drawLegend(doc, series, labels, ink, left, doc.y + 4, width);

  doc.fontSize(LABEL_SIZE);
  const labelHeight = doc.currentLineHeight();
  // Room above the plot for the half of the top y label that rises above its tick.
  const frame = { left, top: legendBottom + 8 + labelHeight / 2, width, height: PLOT_HEIGHT };
  const chart = chartGeometry(months, series, frame, {
    xWidth: doc.widthOfString("0000-00"),
    yWidth: (value) => doc.widthOfString(formatTick(value)),
  });

  drawAxes(doc, chart, ink, formatTick, labelHeight);
  dashed(doc.moveTo(chart.plot.left, chart.baselineY).lineTo(chart.plot.left + chart.plot.width, chart.baselineY), ink.muted);
  drawSeries(doc, chart);

  doc.x = left;
  doc.y = chart.plot.top + chart.plot.height + 4 + labelHeight;
  return doc.y;
}

/** The baseline's line style, on the plot and in the legend. */
function dashed(doc: PDFKit.PDFDocument, color: string): void {
  doc.lineWidth(1).strokeColor(color).dash(3, { space: 2 }).stroke().undash();
}

/** A line swatch and the language code per series, then the dashed baseline with what 100 means. */
function drawLegend(
  doc: PDFKit.PDFDocument,
  series: ChartSeries[],
  labels: ChartLabels,
  ink: Ink,
  left: number,
  top: number,
  width: number,
): number {
  doc.fontSize(LEGEND_SIZE);
  const middle = top + doc.currentLineHeight() / 2;
  let x = left;
  series.forEach((s, i) => {
    doc.moveTo(x, middle).lineTo(x + SWATCH, middle).lineWidth(LINE_WIDTH).strokeColor(SERIES_COLORS[i]).stroke();
    x += SWATCH + 4;
    doc.fillColor(ink.text).text(s.lang, x, top, { lineBreak: false });
    x += doc.widthOfString(s.lang) + 12;
  });
  dashed(doc.moveTo(x, middle).lineTo(x + SWATCH, middle), ink.muted);
  x += SWATCH + 4;
  doc.fillColor(ink.muted).text(labels.baseline, x, top, { width: left + width - x, lineBreak: false });
  return top + doc.currentLineHeight();
}

function drawAxes(doc: PDFKit.PDFDocument, chart: ChartGeometry, ink: Ink, formatTick: (value: number) => string, labelHeight: number): void {
  const { left, width } = chart.plot;
  const bottom = chart.plot.top + chart.plot.height;
  doc.fontSize(LABEL_SIZE).fillColor(ink.muted).lineWidth(0.5);
  for (const tick of chart.yTicks) {
    doc.moveTo(left, tick.y).lineTo(left + width, tick.y).strokeColor(GRID).stroke();
    const label = formatTick(tick.value);
    doc.text(label, tick.labelRight - doc.widthOfString(label), tick.y - labelHeight / 2, { lineBreak: false });
  }
  doc.moveTo(left, bottom).lineTo(left + width, bottom).strokeColor(ink.rule).stroke();
  for (const tick of chart.xTicks) {
    doc.moveTo(tick.x, bottom).lineTo(tick.x, bottom + 3).strokeColor(ink.rule).stroke();
    doc.text(tick.month, tick.x - doc.widthOfString(tick.month) / 2, bottom + 4, { lineBreak: false });
  }
}

/** One line per language edition; a segment of a single month is a dot, so a month between two gaps still shows. */
function drawSeries(doc: PDFKit.PDFDocument, chart: ChartGeometry): void {
  doc.lineWidth(LINE_WIDTH).lineJoin("round").lineCap("round");
  chart.series.forEach(({ segments }, i) => {
    const color = SERIES_COLORS[i];
    for (const segment of segments) {
      if (segment.length === 1) {
        doc.circle(segment[0].x, segment[0].y, LINE_WIDTH).fillColor(color).fill();
        continue;
      }
      doc.moveTo(segment[0].x, segment[0].y);
      for (const point of segment.slice(1)) doc.lineTo(point.x, point.y);
      doc.strokeColor(color).stroke();
    }
  });
}
