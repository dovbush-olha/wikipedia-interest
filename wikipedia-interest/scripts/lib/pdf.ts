import { join } from "node:path";
import PDFDocument from "pdfkit";
import type { Analysis } from "./analysis.ts";
import { UserError } from "./cli.ts";
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
  doc.moveDown(0.8).fillColor(MUTED).fontSize(8).text(t.viewsPerMillionNote, MARGIN, doc.y, { width });

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
  const number = new Intl.NumberFormat(analysis.report_lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const columns = [
    { width: width * 0.3, align: "left" as const },
    { width: width * 0.45, align: "left" as const },
    { width: width * 0.25, align: "right" as const },
  ];
  const padding = 4;

  const row = (cells: string[], color: string) => {
    const top = doc.y;
    let x = MARGIN;
    let height = 0;
    cells.forEach((cell, i) => {
      const options = { width: columns[i].width - padding, align: columns[i].align };
      doc.fillColor(color).text(cell, x, top, options);
      height = Math.max(height, doc.heightOfString(cell, options));
      x += columns[i].width;
    });
    doc.x = MARGIN;
    doc.y = top + height + padding;
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + width, doc.y).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.y += padding;
  };

  doc.fontSize(9);
  row([t.columnLanguage, t.columnArticle, t.columnViewsPerMillion], MUTED);
  doc.fontSize(10);
  for (const language of analysis.languages) {
    const name = languageNames.of(language.lang) ?? language.lang;
    const views = language.views_per_million === null ? t.noData : number.format(language.views_per_million);
    row([`${language.lang} - ${name}`, language.title, views], INK);
  }
}
