import PDFDocument from "pdfkit";
import type { Analysis, AssessedLanguage, NotAssessedLanguage } from "./analysis.ts";
import { drawChart } from "./chart.ts";
import { UserError } from "./cli.ts";
import type { Conclusion, LanguageConclusion } from "./conclusion.ts";
import { FONT_FILE, unsupportedCharacters } from "./glyphs.ts";
import { HISTORY_CHECK_TRUNCATED, indexedAttention, LOW_VOLUME, RAW_RELATIVE_DIVERGE, recentSpikeMonth, spikeMonth } from "./metrics.ts";
import { monthsOf } from "./period.ts";
import { STRINGS, type Strings } from "./strings.ts";

// One A4 page. Every fact on it comes from analysis.json or the report-language dictionary;
// the model's interpretation from conclusion.json sits on a tint of its own, apart from the facts.

const MARGIN = 30;
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
/** The notes, the limitations and the footer: fixed method texts, set small so the page keeps its room for the data. */
const NOTE_SIZE = 7;
/** Leading of the small texts that run to many lines: the font's own is generous, it suits the body text. */
const DENSE_LINE_GAP = -1;
/** The least room between the content and the footer. */
const FOOTER_GAP = 12;
/** Width share of the language column, in the table and in the not-assessed group alike. */
const LANGUAGE_SHARE = 0.145;
/** Historical titles named per article in the limitations; the rest are counted, so a long move log keeps to its lines. */
const HISTORICAL_TITLES_SHOWN = 2;
/** The indent of a limitation's text after its bullet. */
const BULLET_INDENT = 8;

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
  drawTitle(doc, t.title(topic.label), `${t.period}: ${periodText}`, width);
  doc.moveDown(0.5);
  labelled(doc, t.question, analysis.user_question, width);
  const description = topic.description === null ? "" : ` - ${topic.description}`;
  doc.moveDown(0.3);
  labelled(doc, t.measuredTopic, `${topic.label} (${topic.qid})${description}`, width);
  if (topic.relation_to_question === "proxy") {
    doc.moveDown(0.3);
    labelled(doc, t.assumption, `${t.proxyAssumption} ${topic.proxy_reason}`, width);
  }
  doc.moveDown(0.5);
  drawRecommendation(doc, t.recommendationHeading, conclusion.summary, width);

  // Languages with insufficient data are never ranked with the assessed ones: they get a group of their own.
  const assessed = analysis.languages.filter((language) => language.data_status === "ok");
  const notAssessed = analysis.languages.filter((language) => language.data_status === "insufficient_data");
  const languageName = languageNamer(analysis);
  const articleName = articleNamer(analysis, t);
  if (assessed.length > 0) {
    // Only assessed languages have a baseline to index to; the others are named in their group under the table.
    const series = assessed.map((language) => ({ lang: language.lang, values: indexedAttention(language.series) }));
    const labels = { title: t.chartTitle, baseline: t.chartBaseline(analysis.growth_compares) };
    const tick = new Intl.NumberFormat(analysis.report_lang, { maximumFractionDigits: 0 });
    const ink = { text: INK, muted: MUTED, rule: RULE };
    const top = doc.y + doc.currentLineHeight();
    drawChart(doc, monthsOf(period), series, labels, ink, (value) => tick.format(value), { left: MARGIN, top, width });
    doc.fontSize(BODY_SIZE).moveDown(0.5);
    drawLanguageTable(doc, assessed, conclusion.languages, analysis, languageName, articleName, t, width);
  }
  if (notAssessed.length > 0) {
    doc.moveDown(assessed.length > 0 ? 0.5 : 1);
    drawNotAssessed(doc, notAssessed, analysis, languageName, articleName, t, width);
  }
  if (assessed.length > 0) {
    // What the table's metrics mean, closing with the heuristic_v1 note: after the not-assessed group, which has no metrics.
    doc.moveDown(0.5).fillColor(MUTED).fontSize(NOTE_SIZE);
    for (const note of [`${t.viewsPerMillionNote} ${t.growthNote(analysis.growth_compares)}`, t.heuristicNote]) {
      doc.text(note, MARGIN, doc.y, { width, lineGap: DENSE_LINE_GAP }).moveDown(0.3);
    }
  }
  doc.moveDown(0.3);
  drawLimitations(doc, limitations(analysis, assessed, t), t.limitationsHeading, width);

  const contentBottom = doc.y;
  const footer = [[topic.qid, `${t.period}: ${periodText}`, `${t.generated} ${generatedOn}`].join("  ·  "), t.source].join("\n");
  doc.fontSize(NOTE_SIZE);
  // The font's own leading: with less, pdfkit takes the last line for one past the page's foot and starts a new page.
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

/** The title, and the period at the right end of its line when there is room, under it otherwise. */
function drawTitle(doc: PDFKit.PDFDocument, title: string, period: string, width: number): void {
  const top = doc.y;
  const titleWidth = doc.fontSize(TITLE_SIZE).widthOfString(title);
  const titleHeight = doc.currentLineHeight();
  const periodWidth = doc.fontSize(BODY_SIZE).widthOfString(period);
  if (titleWidth + 2 * TITLE_SIZE + periodWidth > width) {
    doc.fillColor(INK).fontSize(TITLE_SIZE).text(title, MARGIN, top, { width });
    doc.fillColor(MUTED).fontSize(BODY_SIZE).text(period, { width });
    return;
  }
  // Both on the title's baseline.
  const baseline = top + TITLE_SIZE;
  doc.fillColor(INK).fontSize(TITLE_SIZE).text(title, MARGIN, baseline, { baseline: "alphabetic", lineBreak: false });
  doc.fillColor(MUTED).fontSize(BODY_SIZE).text(period, MARGIN + width - periodWidth, baseline, { baseline: "alphabetic", lineBreak: false });
  doc.x = MARGIN;
  doc.y = top + titleHeight;
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

/**
 * The title of a language edition's article as the page shows it: as is when the font can draw it, otherwise
 * the measured topic's label with its QID and the language code, marked for the note under the limitations.
 */
function articleNamer(analysis: Analysis, t: Strings): (lang: string, title: string) => string {
  const { label, qid } = analysis.measured_topic;
  return (lang, title) => (drawable(title) ? title : t.titleNotShown(label, qid, lang));
}

function drawable(text: string): boolean {
  return unsupportedCharacters(text).length === 0;
}

/**
 * The fixed limitations of the method, then those of this analysis: the proxy, raw views and relative attention moving
 * in opposite directions, spikes, the history check of every article, and titles the font cannot draw.
 */
function limitations(analysis: Analysis, assessed: AssessedLanguage[], t: Strings): string[] {
  const items = [...t.limitations];
  if (analysis.measured_topic.relation_to_question === "proxy") items.push(t.proxyLimitation(analysis.measured_topic.label));

  const diverging = assessed.filter((language) => language.flags.includes(RAW_RELATIVE_DIVERGE));
  // A diverging trend is never flat: up is more relative attention on fewer raw views, down the other way round.
  const fewer = diverging.filter((language) => language.trend === "up").map((language) => language.lang);
  const more = diverging.filter((language) => language.trend === "down").map((language) => language.lang);
  if (fewer.length > 0) items.push(t.fewerRawViews(fewer));
  if (more.length > 0) items.push(t.moreRawViews(more));

  const spikes = assessed.flatMap((language) => {
    const months = language.flags.flatMap((flag) => spikeMonth(flag) ?? []);
    return months.length === 0 ? [] : [t.spikeMonths(language.lang, months)];
  });
  if (spikes.length > 0) items.push(`${t.spikesIntro} ${spikes.join("; ")}.`);

  // Every article's history check, assessed or not: a missed historical title can also be why a history looks short.
  const articles = analysis.languages.filter((language) => language.title !== null);
  if (articles.length > 0) {
    items.push(
      t.historyNote(
        articles.map((language) => {
          const shown = language.historical_titles.filter(drawable).slice(0, HISTORICAL_TITLES_SHOWN);
          return {
            lang: language.lang,
            titles: shown,
            more: language.historical_titles.length - shown.length,
            checked: language.redirect_candidates_checked,
            truncated: language.flags.includes(HISTORY_CHECK_TRUNCATED),
          };
        }),
      ),
    );
  }
  const undrawable = (language: (typeof articles)[number]) => !drawable(language.title) || !language.historical_titles.every(drawable);
  if (articles.some(undrawable)) items.push(t.titleNotShownNote);
  return items;
}

/** The block «Assumptions and limitations»: a heading, then one bullet per limitation. */
function drawLimitations(doc: PDFKit.PDFDocument, items: string[], heading: string, width: number): void {
  doc.fillColor(INK).fontSize(BODY_SIZE).text(heading, MARGIN, doc.y, { width });
  doc.moveDown(0.2).fillColor(MUTED).fontSize(NOTE_SIZE);
  for (const item of items) {
    const top = doc.y;
    doc.text("•", MARGIN, top, { lineBreak: false });
    doc.text(item, MARGIN + BULLET_INDENT, top, { width: width - BULLET_INDENT, lineGap: DENSE_LINE_GAP });
    doc.moveDown(0.1);
  }
  doc.x = MARGIN;
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
  articleName: (lang: string, title: string) => string,
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
    { header: t.columnArticle, share: 0.187, align: left, cell: (l) => articleName(l.lang, l.title) },
    { header: t.columnViewsPerMillion, share: 0.095, align: right, cell: (l) => views.format(l.views_per_million) },
    { header: t.columnRelativeGrowth, share: 0.095, align: right, cell: (l) => growth(l.relative_attention_growth_pct) },
    { header: t.columnRawGrowth, share: 0.095, align: right, cell: (l) => growth(l.raw_growth_pct) },
    { header: t.columnEditionGrowth, share: 0.095, align: right, cell: (l) => growth(l.edition_growth_pct) },
    {
      header: t.columnMonthsUp,
      share: 0.09,
      align: right,
      cell: (l) => t.monthsUp(l.recent_trend_consistency.positive_months, l.recent_trend_consistency.months_compared),
    },
    { header: t.columnTrend, share: 0.106, align: left, cell: (l) => t.trend[l.trend] },
    { header: t.columnReliability, share: 0.092, align: left, cell: (l) => (l.trend_reliability === null ? t.noData : t.reliability[l.trend_reliability]) },
  ];
  // Shares were sized to the widest cell (a growth of four digits) and header word at 9 and 8 pt, in both report languages;
  // the article column takes the rest.
  const gap = 6;
  // More room where a left-aligned column follows a right-aligned one, whose text runs up to the column's edge.
  const turn = 4;
  const padding = 3;

  const row = (cells: string[], color: string) => {
    const top = doc.y;
    let x = MARGIN;
    let height = 0;
    cells.forEach((cell, i) => {
      const indent = i > 0 && columns[i - 1].align === "right" && columns[i].align === "left" ? turn : 0;
      const options = { width: columns[i].share * width - gap - indent, align: columns[i].align };
      doc.fillColor(color).text(cell, x + indent, top, options);
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
  // What lowered trend reliability, under the language's facts across the width: a narrow column would stack its reasons.
  const lowered = (language: AssessedLanguage) => {
    const reasons = reliabilityDowngrades(language, t);
    if (reasons.length === 0) return;
    const options = { width: MARGIN + width - interpretationLeft };
    doc.fontSize(SMALL_SIZE).fillColor(MUTED).text(`${t.reliabilityLowered}: ${reasons.join(", ")}`, interpretationLeft, doc.y, options);
    doc.fontSize(BODY_SIZE);
    doc.x = MARGIN;
    doc.y += padding;
  };
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
    lowered(language);
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
  articleName: (lang: string, title: string) => string,
  t: Strings,
  width: number,
): void {
  doc.fillColor(INK).fontSize(BODY_SIZE).text(t.notAssessedHeading, MARGIN, doc.y, { width });
  doc.moveDown(0.2).fillColor(MUTED).fontSize(NOTE_SIZE).text(t.notAssessedNote, MARGIN, doc.y, { width, lineGap: DENSE_LINE_GAP });
  doc.moveDown(0.5).fontSize(SMALL_SIZE).fillColor(INK);

  const labelWidth = LANGUAGE_SHARE * width;
  for (const language of languages) {
    const top = doc.y;
    const label = languageName(language.lang);
    const text = notAssessedText(language, analysis, articleName, t);
    const labelOptions = { width: labelWidth - 6 };
    const textOptions = { width: width - labelWidth, lineGap: DENSE_LINE_GAP };
    doc.text(label, MARGIN, top, labelOptions);
    doc.text(text, MARGIN + labelWidth, top, textOptions);
    doc.x = MARGIN;
    doc.y = top + Math.max(doc.heightOfString(label, labelOptions), doc.heightOfString(text, textOptions)) + 4;
  }
}

function notAssessedText(
  language: NotAssessedLanguage,
  analysis: Analysis,
  articleName: (lang: string, title: string) => string,
  t: Strings,
): string {
  switch (language.reason) {
    case "no_linked_article":
      return t.noLinkedArticle;
    case "short_history":
      return t.shortHistory(articleName(language.lang, language.title), language.max_months_available, analysis.period.months);
    case "zero_baseline":
      return t.zeroBaseline(analysis.growth_compares);
  }
}

/** What lowered trend reliability, in heuristic_v1's order: the direction reason is already in the months-up column. */
function reliabilityDowngrades(language: AssessedLanguage, t: Strings): string[] {
  // Recent spikes lower the level once however many there are, so they are named together.
  const reasons = language.reliability_reasons;
  const spikes = reasons.flatMap((reason) => recentSpikeMonth(reason) ?? []);
  return [
    ...(reasons.includes(LOW_VOLUME) ? [t.lowVolume] : []),
    ...(spikes.length > 0 ? [t.spike(spikes)] : []),
    ...(reasons.includes(HISTORY_CHECK_TRUNCATED) ? [t.historyCheckTruncated] : []),
  ];
}
