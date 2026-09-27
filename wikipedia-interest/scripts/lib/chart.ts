import { chartGeometry, type ChartGeometry, type ChartSeries } from "./chart-geometry.ts";

// Draws the relative attention chart with pdfkit primitives; every position comes from chart-geometry.ts.

/** Categorical hues in a fixed order, one per assessed language: the order of --langs, never the rank. */
const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const GRID = "#e6e6e6";
const TITLE_SIZE = 10;
const LABEL_SIZE = 7;
const LEGEND_SIZE = 8;
const PLOT_HEIGHT = 100;
const SWATCH = 14;
const LINE_WIDTH = 1.5;

export type ChartText = { title: string; baseline: string; ink: string; muted: string; rule: string };

/** Draws the chart from `top` across `width` at `left`, and returns the y under it. */
export function drawChart(
  doc: PDFKit.PDFDocument,
  months: string[],
  series: ChartSeries[],
  text: ChartText,
  formatTick: (value: number) => string,
  left: number,
  top: number,
  width: number,
): number {
  doc.fillColor(text.ink).fontSize(TITLE_SIZE).text(text.title, left, top, { width });
  const legendTop = doc.y + 4;
  const legendBottom = drawLegend(doc, series, text, left, legendTop, width);

  doc.fontSize(LABEL_SIZE);
  const xLabelWidth = doc.widthOfString("0000-00");
  const labelHeight = doc.currentLineHeight();
  // The plot starts right of the widest y label, and its top leaves room for the half of the top label above it.
  const plotTop = legendBottom + 8 + labelHeight / 2;
  const area = (gutter: number) => ({ left: left + gutter, top: plotTop, width: width - gutter, height: PLOT_HEIGHT });
  const draft = chartGeometry(months, series, area(0), xLabelWidth);
  const gutter = Math.max(...draft.yTicks.map((tick) => doc.widthOfString(formatTick(tick.value)))) + 6;
  const chart = chartGeometry(months, series, area(gutter), xLabelWidth);
  const plot = area(gutter);
  const bottom = plot.top + plot.height;

  drawAxes(doc, chart, plot.left, plot.left + plot.width, bottom, text, formatTick, labelHeight);
  doc.moveTo(plot.left, chart.baselineY).lineTo(plot.left + plot.width, chart.baselineY);
  doc.lineWidth(1).strokeColor(text.muted).dash(3, { space: 2 }).stroke().undash();
  drawSeries(doc, chart);

  doc.x = left;
  doc.y = bottom + 4 + labelHeight;
  return doc.y;
}

/** A line swatch and the language code per series, then the dashed baseline with what 100 means. */
function drawLegend(doc: PDFKit.PDFDocument, series: ChartSeries[], text: ChartText, left: number, top: number, width: number): number {
  doc.fontSize(LEGEND_SIZE);
  const middle = top + doc.currentLineHeight() / 2;
  let x = left;
  const swatch = (color: string, dashed: boolean) => {
    doc.moveTo(x, middle).lineTo(x + SWATCH, middle).lineWidth(dashed ? 1 : LINE_WIDTH).strokeColor(color);
    if (dashed) doc.dash(3, { space: 2 }).stroke().undash();
    else doc.stroke();
    x += SWATCH + 4;
  };
  const label = (value: string) => {
    doc.fillColor(text.ink).text(value, x, top, { lineBreak: false });
    x += doc.widthOfString(value) + 12;
  };
  series.forEach((s, i) => {
    swatch(SERIES_COLORS[i], false);
    label(s.lang);
  });
  swatch(text.muted, true);
  doc.fillColor(text.muted).text(text.baseline, x, top, { width: left + width - x, lineBreak: false });
  return top + doc.currentLineHeight();
}

function drawAxes(
  doc: PDFKit.PDFDocument,
  chart: ChartGeometry,
  plotLeft: number,
  plotRight: number,
  bottom: number,
  text: ChartText,
  formatTick: (value: number) => string,
  labelHeight: number,
): void {
  doc.fontSize(LABEL_SIZE).fillColor(text.muted).lineWidth(0.5);
  for (const tick of chart.yTicks) {
    doc.moveTo(plotLeft, tick.y).lineTo(plotRight, tick.y).strokeColor(GRID).stroke();
    const label = formatTick(tick.value);
    doc.text(label, plotLeft - 6 - doc.widthOfString(label), tick.y - labelHeight / 2, { lineBreak: false });
  }
  doc.moveTo(plotLeft, bottom).lineTo(plotRight, bottom).strokeColor(text.rule).stroke();
  for (const tick of chart.xTicks) {
    doc.moveTo(tick.x, bottom).lineTo(tick.x, bottom + 3).strokeColor(text.rule).stroke();
    const width = doc.widthOfString(tick.month);
    doc.text(tick.month, tick.x - width / 2, bottom + 4, { lineBreak: false });
  }
}

/** One line per language; a segment of a single month is a dot, so a month between two gaps still shows. */
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
