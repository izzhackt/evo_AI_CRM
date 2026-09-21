# A14a — компактный каталог сотрудников: исходники

Source `030d7c2ecb072e5c61e5b3cec225755970f3fd09`, precode `f67d0fe6`.
Основание: [утверждённый план](../EVO_STAFF_CATALOG_COMPACT_PLAN_2026-09-21.md).
Целевые файлы33966da1 и входящий main29e0fb46 byte-identical перед изменением.
Это source-проверка; Auth/DB/server/browser и новый actual UI не выполнялись.

## Реализация

- Только staff-ветка UniversityList использует одноколоночные компактные записи:
  настоящее фото с caption/author/source/license, название/место, краткий overview,
  общий count «Программ в карточке» и прежняя ссылка «Программы и сроки».
  Потенциальная portal-ветка списка и detail/Program остаются прежними.
- Optional compact-фото имеет96px image height, на desktop отдельную176px
  колонку; caption и ссылки переносятся. Resolver, managed/hotlink, alt и error
  semantics не менялись; default/large сохраняют прежние размеры.
- Pure selector выбирает только опубликованную календарную дату open/announced
  по выбранному уровню, с валидными source/verifiedOn и явной поддерживаемой
  UTC/GMT/IANA зоной. Не принимает posix/right, пустую зону, aliases/offsets вне
  существующего контракта или будущую verification в локальном дне этой зоны.
- Проверка истечения совпадает с существующим label: deadlineTime<=текущей
  локальной минуты считается прошедшим; date-only сегодня остаётся датой.
  Сортировка по calendar date, program.id и исходному intake index, без
  объявления ближайшего absolute instant. Сохраняются ссылки на оригинальные
  program/intake; legacy intake не получает выдуманный ID.
- UI показывает «Дата подачи», исходные time/TZ, программу, набор, источник и
  дату проверки. При нескольких доступных наборах на эту дату показан count;
  при отсутствии безопасного кандидата — «Сроки подачи — в карточке».
  Start date/month не заменяют deadline, admission eligibility не обещается.
- Staff page передаёт один now для всех строк. Search/country/level/reset/Next,
  server filtering до30-row limit, invalid→notFound, reader unavailable и
  canManage/scoped guards не изменены. Нет SQL, API/DTO, package/lock,
  Student/native, управления каталогом или полного country facet.

Impeccable Shape/Operate/craft-floor прочитаны; текущая композиция опирается на
существующие EVO/Golos и исходники. Свежего staff screenshot нет; portal/iPhone
снимки не выдаются за staff baseline. Визуальная приёмка ещё впереди.

## Проверки и два существующих сбоя

Node22.23.1, повторно использованы matching dependencies без установки.
`npm run typecheck` и scoped ESLint пяти изменённых source/test файлов: PASS.
`git diff --check`: PASS. Новый pure selector:10/10 PASS — выбранный уровень,
статусы, missing/invalid date/source/TZ, явнаяUTC, локальные дни, minute/DST
границы и parity с label, date-only, future verification, calendar ties,
legacy identity и отсутствие мутаций input. Это unit cases, не published fixtures.

Общий запуск трёх файлов дал **35/37 PASS,2 FAIL**, а не полный успех:
`university-staff-deadline`, `platform-university-catalog`, `university-photo-storage`.
Два существующих падения воспроизвелись отдельным запуском только этих имён
на чистом исходном main `29e0fb46a8067a6a4f5a9bedce81971aba2f56ff`:

1. `published and draft DTOs reject raw registry/provenance extras and malformed versions`:
   старый test draft не содержит обязательный `reviewKind`; decoder возвращаетnull.
2. `real catalogue content renders known facts without missing-field or uncertain-intake UI`:
   существующий SSR child без server condition падает на существующем
   `server-only` import из photo URL resolver. HTML-проверка не состоялась.

Эти tests/decoder/resolver не менялись и здесь не исправляются. Они не являются
регрессией A14a, но соответствующие старые assertions/SSR markup нельзя считать
проверенными. Новая staff UI приёмка требует отдельного реального прохода.

| Локальный evidence вне Git | SHA-256 |
|---|---|
| `/private/tmp/evo-staff-catalog-source-tests.log` | `a6acfd7340bb821be2527a0308a56e4679d66f29151e18e21a1205842400699f` |
| `/private/tmp/evo-staff-catalog-baseline-tests.log` | `ad72977e53fa4cfa154c32bb94a10735907d913736c33a007f3deadf918842d0` |
| `/private/tmp/evo-staff-catalog-source-lint.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `/private/tmp/evo-staff-catalog-source-types.log` | `dd8145086836aaed592b736d5d2abf5e521cada876212e044f406db1756e9d5b` |

Независимые source review/CI и затем scheduled actual обязательны. Общая QA у
B1006; каталог не запускает своих сессий. После передачи среды: существующий
ordinary staff,1440/390/320, доступные фильтры/Next/detail/source/attribution,
сверка program/intake/date с настоящим decoded RPC, без seed/publication/write.
Недоступный положительный deadline/Next/manager/error вариант останется gap.
Пункт14/все1–36, production и Student/native этой записью не завершены.
