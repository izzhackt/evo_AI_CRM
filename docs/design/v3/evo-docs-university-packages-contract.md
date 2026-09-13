# D4 — университетские формы и пакеты документов

Дата: 2026-09-13. Контракт D4, не готовность всего блока; номера миграций выделяет root.
На отдельной ветке локально реализованы mapping/DOCX/PDF-модули ниже; формы, пакеты и их
production/клиентская приёмка пока не готовы.
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
Изоляция, полная проверка исходных шаблонов/layout, package engine, immutable history/
Storage/reconciliation, schema/UI и разрешённая реальная приёмка остаются открыты.
API/лицензии: [pdf-lib1.17.1 MIT](https://github.com/Hopding/pdf-lib/blob/v1.17.1/LICENSE.md),
[fontkit1.1.1 MIT](https://github.com/Hopding/fontkit),
[registerFontkit](https://pdf-lib.js.org/docs/api/classes/pdfdocument#registerfontkit),
[LoadOptions](https://pdf-lib.js.org/docs/api/interfaces/loadoptions).
