import PDFDocument from "pdfkit";
import type { Analysis, AssessedLanguage, NotAssessedLanguage } from "./analysis.ts";
import { drawChart } from "./chart.ts";
import { UserError } from "./cli.ts";
import type { Conclusion, LanguageConclusion } from "./conclusion.ts";
import { FONT_FILE } from "./glyphs.ts";
import { HISTORY_CHECK_TRUNCATED, indexedAttention, LOW_VOLUME, recentSpikeMonth } from "./metrics.ts";
import { monthsOf } from "./period.ts";
import { STRINGS, type Strings } from "./strings.ts";

// One A4 page. Every fact on it comes from analysis.json or the report-language dictionary;
// the model's interpretation from conclusion.json sits on a tint of its own, apart from the facts.

const MARGIN = 36;
const INK = "#1a1a1a";
const MUTED = "#666666";
const RULE = "#bbbbbb";
/** Background and edge of the interpretation: the recommendation block and each language's action in the table. */
const INTERPRETATION_TINT = "#f4f1ea";
const INTERPRETATION_EDGE = "#9c8a5e";
const INTERPRETATION_EDGE_WIDTH = 2.5;
const TITLE_SIZE = 14;
/** The question, the measured topic, the summary, the table and the heading of the not-assessed group. */
const BODY_SIZE = 9;
/** Secondary text: the table header, the recommendation heading and the reasons in the not-assessed group. */
const SMALL_SIZE = 8;
/** The notes under the table and the group, and the footer: fixed method texts, set small so the page keeps its room for the data. */
const NOTE_SIZE = 7;
/** The least room between the content and the footer. */
const FOOTER_GAP = 12;
/** Width share of the language column, in the table and in the not-assessed group alike. */
const LANGUAGE_SHARE = 0.145;

export async function renderReport(analysis: Analysis, conclusion: Conclusion, generatedOn: string): Promise<Buffer> {
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

  doc.registerFont("body", FONT_FILE).font("body");
  const width = doc.page.width - 2 * MARGIN;

  const periodText = `${period.start} - ${period.end}`;
  doc.fillColor(INK).fontSize(TITLE_SIZE).text(t.title(topic.label), { width });
  doc.fillColor(MUTED).fontSize(BODY_SIZE).text(`${t.period}: ${periodText}`, { width });
  doc.moveDown(0.6);
  labelled(doc, t.question, analysis.user_question, width);
  const description = topic.description === null ? "" : ` - ${topic.description}`;
  doc.moveDown(0.3);
  labelled(doc, t.measuredTopic, `${topic.label} (${topic.qid})${description}`, width);
  if (topic.relation_to_question === "proxy") {
    doc.moveDown(0.3);
    labelled(doc, t.assumption, `${t.proxyAssumption} ${topic.proxy_reason}`, width);
  }
  doc.moveDown(0.6);
  drawRecommendation(doc, t.recommendationHeading, conclusion.summary, width);

  // Languages with insufficient data are never ranked with the assessed ones: they get a group of their own.
  const assessed = analysis.languages.filter((language) => language.data_status === "ok");
  const notAssessed = analysis.languages.filter((language) => language.data_status === "insufficient_data");
  const languageName = languageNamer(analysis);
  if (assessed.length > 0) {
    // Only assessed languages have a baseline to index to; the others are named in their group under the table.
    const series = assessed.map((language) => ({ lang: language.lang, values: indexedAttention(language.series) }));
    const labels = { title: t.chartTitle, baseline: t.chartBaseline(analysis.growth_compares) };
    const tick = new Intl.NumberFormat(analysis.report_lang, { maximumFractionDigits: 0 });
    const ink = { text: INK, muted: MUTED, rule: RULE };
    const top = doc.y + doc.currentLineHeight();
    drawChart(doc, monthsOf(period), series, labels, ink, (value) => tick.format(value), { left: MARGIN, top, width });
    doc.fontSize(BODY_SIZE).moveDown(0.6);
    drawLanguageTable(doc, assessed, conclusion.languages, analysis, languageName, t, width);
    doc.moveDown(0.6).fillColor(MUTED).fontSize(NOTE_SIZE);
    for (const note of [t.viewsPerMillionNote, t.growthNote(analysis.growth_compares), t.heuristicNote]) {
      doc.text(note, MARGIN, doc.y, { width }).moveDown(0.3);
    }
  }
  if (notAssessed.length > 0) {
    doc.moveDown(assessed.length > 0 ? 0.6 : 1);
    drawNotAssessed(doc, notAssessed, analysis, languageName, t, width);
  }
  // Every article's history check, assessed or not: a missed historical title can also be why a history looks short.
  const articles = analysis.languages.filter((language) => language.title !== null);
  if (articles.length > 0) {
    const historyNote = t.historyNote(
      articles.map((language) => ({
        lang: language.lang,
        titles: language.historical_titles,
        checked: language.redirect_candidates_checked,
        truncated: language.flags.includes(HISTORY_CHECK_TRUNCATED),
      })),
    );
    doc.moveDown(notAssessed.length > 0 ? 0.6 : 0).fillColor(MUTED).fontSize(NOTE_SIZE).text(historyNote, MARGIN, doc.y, { width });
  }

  const contentBottom = doc.y;
  const footer = [[topic.qid, `${t.period}: ${periodText}`, `${t.generated} ${generatedOn}`].join("  ·  "), t.source].join("\n");
  doc.fontSize(NOTE_SIZE);
  const footerTop = doc.page.height - MARGIN - doc.heightOfString(footer, { width });
  doc.fillColor(MUTED).text(footer, MARGIN, footerTop, { width });

  // The footer sits at the foot of the page: content reaching into it does not fit either.
  const fits = doc.bufferedPageRange().count === 1 && contentBottom + FOOTER_GAP <= footerTop;
  doc.end();
  await done;
  if (!fits) {
    // The worst-case tests keep a conclusion within its limits on the page: what overflows it is an unbounded text of the analysis.
    throw new UserError("the report does not fit on one page. Shorten --user-question or --proxy-reason and rerun analyze.ts.");
  }
  return Buffer.concat(chunks);
}

function labelled(doc: PDFKit.PDFDocument, label: string, value: string, width: number): void {
  doc.fontSize(BODY_SIZE).fillColor(MUTED).text(`${label}: `, MARGIN, doc.y, { width, continued: true });
  doc.fillColor(INK).text(value);
}

/** The summary of the conclusion under its heading, on the interpretation tint. */
function drawRecommendation(doc: PDFKit.PDFDocument, heading: string, summary: string, width: number): void {
  const padding = 6;
  const inner = { width: width - 2 * padding - INTERPRETATION_EDGE_WIDTH };
  const left = MARGIN + INTERPRETATION_EDGE_WIDTH + padding;
  const top = doc.y;
  const headingHeight = doc.fontSize(SMALL_SIZE).heightOfString(heading, inner);
  const gap = 3;
  const summaryHeight = doc.fontSize(BODY_SIZE).heightOfString(summary, inner);
  const height = padding + headingHeight + gap + summaryHeight + padding;

  interpretationTint(doc, MARGIN, top, width, height);
  doc.fillColor(MUTED).fontSize(SMALL_SIZE).text(heading, left, top + padding, inner);
  doc.fillColor(INK).fontSize(BODY_SIZE).text(summary, left, top + padding + headingHeight + gap, inner);
  doc.x = MARGIN;
  doc.y = top + height;
}

function interpretationTint(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number): void {
  doc.rect(x, y, width, height).fill(INTERPRETATION_TINT);
  doc.rect(x, y, INTERPRETATION_EDGE_WIDTH, height).fill(INTERPRETATION_EDGE);
}

/** "pl - polski" style label of a language edition, in the report language. */
function languageNamer(analysis: Analysis): (lang: string) => string {
  const names = new Intl.DisplayNames([analysis.report_lang], { type: "language" });
  return (lang) => `${lang} - ${names.of(lang) ?? lang}`;
}

function drawLanguageTable(
  doc: PDFKit.PDFDocument,
  languages: AssessedLanguage[],
  interpretations: LanguageConclusion[],
  analysis: Analysis,
  languageName: (lang: string) => string,
  t: Strings,
  width: number,
): void {
  const decimals = (digits: number, signDisplay: "auto" | "exceptZero") =>
    new Intl.NumberFormat(analysis.report_lang, { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay });
  const views = decimals(2, "auto");
  const pct = decimals(1, "exceptZero");
  const growth = (value: number | null) => (value === null ? t.noData : `${pct.format(value)}%`);

  const left = "left" as const;
  const right = "right" as const;
  const columns: { header: string; share: number; align: "left" | "right"; cell: (language: AssessedLanguage) => string }[] = [
    { header: t.columnLanguage, share: LANGUAGE_SHARE, align: left, cell: (l) => languageName(l.lang) },
    { header: t.columnArticle, share: 0.135, align: left, cell: (l) => l.title },
    { header: t.columnViewsPerMillion, share: 0.1, align: right, cell: (l) => views.format(l.views_per_million) },
    { header: t.columnRelativeGrowth, share: 0.11, align: right, cell: (l) => growth(l.relative_attention_growth_pct) },
    { header: t.columnRawGrowth, share: 0.1, align: right, cell: (l) => growth(l.raw_growth_pct) },
    { header: t.columnEditionGrowth, share: 0.09, align: right, cell: (l) => growth(l.edition_growth_pct) },
    {
      header: t.columnMonthsUp,
      share: 0.095,
      align: right,
      cell: (l) => t.monthsUp(l.recent_trend_consistency.positive_months, l.recent_trend_consistency.months_compared),
    },
    { header: t.columnTrend, share: 0.105, align: left, cell: (l) => t.trend[l.trend] },
    { header: t.columnReliability, share: 0.13, align: left, cell: (l) => reliabilityText(l, t) },
  ];
  // Shares were sized to the widest cell and header word at 9 and 8 pt, in both report languages.
  const gap = 6;
  const padding = 3;

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
  };
  const rule = () => {
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + width, doc.y).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.y += padding;
  };
  // The model's action and rationale under the language's facts, on the interpretation tint: from the article column on,
  // so the language name stays the row's only label.
  const interpretationLeft = MARGIN + LANGUAGE_SHARE * width;
  const interpretation = ({ action, rationale }: LanguageConclusion) => {
    const options = { width: MARGIN + width - interpretationLeft - INTERPRETATION_EDGE_WIDTH - 2 * padding };
    const text = `${t.action[action]}: ${rationale}`;
    const top = doc.y - padding / 2;
    const height = doc.heightOfString(text, options) + padding;
    interpretationTint(doc, interpretationLeft - padding, top, MARGIN + width - interpretationLeft + padding, height);
    doc.fillColor(INK).text(text, interpretationLeft + INTERPRETATION_EDGE_WIDTH, top + padding / 2, options);
    doc.x = MARGIN;
    doc.y = top + height + padding;
  };

  doc.fontSize(SMALL_SIZE);
  row(columns.map((column) => column.header), MUTED);
  rule();
  doc.fontSize(BODY_SIZE);
  // readConclusion orders the interpretations as the assessed languages.
  languages.forEach((language, i) => {
    row(columns.map((column) => column.cell(language)), INK);
    interpretation(interpretations[i]);
    rule();
  });
}

/** The group «Not assessed»: each language with the fixed wording for its reason, in --langs order and unranked. */
function drawNotAssessed(
  doc: PDFKit.PDFDocument,
  languages: NotAssessedLanguage[],
  analysis: Analysis,
  languageName: (lang: string) => string,
  t: Strings,
  width: number,
): void {
  doc.fillColor(INK).fontSize(BODY_SIZE).text(t.notAssessedHeading, MARGIN, doc.y, { width });
  doc.moveDown(0.2).fillColor(MUTED).fontSize(NOTE_SIZE).text(t.notAssessedNote, MARGIN, doc.y, { width });
  doc.moveDown(0.5).fontSize(SMALL_SIZE).fillColor(INK);

  const labelWidth = LANGUAGE_SHARE * width;
  for (const language of languages) {
    const top = doc.y;
    const label = languageName(language.lang);
    const text = notAssessedText(language, analysis, t);
    const labelOptions = { width: labelWidth - 6 };
    const textOptions = { width: width - labelWidth };
    doc.text(label, MARGIN, top, labelOptions);
    doc.text(text, MARGIN + labelWidth, top, textOptions);
    doc.x = MARGIN;
    doc.y = top + Math.max(doc.heightOfString(label, labelOptions), doc.heightOfString(text, textOptions)) + 4;
  }
}

function notAssessedText(language: NotAssessedLanguage, analysis: Analysis, t: Strings): string {
  switch (language.reason) {
    case "no_linked_article":
      return t.noLinkedArticle;
    case "short_history":
      return t.shortHistory(language.title, language.max_months_available, analysis.period.months);
    case "zero_baseline":
      return t.zeroBaseline(analysis.growth_compares);
  }
}

/** The level, then what lowered it: the direction reason is already in the months-up column. */
function reliabilityText(language: AssessedLanguage, t: Strings): string {
  if (language.trend_reliability === null) return t.noData;
  const downgrades = language.reliability_reasons.flatMap((reason) => {
    if (reason === LOW_VOLUME) return [t.lowVolume];
    if (reason === HISTORY_CHECK_TRUNCATED) return [t.historyCheckTruncated];
    const spike = recentSpikeMonth(reason);
    return spike === null ? [] : [t.spike(spike)];
  });
  const level = t.reliability[language.trend_reliability];
  return downgrades.length === 0 ? level : `${level}: ${downgrades.join(", ")}`;
}
