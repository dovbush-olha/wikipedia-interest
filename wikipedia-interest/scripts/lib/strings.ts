import type { ReportLang } from "./analysis.ts";
import {
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

const en = {
  title: (topic: string) => `Relative attention to “${topic}” in Wikipedia`,
  question: "Question",
  measuredTopic: "Measured topic",
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
  growthNote: (compares: GrowthCompares) =>
    `Growth: median of ${range(compares.last_12_months)} against the median of ${range(compares.first_12_months)}. ` +
    "Months up: how many of the last 12 months have higher relative attention than the same month a year earlier.",
  heuristicNote:
    "Trend reliability: heuristic_v1 is a simple product heuristic, not a statistical confidence or probability. " +
    `High: ${HIGH}-12 of the last 12 months move in the trend's direction, moderate: ${MODERATE}-${HIGH - 1}, low: fewer than ${MODERATE}; ` +
    `one level lower for low volume (raw views median of the last 12 months below ${LOW_VOLUME_MEDIAN_VIEWS}) ` +
    `and for a spike (a month above ${SPIKE_MEDIAN_MULTIPLE}× the period's raw views median) in the last 12 months. ` +
    `A flat trend is a relative attention growth within ±${FLAT_GROWTH_PCT}% and has no reliability.`,
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
  growthNote: (compares) =>
    `Зміни: медіана за ${range(compares.last_12_months)} відносно медіани за ${range(compares.first_12_months)}. ` +
    "Місяців зростання: скільки з останніх 12 місяців мають відносну увагу вищу, ніж той самий місяць роком раніше.",
  heuristicNote:
    "Надійність тренду: heuristic_v1 - проста продуктова евристика, а не статистична довіра чи ймовірність. " +
    `Висока - ${HIGH}-12 з останніх 12 місяців рухаються в напрямку тренду, помірна - ${MODERATE}-${HIGH - 1}, низька - менше ${MODERATE}; ` +
    `на рівень нижче за малий обсяг (медіана сирих переглядів за останні 12 місяців менше ${LOW_VOLUME_MEDIAN_VIEWS}) ` +
    `і за сплеск (місяць понад ${SPIKE_MEDIAN_MULTIPLE}× медіани сирих переглядів періоду) в останніх 12 місяцях. ` +
    `Тренд «без змін» - зміна відносної уваги в межах ±${FLAT_GROWTH_PCT}%, надійності для нього немає.`,
  viewsPerMillionNote:
    "Переглядів на мільйон: медіана місячних переглядів статті на мільйон переглядів людьми її мовного розділу за останні 12 місяців. " +
    "Порівнює відносну увагу всередині Wikipedia, а не кількість людей, населення чи готовність платити.",
  period: "Період",
  generated: "Згенеровано",
  source: "Джерело: Wikimedia Pageviews API (помісячно, all-access, user), Wikidata",
};

export const STRINGS: Record<ReportLang, Strings> = { uk, en };
