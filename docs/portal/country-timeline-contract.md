# «Путь поступления» на «Главной»: контракт для веба и iPhone

Дата: 16.10.2026. План: `docs/EVO_STUDENT_APP_V2_PLAN_2026-10-16.md` §8 (S4), решения владельца §2 (Р5), общие правила §4, проверки §12. Запись `docs/PLAN_CHANGES.md` «Путь поступления на «Главной» (284)». Миграция `supabase/migrations/284_platform_student_country_choice.sql`.

Этот документ для агентов веба (`/portal`) и iPhone (`ios/`). Ядро готово: контент, строгий парсер, выбор того, что видит студент, и RPC выбора страны. Интерфейс (блок на «Главной», лист шага на iPhone, выбор страны) строят следующие PR по §8.4 плана и скилу impeccable. Веб и iPhone показывают одно и то же: один набор файлов и одни правила ниже.

## 1. Файлы

| Файл | Что | Статус 16.10 |
| --- | --- | --- |
| `src/content/timelines/cn.json` | Китай, 8 шагов, набор сентябрь 2027 | `approved` |
| `src/content/timelines/my.json` | Малайзия, 7 шагов, от интейка вуза | `approved` |
| `src/content/timelines/ae.json` | ОАЭ, 6 шагов | `owner_review` |
| `src/content/timelines/tr.json` | Турция, 6 шагов | `owner_review` |
| `src/content/timelines/it.json` | Италия, 8 шагов | `owner_review` |
| `src/content/timelines/cz.json` | Чехия, 6 шагов | `owner_review` |
| `src/content/timelines/undecided.json` | общий маршрут: 7 рабочих этапов продукта, без дат | `approved` |
| `src/content/timelines/SCHEMA.md` | схема полей и правила текста | |

- Веб: `src/lib/portal/country-timeline.ts` импортирует все семь файлов и разбирает их при импорте. Импортируйте модуль в серверном компоненте и отдавайте клиенту только результат `selectCountryTimeline` (от 10 до 24 КБ JSON на один путь вместо 260 КБ всех файлов, замер 16.10).
- iPhone: те же файлы ресурсами bundle обеих целей (`ios/project.yml`, приложение и `EVOAdmissionsTests`), плоско в корне bundle: `Bundle(for: …).url(forResource: "cn", withExtension: "json")`. Копий в Swift нет. Тест `tests/portal-country-timeline.test.mjs` проверяет, что `project.yml` и `project.pbxproj` указывают ровно на эти семь файлов; сборка `EVOAdmissionsTests` 16.10 положила в bundle файлы, байт в байт равные репозиторию.
- Правка текста: меняется JSON, растёт `contentVersion`, тест контента должен пройти. Статус страны меняется на `approved` только после подтверждения владельца (план §8.2, §8.5 п. 3).

## 2. Строгий парсер

`parseCountryTimelineFile(value, key)` в `src/lib/portal/country-timeline.ts`. Любое отклонение бросает ошибку с путём поля. Правила полей в `SCHEMA.md`; главное:

- закрытый набор ключей на каждом уровне; RU и KY во всех текстах; `name` равен названию из `src/lib/study-countries.json`;
- три оговорки (`disclaimers.timing`, `documents`, `decisions`) с обязательными началами и концами фраз;
- от 5 до 8 шагов, `order` без пропусков, ID вида `cn-2-exams` и `cn-2-03`, этапы из словаря CRM;
- в каждом шаге есть пункт `confirmed`, который остаётся и после `validUntil`;
- текст с годом обязан иметь `undated`; в `approved` файле нет сроков `estimate`;
- источники из реестра, все использованы, у внутренних нет адреса;
- без тире, без обещаний («гарантир…», «100 %», «точно получ…», «кепилд…», «сөзсүз аласыз»), без внутренних сведений (ОЗО, отдел продаж, регламент, плейбук, скрипт, агентские данные, e-mail, телефоны, внутренние пути).

iPhone декодирует ту же форму (`Decodable`). Отдельный строгий парсер в Swift не обязателен: файлы проверяет node-тест до слияния, а bundle содержит ровно эти файлы. Минимум для Swift: нераспознанный файл не показывается, вместо него общий маршрут; ошибка разбора не роняет «Главную».

## 3. Выбор того, что видит студент

`selectCountryTimeline(choice, { locale, today, modules })` → `CountryTimelineView | null`. Swift повторяет алгоритм шаг в шаг:

1. `choice` это код из шести (`CN`, `MY`, `AE`, `TR`, `IT`, `CZ`) или `UNDECIDED`. Любое другое значение, включая `null` и `undecided` в нижнем регистре, даёт `null`: интерфейс показывает карточку «Выберите страну» с шестью вариантами и «Пока не решил».
2. Файл: если `choice` страна и её файл `approved`, показывается её файл (`kind = "country"`). Иначе показывается `undecided.json` (`kind = "general"`); для страны с `owner_review` в `countryName` остаётся название выбранной страны. Сейчас Италия, Турция, ОАЭ и Чехия показывают общий маршрут с названием своей страны.
3. Язык: `locale = "ky"` даёт кыргызский, всё остальное русский. `kyNeedsProofreading = true`, пока `kyStatus` не `proofread`.
4. Даты: `today` это `YYYY-MM-DD` дня студента (`todayForTimeline()`, часовой пояс Asia/Bishkek). `datesHidden = today > validUntil` (сравнение строк). При `datesHidden` каждый текст с `undated` показывается вариантом `undated`; `undated: null` скрывает поле, а у текста пункта скрывает весь пункт. Без `undated` текст показывается как есть (в нём нет года).
5. Пункты со `status = "verify"` не показываются никогда.
6. Ссылки: у ссылки с `appModule` (сейчас только `csca` у шага `cn-2-exams`) `href` берётся из `modules[appModule]`, `external = false`; если платформа модуль не передала, `href = url` (`https://csca.cn`), `external = true`. Пока модуля CSCA нет (S5), веб модули не передаёт; когда маршрут появится, веб передаст `{ csca: "<маршрут модуля>" }`, iPhone откроет свой экран CSCA. Даты сессий CSCA в таймлайне не показываются.
7. Подписи «кто делает»: `student` «Студент», `evo` «EVO», `university` «Вуз» (KY «Университет»), `embassy` «Посольство» (KY «Элчилик»).

Форма результата:

```ts
type CountryTimelineView = {
  choice: string;                 // "CN" … "CZ" | "UNDECIDED"
  kind: "country" | "general";
  countryCode: string | null;     // null для UNDECIDED
  countryName: string | null;     // из study-countries.json; null для UNDECIDED
  file: string;                   // "cn" … "cz" | "undecided"
  contentVersion: number;
  datesHidden: boolean;
  intake: { label: string; note: string | null };
  steps: Array<{
    id: string; order: number; stageKeys: string[];
    title: string; summary: string;
    timing: string | null;        // null у общего маршрута
    note: string | null; doneWhen: string;
    items: Array<{ id: string; who: "student" | "evo" | "university" | "embassy"; whoLabel: string;
                   text: string; note: string | null; appliesTo: string | null }>;
    links: Array<{ id: string; label: string; href: string; external: boolean }>;
  }>;
  disclaimers: [string, string, string]; // сроки, документы, решения
  kyNeedsProofreading: boolean;
};
```

Интерфейс (план §8.4): заголовок «Путь поступления: <countryName>», для `UNDECIDED` просто «Путь поступления»; подпись `intake.label` и `intake.note`; вертикальные большие шаги, по нажатию шаг раскрывается в пункты (только чтение, отметок нет); `appliesTo` над текстом пункта, `note` мелким шрифтом; три оговорки под таймлайном всегда; ссылка «Сменить страну». На вебе раскрытые шаги запоминаются в браузере (ключ с `file` и `contentVersion`), на iPhone шаг открывается листом. Блок у клиента после «Ближайших действий дела», у самостоятельного студента первым. «Вы здесь» по этапу дела не показывается (персонализации нет, §1).

## 4. Выбор страны: RPC (миграция 284)

Обе функции в схеме `platform`, только для вошедшего студента о себе. Вызов: веб `client.schema("platform").rpc(...)`, iPhone `client.schema("platform").rpc(...)` с теми же именами параметров. Разбор ответа: `parseStudentCountryChoice` в `src/lib/portal/country-choice.ts` (строгий, отклонение формы даёт `null`).

### `platform.student_country_choice_v1()`

Без параметров. Ответ:

```json
{ "country": "CN" | "MY" | "AE" | "TR" | "IT" | "CZ" | "UNDECIDED" | null,
  "source": "saved" | "application" | "case" | "none",
  "savedAt": "2026-10-16T10:04:44.123456+00:00" | null }
```

| `source` | Когда | `country` | `savedAt` |
| --- | --- | --- | --- |
| `saved` | студент сохранил выбор | код или `UNDECIDED` | время сохранения |
| `application` | в анкете этого аккаунта ровно одна из шести стран (`["PL","IT"]` даёт `IT`, `["CN","MY"]` не даёт ничего) | код страны | `null` |
| `case` | иначе `target_country` своего дела распознаётся как одна из шести (код, EN, RU или KY название: «China», «Китай», «Czech Republic», «Түркия») | код страны | `null` |
| `none` | иначе | `null` | `null` |

Вывод по умолчанию никогда не даёт `UNDECIDED`: анкета «Пока не решил» (`undecided`) переходит к делу, затем к `none`. Своё дело выбирается как в 196: `portal_activated_at` задан, состояние `pending`, `active` или `closed`, первое по `created_at`. Вывод не сохраняется: пока студент не выбрал сам, ответ каждый раз считается заново.

### `platform.set_student_country_choice_v1(p_country text, p_request_id uuid)`

- `p_country`: `CN`, `MY`, `AE`, `TR`, `IT`, `CZ` или `UNDECIDED` (верхний регистр). Значение формы анкеты `undecided` сюда не подходит.
- `p_request_id`: новый UUID на каждое действие студента; при сетевом сбое повторяйте тот же UUID.
- Ответ: та же форма, `source = "saved"`.
- Идемпотентность: повтор того же `p_request_id` с той же страной возвращает исходную квитанцию и ничего не меняет (даже если после него студент выбрал другую страну). Тот же `p_request_id` с другой страной отклоняется.

### Ошибки

| SQLSTATE | Когда |
| --- | --- |
| `42501` | не студент: сотрудник любой роли, заявитель без участия, `anon` (нет права EXECUTE), `service_role`. Обе функции. |
| `22023` | `set`: неизвестный код, нижний регистр, `NULL` в любом параметре, повтор `p_request_id` с другой страной. Ничего не записывается. |

Интерфейс показывает честную ошибку («Не удалось сохранить выбор, попробуйте ещё раз») и прежний выбор; выдуманную страну не показывает.

### Приватность и данные

- Таблицы `platform_private.student_country_choices` (одна строка на участника) и `platform_private.student_country_choice_requests` (квитанции): RLS включена и обязательна, табличных грантов нет, PostgREST схему `platform_private` не отдаёт.
- Сотрудникам выбор не виден (нет RPC для сотрудников), в `audit_events` не пишется.
- Удаление аккаунта (280): обе таблицы входят в свои строки аккаунта; простой аккаунт с сохранённым выбором остаётся простым, строки удаляются вместе с ним.

## 5. Порядок на экране

1. Сервер вызывает `student_country_choice_v1()`; ответ разбирается `parseStudentCountryChoice`.
2. `country = null` (или ошибка разбора): карточка «Выберите страну» с шестью странами и «Пока не решил» (названия из `study-countries.json`, «Пока не решил» это запись `undecided` того же файла).
3. Иначе `selectCountryTimeline(country, { locale, today: todayForTimeline(), modules })` и отрисовка.
4. «Сменить страну» или выбор в карточке: `set_student_country_choice_v1(code, newUuid)`, затем перечитать `student_country_choice_v1()`. iPhone и веб видят один и тот же сохранённый выбор.

## 6. Проверено 16.10.2026

- `tests/portal-country-timeline.test.mjs` (11 тестов): схема всех файлов и отказ парсера на 29 видах порчи, паритет RU и KY, три оговорки в каждом файле и в каждой выдаче, нет обещаний, внутренних сведений, тире и дат сессий CSCA, пункты `verify` не попадают в выдачу, `owner_review` никогда не показывается своим таймлайном, после `validUntil` нет абсолютных дат, ссылка CSCA, ресурсы iPhone, разбор ответа RPC и список стран SQL.
- `supabase/tests/platform_student_country_choice.sql` на одноразовой базе (закреплённый образ Supabase Postgres, вся цепочка миграций, затем набор): распознавание стран, вывод по умолчанию через реальные анкеты и их одобрение, запись и повтор, отказы `22023` и `42501` без записи, права таблиц, отсутствие `audit_events`, удаление аккаунта, права функций. Набор подключён в `scripts/test-postgres-authorization.sh` сразу после 284.
- Стек evo-video-demo: резервная копия `20261016T100444Z-pre-284-country-choice`, 284 применена и записана в ledger (284). Через локальный Supabase Auth и PostgREST: шесть демо-студентов получают вывод по умолчанию (`case` у героя, `application` у остальных), сохранение CN, повтор, отказы, Италия даёт общий маршрут с названием «Италия», `UNDECIDED`; Admin, куратор и anon получают 42501. Синтетический выбор после проверки удалён.

Не проверено: интерфейс (его ещё нет), iPhone на симуляторе с живыми данными, production.
