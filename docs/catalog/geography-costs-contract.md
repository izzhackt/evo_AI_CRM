# Университеты v2: контракт RPC географии и стоимости (миграция 283)

Статус: контракт для потоков S3.3 (веб), S3.4 (iPhone) и S3.5 (CRM). Источник
правды: `supabase/migrations/283_platform_catalog_geography_costs.sql`, проверки:
`supabase/tests/platform_catalog_geography_costs.sql`. План:
`docs/EVO_STUDENT_APP_V2_PLAN_2026-10-16.md` (раздел 7), решения:
`docs/PLAN_CHANGES.md`, записи 16.10.2026 о миграции 283.

Все RPC в схеме `platform`. Веб вызывает их как
`supabase.schema("platform").rpc(name, args)`, iPhone так же через
supabase-swift (`db.schema = "platform"`). Прямого чтения таблиц нет ни у
одной клиентской роли: только эти функции.

## 1. Что не меняется

Прежние RPC (`student_university_catalog`, `student_university_catalog_by_ids_v1`,
`student_university_favorites_v1`, `set_university_favorite_v1`,
`student_recent_universities_v1`, `student_catalog_preparations_v1`,
`own_portal_consultation_requests_v1`, `staff_university_catalog`,
`staff_university_catalog_countries`) остаются с той же подписью, телом и
ответом: миграция сверяет их md5 до и после, тест сверяет форму. Сборки
iPhone 0.1.0 и 1.0 работают как раньше. Карточка вуза `content` и её
валидатор не меняются.

## 2. Студент

Доступ у обоих RPC тот же, что у `student_university_catalog`: вошедший
студент организации (`platform_role = student`) с `portal.read.self`.
Состояние дела не важно (approved и assisted одинаково). Организация берётся
из сессии, параметра организации нет. Видно только опубликованное и только
шесть стран продукта (`CN, MY, AE, TR, IT, CZ`).

### 2.1. `student_university_index_v1(p_known_version text default null)`

Весь каталог шести стран организации одной выдачей: страны, опубликованные
города, краткие карточки вузов. Заменяет постраничные чтения для списка,
карты, поиска, групп по городам и профессий.

Ответ при совпадении `p_known_version` с текущей версией:

```json
{ "notModified": true, "version": "g1.c259412d88f328f9f986867c747feed4" }
```

Иначе полный ответ (`notModified: false`):

```json
{
  "notModified": false,
  "version": "g1.c259412d88f328f9f986867c747feed4",
  "countries": [
    {
      "code": "CN",
      "name": { "ru": "Китай", "ky": "Кытай" },
      "photo": {
        "path": "geography/countries/cn-459341790afb.jpg",
        "width": 2400, "height": 1600,
        "author": "Diana", "authorUrl": "https://www.pexels.com/@diana",
        "sourceName": "Pexels", "sourceUrl": "https://www.pexels.com/photo/example-123/",
        "license": "Pexels License", "licenseUrl": "https://www.pexels.com/license/"
      },
      "summary": { "ru": "Короткий текст.", "ky": "Кыска текст." },
      "universityCount": 47,
      "cityCount": 19
    }
  ],
  "cities": [
    {
      "key": "hangzhou",
      "country": "CN",
      "name": { "ru": "Ханчжоу", "ky": "Ханчжоу" },
      "photo": { "path": "geography/cities/cn-hangzhou-c6acd1b0f6fb.jpg", "width": 2400, "height": 1800,
        "author": "miyou_ 77", "authorUrl": "https://www.pexels.com/@miyou_-77-696995602/",
        "sourceName": "Pexels", "sourceUrl": "https://www.pexels.com/photo/view-of-the-west-lake-20700881/",
        "license": "Pexels License", "licenseUrl": "https://www.pexels.com/license/" },
      "summary": { "ru": "Столица провинции Чжэцзян.", "ky": "Чжэцзян провинциясынын борбору." },
      "fact": { "ru": "Озеро Сиху внесено в список ЮНЕСКО в 2011 году.", "ky": "Сиху көлү 2011-жылы ЮНЕСКОнун тизмесине киргизилген.",
        "sourceUrl": "https://whc.unesco.org/en/list/1334", "verifiedOn": "2026-10-16" },
      "universityCount": 9
    }
  ],
  "universities": [
    {
      "id": "0b9c2f8e-3f0a-4b8e-9d55-7a1d2c3e4f50",
      "name": "Zhejiang University",
      "country": "CN",
      "cityKey": "hangzhou",
      "cityLabel": "Ханчжоу",
      "levels": ["language", "bachelor", "master"],
      "photoKey": "zhejiang-university",
      "intakes": [ { "deadline": "2027-03-31", "start": "2027-09-01", "startMonth": "2027-09" } ],
      "hasCosts": true
    }
  ]
}
```

Поля:

| Поле | Тип | Смысл |
|---|---|---|
| `version` | string | непрозрачная версия выдачи (сейчас `g1.` + md5 самой выдачи); сравнивать только на равенство |
| `countries` | array, всегда 6 | порядок продукта CN, MY, AE, TR, IT, CZ; названия фиксированные (как `src/lib/study-countries.json`), не `Intl.DisplayNames` и не `Locale` |
| `countries[].photo`, `summary` | object или null | пока карточку страны не заполнили, null |
| `countries[].universityCount` | number | опубликованные вузы страны организации (сумма по странам = число вузов в `universities`) |
| `countries[].cityCount` | number | опубликованные города страны, где есть хотя бы один вуз |
| `cities` | array | только опубликованные карточки городов, где есть хотя бы один вуз; порядок: страна в порядке продукта, затем больше вузов, затем название RU |
| `cities[].summary`, `fact` | object | у опубликованного города всегда заполнены (CHECK в базе) |
| `universities` | array | все опубликованные вузы шести стран организации, порядок по `name` |
| `universities[].cityKey` | string или null | null: у вуза нет опубликованного города, вуз показывается в «Другие вузы страны» |
| `universities[].cityLabel` | string или null | исходная строка `content.city` карточки (для «Других вузов страны») |
| `universities[].levels` | array | уровни программ в порядке `language, foundation, diploma, bachelor, master, doctorate` |
| `universities[].photoKey` | string или null | ключ фото вуза из библиотеки фото вузов, как в `content.photoKey` |
| `universities[].intakes` | array | даты наборов только со статусом `open` или `announced`; поля `deadline` (срок подачи), `start` (дата начала), `startMonth` (`YYYY-MM`), каждое может быть null |
| `universities[].hasCosts` | boolean | у вуза есть опубликованные строки стоимости |

«Ближайший набор» считает клиент по `intakes` тем же правилом, что сейчас
`nearestUniversityIntake` (`src/lib/portal/universities.ts`): сначала
ближайший будущий срок подачи, иначе ближайшее начало. Так выдача не зависит
от текущей даты и её версия не меняется каждый день.

Размер (замер 16.10.2026 на синтетической копии production: 116 вузов, 60
городов с реальными текстами RU и KY, 6 стран с фото, без текстов стран):
146 713 байт без сжатия, 34 162 байта gzip; тексты городов на двух языках
это 83 КБ из них. Цель плана 100 КБ без сжатия не достигнута; ответ PostgREST
идёт через шлюз Supabase со сжатием, клиенты должны принимать gzip (браузер и
URLSession делают это сами).

### 2.2. `student_university_detail_v1(p_institution_id uuid)`

Страница вуза одним вызовом. Заменяет четыре последовательных чтения
страницы `/portal/universities/<id>` (карточка по id, подготовки, избранное,
консультации) и даёт страну, город и стоимость.

```json
{
  "university": { "id": "0b9c2f8e-...", "version": 2, "publishedAt": "2026-09-20T10:00:00+00:00", "content": { } },
  "country": { "code": "CN", "name": { "ru": "Китай", "ky": "Кытай" } },
  "city": { "key": "hangzhou", "country": "CN", "name": { "ru": "Ханчжоу", "ky": "Ханчжоу" },
    "photo": { }, "summary": { "ru": "...", "ky": "..." },
    "fact": { "ru": "...", "ky": "...", "sourceUrl": "https://...", "verifiedOn": "2026-10-16" } },
  "favored": true,
  "openConsultation": { "requestId": "...", "status": "requested", "institutionId": "...", "institutionName": "Zhejiang University",
    "note": "...", "requestedAt": "2026-10-16T08:00:00+00:00", "handledAt": null },
  "preparations": { "studentCaseId": "...", "items": [ ] },
  "costs": {
    "rows": [
      {
        "id": "785b342e-...", "kind": "tuition", "period": "year", "studyLevel": "bachelor", "programId": null,
        "teachingLanguage": "en", "currency": "CNY", "exponent": 2,
        "amountMinMinor": 2500000, "amountMaxMinor": 3500000,
        "usdApproxMin": 3510, "usdApproxMax": 4910,
        "academicYear": "2026/27", "note": null,
        "source": { "kind": "official", "url": "https://university.example.edu/fees" },
        "verifiedOn": "2026-10-16"
      },
      {
        "id": "e5abfe73-...", "kind": "accommodation", "period": "year", "studyLevel": "bachelor", "programId": null,
        "teachingLanguage": "en", "currency": "CNY", "exponent": 2,
        "amountMinMinor": 800000, "amountMaxMinor": null,
        "usdApproxMin": 1120, "usdApproxMax": null,
        "academicYear": "2026/27", "note": { "ru": "...", "ky": "..." },
        "source": { "kind": "agency", "url": null },
        "verifiedOn": "2026-10-16"
      }
    ],
    "fxRates": [ { "currency": "CNY", "unitsPerUsd": 7.1234, "asOf": "2026-10-13", "sourceName": "Национальный банк" } ]
  }
}
```

| Поле | Смысл |
|---|---|
| `university` | ровно элемент `items` из `student_university_catalog_by_ids_v1` (последняя опубликованная версия): веб разбирает `parseUniversityPage`-совместимым разбором элемента, iPhone тем же `UniversityCatalogItem` |
| `country` | страна вуза с фиксированными названиями |
| `city` | опубликованный город вуза или null (тогда навигация «Страна › Город» без города) |
| `favored` | вуз в избранном этого студента |
| `openConsultation` | открытый запрос консультации студента или null; форма элемента `own_portal_consultation_requests_v1` |
| `preparations` | null, если дело кабинета не читается (как сейчас `catch` на вебе); иначе `studentCaseId` и подготовки этого вуза в форме элементов `student_catalog_preparations_v1` |
| `costs` | null, если опубликованных строк нет: тогда блока «Стоимость» нет совсем |

Строки стоимости:

| Поле | Значения |
|---|---|
| `kind` | `tuition` обучение, `accommodation` общежитие, `application_fee` сбор за подачу или регистрацию, `insurance` страховка, `other` прочее |
| `period` | `year`, `semester`, `month`, `week`, `day`, `once` (разово), `program` (вся программа) |
| `studyLevel`, `programId`, `teachingLanguage` | уточнения строки или null (null у `programId`: строка для всего вуза); язык ISO 639-1 (`en`, `zh`, `cs`, `it`) |
| `amountMinMinor`, `amountMaxMinor` | сумма в минорных единицах валюты вуза; `amountMaxMinor` null: одна сумма, иначе диапазон |
| `exponent` | число знаков минорной единицы (у валют шести стран и USD это 2): сумма = `amountMinMinor / 10^exponent` |
| `usdApproxMin`, `usdApproxMax` | ориентир в целых USD, уже округлён до 10 (ненулевая сумма не меньше 10); null, если строка в USD или курса нет |
| `academicYear` | вид `2026/27` |
| `source.kind` | `official` (сайт университета, `url` есть), `agency` (открытые данные образовательных агентств: `url` всегда null, название агентства студенту не отдаётся), `evo_document` (материалы EVO, `url` null) |
| `verifiedOn` | дата проверки строки |
| `fxRates` | последний курс по каждой валюте строк: «1 USD = `unitsPerUsd` `currency`», источник и дата |

Правила показа (план 4.5, решения владельца 16.10.2026):

- Блок «Стоимость» только при `costs != null`. Фразы «Стоимость уточняет
  куратор» нет нигде (ни в коде, ни в словарях).
- Колонка «≈ USD» только если хотя бы у одной строки `usdApproxMin != null`;
  знак «≈», сумма уже округлена сервером.
- Строка под таблицей: «Ориентир на <academicYear>. Источник: <сайт
  университета | открытые данные образовательных агентств>, проверено
  <самая поздняя verifiedOn>. Курс: 1 USD = <unitsPerUsd> <currency>
  (<sourceName>, <asOf>). Окончательную сумму указывает университет». Если в
  таблице оба вида источника, называются оба. Подпись для `evo_document`
  выбирает UI-поток (предложение: «материалы EVO»).

### 2.3. Ошибки студенческих RPC

| SQLSTATE | HTTP (PostgREST) | Когда |
|---|---|---|
| `42501` | 403 (401 для anon) | не студент, нет `portal.read.self`, anon; вуз чужой организации, неизвестный, неопубликованный или страны вне списка (неразличимы) |
| `22023` | 400 | `p_institution_id` null; `p_known_version` длиннее 100 знаков или с управляющими символами |

### 2.4. Кэш и версия

- Индекс одинаков для всех студентов организации и не содержит личных данных.
  Веб держит его в серверном кэше Next с ключом (организация, `version`),
  при каждом показе вызывает RPC с известной версией и при `notModified`
  отдаёт кэш. Отдаётся только после проверки доступа (её делает сам RPC).
  После публикации из CRM веб сбрасывает тег кэша (одно приложение, один
  контейнер).
- iPhone хранит индекс на диске вместе с `version`, при запуске и
  pull-to-refresh вызывает RPC с ней; `notModified` оставляет копию.
- Версия меняется при любом изменении выдачи: публикация или правка карточки
  вуза, города, страны, связи вуз → город, появление или снятие
  опубликованной стоимости (`hasCosts`). От даты не зависит.
- `student_university_detail_v1` личный (избранное, консультация, подготовки):
  между студентами не кэшируется, читается при открытии страницы вуза.

### 2.5. Фото стран и городов

`photo.path` это путь объекта в публичном бакете `portal-university-photos`
(тот же, что у фото вузов). Адрес оригинала:

```
<SUPABASE_URL>/storage/v1/object/public/portal-university-photos/<path>
```

Вариант нужного размера через Image Transformations Supabase:

```
<SUPABASE_URL>/storage/v1/render/image/public/portal-university-photos/<path>?width=800&quality=70
```

Доступность трансформаций зависит от тарифа проекта; до выпуска проверить
на production-проекте GET-запросом без входа. Путь содержит 12 знаков
sha256 файла: новое фото это новый путь, кэш браузера и iPhone можно держать
долго. Подпись под карточкой не печатается; автор, источник и лицензия по
кнопке «©» из полей `author`, `authorUrl`, `sourceName`, `sourceUrl`,
`license`, `licenseUrl`. Источник фото стран и городов только Unsplash,
Pexels или Wikimedia Commons (CHECK в базе); фото агентств нет.

## 3. Сотрудник (CRM)

Право: `catalog.import.manage` в охвате организации (как публикация
каталога в 148) или системный Admin. Подтверждение строк агентств: только
системный Admin. Продажи, кураторы, студенты, anon и сотрудник другой
организации получают `42501`. Все команды принимают `p_request_id uuid` и
идемпотентны: повтор с тем же входом возвращает ту же квитанцию без записи;
тот же `p_request_id` с другим входом, другой командой или другим актором
даёт `23505`. Ключи JSON входа строго заданы: лишний или отсутствующий ключ
это `22023`.

| RPC | Аргументы | Квитанция |
|---|---|---|
| `staff_catalog_geography_v1` | `p_organization_id` | см. 3.1 |
| `staff_catalog_city_upsert_v1` | `p_organization_id`, `p_city jsonb`, `p_base_version bigint` (0 для нового), `p_request_id` | `{requestId, cityKey, version, status}` |
| `staff_catalog_city_publish_v1` | `p_organization_id`, `p_city_key`, `p_published boolean`, `p_base_version`, `p_request_id` | `{requestId, cityKey, version, status}` |
| `staff_catalog_institution_city_set_v1` | `p_organization_id`, `p_institution_id`, `p_city_key` (null снимает связь), `p_request_id` | `{requestId, institutionId, cityKey}` |
| `staff_catalog_cost_upsert_v1` | `p_organization_id`, `p_cost jsonb`, `p_base_version` (0 для новой строки), `p_request_id` | `{requestId, costId, version, status}` |
| `staff_catalog_cost_confirm_v1` (только Admin) | `p_organization_id`, `p_cost_id`, `p_base_version`, `p_reason text` (до 500), `p_request_id` | `{requestId, costId, version, status, confirmedOn}` |
| `staff_catalog_cost_publish_v1` | `p_organization_id`, `p_cost_id`, `p_status` (`published`, `retired`, `draft`), `p_base_version`, `p_request_id` | `{requestId, costId, version, status}` |
| `staff_catalog_cost_import_v1` | `p_organization_id`, `p_rows jsonb` (1..2000), `p_request_id`, `p_actor_membership_id uuid default null` | `{requestId, created, existing, institutionMissing, rows: [{importKey, status, costId?, published?}]}` |
| `staff_catalog_fx_rate_set_v1` | `p_organization_id`, `p_currency`, `p_as_of date`, `p_units_per_usd numeric` («1 USD = x»), `p_source_name`, `p_source_url` (null или https), `p_request_id`, `p_actor_membership_id uuid default null` | `{requestId, currency, asOf, unitsPerUsd}` |

`p_actor_membership_id` принимается только от сервисной роли (скрипт
импорта координатора) и должен быть членством живого системного Admin этой
организации; от сессии сотрудника он должен быть null.

### 3.1. `staff_catalog_geography_v1`

```json
{
  "countries": [ { "code": "CN", "nameRu": "Китай", "nameKy": "Кытай", "nameEn": "China", "photo": null,
    "summaryRu": null, "summaryKy": null, "kyReview": "pending" } ],
  "cities": [ { "key": "hangzhou", "country": "CN", "nameRu": "Ханчжоу", "nameKy": "Ханчжоу", "nameEn": "Hangzhou",
    "lat": 30.27, "lng": 120.15, "photo": { }, "summaryRu": "...", "summaryKy": "...", "factRu": "...", "factKy": "...",
    "factSourceUrl": "https://...", "factVerifiedOn": "2026-10-16", "kyReview": "pending", "status": "published",
    "publishedAt": "...", "publishedVia": "staff", "reviewedByName": "...", "complete": true, "version": 2,
    "updatedAt": "...", "institutionCount": 9 } ],
  "institutions": [ { "id": "...", "name": "Zhejiang University", "country": "CN", "cityLabel": "Ханчжоу", "published": true,
    "cityKey": "hangzhou", "assignedVia": "migration", "assignedAt": "..." } ],
  "costs": [ { "id": "...", "institutionId": "...", "programId": null, "studyLevel": "bachelor", "teachingLanguage": "en",
    "costKind": "tuition", "period": "year", "amountMinMinor": 2500000, "amountMaxMinor": null, "currency": "CNY", "exponent": 2,
    "academicYear": "2026/27", "noteRu": null, "noteKy": null, "sourceKind": "agency", "sourceName": "EDUPRCHINA",
    "sourceUrl": "https://...", "verifiedOn": "2026-10-16", "confirmedAt": "...", "confirmedOn": "2026-10-16",
    "confirmationReason": "...", "confirmedByName": "...", "status": "published", "publishedAt": "...", "version": 3,
    "importKey": "cn:zju:tuition:0", "createdAt": "...", "updatedAt": "..." } ],
  "fxRates": [ { "currency": "CNY", "asOf": "2026-10-13", "unitsPerUsd": 7.1234, "sourceName": "...", "sourceUrl": null,
    "setAt": "...", "ageDays": 3, "latest": true } ]
}
```

Вузы в `institutions` только шести стран, включая неопубликованные
(`published: false`). Курс с `latest: true` и `ageDays > 45` CRM помечает как
устаревший (план 7.5).

### 3.2. Вход `p_city` (все ключи обязательны, null где допустимо)

`key` (латинский slug 2..64, `a-z0-9` и дефис), `country` (одна из шести),
`nameRu`, `nameKy`, `nameEn` (до 100), `lat`, `lng` (оба числа или оба null),
`photo` (объект как в 2.1 с путём `geography/cities/...-<12 hex>.<jpg|png|webp|avif>`
или null), `summaryRu`, `summaryKy` (до 300, оба или ни одного), `factRu`,
`factKy` (до 200, оба или ни одного), `factSourceUrl` (https или null),
`factVerifiedOn` (дата не позже сегодня или null), `kyReview` (`pending`, `done`).
Страна города после создания не меняется. Опубликовать можно только полную
карточку (фото, текст, факт, источник и дата факта); опубликованная карточка
при правке остаётся опубликованной и обязана остаться полной.

### 3.3. Вход `p_cost` (все ключи обязательны, null где допустимо)

`id` (null для новой строки), `institutionId` (вуз организации шести стран),
`programId` (id программы из последней опубликованной карточки или null),
`studyLevel` (совпадает с уровнем программы, если она названа), `teachingLanguage`,
`costKind`, `period`, `amountMinMinor` (целое ≥ 0), `amountMaxMinor` (целое
больше минимума или null), `currency` (ISO 4217), `academicYear` (`2026/27`),
`noteRu`, `noteKy` (до 300, оба или ни одного), `sourceKind`, `sourceName` (до
200), `sourceUrl` (https; обязателен для `official` и `agency`), `verifiedOn`
(не позже сегодня). Любая правка возвращает строку в `draft` и снимает
подтверждение агентства.

### 3.4. Импорт

Строка `p_rows` содержит ключи 3.3 без `id`, плюс `importKey` (обязателен,
`[A-Za-z0-9][A-Za-z0-9:._/-]{0,199}`), вуз по `institutionId` или по паре
`country` + точное `institutionName`, `confirmation` (`{confirmedOn, reason}`
или null; только для `agency`; требует системного Admin) и `publish`
(boolean). Вуз не найден или не из шести стран: строка в отчёте
`institution_missing`, не создаётся. `importKey`, уже импортированный в
организацию: `exists`, без изменений. Неверная строка отклоняет весь пакет
(`22023`, номер строки в сообщении). `publish: true` у строки агентства без
`confirmation` это `23514`.

Подтверждение владельца 16.10.2026 для данных EDUPRCHINA и похожих
агентств записывается так: `"confirmation": {"confirmedOn": "2026-10-16",
"reason": "Владелец подтвердил данные агентств в чате 16.10.2026: «у них
правильно, мы все подтверждаем»"}`.

Файл скрипта `scripts/catalog/import-catalog-costs.mjs`:

```json
{
  "schemaVersion": 1,
  "organizationId": "необязательно, иначе EVO_PLATFORM_ORGANIZATION_ID",
  "requestId": "необязательно, иначе выводится из sha256 файла",
  "rows": [ { "importKey": "cn:zju:tuition:bachelor:en", "country": "CN", "institutionName": "Zhejiang University",
    "studyLevel": "bachelor", "teachingLanguage": "en", "costKind": "tuition", "period": "year",
    "amountMin": "25000", "amountMax": "35000", "currency": "CNY", "academicYear": "2026/27",
    "sourceKind": "agency", "sourceName": "EDUPRCHINA", "sourceUrl": "https://www.eduprchina.com/...",
    "verifiedOn": "2026-10-16", "confirmation": { "confirmedOn": "2026-10-16", "reason": "..." }, "publish": true } ],
  "fxRates": [ { "currency": "CNY", "asOf": "2026-10-16", "unitsPerUsd": "7.12", "sourceName": "...", "sourceUrl": null } ]
}
```

`amountMin`/`amountMax` в единицах валюты (строка или число), либо
`amountMinMinor`/`amountMaxMinor`; равные min и max становятся одной суммой.
Без `--apply` скрипт только проверяет файл и печатает план.

### 3.5. Ошибки сотрудника

| SQLSTATE | Когда |
|---|---|
| `42501` | нет права публикации каталога или Admin; подтверждение не от Admin; вуз или город недоступны; сервисная роль без живого Admin; `p_actor_membership_id` от сессии |
| `22023` | неверный вход; неполная карточка при публикации; город другой страны; подтверждение не агентства; смена страны города |
| `23505` | `p_request_id` уже использован с другим входом, другой командой или другим актором |
| `40001` | `p_base_version` не равна текущей версии (перечитать и повторить) |
| `23514` | публикация строки агентства без подтверждения; правка, после которой опубликованный город стал неполным; связь вуза с городом другой страны в обход RPC |

## 4. Сид 283 и проверка production

Раздел сида в конце миграции генерирует
`node scripts/catalog/generate-geography-seed.mjs --seed-dir <папка> --write`
(`--check` сверяет раздел с входами, `--prod-institutions <выгрузка>` даёт
покрытие, `--require-complete` делает неполное покрытие ошибкой). Входы:

- `countries.json`: `{ "schemaVersion": 1, "countries": [ { "code", "summaryRu"?, "summaryKy"?, "kyReview"?, "photo"? } ] }`;
- `cities.json`: `{ "schemaVersion": 1, "cities": [ { "key", "country", "nameRu", "nameKy", "nameEn", "status" (draft | published), "lat"?, "lng"?, "summaryRu"?, "summaryKy"?, "factRu"?, "factKy"?, "factSourceUrl"?, "factVerifiedOn"?, "kyReview"?, "photo"? } ] }`;
- `institution-cities.json`: `{ "schemaVersion": 1, "links": [ { "country", "institutionName", "cityKey" } ] }`;
- `photo` во входе: `{ "file" (путь к файлу относительно папки сида), "author", "authorUrl"?, "sourceName" (Unsplash | Pexels | Wikimedia Commons), "sourceUrl", "license", "licenseUrl"? }`. Размер, sha256 и путь объекта генератор считает сам по файлу (JPEG, PNG, WebP).

Город создаётся для каждой организации, где есть вуз этой страны. Вуз
связывается по (`country_code`, точное `institution_name`); вуз, которого нет
в базе, пропускается (UUID production и демо различаются). Генератор
предупреждает о длинном и среднем тире в текстах.

Фото загружает `node scripts/catalog/upload-geography-photos.mjs --seed-dir <папка>`
(по умолчанию план без сети; `--check` читает публичные адреса; `--apply`
загружает недостающие, бакет должен существовать). Стоимость сидом не
грузится: только импорт 3.4 после выпуска, по разрешению.

Проверка production только чтением: `scripts/catalog/check-geography.sql`
(строка на организацию: `published_institutions`, `linked_institutions`,
`all_linked`, города, строки стоимости по статусам, последние курсы,
разбивка по странам, список вузов без связи). Ожидание после сида:
`all_linked = true`, 116 из 116.
