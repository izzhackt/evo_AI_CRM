# D4 — университетские формы и пакеты документов

## Актуальный срез ZIP — решение владельца2026-09-15

Владелец явно выбрал ZIP до50MiB без дополнительных расходов. Этот предел
заменяет прежнюю цель250/260MiB, но не разрешает пропускать выбранные документы.
Перенос старой тестовой истории отменён и не нужен для нового рабочего пакета.

- Расширить существующий `PartnerPacketsPanel`/partner manifest: до50 выбранных
  approved/clean оригинальных версий и уже сохранённых готовых profile/form
  artifacts. Один интерфейс, org/case и общая история результатов.
- Фиксировать неизменяемый состав/hash/size/MIME/source binding. `kind=package`
  в существующем export lifecycle, отдельный строгий package binding и прямой
  org/case FK; для пакета только с оригиналами не создавать фиктивную анкету/hash.
- Сборка через существующий PizZip-движок: проверка source bytes → ZIP → private
  Storage без overwrite → readback size/SHA → повторная проверка доступа/состава
  → ready. Retry идемпотентен; history download читает сохранённый файл, не
  пересобирает. Ошибка любого выбранного файла блокирует весь экспорт.
- Draft/final явно различаются; final не включает draft generated artifacts.
  Новая версия источника требует нового пакета; старый history download проверяет
  действующий доступ и безопасность включённых версий, не их статус latest.
- Проверять предварительный объём и итоговые bytes≤52,428,800 до upload; UI
  показывает «ZIP до50МБ». Отдельный private export bucket расширить20→50MiB и
  добавить `application/zip`; profile/form caps5/20MiB и original ingress25MiB
  остаются. Global limit/tariff не менять, доступность проверить чтением настроек.
- Проверка на разрешённом изолированном case: реальные upload/render/Storage,
  сохранение draft/final, повторный вход и скачивание, entry hashes, отказ при
  stale/access/oversize/replay conflict. Это техническая приёмка, не клиентская.

Ниже — исходный контракт и исторический library checkpoint; изменённые здесь
пределы, reuse существующего partner panel и отказ от старого импорта приоритетны.

Дата: 2026-09-13. Контракт D4, не готовность всего блока; номера миграций выделяет root.
Mapping/DOCX/PDF-модули объединены PR759 в main `7da50fa8`; pure package-модули
объединены PR762 в main `85a1efdf`. Формы, пакеты и их production/клиентская приёмка
пока не готовы.
Исходная база ответвления: D2/PR752 merged `fd5b6a08` = reviewed tree `daf5b5ac`.
Для объединения library-среза PR759 добавлен текущий main `db2a121`, который
содержит принятый S2/D2 выпуск `05585020`. D4 этим выпуском не включён;
его HTTP/Storage/UI и реальная приёмка остаются открыты.
Основания: [общий план](evo-docs-unification-run-plan.md),
[D2](evo-docs-profile-fields-contract.md), [ADR0028](../../adr/0028-unify-document-automation-inside-evo-platform.md).
D4 можно выполнять параллельно D3: вручную подтверждённых полей достаточно,
ответ Gemini не является зависимостью. D5/import и D6/retirement остаются отдельно.

## Результат и единая authority

В существующем деле выбрать вуз/заявку → опубликованный бланк → проверить заполнение
→ выбрать оригиналы, переводы и вложения → сформировать draft/final → открыть историю.
Расширяется текущий Documents/«Анкета», не создаётся второй экран продукта или вход.
Готовый файл не означает отправленную заявку, получение университетом или согласие клиента.
Подпись, заявление от имени клиента, фото и согласие не подставляются автоматически;
ручные действия остаются явными препятствиями готовности к подаче.

- Единственный вуз — `platform.catalog_institutions.id` с тем же organization_id.
  Форма хранит `catalog_institution_id`; заявка использует существующий одноимённый FK.
  Имя вуза — подпись, не join/import key. Фиксируется утверждённая source_revision
  каталога; смена привязки требует нового решения, не автоматического поиска по имени.
- Анкета — текущий D2 profile/revision и 61 ключ. Значения читаются под сессией
  сотрудника, только подтверждённые; текущие mapped-поля не дублируются.
  Derived full_name/имена родителей допустимы только из подтверждённых компонентов.
  Confirmed NULL остаётся пустым, conflict не превращается в значение или «N/A».
- Отдельные SQLite, локальный файловый runtime, Express, Auth и каталог не переносятся.

## Модель версий и проверок

Предлагаемые сущности в `platform`/`platform_private`, не существующие API:

| Сущность | Обязательная связь и неизменяемое содержимое |
|---|---|
| `university_form_templates` | org + catalog institution ID; текущий опубликованный version pointer, архивирование без удаления истории |
| `university_form_template_versions` | template ID, version ID, SHA256/size/MIME/private object key, source reference/date, inspection revision; исходные байты неизменны |
| `university_form_mapping_versions` | exact template version/hash, slots/coordinates, sourceKey/format/required/manual flags, mapping hash; отдельные reviewer/reason/time и draft/approved/rejected |
| `student_document_packages` / items | org/case/application, revision, versioned rules; выбранные `document_version`, `university_form_export`, `student_profile_export` как равноправные типы |
| `student_document_package_reviews` | item/version/hash, parentVersionId, rules hash, reviewer/time/decision; оригинал, перевод и appendix проверяются раздельно |
| `document_export_artifacts` | case + kind/form/package, request/actor, immutable input snapshot/hash, format/mode, renderer/font versions, output hash/size/object key и outcome receipts |

Новая загрузка оригинала снимает актуальность его проверки и связанных переводов/
вложений по exact versionId, даже при одинаковом SHA. Смена parentVersionId или правил
также требует проверки. Новая версия бланка, включая конвертацию DOC→PDF, получает
новый version/hash и отдельное подтверждение mapping; старое не наследуется.
Snapshot включает profile revision/field review references, template/mapping versions,
правила, case/application/catalog IDs и все source version/hash/parent связи.
Личные значения/snapshots доступны только в защищённой области; аудит содержит IDs,
revision/hash/outcome, не содержимое анкеты, оригинальные имена файлов или тексты ошибок.

## Оригиналы, Storage и renderer

- Шаблоны загружаются через отдельную private Storage boundary в том же managed
  Supabase: отдельный bucket `platform-document-templates` и object registry/RLS,
  не student document slot. Базовый предел — 20 MiB для DOCX/PDF; upload/scan/inspection
  обязательны до публикации. Текущий student ingress PDF/JPEG/PNG ≤25 MiB не расширяется.
- Документные версии остаются в `platform-documents`; результаты — в отдельном
  private `platform-document-exports`, согласно [amendment](evo-docs-export-artifacts-contract.md).
  Это сохраняет ограничения загрузки оригиналов. Объект получает новый непрогнозируемый key;
  upsert/overwrite готового файла запрещены. Нет публичного bucket или вечного URL.
- DOCX: сохранить исходную структуру, запретить macros/OLE/ActiveX/signatures,
  неподдерживаемые отношения/архивы; переносить guards размера ZIP/entry/XML,
  количества элементов и распакованного объёма (50 MiB), не только MIME/ClamAV.
- PDF: только пассивный, неподписанный, незашифрованный, неинтерактивный бланк;
  ограничения страниц/объектов/геометрии. Не поддержанный символ, пересечение областей
  или overflow блокируют экспорт; не обрезать текст и не менять написание автоматически.
  Конвертация — отдельный проверяемый исходник, не обход запрета.
- Draft использует только confirmed values и заметную отметку/manifest пропусков.
  Final требует approved mapping, все обязательные данные/части и текущие проверки;
  mapped conflicts/unconfirmed/invalid блокируют final. Для формы required задаёт mapping;
  девять required D2 относятся только к Student Profile, не ко всем бланкам.
  Заполненный бланк не подтверждает готовность к подаче; лимиты ZIP/Storage фиксируются до кода, не наследуются как старые 250 MiB.

## Команды и доступ

Имена ниже — forward interface для реализации/ревью, не доступные сейчас RPC.
Обычные команды: `p_organization_id`, target ID, `p_expected_revision`, `p_request_id`,
`p_reason`; actor берётся из Auth, не из формы. Exact replay возвращает прежний outcome,
другой fingerprint с тем же ID — conflict; stale revision не меняет запись. Ответ: ID/revision/outcome/replayed.

- `staff_university_form_workspace(p_template_id)` и
  `staff_student_document_package(p_student_case_id,p_package_id)` — STABLE JSON:
  `schema_version`, IDs/revision, `workspace_revision`, capabilities, versions/items, checks, exports;
  ни чтение, ни отсутствие профиля не создают данные. DTO fail closed, без fallback.
- `save_university_form_mapping` создаёт mapping revision; `review_university_form_mapping`
  фиксирует approve/reject; `publish_university_form_template` публикует только exact
  clean inspected template + approved mapping. Все требуют live `catalog.import.manage`
  в области этой организации; `catalog.read` нужен для выбора опубликованного бланка.
- `save_student_document_package` меняет состав/правила под `document.manage`;
  `review_student_document_package_item` подтверждает exact item tuple под
  `document.review`. Права проверяются для данного дела и всех связанных объектов.
- POST `/api/v3/student-cases/[studentCaseId]/document-exports`: `kind`, `target_id`,
  `mode`, `expected_revision`, `request_id`; kind=`university_form|student_profile|package`.
  target=mapping version/profile/package ID; expected_revision — workspace digest из read RPC
  по profile/template/mapping/source/review/rules versions. БД сверяет digest; значения/Storage keys из browser запрещены.
  Экспорт требует `profile.read.full` для используемых полей, действующий case scope
  и `document.download` для того же дела **и каждого** исходного/включённого артефакта.
- Серверные `begin_document_export`, `complete_document_export`, `reconcile_document_export`
  доступны только service_role: browser не может записать generated/ready success.
  Каждый вызов повторно связывает authUserId + active membership + org с live S2
  authority. Service key не используется для обходного чтения значений анкеты.
  Organization lock предшествует request/member/case/profile locks; порядок един для RPC.
- Ответ POST: artifact ID/state/hash/size (последние NULL до готовности); download по ID проверяет весь состав и Storage hash,
  отдаёт сохранённые bytes с no-store. Admin preview/Student-private assessments исключены.
  Ошибки — фиксированные `forbidden`, `stale_revision`, `not_ready`, `source_changed`,
  `artifact_pending`, `integrity_failed`, `export_failed`, без личных данных; HTTP403/409/422/503 по категории.

## Публикация результата и восстановление

`pending → stored_unverified → ready`; ошибка → `failed`, неоднозначный I/O → `unknown`.
Begin фиксирует input snapshot и request fingerprint до генерации. Renderer и ZIP
используют только этот snapshot: порядок/имена entries, даты/метаданные, версии шрифтов
и renderer фиксируются; manifest содержит exact IDs/hashes/пропуски, не «latest» ссылки.
Оригиналы входят без изменения байтов; университетские формы включаются по export ID.
Затем private upload → readback SHA/size → повторная проверка всех input revisions,
состояния/доступности источников и live прав → transactional ready + receipt.
Storage и PostgreSQL не считаются одной транзакцией. При смене данных/доступа сохраняется
failed outcome; оставшийся объект не публикуется и попадает в scoped reconciliation.
Unknown/pending запрещают выдачу bytes и повторную генерацию по таймеру. Reconcile
сверяет известный key/hash и исходный snapshot без чтения новых значений: exact совпадение
и текущие права допускают завершение; иначе fixed failure/явное решение оператора.
Повтор ready-запроса возвращает тот же export ID; скачивание не вызывает renderer.
Старые ready exports неизменны и помечены историческими после изменения исходников:
они не доказывают текущую готовность; новое формирование требует новой явной команды.
Аудит различает attempted/generated/stored/failed/unknown, не заявляет доставку человеку.

## Перенос кода, входные данные и приёмка

Источник — standalone `6e7cf741`: `src/shared/{university-forms,package}.ts`, `server/university-{docx,pdf,form-service}.ts`, `server/package-service.ts`.
Перенести `inspect/fillUniversityDocx`, `inspect/fillUniversityPdf`, typed mappings,
правила и manifest; не копировать mutable SQLite service. Проверить лицензии кода/
зависимостей и сохранить NotoSans `assets/fonts/OFL.txt`; шрифты включить в build tracing.
Целевые модули: `src/lib/{university-form-fields,document-package}.ts`,
`src/lib/{platform-university-forms,platform-document-packages}.ts` + actions,
`src/lib/server/{university-form-docx,university-form-pdf,document-export}.ts`;
существующий `src/lib/server/student-profile-template.ts` и D2 confirmed-values boundary
переиспользовать. UI — компоненты форм/пакета в текущем `src/components/v3/profile/`.

До реальной приёмки нужны разрешённые актуальные оригиналы бланков с source/hash,
явная привязка к catalog IDs и human-reviewed mapping, выбранное разрешённое case/file.
Девять presets не доказывают наличие/актуальность оригиналов; USTC DOC→PDF не считается
принимаемым университетом без подтверждения. D5 source-student→canonical-case mapping
не угадывается по имени; импорт, provider calls и retirement этим контрактом не разрешены.
Проверка: synthetic Auth/DB/Storage/browser → форма и ZIP с точными bytes/history,
обычная замена версии/редактирование во время export → понятный stale outcome,
reconcile известного объекта → доказанный hash; визуальный просмотр всех страниц.
Потом отдельные exact-head review/release и разрешённая реальная приёмка; не заявлять PASS заранее.

Официальные основания проверены 2026-09-13: [Storage RLS/service key](https://supabase.com/docs/guides/storage/security/access-control)
и [новые object paths вместо overwrite](https://supabase.com/docs/guides/storage/uploads/standard-uploads).
Это обоснование boundary, не доказательство её реализации.

## Первый срез исполнения: mapping и DOCX

Первый локальный срез `4795e5f6` выполнен в `izzhackt/evo-docs-university-packages`
от c6669ff1, без изменения main; он независимо проверен. Это история первого среза.
Реализованы нейтральный [mapping resolver](../../../src/lib/university-form-fields.ts) и server-only
[DOCX inspect/fill](../../../src/lib/server/university-form-docx.ts) с synthetic tests. Используются имеющиеся
PizZip3.2.0/xmldom0.9.12 и D2 registry; не переносить mutable standalone service.
Confirmed-empty, конфликт, неверное/неподтверждённое значение и ручное поле должны
оставаться различимыми. Согласовать весь mapping до заполнения; bytes не означают ready.
DOCX limits зафиксированы в PLAN_CHANGES. Проверить обычные таблицы, label runs,
merged cells, headers и Unicode; визуально просмотреть все полученные страницы.
Универсальная проверка layout не объявляется существующей по одному roundtrip.
Public export остаётся закрытым до реализации всех live-authority, template/layout,
immutable persistence и begin/complete/reconcile условий основного контракта.
На тот момент PDF, package engine, schema/Storage/UI и реальная приёмка оставались открыты.

`resolveUniversityFormMappings` принимает exact template/mapping IDs+SHA256,
immutable approved/rejected review snapshot и D2 fields + фиксированный `today`.
Canonical mapping hash пересчитывается; mismatch останавливает работу.
Результат `fieldsReady` означает только готовность mapping/полей, не право на export.
`getUniversityFormAssignments` исключает пустые/неразрешённые значения; final
блокируют required missing/empty и любой mapped conflict/unconfirmed/invalid/manual.
`inspectUniversityDocx`/`fillUniversityDocx` не выполняют сеть, Auth или Storage.
Пример исполнения и проверки — [focused tests](../../../tests/university-form-docx.test.mjs).

Локально:26 focused checks, scoped lint/strict TypeScript PASS; root просмотрел
все5 synthetic одностраничных файлов. Китайские глифы визуально НЕ прошли:
DOCX сохранил символы, но fallback LinuxLibertineG в PDF имел пустые outlines.
Извлекаемый PDF-текст не доказывает видимые глифы. Полный font/layout gate остаётся
обязательным; universal Unicode support и готовность публичного final не заявлены.
Точные receipts — в [журнале решений](../../PLAN_CHANGES.md).
API порта сверены с [xmldom 0.9.12 onError](https://github.com/xmldom/xmldom/blob/0.9.12/index.d.ts)
и [Node22 zlib](https://nodejs.org/download/release/v22.23.1/docs/api/zlib.html).

## Второй локальный срез: PDF и фактический CI entrypoint

Реализован server-only [PDF inspect/fill](../../../src/lib/server/university-form-pdf.ts),
без HTTP, SQL, Auth, Storage и провайдеров. `inspectUniversityPdf(Buffer)` возвращает
immutable SHA256/pageSizes/warnings; видимая область — CropBox ∩ MediaBox.
`fillUniversityPdf(Buffer, UniversityFormResolution, {draft})` принимает только
результат существующего resolver, сверяет exact template SHA и геометрию страниц.
Snapshot PDF явно содержит `format: "pdf"`, pageSizes и позиции `pdf-N`:
page (с1), x/y от верхнего левого угла, width/height, optional characterCount.
Каждая координата и characterCount входят в canonical mapping SHA; исходный DOCX
hash format не изменён. Проверяются все области, включая пустые/ручные: пересечение
или выход за страницу блокирует даже draft. Заполняются только confirmed assignments;
`fieldsReady` по-прежнему не означает разрешение публичного final export.

Встроен неизменённый [NotoSans/OFL](../../../assets/fonts/README.md), без host fallback.
Проверяются code points, реальные outlines, shaped glyphs и границы чернил.
Китайский текст/emoji/невидимые неподдерживаемые символы завершаются
`form_pdf_character_unsupported`; позиционированные combining/RTL runs —
`form_pdf_shaping_unsupported`, потому что encoder не применяет эти offsets.
Текст не сокращается и не заменяется; размер8–11pt, переполнение —
`form_pdf_text_overflow`. Подписи/согласия/фото не заполняются. Интерактивные,
подписанные, активные, повёрнутые или нестандартные UserUnit PDF не конвертируются
молча. Исходные content streams сохраняются; одинаковые входы дают одинаковые bytes.

Лимиты:20MiB input/output,100 страниц,30000 indirect objects,500 областей,
1000 code points/value и50000 суммарно; страницы72–3000pt, область≥12pt,
до120 character cells шириной≥5pt. **Это не ограничение времени/RSS парсера**:
pdf-lib сначала загружает структуру. До любого ingress/public export обязателен
shared hard-isolated runtime с deadline/memory boundary и подавлением библиотечных
диагностик, а не heap-cap внутри web process. Asset tracing тоже остаётся интеграционным gate.

`npm run test:university-forms` включает3 D4-модуля в реальный
[CI/UNIT runner](../../../scripts/run-node-test-suite.mjs); классификатор разрешает
только3 exact font assets и требует build. [Synthetic tests](../../../tests/university-form-pdf.test.mjs)
проверяют исходные потоки, immutable binding, отказ при неподтверждённых полях,
геометрию, glyph failures, overflow и воспроизводимость. Локально52 focused checks,
21 manifest/classifier checks, scoped lint/strict TypeScript PASS; validate-only
CI166/UNIT161 файлов не означает прогон полного CI. Все10 страниц5 синтетических
PDF просмотрены: Latin/Cyrillic/Kyrgyz видимы, длинный текст в пределах областей,
draft на обеих страницах, ручные разделы неизменны. Embedded subsets имеют реальные
outlines. Точные receipts — [PLAN_CHANGES](../../PLAN_CHANGES.md).

Публичный export не подключён. DOCX CJK/layout gate **не исправлен** новым PDF-шрифтом.
Изоляция, полная проверка исходных шаблонов/layout, интеграция package engine, immutable history/
Storage/reconciliation, schema/UI и разрешённая реальная приёмка остаются открыты.
API/лицензии: [pdf-lib1.17.1 MIT](https://github.com/Hopding/pdf-lib/blob/v1.17.1/LICENSE.md),
[fontkit1.1.1 MIT](https://github.com/Hopding/fontkit),
[registerFontkit](https://pdf-lib.js.org/docs/api/classes/pdfdocument#registerfontkit),
[LoadOptions](https://pdf-lib.js.org/docs/api/interfaces/loadoptions).

## Третий локальный срез: чистый package engine

Sibling `izzhackt/evo-docs-package-engine` от exact9811b3c; PDF-кандидат не меняется.
`resolveDocumentPackage(snapshot, expectedRevision)` проверяет immutable selection/
rules/reviews/current pointers; `contentReady` не является live authorization.
`buildDocumentPackageZip(resolution, sourceBuffers, {mode})` возвращает ZIP/manifest/
hashes, без I/O, регенерации форм, Auth/SQL/Storage. D2 transient export attempt ещё
не заменяет будущий persisted artifact с ready receipt.

Максимум40 assets +2 metadata entries; document_version≤25MiB,
university_form_export/student_profile_export≤20MiB, источники суммарно≤64MiB,
manifest≤64KiB UTF-8, ZIP≤65MiB. STORE сохраняет каждый оригинал byte-exact,
не распаковывает DOCX/вложенные архивы. Пути только по neutral IDs, фиксированные
даты/права/порядок; без исходных личных имён файлов и значений анкеты.
Exact source/parent document/version/SHA, rules version/hash и review tuple обязательны;
review хранит полный nullable parent tuple, receipt — exact exportId/artifactSha256.
Изменившийся source/parent pointer инвалидирует проверку даже при одинаковом SHA.
Сгенерированный файл связывается с receipt/input SHA, profile/field-review digest,
template и (для формы) mapping/review/catalog IDs; текущий input digest должен совпасть.
Все выбранные файлы и обязательные slots должны пройти проверку для final.
Draft исключает unsafe/stale/unreviewed/unavailable bytes с точными omission codes;
metadata-only draft явно остаётся contentReady=false. Draft-артефакт входит только
в draft ZIP. Mode/order/renderer version входят в input hash.
Проверка — реальные синтетические ZIP/оригиналы, изменённые версии/правила/parent,
неполный draft, точные manifest/bytes/hash и детерминизм; не mock persistence.
Изоляция, Storage/history/reconciliation, live per-asset права, UI и реальная приёмка
остаются обязательными последующими слоями, не объявляются существующими здесь.

Локально реализованы [правила](../../../src/lib/document-package.ts) и
[ZIP builder](../../../src/lib/server/document-package.ts). 22 package +52 renderer
checks PASS,22 CI/classifier checks PASS, scoped lint/strict TypeScript PASS.
`test:document-packages` входит в реальные CI/UNIT entrypoints; validate-only
CI168/UNIT163 — не исполнение полного CI. Проверены byte-exact PDF/вложенный DOCX,
draft omissions, parent/export binding, лимиты и одинаковый ZIP в3 timezone.
На40 сложных records manifest может достичь своего независимого64KiB лимита раньше
лимита количества. Snapshot/receipt provenance, scanner/layout и live authorization
проверяет будущий внешний слой; `available`/`ready` здесь не создают таких доказательств.
Primary API: [PizZip file data](https://open-xml-templating.github.io/pizzip/documentation/api_pizzip/file_data.html)
(входной buffer сохраняется по ссылке — builder копирует его),
[generate](https://open-xml-templating.github.io/pizzip/documentation/api_pizzip/generate.html)
(STORE/platform); существующая зависимость PizZip3.2.0, без новых packages.
Точные scoped receipts — [PLAN_CHANGES](../../PLAN_CHANGES.md).

### PDF inspection and reviewer-defined regions

The PDF resolver snapshot must retain the real native manifest `slots: []` plus
visible `pageSizes`. Existing approved `mapping.mappings` define the1–500 human
reviewed `pdf-N` regions, positions and manual flags; they are not discovered
editable slots. The canonical mapping/review hash remains unchanged. All regions,
including manual or empty fields, must satisfy166/renderer bounds, character-cell
limits and non-overlap before resolution. DOCX still requires inspected slot
matching. This repair is a library integration seam, not full PDF acceptance.
The bounded correction passes75 focused fields/PDF/DOCX checks and lint after
actual RED cases for empty inspected slots and missing geometry refusals; see
`01a09d5144bd72d0982dff1c7d0330f9`. No native/build/browser gate was repeated.

## Saved university-form artifact producer — pre-code amendment, 2026-09-14

База:164 persistence,165 registry,166 trusted ingress и resolver `0e748452`;
это следующий **не реализованный** срез полного DOCX/PDF export, не новый importer,
не ZIP producer и не готовность D4. Ни номер forward migration, ни применение
Storage-конфигурации здесь не разрешаются. Для saved-form producer этот amendment
заменяет ранние `target_id`/`expected_revision` и предположение «output hash только
после ready» выше. Установленный Student Profile contract164 сохраняется.

### Точные DTO и HTTP seam

Все объекты закрытые: неизвестные ключи отвергаются, nullable поля обязательны.
`UUID` — canonical UUID, `Hex` —64 lowercase hex, `ImageId` — `sha256:` + Hex,
`Revision` —40 lowercase hex, `Day` — действительная UTC-дата `YYYY-MM-DD`;
revision/size — положительные safe integers. `DOCX` означает MIME из
[existing artifact contract](../../../src/lib/document-export-artifact-contract.ts),
`PDF` — `application/pdf`. Имена existing types ниже — точные aliases, не новые
неопределённые DTO. В JSON нет `undefined`.

```ts
type FormBinding = {
  application_id: UUID; catalog_institution_id: UUID; catalog_source_revision: string;
  template_id: UUID; template_version_id: UUID; inspection_receipt_id: UUID;
  mapping_id: UUID; mapping_sha256: Hex; review_id: UUID; validation_day: Day;
};
type RendererProof = {
  image_id: ImageId; release_revision: Revision; font_sha256: Hex | null;
};
type ProfileReceipt = DocumentExportReceipt; // exact pre-amendment164 shape
type FormReceipt = Omit<ProfileReceipt, "kind" | "mime_type" | "failure_code"> & {
  kind: "university_form"; mime_type: DOCX | PDF;
  form: FormBinding; generated_input_sha256: Hex; renderer_proof: RendererProof | null;
  failure_code: DocumentExportFailure | "form_not_ready" | null;
};
type ExportReceipt = ProfileReceipt | FormReceipt;
type BoundTemplate = {
  versionId: UUID; sha256: Hex;
  manifest: { format: "docx"; slots: { id: string; editable: boolean }[]; pageSizes: [] }
    | { format: "pdf"; slots: []; pageSizes: { width: number; height: number }[] };
};
type FormMetadata = {
  schema_version: 1; kind: "university_form"; organization_id: UUID; student_case_id: UUID;
  form: FormBinding; template: BoundTemplate;
  mapping: UniversityFormMappingSnapshot; review: UniversityFormMappingReviewSnapshot;
  source_byte_size: number; source_mime_type: DOCX | PDF; manifest_sha256: Hex;
  renderer_version: "evo-university-form-docx-v1" | "evo-university-form-pdf-v1";
  font_sha256: Hex | null;
};
type FormInput = FormMetadata & { mode: "draft" | "final"; frozen_profile: FrozenProfile164 };
type FormPreparation = {
  schema_version: 1; preparation_id: UUID; artifact: FormReceipt; frozen_form: FormInput | null;
};
type FormWorkspace = {
  schema_version: 1; student_case_id: UUID; application_id: UUID; catalog_institution_id: UUID;
  profile: { id: UUID; revision: number } | null; selection: FormBinding | null;
  workspace_revision: Hex | null; can_export: boolean;
  unavailable_reason: "profile_missing" | "mapping_not_current" | null;
};
type ExportWorkspaceV2 = Omit<DocumentExportWorkspace, "schema_version" | "artifacts"> & {
  schema_version: 2; artifacts: ExportReceipt[];
};
type TemplateSource = {
  bucket_id: "platform-document-templates"; object_name: string; mime_type: DOCX | PDF;
  sha256: Hex; byte_size: number; inspection_receipt_id: UUID; manifest_sha256: Hex; expires_at: string;
};
type FormBeginning = {
  artifact: FormReceipt; created: boolean; claim_token: UUID | null; template_source: TemplateSource | null;
};
```

`FrozenProfile164` — ровно JSON, который164 строит из `staff_student_profile_fields`:
case/profile IDs+revision, capability booleans и61 fields с исходными review states;
только confirmed values/source references, все прочие values=NULL, proposals=[].
Проверять его `normalizePlatformStudentProfileFieldsSnapshot`, затем передавать
нормализованные `fields` существующему resolver; не применять9 required D2 к форме.
`mapping`, `review` — aliases [resolver types](../../../src/lib/university-form-fields.ts).
`template` — закрытый BoundTemplate, **не** rich UniversityFormTemplateSnapshot:
SQL копирует настоящий minimal manifest166. DOCX slots содержат только id/editable,
ordered `p-1…p-N` (1–3000), pageSizes=[]; PDF slots=[], pageSizes1–100 в пределах72–3000pt.
Text/context/kind/manualReason в БД отсутствуют: не выдумывать и не добавлять их в165/166.
В isolated child повторная inspection exact bound bytes строит настоящий rich resolver
snapshot; его minimal projection должна совпасть с frozen manifest, иначе отказ.
Только затем child выполняет resolve/fill; rich DOCX text не сохраняется в SQL или receipt.
PDF snapshot сохраняет slots=[]/actual pageSizes, regions/manual/position — только mapping.
Review `versionId` = review row ID, `state="approved"`; IDs/SHA всех трёх DTO обязаны
совпадать с FormBinding и receipt166. Никаких browser values, paths или доказательств.

`FormReceipt` сохраняет все остальные ключи164, но template SHA берётся из exact
version, renderer policy и MIME — из FormMetadata. Все FormBinding поля non-NULL;
source size1–20971520. Для PDF ожидаемый NotoSans SHA —
`b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`;
для DOCX `font_sha256=null`: fill сохраняет font declarations, не доказывает встраивание
PDF-шрифта. `renderer_proof=null` до seal; после seal non-NULL и неизменен, включая
unknown/failed после upload. Output SHA/size также появляются при seal, а не при ready;
`receipt_id`/`ready_at` non-NULL только ready, `can_download` только ready + live access.
Старый ProfileReceipt не получает новых ключей или выдуманной execution provenance.

Существующий POST `/api/v3/student-cases/[studentCaseId]/document-exports` принимает
ровно прежний profile body `{mode, expected_workspace_revision, request_id}` либо
form body `{kind:"university_form", application_id, mapping_id, mode,
expected_workspace_revision, request_id}`. Org, catalog, template и actor выводит БД.
Существующие same-origin/session/request UUID guards сохраняются. Ответ `{artifact}`
использует ExportReceipt; ready200, pending/unknown202, fixed failures по существующим
HTTP категориям (`form_not_ready`409; native unavailable/timeout → `export_failed`503).
GET без query либо с единственным `schema_version=1` сохраняет exact164 schema1,
profile-only history и `staff_document_export_workspace` (SQL фильтрует kind=student_profile).
Новый history consumer явно запрашивает `?schema_version=2`: только этот opt-in вызывает
`staff_document_export_workspace_v2` и возвращает ExportWorkspaceV2. Остальные keys
по-прежнему относятся к profile command. Unknown/повторные version query и лишние query
keys →400; v2 consumer не принимает schema1 и не делает скрытый fallback. Migration
устанавливает новый read RPC до нового app, но не меняет v1 shape даже после создания
form rows: rollback старого app сохраняет его profile history. Legacy prepare остаётся v1.
Download/reconcile URL и их request bodies не меняются. Private capsule, claim,
TemplateSource, Storage key и значения не пересылаются browser или audit.

### SQL/RPC и immutable binding

Добавить только три session RPC, все `RETURNS JSONB`, без service-role grant:

| RPC | Аргументы SQL (все обязательны) | Результат |
|---|---|---|
| `staff_university_form_export_workspace` | `p_student_case_id UUID, p_application_id UUID, p_mapping_id UUID` | FormWorkspace; STABLE, не создаёт данные |
| `prepare_university_form_export` | те же3 UUID, `p_mode TEXT, p_expected_workspace_revision TEXT, p_request_id UUID` | FormPreparation; одна короткая transaction |
| `staff_document_export_workspace_v2` | `p_student_case_id UUID` | ExportWorkspaceV2; STABLE, обе artifact kinds с live scope filtering; не создаёт данные |

Application обязан существовать в `platform.university_applications` с exact org/case;
его `catalog_institution_id` обязан совпасть с template. Cross-scope/неизвестные IDs
дают forbidden, не диагностический lookup. Для доступного same-scope, но не текущего
mapping: selection/workspace_revision=NULL, can_export=false, reason=mapping_not_current;
иначе при отсутствующем profile: selection=FormBinding, digest=NULL, reason=profile_missing.
При наличии обоих digest non-NULL, reason=NULL, can_export=true означает допустимость
команды, **не** final field readiness. Приоритет причины — mapping, затем profile.
Prepare требует exact current publication165; ни draft mapping, ни старый approval
не годятся даже для draft export. Exact request replay сохраняет outcome; capsule
возвращается только до begin и при текущих правах/inputs. После begin всегда NULL.

Расширить existing164 RPC, не вводить параллельную lifecycle:

| RPC | Изменение относительно [точных164 args/results](../../../src/lib/document-export-artifact-contract.ts) |
|---|---|
| `begin_document_export` | Args unchanged; profile result unchanged; form → FormBeginning, TemplateSource только при `created=true`, с expiry existing10-minute claim |
| `seal_document_export_output` | Заменить4-arg function одной5-arg: прежние `p_artifact_id UUID, p_claim_token UUID, p_output_sha256 TEXT, p_output_bytes INTEGER` + `p_renderer_proof JSONB DEFAULT NULL`; вернуть `{artifact:ExportReceipt, storage:DocumentExportStorageTarget|null}` с MIME по kind |
| `complete_document_export`, `inspect_document_export_reconciliation`, `reconcile_document_export` | Args unchanged, closed failure union дополнен только `form_not_ready`; artifact result union; Storage result MIME по kind |
| `grant_document_export_download`, `consume_document_export_download`, `complete_document_export_download` | Args и grant/result keys unchanged; nested artifact union/MIME по kind, тот же exact readback |

Не оставлять4/5-arg overload одновременно. Forward migration меняет signature,
явно REVOKE/GRANT и [PostgREST schema-cache reload](https://docs.postgrest.org/en/stable/references/schema_cache.html);
4-arg profile callers [пропускают default argument](https://docs.postgrest.org/en/stable/references/api/functions.html#calling-with-get)
и получают NULL. `p_renderer_proof` non-NULL запрещён для profile, обязателен для form;
его host writer берёт identity только из `readUniversityTemplateRuntimeIdentity()`.
`image_id` = проверенный Docker engine-native `.Image`, **не** config digest, revision
или hash от revision. Actual execution proof нельзя получить из session при prepare:
она записывается ровно один раз trusted seal вместе с output SHA/size/key. Exact seal
replay сравнивает и proof; unknown upload/reconcile не меняет её на identity нового app.

Одна forward migration расширяет четыре таблицы164;165/166 остаются неизменными:

- `document_export_artifacts`: добавить колонки FormBinding, `generated_input_sha256`,
  `renderer_proof JSONB`. Binding/generated hash все NULL для profile и все non-NULL
  для form; profile ID/revision остаются NOT NULL. Scoped FKs связывают org/case/application,
  catalog/template/version/mapping/review/inspection; добавить только необходимые
  composite UNIQUE targets, не ослаблять existing FKs. Exact version/hash tuple дополнительно
  проверяет writer, а не только независимое существование IDs. Immutable trigger защищает
  новые bindings; renderer_proof разрешён только в единственном seal переходе, дальше frozen.
- `document_export_input_snapshots`: добавить `frozen_form JSONB NULL` = FormMetadata;
  existing `frozen_profile` не дублировать. В transaction составить FormInput из двух
  колонок + artifact.mode; оба immutable. Ни нового service values reader, ни direct grants.
- Пер-kind CHECK: existing profile constants/5MiB/.docx без изменений; form output
  1–20971520 bytes, DOCX/.docx либо PDF/.pdf и соответствующая fixed renderer policy.
  `renderer_proof`/output tuple all-NULL до seal и all-present после seal для form;
  PDF font proof равен frozen SHA, DOCX font NULL. Key выдаёт seal create-only.
- Events/grants остаются164: IDs/hash/outcome без fields/manifest/source path; form audit
  resource связывается с artifact и application, не маскируется под profile generation.
  Ready/failed history не переписывается. Package kind/table/schema в этот срез не добавлять.

### Два hash-domain и проверка актуальности

`bw1_input_sha256` = SHA256 UTF-8 PostgreSQL `jsonb::text`. Existing profile
`input_snapshot_sha256=bw1(frozen_profile)` остаётся byte-for-byte прежним.
Для form `input_snapshot_sha256=bw1(FormInput)`; actual runtime image в него не входит:
он связан с этим input через immutable artifact/seal proof. Workspace digest = bw1
объекта с exact keys `{schema_version:1, kind:"university_form", organization_id,
student_case_id, form:FormBinding, profile_id, profile_revision, field_reviews_sha256,
template_sha256, manifest_sha256, renderer_version, font_sha256}`. `validation_day`
берётся из DB UTC date, не браузера. Request digest = bw1 закрытого объекта
`{kind:"university_form", organization_id, student_case_id, application_id, mapping_id,
mode, workspace_revision, auth_user_id, membership_id}`; request UUID unique как в164.

`generated_input_sha256` — **другой digest**, exact результат existing
[`computePackageGeneratedInputHash`](../../../src/lib/document-package.ts) над
`{kind:"university_form", organizationId, studentCaseId, profileId, profileRevision,
fieldReviewsSha256, templateSha256, applicationId, catalogInstitutionId,
templateVersionId, mappingVersionId, mappingSha256, mappingReviewVersionId}`.
Это sorted-key **compact** canonical JSON, не `jsonb::text`: SQL writer должен
воспроизвести именно эту ASCII UUID/hash/integer projection и доказать TS/SQL parity
golden vectors, а не принимать готовый browser hash. Не менять mapping hash или review
tuple. Старые profile hashes не переименовывать; будущий package adapter отдельно
вычислит projection из их immutable metadata без backfill. Package current eligibility
дополнительно проверяет полную form binding/policy/day: этот узкий package hash сам
по себе не проверяет публикацию, catalog source revision, renderer или validation day.

### Live authority, порядок операций и gates

Session prepare/read и каждый service transition проверяют auth + active membership
того же org, `profile.read.full`/`document.download` для case и `document.download`
для **каждой** confirmed field source version, плюс `catalog.read` на organization.
Обычный экспорт не требует `catalog.import.manage`;166 manager source route не
ослабляется: TemplateSource выдаёт только case-bound begin. History фильтрует form
rows без live catalog access. Service key не заменяет actor и не читает frozen values;
это важно, поскольку [service key обходит Storage RLS](https://supabase.com/docs/guides/storage/security/access-control).

Во всех изменяемых RPC: organization FOR UPDATE → request advisory locks (UUID
по порядку) → memberships по UUID → case → profile → application → catalog FOR SHARE
→ template FOR UPDATE → immutable version/mapping/review/receipt → source slots и
versions по UUID FOR SHARE → artifact FOR UPDATE. Сохраняются organization-first164/165/166
и catalog-before-template. Никаких DB locks во время native/Storage I/O. Publication,
catalog binding/source revision, profile/reviews, source health и validation day
проверяются prepare/begin/seal/complete/reconcile до ready. Смена → `source_changed`,
revocation → `access_changed`, unsafe/missing source → `source_unavailable`, не rerender.
Новый unrelated draft сам по себе не меняет текущую опубликованную tuple. Старый ready
можно download при текущих per-source/case/catalog правах и source health; смена profile,
publication или дня лишь делает его historical, не заменяет bytes и не доказывает
актуальный final/пригодность для нового package.

Один host flow: session frozen input → begin → exact private template GET SHA/size/MIME
и binding к настоящему receipt166 → hard-isolated reinspection/resolve/fill тех же bytes
со сверкой minimal manifest → seal → create-only Storage → exact output GET SHA/size
→ live complete/ready receipt.
Resolver и fill исполняются в одном bounded child: WeakSet-branded resolution нельзя
сериализовать как якобы trusted JSON. PDF сохраняет slots=[] и проверяет approved human
regions против actual pageSizes; DOCX проверяет actual inspected slots. Final требует
`fieldsReady`; draft включает только confirmed assignments с draft notice/omissions.
Timeout/missing native не разрешает in-process fallback или uninspected output.
Lease на память/concurrency удерживается до actual settlement/kill, даже если HTTP
abort уже вернулся. Ambiguous upload → unknown, explicit same-key reconciliation;
никакой повторной генерации/download-as-render, implicit loop или overwrite.

Формы требуют private `platform-document-exports`20MiB + DOCX/PDF, не текущие5MiB/DOCX.
Student uploads25MiB и template bucket20MiB не меняются. Для >6MiB переиспользовать
existing resumable helper: [6MiB TUS chunks, direct Storage hostname, один upload URL](https://supabase.com/docs/guides/storage/uploads/resumable-uploads),
без upsert; неизвестный commit выясняется exact readback, не новым upload URL.
ZIP остаётся следующим полным срезом:40 items, original25MiB/generated20MiB,
source aggregate64MiB, manifest64KiB, ZIP65MiB. Текущий global50MiB не доказывает65MiB:
нужны разрешённый read-only managed global/bucket/tier capacity readback и затем
явно разрешённая конфигурация; [bucket не может превышать global limit](https://supabase.com/docs/guides/storage/uploads/file-limits).
Если доступная capacity недостаточна — blocker, не сокращение продукта/платный upgrade.

### Ownership и стоп до реализации/активации

| Срез | Минимальные файлы/ответственность |
|---|---|
| SQL author, номер выделяет root | одна forward migration; `supabase/tests/platform_document_export_artifacts.sql` + новый form fixture и existing local runner; helpers/locks/closed DTOs/TS-SQL hash vectors |
| Host/API author | `src/lib/document-export-artifact-contract.ts`, `src/lib/document-export-artifacts.ts`, `src/lib/server/document-export-artifact-route-handlers.ts`; новый `src/lib/server/university-form-export.ts` для form-only orchestration; scoped tests |
| Native author | existing university-template runtime/build/tracing + server adapter; reviewed fill protocol для обеих форм, assets/font identity, hard bounds и actual Linux evidence |
| UI/Storage/integration author | existing document-export client/history, profile Documents controls; export bucket configuration+local config; один existing foundation acceptance flow после exact-diff review |

**Открытое техническое решение до кода native/host:** утвердить с native author точный
fill protocol/output framing и measured CPU/RSS/wall/buffer envelope для full20MiB
DOCX/PDF. Inspection128KiB stdout/15s не является контрактом fill и не наследуется
молча. Остальные DTO/RPC выше фиксированы; решение дописывается здесь до его реализации.
До активации нужны actual isolated fill обоих форматов, visible glyph/layout proof,
SQL regressions164+form replay/stale/revocation/scope/seal invariants и одна реальная
Auth/Storage/browser проверка create→stored history→cold download/reconcile exact bytes
с cleanup. Synthetic stubs, successful source ingress и CI не заменяют эти gates;
полные D4/ZIP, D5 и D6 остаются открытыми.
