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

Размер (замер 16.10.2026 на синтетической копии production с сидом 283
контент-потока: 116 вузов, 61 город, 6 стран с фото и текстами, 629 строк
стоимости): 145 720 байт без сжатия, 33 403 байта gzip; города (тексты и
факты на двух языках, фото) это 107 КБ из них. Цель плана 100 КБ без сжатия
не достигнута (вопрос владельцу). Шлюз локального стека ответ не сжимает
(`content-encoding` нет, 16.10.2026); сжатие шлюза production не проверено.
Веб отдаёт браузеру свой кэш и может сжимать сам; iPhone принимает gzip, если
его отдаёт шлюз.

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
| `academicYear` | `2026/27`, календарный год набора `2026` (вузы Малайзии) или null: источник год не указывает, год не придумывается |
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
- `academicYear` null у строки: часть «Ориентир на ...» для неё не печатается,
  остаётся «проверено <дата>» (в сиде 16.10.2026 так у 545 из 629 строк,
  почти у всех строк агентств). Разные годы строк перечисляются.
- `sourceName` курса приходит как записан admin (в сиде 16.10.2026 это
  полное английское название ЕЦБ или ЦБ ОАЭ); короткую подпись для студента
  выбирает UI-поток.

### 2.2a. Текст, ссылки и разбор по частям (review раунда 3, F2 и F12)

Одно правило для базы, веба, iPhone, генератора сида и импорта:
`platform_private.catalog_text_ok(value, max)` и
`platform_private.catalog_url_ok(url)` в 283, `catalogText` и `catalogUrl` в
`src/lib/catalog-text.ts`. Общие векторы `tests/fixtures/catalog-text-vectors.json`
проверяют SQL-набор 283 и `tests/catalog-text.test.mjs`; iPhone берёт те же
векторы для своего теста.

- Текст: от 1 до max знаков Unicode (кодовых точек, не UTF-16), ни одного
  знака из класса `U+0001..U+001F, U+007F..U+009F, U+00AD, U+061C, U+180E,
  U+200B..U+200F, U+2028..U+202E, U+2060..U+2064, U+2066..U+206F, U+FEFF,
  U+FFF9..U+FFFB` (управляющие с табуляцией и переводами строк, мягкий
  перенос, знаки нулевой ширины и направления письма, BOM) и ни одного
  пробела `U+0020, U+00A0, U+1680, U+2000..U+200A, U+202F, U+205F, U+3000` в
  начале и в конце. Внутри текста обычный и неразрывный пробелы допустимы.
  Классы записаны явно: `[[:cntrl:]]`, `[[:space:]]`, `trim` и `\s`
  зависят от локали или от Unicode, на них правило не держится.
- Ссылка: правило 148 (https, публичный хост, без порта, учётных данных,
  фрагмента и секретов в запросе) и сверх него ни одного знака
  запрещённого класса, ни одного пробела из списка выше и ни одного знака
  вне BMP.
- Разбор индекса отказывает целиком (экран «не удалось загрузить») только
  при неверной обёртке: ключи ответа, версия, шесть стран в порядке
  продукта. Неверная карточка города пропускается, её вузы уходят в
  «Другие вузы страны»; неверный вуз (без id, названия или страны шести)
  пропускается; неверное фото или текст страны становятся пустыми, неверное
  название страны заменяется названием из `study-countries.json`; неверные
  даты набора дают «даты уточняются». Счётчики считаются по тому, что
  осталось. Страница вуза: неверный город даёт страницу без города, неверная
  строка стоимости или курс опускаются, строка без своего курса теряет
  ориентир в USD, без строк блока «Стоимость» нет. Карточка вуза, страна,
  избранное, консультация и подготовки по-прежнему строгие. Каждое такое
  событие сервер веба пишет строкой журнала
  `{"event":"portal_university_catalog_item_degraded","rpc",…,"item","key","reason"}`
  (ключи только каталожные). iPhone ведёт себя так же.
- Название вуза и строка его города в индексе приходят из карточки вуза
  (148, `university_text`): разбор не строже базы.

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
`license`, `licenseUrl`: «Фото: <автор>, <источник>, <лицензия>», автор
ссылкой на `authorUrl` (если есть), источник всегда ссылкой на `sourceUrl`
(страница файла; для CC BY-SA это часть атрибуции), лицензия ссылкой на
`licenseUrl` (review раунда 2, F13). Панель закрывается Escape и нажатием
вне неё, открыта одна на странице. Источник фото стран и городов только Unsplash,
Pexels или Wikimedia Commons (CHECK в базе); фото агентств нет. Хост
`sourceUrl` принадлежит именно названному источнику (CHECK в базе с review
раунда 1, 16.10.2026; те же пары проверяют разборщики веба и iPhone):

| `sourceName` | хост `sourceUrl` |
|---|---|
| `Unsplash` | `unsplash.com`, `www.unsplash.com` |
| `Pexels` | `pexels.com`, `www.pexels.com` |
| `Wikimedia Commons` | `commons.wikimedia.org`, `upload.wikimedia.org` |

### 2.6. Фото вузов

Фото вуза по `photoKey` студент видит только из бакета
`portal-university-photos`: запись манифеста
`scripts/portal/university-photos-manifest.json` со `status = verified` и
`migrated = true`. Иначе честная заглушка «Проверенное фото кампуса пока не
добавлено», адрес на сайте вуза (hotlink) не используется (план 4.4,
приёмка 7.6.5). Поле `rights` записи говорит, на каком основании копия
сделана: `open_license` (CC, FAL, PD) или `official_media_owner_accepted`
(собственный сайт вуза шести стран, риск владельца по решению Р3, правило в
`src/lib/university-photo-rights.ts`). По кнопке «©»: у официальных медиа
«Фото: <вуз>, официальный сайт» со ссылкой на страницу источника, у
остальных автор и лицензия из библиотеки `src/lib/university-photo-library.json`.

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
карточку (фото, текст, факт, источник и дата факта), и только когда файл
фото уже лежит в бакете `portal-university-photos` (`storage.objects`,
review CRM R5); опубликованная карточка при правке остаётся опубликованной,
обязана остаться полной, а новое фото у неё принимается только уже
загруженным. Карточки стран публикует только миграция.

### 3.3. Вход `p_cost` (все ключи обязательны, null где допустимо)

`id` (null для новой строки), `institutionId` (вуз организации шести стран),
`programId` (id программы из последней опубликованной карточки или null),
`studyLevel` (совпадает с уровнем программы, если она названа), `teachingLanguage`,
`costKind`, `period`, `amountMinMinor` (целое ≥ 0), `amountMaxMinor` (целое
больше минимума или null), `currency` (ISO 4217), `academicYear` (`2026/27`, `2026` или null),
`noteRu`, `noteKy` (до 300, оба или ни одного), `sourceKind`, `sourceName` (до
200), `sourceUrl` (https; обязателен для `official` и `agency`), `verifiedOn`
(не позже сегодня). Любая правка возвращает строку в `draft` и снимает
подтверждение агентства. Вид источника строки `agency` меняет только
системный Admin (иначе `42501 catalog_admin_required`, review CRM R4);
правка имени или адреса источника строки агентства или подтверждённой
строки, как и любая правка, возвращает её в черновик без подтверждения.
Адрес образовательного агентства (`catalog_agency_url`, список
`CATALOG_AGENCY_DOMAINS` в `src/lib/catalog-text.ts`: eduprchina.com,
easyuni.my, easyuni.com и другие) бывает только у строки `agency`: строка
`official` или `evo_document` с таким адресом это `22023
catalog_cost_agency_source_mislabeled` (и CHECK
`catalog_costs_agency_url_is_agency`).

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

Вместо `--file` скрипт читает сид контент-потока: `--seed-dir <папка>` берёт
`costs-import.json` и `fx-rates.json` (схема `SEED_CONTRACT.md` папки сида) и
переводит их функцией `fromContentSeed`:

| Сид | Импорт |
|---|---|
| `request_id` (UUIDv5 сида) | `importKey` = `s3:<request_id>` (повторный импорт не дублирует строку) |
| `country_code`, `institution_name` | `country`, `institutionName` (вуз по паре, как сид городов) |
| `cost_kind` `registration` | `application_fee` (план 7.1: «сбор за подачу или регистрацию»; уточнение в `note`) |
| `period` `programme` | `program` |
| `academic_year` null или `2026` | как есть |
| `confirmation` `{confirmed_on, confirmed_by: owner, channel, statement, scope}` | `{confirmedOn, reason}`; `reason` собирается из канала, слов владельца и охвата, видна только сотрудникам |
| `status` `published` | `publish: true` |
| `program_ref` | только null (`programId` null) |
| курс `USD` (тождество 1) | не вносится |
| курс `units_per_usd`, `as_of`, `source`, `source_url` | `unitsPerUsd`, `asOf`, `sourceName`, `sourceUrl` |

`request_id` пакета выводится из sha256 обоих файлов сида: тот же сид даёт тот
же вызов, повтор возвращает ту же квитанцию.

### 3.5. Ошибки сотрудника

| SQLSTATE | Когда |
|---|---|
| `42501` | нет права публикации каталога или Admin; подтверждение не от Admin; смена вида источника строки агентства не Admin (`catalog_admin_required`); вуз или город недоступны; сервисная роль без живого Admin; `p_actor_membership_id` от сессии |
| `22023` | неверный вход (в том числе текст или ссылка вне правила 2.2a); неполная карточка при публикации; файла фото нет в бакете (`catalog_city_photo_missing`); город другой страны; подтверждение не агентства; адрес агентства у строки `official` или `evo_document` (`catalog_cost_agency_source_mislabeled`); смена страны города |
| `23505` | `p_request_id` уже использован с другим входом, другой командой или другим актором |
| `40001` | `p_base_version` не равна текущей версии (перечитать и повторить) |
| `23514` | публикация строки агентства без подтверждения; правка, после которой опубликованный город стал неполным; связь вуза с городом другой страны в обход RPC |

## 4. Сид 283 и проверка production

Раздел сида в конце миграции генерирует
`node scripts/catalog/generate-geography-seed.mjs --seed-dir <папка> --write`
(`--check` сверяет раздел с входами, `--prod-institutions <выгрузка>` даёт
покрытие, `--require-complete` делает ошибкой неполное покрытие и
`production_id` связи, не совпавший с выгрузкой). Входная схема это контракт
контент-потока `output/student-app-v2/seed/SEED_CONTRACT.md` (snake_case):

- `countries.json`: `{ generated_on, count, countries: [ { code, sort_order, name_ru, name_ky, name_en, summary_ru?, summary_ky?, ky_review, photo?: { key, file }, city_count?, institution_count? } ] }`; названия и порядок должны совпасть с `src/lib/study-countries.json` (в базе они фиксированы 283);
- `cities.json`: `{ generated_on, count, cities: [ { city_key, country_code, name_ru, name_ky, name_en, lat?, lng?, summary_ru?, summary_ky?, fact_ru?, fact_ky?, fact_source_url?, fact_verified_on?, ky_review, status (draft | published), gaps, photo?: { key, file }, ... } ] }`; справочные `coord_*`, `wikidata_id`, `fact_source_title` в базу не пишутся;
- `institution-cities.json`: `{ generated_on, count, match_rule, links: [ { country_code, institution_name, city_key, production_id?, production_city?, resolution?, owner_question?, note?, source_url? } ] }`; `production_id` только для сверки с выгрузкой production;
- `photos-manifest.json`: `{ generated_on, count, rules, photos: [ { key, place_type, place_key, file, sha256, bytes, width, height, author, author_url, source (pexels | unsplash | wikimedia_commons), source_url, licence, licence_url, attribution_required, attribution_text, fetched_on, ... } ] }`. Ключ фото `country-<код>` или `city-<city_key>`; генератор сверяет sha256, размер и стороны с файлом, хост `source_url` с источником; фото без карточки и адреса агентств это ошибка.

В `photo jsonb` базы попадает `{ path, width, height, author, authorUrl,
sourceName, sourceUrl, license, licenseUrl }` из манифеста; `path` это путь
объекта, который создаёт скрипт загрузки:
`geography/countries/<код>-<12 hex sha256>.jpg` и
`geography/cities/<страна>-<city_key>-<12 hex sha256>.jpg`.

Город создаётся для каждой организации, где есть вуз этой страны. Вуз
связывается по (`country_code`, точное `institution_name`); вуз, которого нет
в базе, пропускается (UUID production и демо различаются). Тексты для людей с
длинным или средним тире генератор отвергает (правило текстов EVO), так же
неполный опубликованный город, расхождение справочных чисел и неизвестные
поля.

Фото загружает `node scripts/catalog/upload-geography-photos.mjs --seed-dir <папка>`
(по умолчанию план без сети; `--check` читает публичные адреса; `--apply`
загружает недостающие, бакет должен существовать). Стоимость сидом не
грузится: только импорт 3.4 после выпуска, по разрешению.

Порядок выпуска S3 (review раунда 1, F5): веб выходит только после того,
как фото есть в бакете production, иначе карточки останутся без фото.

1. Ledger: миграция 283.
2. `upload-geography-photos.mjs --seed-dir <папка> --apply`, затем `--check`:
   67 из 67 читаются публично. Квитанцию `--check` приложить к записи выпуска.
3. `migrate-university-photos.mjs --check --only=chang-an-university,gbs-global-banking-school-dubai-campus,guangzhou-huashang-vocational-college`
   (сеть только чтением: три записи, чью библиотеку сменил review раунда 3,
   получают sha256; остальные записи манифеста не меняются), затем
   `--apply` для 45 записей со `status = verified` и `migrated = false`
   (42 официальных медиа, 2 официальных медиа GBS Dubai и Guangzhou
   Huashang, 1 Wikimedia Commons Chang’an University; запись в production по
   разрешению), затем закоммитить манифест с `migrated = true`. После шага у
   115 из 116 вузов шести стран фото из бакета; у University of Cassino and
   Southern Lazio заглушка (свободного фото кампуса нет, PLAN_CHANGES).
4. `check-geography.sql` только чтением: 116 из 116 связаны.
5. Выпуск веба с этим манифестом.

Проверка production только чтением: `scripts/catalog/check-geography.sql`
(строка на организацию: `published_institutions`, `linked_institutions`,
`all_linked`, города, строки стоимости по статусам, последние курсы,
разбивка по странам, список вузов без связи). Ожидание после сида:
`all_linked = true`, 116 из 116.
