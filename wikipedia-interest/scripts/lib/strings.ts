import type { ReportLang } from "./analysis.ts";
import type { Action } from "./conclusion.ts";
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

/**
 * The history check of one article: the historical titles shown and how many `more` are not, `undrawable` when some of those
 * are not shown because the PDF font cannot draw them, among the redirect candidates checked.
 */
export type HistoryCheckLine = { lang: string; titles: string[]; more: number; undrawable: boolean; checked: number; truncated: boolean };

/** The words of the history check in one report language. */
type HistoryWords = {
  intro: string;
  noneFound: string;
  found: (entries: string) => string;
  quote: (title: string) => string;
  andMore: (count: number) => string;
  /** No title shown: all of them are ones the font cannot draw. */
  notShown: (count: number) => string;
  checked: (entries: string) => string;
  truncated: (langs: string, checked: number) => string;
};

/** The history check of every article, grouped by outcome; `*` marks titles not shown because of the font. */
const historyNote = (words: HistoryWords) => (lines: HistoryCheckLine[]) => {
  const found = lines
    .filter(({ titles, more }) => titles.length + more > 0)
    .map(({ lang, titles, more, undrawable }) => {
      const shown = titles.length === 0 ? words.notShown(more) : titles.map(words.quote).join(", ") + (more > 0 ? ` ${words.andMore(more)}` : "");
      return `${lang} ${shown}${undrawable ? "*" : ""}`;
    });
  // A truncated check stops at the candidate limit: grouped by how many were checked, so no group borrows another's count.
  const truncated = Map.groupBy(
    lines.filter((line) => line.truncated),
    (line) => line.checked,
  );
  return [
    words.intro,
    found.length === 0 ? words.noneFound : words.found(found.join("; ")),
    words.checked(lines.map(({ lang, checked }) => `${lang} ${checked}`).join(", ")),
    ...[...truncated].map(([checked, group]) => words.truncated(group.map(({ lang }) => lang).join(", "), checked)),
  ].join(" ");
};

/** Spike months of one language edition: the month, or how many and between which months. */
const spikeSpan = (months: string[], many: (count: number, span: string) => string) =>
  months.length === 1 ? months[0] : many(months.length, `${months[0]} - ${months[months.length - 1]}`);

const en = {
  title: (topic: string) => `Relative attention to “${topic}” in Wikipedia`,
  question: "Question",
  measuredTopic: "Measured topic",
  assumption: "Assumption",
  proxyAssumption: "the measured topic is a proxy for the topic of the question; it may be broader or narrower than that topic.",
  recommendationHeading:
    "Next-research recommendation based on the Wikipedia signal (interpretation, not a product launch decision)",
  action: {
    investigate_next: "investigate next",
    consider: "consider",
    lower_priority: "lower priority",
  } satisfies Record<Action, string> as Record<Action, string>,
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
  spike: (months: string[]) => `${months.length === 1 ? "spike" : "spikes"} ${spikeSpan(months, (count, span) => `${span} (${count})`)}`,
  historyCheckTruncated: "history check truncated",
  reliabilityLowered: "Reliability lowered by",
  growthNote: (compares: GrowthCompares) =>
    `Growth: median of ${range(compares.last_12_months)} against the median of ${range(compares.first_12_months)}. ` +
    "Months up: how many of the last 12 months have higher relative attention than the same month a year earlier.",
  heuristicNote:
    "Trend reliability: heuristic_v1 is a simple product heuristic, not a statistical confidence or probability. " +
    `High: ${HIGH}-12 of the last 12 months move in the trend's direction, moderate: ${MODERATE}-${HIGH - 1}, low: fewer; ` +
    `one level lower for low volume (raw views median of the last 12 months below ${LOW_VOLUME_MEDIAN_VIEWS}), ` +
    "for spikes in the last 12 months and for a truncated history check. " +
    `A flat trend (within ±${FLAT_GROWTH_PCT}%) has no reliability.`,
  historyNote: historyNote({
    intro: "Article views include its historical titles confirmed by the move log; other redirects are not counted.",
    noneFound: "No historical titles found.",
    found: (entries) => `Historical titles: ${entries}.`,
    quote: (title) => `“${title}”`,
    andMore: (count) => `and ${count} more`,
    notShown: (count) => `${count} not shown`,
    checked: (entries) => `Redirect candidates checked: ${entries}.`,
    truncated: (langs, checked) => `${langs}: only the first ${checked} redirect candidates checked, so historical titles may be missing.`,
  }),
  viewsPerMillionNote:
    "Views per million: median monthly views of the article per million human views of its language edition over the last 12 months.",
  notAssessedHeading: "Not assessed",
  notAssessedNote:
    "Not enough Wikipedia data to assess the topic over the whole requested period; " +
    "not ranked with the assessed language editions, and not a sign of low attention.",
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
  limitationsHeading: "Assumptions and limitations",
  limitations: [
    "Relative attention is the topic's share of attention inside Wikipedia, not the number of interested people, market demand or willingness to pay. " +
      "Views per million compare that share between language editions, not their population or number of readers.",
    "A fall in the total views of a language edition may affect topics unevenly. " +
      "One article per topic and human views only (agent=user); renames without a redirect and complex title swaps may be missed.",
  ],
  proxyLimitation: (label: string) =>
    `The measured topic is a proxy: the report measures attention to “${label}”, which may be broader or narrower than the topic of the question.`,
  fewerRawViews: (langs: string[]) =>
    `${langs.join(", ")}: fewer raw views, but the topic takes a larger share of attention inside Wikipedia; this does not mean that more people read about it.`,
  moreRawViews: (langs: string[]) =>
    `${langs.join(", ")}: more raw views, but the language edition as a whole grew faster, so the topic's share of attention fell.`,
  spikesIntro: `Spikes, months with raw views above ${SPIKE_MEDIAN_MULTIPLE}× the period's median, may reflect one-off events rather than lasting attention:`,
  spikeMonths: (lang: string, months: string[]) => `${lang} ${spikeSpan(months, (count, span) => `${count} months in ${span}`)}`,
  titleNotShown: (label: string, qid: string, lang: string) => `${label} (${qid}, ${lang})*`,
  titleNotShownNote: "*: the local article title is not shown because of a PDF font limitation.",
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
  recommendationHeading:
    "Рекомендація щодо наступного дослідження на основі Wikipedia-сигналу (інтерпретація, не рішення про запуск продукту)",
  action: { investigate_next: "досліджувати наступною", consider: "розглянути", lower_priority: "нижчий пріоритет" },
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
  spike: (months) => `${months.length === 1 ? "сплеск" : "сплески"} ${spikeSpan(months, (count, span) => `${span} (${count})`)}`,
  historyCheckTruncated: "перевірку історії обрізано",
  reliabilityLowered: "Надійність знижено",
  growthNote: (compares) =>
    `Зміни: медіана за ${range(compares.last_12_months)} відносно медіани за ${range(compares.first_12_months)}. ` +
    "Місяців зростання: скільки з останніх 12 місяців мають відносну увагу вищу, ніж той самий місяць роком раніше.",
  heuristicNote:
    "Надійність тренду: heuristic_v1 - проста продуктова евристика, а не статистична довіра чи ймовірність. " +
    `Висока - ${HIGH}-12 з останніх 12 місяців рухаються в напрямку тренду, помірна - ${MODERATE}-${HIGH - 1}, низька - менше; ` +
    `на рівень нижче за малий обсяг (медіана сирих переглядів за останні 12 місяців менше ${LOW_VOLUME_MEDIAN_VIEWS}), ` +
    "за сплески в останніх 12 місяцях і за обрізану перевірку історії. " +
    `Для тренду «без змін» (у межах ±${FLAT_GROWTH_PCT}%) надійності немає.`,
  historyNote: historyNote({
    intro: "Перегляди статті включають її історичні назви, підтверджені журналом перейменувань; інші редиректи не враховано.",
    noneFound: "Історичних назв не знайдено.",
    found: (entries) => `Історичні назви: ${entries}.`,
    quote: (title) => `«${title}»`,
    andMore: (count) => `та ще ${count}`,
    notShown: (count) => `${count} не показано`,
    checked: (entries) => `Перевірено кандидатів на історичну назву: ${entries}.`,
    truncated: (langs, checked) =>
      `${langs}: перевірено лише перших ${checked} кандидатів на історичну назву, тож історичні назви могли бути пропущені.`,
  }),
  viewsPerMillionNote:
    "Переглядів на мільйон: медіана місячних переглядів статті на мільйон переглядів людьми її мовного розділу за останні 12 місяців.",
  notAssessedHeading: "Не оцінено",
  notAssessedNote:
    "Недостатньо Wikipedia-даних, щоб оцінити тему за весь запитаний період; " +
    "ці розділи не ранжуються з оціненими, і це не означає низької уваги.",
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
  limitationsHeading: "Припущення та обмеження",
  limitations: [
    "Відносна увага - частка уваги до теми всередині Wikipedia, а не кількість зацікавлених людей, ринковий попит чи готовність платити. " +
      "Переглядів на мільйон порівнюють цю частку між мовними розділами, а не їхнє населення чи кількість читачів.",
    "Спад загального трафіку мовного розділу може зачіпати теми нерівномірно. " +
      "Лише одна стаття на тему і лише перегляди людьми (agent=user); перейменування без редиректу і складні обміни назвами можуть бути пропущені.",
  ],
  proxyLimitation: (label) =>
    `Виміряна тема - проксі: звіт вимірює увагу до теми «${label}», яка може бути ширшою або вужчою за тему питання.`,
  fewerRawViews: (langs) =>
    `${langs.join(", ")}: сирих переглядів стало менше, але тема займає більшу частку уваги всередині Wikipedia; це не означає, що про тему читає більше людей.`,
  moreRawViews: (langs) =>
    `${langs.join(", ")}: сирих переглядів більше, але мовний розділ загалом зростав швидше, тож частка уваги до теми зменшилась.`,
  spikesIntro: `Сплески - місяці, у яких сирих переглядів понад ${SPIKE_MEDIAN_MULTIPLE}× медіани періоду, - можуть бути разовими подіями, а не стійкою увагою:`,
  spikeMonths: (lang, months) => `${lang} ${spikeSpan(months, (count, span) => `${count} міс. у ${span}`)}`,
  titleNotShown: (label, qid, lang) => `${label} (${qid}, ${lang})*`,
  titleNotShownNote: "*: локальну назву статті не показано через обмеження PDF-шрифту.",
  period: "Період",
  generated: "Згенеровано",
  source: "Джерело: Wikimedia Pageviews API (помісячно, all-access, user), Wikidata",
};

export const STRINGS: Record<ReportLang, Strings> = { uk, en };
