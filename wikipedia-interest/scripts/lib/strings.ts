import type { ReportLang } from "./analysis.ts";

// Every fixed text of the report. Both dictionaries must have the same keys; `Strings` enforces it at typecheck.

const en = {
  title: (topic: string) => `Relative attention to “${topic}” in Wikipedia`,
  question: "Question",
  measuredTopic: "Measured topic",
  columnLanguage: "Language edition",
  columnArticle: "Article",
  columnViewsPerMillion: "Views per million",
  noData: "n/a",
  viewsPerMillionNote:
    "Views per million: median monthly views of the article per million human views of its language edition over the last 12 months. " +
    "It compares relative attention inside Wikipedia, not the number of people, population or willingness to pay.",
  period: "Period",
  generated: "Generated",
  source: "Source: Wikimedia Pageviews API (monthly, all-access, user), Wikidata",
};

export type Strings = typeof en;

const uk: Strings = {
  title: (topic) => `Відносна увага до теми «${topic}» у Wikipedia`,
  question: "Питання",
  measuredTopic: "Виміряна тема",
  columnLanguage: "Мовний розділ",
  columnArticle: "Стаття",
  columnViewsPerMillion: "Переглядів на мільйон",
  noData: "н/д",
  viewsPerMillionNote:
    "Переглядів на мільйон: медіана місячних переглядів статті на мільйон переглядів людьми її мовного розділу за останні 12 місяців. " +
    "Порівнює відносну увагу всередині Wikipedia, а не кількість людей, населення чи готовність платити.",
  period: "Період",
  generated: "Згенеровано",
  source: "Джерело: Wikimedia Pageviews API (помісячно, all-access, user), Wikidata",
};

export const STRINGS: Record<ReportLang, Strings> = { uk, en };
