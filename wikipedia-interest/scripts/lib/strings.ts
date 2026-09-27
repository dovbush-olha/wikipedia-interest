import type { ReportLang } from "./analysis.ts";
import {
  BASELINE_INDEX,
  FLAT_GROWTH_PCT,
  HIGH_RELIABILITY_MIN_MONTHS as HIGH,
  LOW_VOLUME_MEDIAN_VIEWS,
  MODERATE_RELIABILITY_MIN_MONTHS as MODERATE,
  SPIKE_MEDIAN_MULTIPLE,
  type GrowthCompares,
  type Trend,
  type TrendReliability,
} from "./metrics.ts";
import type { MonthRange } from "./period.ts";

// Every fixed text of the report. Both dictionaries must have the same keys; `Strings` enforces it at typecheck.

const range = ({ start, end }: MonthRange) => `${start} - ${end}`;

/** The history check of one article: its historical titles among the redirect candidates checked. */
export type HistoryCheckLine = { lang: string; titles: string[]; checked: number; truncated: boolean };

const en = {
  title: (topic: string) => `Relative attention to “${topic}” in Wikipedia`,
  question: "Question",
  measuredTopic: "Measured topic",
  assumption: "Assumption",
  proxyAssumption: "the measured topic is a proxy for the topic of the question; it may be broader or narrower than that topic.",
  chartTitle: "Relative attention index",
  chartBaseline: (compares: GrowthCompares) => `${BASELINE_INDEX} = median of ${range(compares.first_12_months)}`,
  columnLanguage: "Language edition",
  columnArticle: "Article",
  columnViewsPerMillion: "Views per million",
  columnRelativeGrowth: "Relative attention growth",
  columnRawGrowth: "Raw views growth",
  columnEditionGrowth: "Edition views growth",
  columnMonthsUp: "Months up",
  columnTrend: "Trend",
  columnReliability: "Trend reliability",
  noData: "n/a",
  monthsUp: (positive: number, compared: number) => `${positive} of ${compared}`,
  trend: { up: "up", down: "down", flat: "flat" } satisfies Record<Trend, string> as Record<Trend, string>,
  reliability: { high: "high", moderate: "moderate", low: "low" } satisfies Record<TrendReliability, string> as Record<TrendReliability, string>,
  lowVolume: "low volume",
  spike: (month: string) => `spike ${month}`,
  historyCheckTruncated: "history check truncated",
  growthNote: (compares: GrowthCompares) =>
    `Growth: median of ${range(compares.last_12_months)} against the median of ${range(compares.first_12_months)}. ` +
    "Months up: how many of the last 12 months have higher relative attention than the same month a year earlier.",
  heuristicNote:
    "Trend reliability: heuristic_v1 is a simple product heuristic, not a statistical confidence or probability. " +
    `High: ${HIGH}-12 of the last 12 months move in the trend's direction, moderate: ${MODERATE}-${HIGH - 1}, low: fewer than ${MODERATE}; ` +
    `one level lower for low volume (raw views median of the last 12 months below ${LOW_VOLUME_MEDIAN_VIEWS}), ` +
    `for a spike (a month above ${SPIKE_MEDIAN_MULTIPLE}× the period's raw views median) in the last 12 months, ` +
    "and for a truncated history check. " +
    `A flat trend is a relative attention growth within ±${FLAT_GROWTH_PCT}% and has no reliability.`,
  historyNote: (lines: HistoryCheckLine[]) =>
    [
      "Article views include its historical titles confirmed by the move log; other redirects are not counted.",
      ...lines.map(({ lang, titles, checked, truncated }) => {
        const found = titles.length === 0 ? "no historical titles" : `historical titles ${titles.map((title) => `“${title}”`).join(", ")}`;
        const check = truncated
          ? `only the first ${checked} redirect candidates checked, so historical titles may be missing`
          : `${checked} ${checked === 1 ? "redirect candidate" : "redirect candidates"} checked`;
        return `${lang}: ${found}; ${check}.`;
      }),
    ].join(" "),
  viewsPerMillionNote:
    "Views per million: median monthly views of the article per million human views of its language edition over the last 12 months. " +
    "It compares relative attention inside Wikipedia, not the number of people, population or willingness to pay.",
  notAssessedHeading: "Not assessed",
  notAssessedNote:
    "Not enough Wikipedia data to assess the topic over the whole requested period. " +
    "These language editions are not ranked with the assessed ones, and this does not mean low attention.",
  noLinkedArticle:
    "No article in this language edition is linked to this Wikidata item. The topic may be covered in another article or section. " +
    "This method cannot assess relative attention to the topic in this language edition. This means neither low nor high attention.",
  shortHistory: (title: string, available: number, requested: number) =>
    available === 0
      ? `The article “${title}” has no views data in the requested period, so the topic cannot be assessed over it.`
      : `Views of the article “${title}” exist only for the last ${available} of the ${requested} requested months, ` +
        "so the topic cannot be assessed over the whole period.",
  zeroBaseline: (compares: GrowthCompares) =>
    `The median relative attention of the first 12 months (${range(compares.first_12_months)}) is zero, ` +
    "so there is nothing to compare its change against.",
  period: "Period",
  generated: "Generated",
  source: "Source: Wikimedia Pageviews API (monthly, all-access, user), Wikidata",
};

export type Strings = typeof en;

const uk: Strings = {
  title: (topic) => `Відносна увага до теми «${topic}» у Wikipedia`,
  question: "Питання",
  measuredTopic: "Виміряна тема",
  assumption: "Припущення",
  proxyAssumption: "виміряна тема - проксі теми питання, вона може бути ширшою або вужчою за тему питання.",
  chartTitle: "Індекс відносної уваги",
  chartBaseline: (compares) => `${BASELINE_INDEX} = медіана за ${range(compares.first_12_months)}`,
  columnLanguage: "Мовний розділ",
  columnArticle: "Стаття",
  columnViewsPerMillion: "Переглядів на мільйон",
  columnRelativeGrowth: "Зміна відносної уваги",
  columnRawGrowth: "Зміна сирих переглядів",
  columnEditionGrowth: "Зміна трафіку розділу",
  columnMonthsUp: "Місяців зростання",
  columnTrend: "Тренд",
  columnReliability: "Надійність тренду",
  noData: "н/д",
  monthsUp: (positive, compared) => `${positive} з ${compared}`,
  trend: { up: "зростання", down: "спад", flat: "без змін" },
  reliability: { high: "висока", moderate: "помірна", low: "низька" },
  lowVolume: "малий обсяг",
  spike: (month) => `сплеск ${month}`,
  historyCheckTruncated: "перевірку історії обрізано",
  growthNote: (compares) =>
    `Зміни: медіана за ${range(compares.last_12_months)} відносно медіани за ${range(compares.first_12_months)}. ` +
    "Місяців зростання: скільки з останніх 12 місяців мають відносну увагу вищу, ніж той самий місяць роком раніше.",
  heuristicNote:
    "Надійність тренду: heuristic_v1 - проста продуктова евристика, а не статистична довіра чи ймовірність. " +
    `Висока - ${HIGH}-12 з останніх 12 місяців рухаються в напрямку тренду, помірна - ${MODERATE}-${HIGH - 1}, низька - менше ${MODERATE}; ` +
    `на рівень нижче за малий обсяг (медіана сирих переглядів за останні 12 місяців менше ${LOW_VOLUME_MEDIAN_VIEWS}), ` +
    `за сплеск (місяць понад ${SPIKE_MEDIAN_MULTIPLE}× медіани сирих переглядів періоду) в останніх 12 місяцях ` +
    "і за обрізану перевірку історії. " +
    `Тренд «без змін» - зміна відносної уваги в межах ±${FLAT_GROWTH_PCT}%, надійності для нього немає.`,
  historyNote: (lines) =>
    [
      "Перегляди статті включають її історичні назви, підтверджені журналом перейменувань; інші редиректи не враховано.",
      ...lines.map(({ lang, titles, checked, truncated }) => {
        const found = titles.length === 0 ? "історичних назв немає" : `історичні назви ${titles.map((title) => `«${title}»`).join(", ")}`;
        const check = truncated
          ? `перевірено лише перших ${checked} кандидатів на історичну назву, тож історичні назви могли бути пропущені`
          : `перевірено кандидатів на історичну назву: ${checked}`;
        return `${lang}: ${found}; ${check}.`;
      }),
    ].join(" "),
  viewsPerMillionNote:
    "Переглядів на мільйон: медіана місячних переглядів статті на мільйон переглядів людьми її мовного розділу за останні 12 місяців. " +
    "Порівнює відносну увагу всередині Wikipedia, а не кількість людей, населення чи готовність платити.",
  notAssessedHeading: "Не оцінено",
  notAssessedNote:
    "Недостатньо Wikipedia-даних, щоб оцінити тему за весь запитаний період. " +
    "Ці мовні розділи не ранжуються разом з оціненими, і це не означає низької уваги.",
  noLinkedArticle:
    "У цьому мовному розділі немає статті, пов'язаної з цим поняттям Wikidata. Тема може бути описана в іншій статті або розділі. " +
    "За цією методикою оцінити відносну увагу до теми в цьому мовному розділі неможливо. Це не означає ні низької, ні високої уваги.",
  shortHistory: (title, available, requested) =>
    available === 0
      ? `Для статті «${title}» немає даних про перегляди в запитаному періоді, тож оцінити тему за нього неможливо.`
      : `Дані про перегляди статті «${title}» є лише за останні ${available} з ${requested} міс. запитаного періоду, ` +
        "тож оцінити тему за весь період неможливо.",
  zeroBaseline: (compares) =>
    `Медіана відносної уваги за перші 12 місяців (${range(compares.first_12_months)}) дорівнює нулю, ` +
    "тож зміну немає з чим порівняти.",
  period: "Період",
  generated: "Згенеровано",
  source: "Джерело: Wikimedia Pageviews API (помісячно, all-access, user), Wikidata",
};

export const STRINGS: Record<ReportLang, Strings> = { uk, en };
