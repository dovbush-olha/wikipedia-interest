import { join } from "node:path";
import PDFDocument from "pdfkit";
import type { Analysis, LanguageResult } from "./analysis.ts";
import { UserError } from "./cli.ts";
import { LOW_VOLUME, recentSpikeMonth } from "./metrics.ts";
import { SKILL_DIR } from "./env.ts";
import { STRINGS, type Strings } from "./strings.ts";

// One A4 page. Every text on it comes from analysis.json or the report-language dictionary.

const FONT = join(SKILL_DIR, "assets", "fonts", "NotoSans-Regular.ttf");
const MARGIN = 48;
const INK = "#1a1a1a";
const MUTED = "#666666";
const RULE = "#bbbbbb";

export async function renderReport(analysis: Analysis, generatedOn: string): Promise<Buffer> {
  const t = STRINGS[analysis.report_lang];
  const { measured_topic: topic, period } = analysis;

  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    bufferPages: true,
    info: {
      Title: t.title(topic.label),
      CreationDate: new Date(`${generatedOn}T00:00:00Z`),
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve) => doc.on("end", resolve));

  doc.registerFont("body", FONT).font("body");
  const width = doc.page.width - 2 * MARGIN;

  const periodText = `${period.start} - ${period.end}`;
  doc.fillColor(INK).fontSize(16).text(t.title(topic.label), { width });
  doc.fillColor(MUTED).fontSize(10).text(`${t.period}: ${periodText}`, { width });
  doc.moveDown(0.8);
  labelled(doc, t.question, analysis.user_question, width);
  const description = topic.description === null ? "" : ` - ${topic.description}`;
  doc.moveDown(0.3);
  labelled(doc, t.measuredTopic, `${topic.label} (${topic.qid})${description}`, width);

  doc.moveDown(1.2);
  drawLanguageTable(doc, analysis, t, width);
  doc.moveDown(0.8).fillColor(MUTED).fontSize(8);
  for (const note of [t.viewsPerMillionNote, t.growthNote(analysis.growth_compares), t.heuristicNote]) {
    doc.text(note, MARGIN, doc.y, { width }).moveDown(0.4);
  }

  const footer = [[topic.qid, `${t.period}: ${periodText}`, `${t.generated} ${generatedOn}`].join("  ·  "), t.source].join("\n");
  doc.fontSize(8);
  const footerTop = doc.page.height - MARGIN - doc.heightOfString(footer, { width });
  doc.fillColor(MUTED).text(footer, MARGIN, footerTop, { width });

  const pages = doc.bufferedPageRange().count;
  doc.end();
  await done;
  if (pages > 1) {
    throw new UserError(`the report needs ${pages} pages but must fit on one. Shorten --user-question and rerun analyze.ts.`);
  }
  return Buffer.concat(chunks);
}

function labelled(doc: PDFKit.PDFDocument, label: string, value: string, width: number): void {
  doc.fontSize(10).fillColor(MUTED).text(`${label}: `, MARGIN, doc.y, { width, continued: true });
  doc.fillColor(INK).text(value);
}

function drawLanguageTable(doc: PDFKit.PDFDocument, analysis: Analysis, t: Strings, width: number): void {
  const languageNames = new Intl.DisplayNames([analysis.report_lang], { type: "language" });
  const decimals = (digits: number, signDisplay: "auto" | "exceptZero") =>
    new Intl.NumberFormat(analysis.report_lang, { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay });
  const views = decimals(2, "auto");
  const pct = decimals(1, "exceptZero");
  const growth = (value: number | null) => (value === null ? t.noData : `${pct.format(value)}%`);

  const left = "left" as const;
  const right = "right" as const;
  const columns: { header: string; share: number; align: "left" | "right"; cell: (language: LanguageResult) => string }[] = [
    { header: t.columnLanguage, share: 0.145, align: left, cell: (l) => `${l.lang} - ${languageNames.of(l.lang) ?? l.lang}` },
    { header: t.columnArticle, share: 0.135, align: left, cell: (l) => l.title },
    {
      header: t.columnViewsPerMillion,
      share: 0.1,
      align: right,
      cell: (l) => (l.views_per_million === null ? t.noData : views.format(l.views_per_million)),
    },
    { header: t.columnRelativeGrowth, share: 0.11, align: right, cell: (l) => growth(l.relative_attention_growth_pct) },
    { header: t.columnRawGrowth, share: 0.1, align: right, cell: (l) => growth(l.raw_growth_pct) },
    { header: t.columnEditionGrowth, share: 0.09, align: right, cell: (l) => growth(l.edition_growth_pct) },
    {
      header: t.columnMonthsUp,
      share: 0.095,
      align: right,
      cell: (l) => t.monthsUp(l.recent_trend_consistency.positive_months, l.recent_trend_consistency.months_compared),
    },
    { header: t.columnTrend, share: 0.105, align: left, cell: (l) => (l.trend === null ? t.noData : t.trend[l.trend]) },
    { header: t.columnReliability, share: 0.13, align: left, cell: (l) => reliabilityText(l, t) },
  ];
  // Shares were sized to the widest cell and header word at 9 and 8 pt, in both report languages.
  const gap = 6;
  const padding = 4;

  const row = (cells: string[], color: string) => {
    const top = doc.y;
    let x = MARGIN;
    let height = 0;
    cells.forEach((cell, i) => {
      const options = { width: columns[i].share * width - gap, align: columns[i].align };
      doc.fillColor(color).text(cell, x, top, options);
      height = Math.max(height, doc.heightOfString(cell, options));
      x += columns[i].share * width;
    });
    doc.x = MARGIN;
    doc.y = top + height + padding;
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + width, doc.y).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.y += padding;
  };

  doc.fontSize(8);
  row(columns.map((column) => column.header), MUTED);
  doc.fontSize(9);
  for (const language of analysis.languages) {
    row(columns.map((column) => column.cell(language)), INK);
  }
}

/** The level, then what lowered it: the direction reason is already in the months-up column. */
function reliabilityText(language: LanguageResult, t: Strings): string {
  if (language.trend_reliability === null) return t.noData;
  const downgrades = language.reliability_reasons.flatMap((reason) => {
    if (reason === LOW_VOLUME) return [t.lowVolume];
    const spike = recentSpikeMonth(reason);
    return spike === null ? [] : [t.spike(spike)];
  });
  const level = t.reliability[language.trend_reliability];
  return downgrades.length === 0 ? level : `${level}: ${downgrades.join(", ")}`;
}
