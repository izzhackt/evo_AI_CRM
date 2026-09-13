# D4 — университетские формы и пакеты документов

Дата: 2026-09-13. Контракт для исполнителей после D2, не реализация/приёмка; номера миграций выделяет root.
База: D2/PR752 merged `fd5b6a08` = reviewed tree `daf5b5ac`; fast PASS, итоговый выпуск ещё не подтверждён.
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
- Документные версии и результаты остаются в `platform-documents` с явным типом
  registry object и отдельными проверками. Объект получает новый непрогнозируемый key;
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
