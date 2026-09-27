---
name: wikipedia-interest
description: Measures relative attention to one topic across Wikipedia language editions (share of pageviews, its trend and how reliable the trend is) and renders a one-page PDF report with a next-research recommendation per language. Use when someone asks whether interest in a topic is growing in Wikipedia, compares interest in a topic between Wikipedia languages, or asks which language audiences or topics to research next for a product, course or localization, in any language, e.g. "Is interest in astronomy growing in Ukrainian Wikipedia?" or «Порівняй інтерес до інтервального голодування в польській і чеській Wikipedia».
compatibility: Needs Node.js 24.12 or later and network access to wikipedia.org, wikidata.org and wikimedia.org.
allowed-tools:
  - Bash(node "${CLAUDE_SKILL_DIR}/scripts/analyze.ts" *)
  - Bash(node "${CLAUDE_SKILL_DIR}/scripts/report.ts" *)
  - Bash(npm ci --prefix "${CLAUDE_SKILL_DIR}")
---

# Wikipedia relative attention

Two scripts do all the work with data: `analyze.ts` finds the topic, downloads pageviews and computes every metric; `report.ts` renders the PDF.
Your part: turn the question into arguments, choose the measured topic, word the result with the fixed wordings below, and write a short conclusion without digits.
Never compute numbers yourself.

## Words to use

- Say **relative attention** («відносна увага»), not "interest", «інтерес», popularity or demand, for what was measured.
  Relative attention is the topic's share of all human views of the language edition: attention inside Wikipedia, not the number of interested people, market demand or willingness to pay.
- `views_per_million`: monthly views of the article per million views of its language edition (median of the last 12 months).
  It compares the level of relative attention between the language editions of one analysis; it is never a number of people, readers or users.
- Growth is "the change of relative attention: median of `growth_compares.last_12_months` against the median of `growth_compares.first_12_months`", with those months written out.
  Never "growth over N years" and never "per year".
- `trend_reliability` is a simple product heuristic (`heuristic_v1`), not a statistical confidence or probability.
  Take it and its reasons from the result and word them with the tables below; never judge reliability yourself.

Never say, in the chat or in `conclusion.json`:

- "interest" or «інтерес» for the result, even when the user's question does; say relative attention.
- that `views_per_million` is an audience, a user base, readers or a market size.
- why attention changed (news, saturation, competitors, seasons, niche groups): the data do not show causes.
- anything about the data beyond the result and the wordings below.
- whether to launch, build, localize or fund something: the skill only recommends what to research next.

## Workflow

Run every command from the user's current working directory, never `cd` into the skill folder.

1. Build the `analyze.ts` arguments (next section) and run it.
2. Handle its `status`: `needs_choice`, `not_found` or `ok`.
3. On `ok`, write `conclusion.json` into the `--out-dir`.
4. Run `report.ts` and fix `conclusion.json` until it succeeds.
5. Answer the user once, in your last message, with the template of section 6: the result, the recommendation and the PDF path.
   Say nothing about the result before it.

If a command fails with `Cannot find package`, run `npm ci --prefix "${CLAUDE_SKILL_DIR}"` once and rerun the command.
If `npm ci` fails with `EBADENGINE`, tell the user the skill needs Node.js 24.12 or later.

## 1. Run analyze

```
node "${CLAUDE_SKILL_DIR}/scripts/analyze.ts" --topic "Intermittent fasting" --topic-lang en --langs pl,cs --months 24 --report-lang uk --user-question "<the user's question>" --out-dir wikipedia-interest-runs/fasting-pl-cs
```

- `--user-question`: the user's message word for word, copied from the user's message, not from your own words or the skill arguments.
  Never shorten, translate or rephrase it: "вивчення англійської" must not become "англійська мова".
  For a follow-up, the original question plus the change in a few words.
- `--report-lang`: `uk` when the user writes in Ukrainian, otherwise `en`.
  It is the language of the PDF, of `conclusion.json` and of your answer in the chat.
- `--langs`: comma-separated Wikipedia codes of the editions the user named: `uk` Ukrainian, `pl` Polish, `cs` Czech, `sk` Slovak, `de` German, `en` English, `es` Spanish, `fr` French.
  At most 3 language editions per analysis (the report is one page), editions without data included.
  If the user named more, ask them to shortlist; never drop a language yourself.
  If the user named none (e.g. "our selected editions"), ask which ones instead of guessing.
- Topic, one per analysis:
  - `--topic "<text>" --topic-lang <code>`: best the likely English Wikipedia article title with `--topic-lang en`, e.g. `--topic "Astronomy"`; or the user's words with the code of the language they are written in, e.g. `--topic "астрономія" --topic-lang uk`.
  - `--qid Q...` instead of `--topic` and `--topic-lang`, once you know the Wikidata item: from a `needs_choice` candidate or from `measured_topic.qid` of an earlier analysis.
  - `--proxy-reason "<how it differs>"` when the measured topic is broader or narrower than the topic of the question.
    One short sentence in the report language, starting with a capital letter; the PDF shows it after its own sentence about the proxy.
- Direct or proxy: decide from the user's own words before the first run.
  Questions about an activity around a subject ("learning English", «вивчення англійської», "astronomy courses", "fasting apps") rarely have their own article.
  Measure the subject itself as a proxy, always with `--proxy-reason`, e.g. `--topic "English language" --proxy-reason "Увага до англійської мови загалом, а не лише до її вивчення."`.
- Period: the default is the last 24 completed months.
  "Last two years" is `--months 24`, "last N years" is `--months` 12×N, "since March 2022" is `--start 2022-03`, and `--end YYYY-MM` fixes the last month.
  A period has at least 24 months and starts not before 2015-07; `--start` and `--months` cannot be combined.
- `--out-dir`: a new folder per analysis inside the current working directory, e.g. `wikipedia-interest-runs/<topic>-<langs>`, never inside the skill folder.
  A follow-up gets a new folder, so earlier reports stay.

## 2. Handle the status

### `needs_choice`: choose the measured topic

The topic text matched no single article: `reason` is `disambiguation_page` (the title is a disambiguation page), `redirect_to_section` (it points into a section of a larger article, which comes first) or `no_exact_match` (no article has that title; the candidates come from search).
Choose from `candidates`, in this order:

1. **Meaning first.** Direct: the candidate is about exactly the topic of the question.
   Proxy: it is close but broader or narrower; add `--proxy-reason`.
   A candidate only loosely related (a person, band, album, company, radio programme, Wikipedia edition, variety of a language) never fits, even with full `coverage`.
2. **Coverage second.** `coverage` is "<editions with an article>/<requested editions>"; `missing_langs` will be "Not assessed".
   A comparison needs an article in at least two requested editions; a question about one edition needs an article in that edition.
3. Rerun the same command with `--qid <qid>` in place of `--topic` and `--topic-lang`.
4. If no candidate is close in meaning, rerun once with a broader or narrower topic as `--topic` and `--proxy-reason`, as in "Direct or proxy" above.
5. If no topic is both close in meaning and covered in enough editions, do not measure another topic: tell the user that no comparable topic was found in Wikipedia and suggest rephrasing the topic or choosing other languages.

If two candidates fit equally well and the question does not decide between them, ask the user.

### `not_found`

Rephrase once, shorter or as the likely English article title with `--topic-lang en`, and rerun.
If it is still not found, tell the user.

### `ok`

Check that `measured_topic.label` and `description` are the topic of the user's own words.
If `relation_to_question` is `direct` but the question is about an activity around the measured topic (learning English, not the English language), rerun with `--qid <measured_topic.qid>` and `--proxy-reason`.
If `topic_match.redirected_from` is not null, the topic text was a redirect to a larger article; if that article is broader than the question, rerun with `--qid <measured_topic.qid>` and `--proxy-reason`.
If the question compares languages but fewer than two are assessed, the answer has the "No comparison" line of section 6.
If no language is assessed, tell the user with the "Not assessed" wordings, do not run `report.ts`, and suggest another topic, other languages or a shorter period.

## 3. Word the result

Every entry of `languages` has `data_status`.

### Assessed languages: `data_status` is `ok`

Fields: `views_per_million`; `relative_attention_growth_pct`, the main trend metric; `raw_growth_pct` and `edition_growth_pct`, context only; `recent_trend_consistency` (`positive_months` of `months_compared`, the last 12 months only, not the whole period); `trend`; `trend_reliability`; `reliability_reasons`; `flags`.

| Trend | English | Українською |
| --- | --- | --- |
| `up` | relative attention grew | відносна увага зросла |
| `down` | relative attention fell | відносна увага знизилась |
| `flat` | relative attention stayed about the same (change within ±10%) | відносна увага майже не змінилась (зміна в межах ±10%) |

| Trend reliability | English | Українською |
| --- | --- | --- |
| `high` | high trend reliability by a simple heuristic | висока надійність тренду за простою евристикою |
| `moderate` | moderate trend reliability by a simple heuristic | помірна надійність тренду за простою евристикою |
| `low` | low trend reliability by a simple heuristic | низька надійність тренду за простою евристикою |
| `null` | no reliability: a flat trend has no direction to check | надійність не визначається: тренд без змін не має напрямку |

Give every reason of `reliability_reasons` after the level, with `<N>`, `<M>` and `YYYY-MM` taken from the code:

| Reliability reason | English | Українською |
| --- | --- | --- |
| `direction_matches_in_<N>_of_<M>_recent_months` | in <N> of the last <M> months relative attention moved in the trend's direction compared with the same month a year earlier | у <N> з останніх <M> місяців відносна увага рухалась у напрямку тренду порівняно з тим самим місяцем роком раніше |
| `low_volume` | lowered one level: few raw views (median of the last 12 months below 100), so percentages are unstable | знижено на рівень: мало сирих переглядів (медіана за останні 12 місяців менше 100), тож відсотки нестабільні |
| `recent_spike:YYYY-MM` | lowered one level: a spike in YYYY-MM may be a one-off event rather than lasting attention | знижено на рівень: сплеск у YYYY-MM може бути разовою подією, а не стійкою увагою |
| `history_check_truncated` | lowered one level: not every redirect was checked for former titles of the article, so some of its views may be missing | знижено на рівень: не всі редиректи перевірено на колишні назви статті, тож частина переглядів могла не врахуватись |

Mention every flag of `flags` that is not already a reason of `reliability_reasons`, once:

| Flag | English | Українською |
| --- | --- | --- |
| `spike:YYYY-MM` | a spike in YYYY-MM (raw views above 3× the period's median) may reflect a one-off event | сплеск у YYYY-MM (сирих переглядів понад 3× медіани періоду) може відображати разову подію |
| `low_volume` | few raw views, so percentages are unstable | мало сирих переглядів, тож відсотки нестабільні |
| `raw_relative_diverge` when `raw_growth_pct` is below zero | fewer raw views, but the topic takes a larger share of attention inside Wikipedia; this does not mean that more people read about it | сирих переглядів стало менше, але тема займає більшу частку уваги всередині Wikipedia; це не означає, що про тему читає більше людей |
| `raw_relative_diverge` when `raw_growth_pct` is above zero | more raw views, but the language edition as a whole grew faster, so the topic's share of attention fell | сирих переглядів більше, але мовний розділ загалом зростав швидше, тож частка уваги до теми зменшилась |
| `history_check_truncated` | historical titles of the article may be missing | історичні назви статті могли бути пропущені |

With `raw_relative_diverge`, never say that interest or the audience grew or fell: use the wording.

### Not assessed: `data_status` is `insufficient_data`

Not-assessed languages always form a separate "Not assessed" («Не оцінено») group: never rank them with the assessed ones, never call them last, and never read them as low attention.
Word each one by its `reason`:

| Reason | English | Українською |
| --- | --- | --- |
| `no_linked_article` | No article in this language edition is linked to this Wikidata item. The topic may be covered in another article or section. This method cannot assess relative attention to the topic in this language edition. This means neither low nor high attention. | У цьому мовному розділі немає статті, пов'язаної з цим поняттям Wikidata. Тема може бути описана в іншій статті або розділі. За цією методикою оцінити відносну увагу до теми в цьому мовному розділі неможливо. Це не означає ні низької, ні високої уваги. |
| `short_history` with `max_months_available` 0 | The article has no views data in the requested period, so the topic cannot be assessed over it. | Для статті немає даних про перегляди в запитаному періоді, тож оцінити тему за нього неможливо. |
| `short_history` | Views of the article exist only for the last <max_months_available> of the <period.months> requested months, so the topic cannot be assessed over the whole period. | Дані про перегляди статті є лише за останні <max_months_available> з <period.months> місяців запитаного періоду, тож оцінити тему за весь період неможливо. |
| `zero_baseline` | The median relative attention of the first 12 months is zero, so there is nothing to compare its change against. | Медіана відносної уваги за перші 12 місяців дорівнює нулю, тож зміну немає з чим порівняти. |

`no_linked_article` is never low demand, high demand, an unoccupied niche, an opportunity, or a reason to enter or avoid that market.
The only thing to add: this audience needs other data sources.
A not-assessed language may also have the flag `history_check_truncated`: add its flag wording.
For `short_history` you may offer a separate analysis over a shorter period; every language of it then uses that shorter period.

## 4. Write conclusion.json

Write `<out-dir>/conclusion.json`, the interpretation for the PDF:

```json
{
  "summary": "Відносна увага до теми зросла в українському розділі і майже не змінилась у чеському.",
  "languages": [
    { "lang": "uk", "action": "investigate_next", "rationale": "Стабільне зростання відносної уваги з високою надійністю." },
    { "lang": "cs", "action": "consider", "rationale": "Відносна увага без змін, її рівень вищий, ніж в українському розділі." }
  ]
}
```

- `summary`: at most 200 characters, the answer to the question about the assessed languages only.
  Never mention a not-assessed language, not even that it has no article or was not assessed: the PDF shows those itself.
- `languages`: exactly one entry per assessed language, and none for a not-assessed one.
- `action`: one of `investigate_next`, `consider`, `lower_priority`.
- `rationale`: at most 120 characters, why that action, from the trend and its reliability only.
- In the report language, in Latin or Cyrillic letters, with **no numbers at all**, neither in digits nor in words: no percentages, counts, months, years or durations ("in most recent months", not "in eleven of twelve months"; "last year", not "two years").
  The PDF renders every number from the analysis itself.

Unless the user gave their own criteria, choose the action from the trend and its reliability:

| Action | When | English | Українською |
| --- | --- | --- | --- |
| `investigate_next` | `up` with `high` or `moderate` reliability | investigate next | досліджувати наступною |
| `consider` | `up` with `low` reliability, `flat`, or `down` with `low` reliability | consider | розглянути |
| `lower_priority` | `down` with `high` or `moderate` reliability | lower priority | нижчий пріоритет |

Between languages with the same action, a higher `views_per_million` may be the reason to name one first.

## 5. Run report

```
node "${CLAUDE_SKILL_DIR}/scripts/report.ts" --run-dir wikipedia-interest-runs/fasting-pl-cs
```

On success it prints `files.report`, the PDF path for the last line of your answer.
On an error, change `conclusion.json` exactly as the message says, fixing every problem it lists, and rerun `report.ts`.
Never edit `analysis.json`; if the message says to rerun `analyze.ts`, do that.

## 6. Answer in the chat

Once `report.ts` has succeeded, answer in the report language with this template, filled from the result and the wording tables, and nothing else.
This is your only message about the result, and the template is all of it: no headings or bold, no second conclusion, no advice and no other topics or languages to research.
The "PDF:" line is the last line; write nothing after it.
Copy numbers and months exactly as `analyze.ts` printed them, months as `YYYY-MM`; never compute new ones (no differences, ratios, averages or rounding).
Leave out a line whose part of the result is empty: "Proxy" for a direct topic, "Not assessed" when every language is assessed.
Write the "No comparison" line only when the question compares language editions and fewer than two are assessed.
Start each language line with its code, e.g. `pl:`, as in the template.

```
Measured topic: <measured_topic.label> (<measured_topic.qid>).
Proxy: <measured_topic.proxy_reason>
No comparison: only <lang> is assessed, so this topic allows no comparison between the requested language editions.
Changes compare the median of <last_12_months.start> - <last_12_months.end> with the median of <first_12_months.start> - <first_12_months.end>.

<lang>: <trend wording>, relative attention change <relative_attention_growth_pct>%, <views_per_million> views per million views of the edition. <reliability wording>: <every reason wording>. <every flag wording>.

Not assessed:
<lang>: <reason wording>

Next-research recommendation based on the Wikipedia signal (not a product launch decision):
<lang>: <action wording> - <rationale>

PDF: <files.report>
```

```
Виміряна тема: <measured_topic.label> (<measured_topic.qid>).
Проксі: <measured_topic.proxy_reason>
Порівняння неможливе: оцінено лише <lang>, тож за цією темою запитані мовні розділи порівняти неможливо.
Зміни порівнюють медіану за <last_12_months.start> - <last_12_months.end> з медіаною за <first_12_months.start> - <first_12_months.end>.

<lang>: <формулювання тренду>, зміна відносної уваги <relative_attention_growth_pct>%, <views_per_million> переглядів на мільйон переглядів розділу. <формулювання надійності>: <формулювання кожної причини>. <формулювання кожного прапорця>.

Не оцінено:
<lang>: <формулювання причини>

Рекомендація щодо наступного дослідження на основі Wikipedia-сигналу (не рішення про запуск продукту):
<lang>: <формулювання дії> - <rationale>

PDF: <files.report>
```

The recommendation lines are the `action` and `rationale` of `conclusion.json` (section 4), one per assessed language, with the action worded by the table of section 4.

## Errors

Every `Error:` of a script says what to change: change only that and rerun the same command.
`Error: unexpected failure, this is a bug in the skill` cannot be fixed by new arguments: tell the user and stop.

## Follow-ups and several topics

- A change of languages or period ("add Slovak", "from March 2022"): rerun `analyze.ts` with `--qid <measured_topic.qid>`, the same `--report-lang`, the changed `--langs` or period, and a new `--out-dir`, then write `conclusion.json` and run `report.ts` again.
  Answer from the new result only.
- Several topics ("compare fasting and yoga"): one analysis measures one topic.
  Explain it and offer a separate analysis per topic.
  Between topics you may restate each one's trend and trend reliability, but never compare their `views_per_million`: the level depends on how broad each article is.
