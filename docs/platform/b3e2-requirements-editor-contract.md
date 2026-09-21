# B3e-2 / 226 — редактор требований программы

До реализации. Source `2b23285d5127b2e8d633c733bf102c25b093baa6`, #982 merged;
v2 readers действуют, но full backend ещё отсутствует. Основание — принятый
[полный B3e](b3e-full-requirements-and-mapping-plan.md) и [v2 wire](b3e1-requirements-v2-read-contract.md).
Root резервирует226 после A225. Работа с исходниками разрешена; общей DB/Auth/UI
пока владеет очередь A225 → root32. Применение226 и QA записи требуют точного
reviewed effects packet и нового root window, production сюда не входит.

## Результат и границы

Сотрудник с scoped `document.manage` сохраняет полный непустой список документов
для существующей214 preparation одним атомарным действием. Каждый пункт имеет
явный материал: существующий документ этого дела либо новый пустой custom slot.
Web/iPhone читают одну актуальную неизменяемую редакцию через уже внедрённый v2.
Выбор программы по-прежнему сразу открывает подготовку.

Нет изменения214 binding/publication/intake/deadline, автоматического одобрения,
нового upload/submit/package процесса, глобального редактора каталога или
массового adoption. Manual application без214 остаётся в прежнем flow. Старые
113 links,137 details/exceptions,179 bound manifest, файлы и проверки сохраняются.

## Данные, источники и стабильная идентичность

Расширить две private append-only таблицы218, без UPDATE/backfill старых строк.
Согласованные пары origin/state: `evo_starter/needs_confirmation` и
`staff_confirmed/confirmed`. Сохранить FORCE RLS, ACL, immutable/truncate guards
и tenant-safe FK. Revision получает nullable `previous_revision_id`,
`change_reason`, private `source_snapshot`; item — nullable `predecessor_item_id`,
`material_snapshot`, `provenance`, `deadline`, `definition_impact`. Для новой full
редакции закрытый writer/reader требуют полный provenance/snapshot. Predecessor
принадлежит тому же org/case/application; последовательная revisionVersion
назначается сервером. Historical private read по exact revision ID допустим,
новую history UI здесь не вводить.

Ключ нового пункта `r.<canonical lowercase nonzero UUID>`, при изменении текста,
порядка или материала сохраняется. Старые ключи218 сохраняются при переносе.
Новый произвольный пункт не может присвоить себе старый typed ключ. Position —
порядок массива1..N. compatibilityKey назначает сервер: typed starter только
при доказанном неизменённом typed переносе, остальные — отдельный staff key.
Совпадение label/MIME/approved никогда не является доказательством совместимости.

Mapping snapshot хранит identity и effective/raw metadata слота/его источника,
но не slot.version, status, current file, scan или review. Последующая загрузка
или проверка файла сама по себе не нарушает mapping. Удалённый slot, исчезнувшая
113 связь или изменённая identity дают association failure с masking file/review
как в v2; обход через старые Docs данные запрещён. Existing metadata не править
ради нового program wording. `definitionImpact=changed` наследуется; изменение
definition/material, новое legacy adoption или reuse прежнего reviewed материала
показывает необходимость проверить применимость. Перестановка одна её не меняет.
Это не отдельный approval, существующие reviews остаются version-scoped.

Один source inventory включает одновременно, без скрытого объединения:

- все items предыдущей редакции (`prior:<item UUID>`);
- requirements точного bound179 manifest, в том числе retired-but-bound
  (`country:<requirement UUID>`), с manifest ID/version;
- каждый113 link target application (`link:<slot UUID>`), включая removed slot;
- каждый parsed137 documentSlotId (`application:<slot UUID>`), с application
  version и признаком существующего exception. Узкие поля137:
  documentsApplicability/documentsSource/documentsCheckedOn/documentSlotIds/
  documentExceptionSlotIds/documentsExceptionReason/documentsExceptionEvidence.

Сведения разных origins одного слота остаются отдельными решениями. У legacy
document_requirements нет required:boolean; slot.status=required — workflow.
Requiredness источника трёхзначна: известное true/false либо null (не определена
для113/country). Каждый источник явно included в конкретный requirementKey либо
excluded с причиной. Понижение прежнего required→optional тоже требует причины.
137 selected slots при documentsApplicability=required должны оставаться в
составе full revision, включая exceptions; reason226 не снимает существующий137
gate. Конфликт требует отдельной штатной137 команды с её application.manage,
после чего редактор перечитывается. Writer226 никогда её не вызывает.

## RPC и замороженная форма намерения

Новые public `STABLE SECURITY DEFINER SET search_path=''`
`staff_application_requirements_editor_v1(p_student_case_id,p_application_id)`
и command `staff_save_application_requirements_v1(p_student_case_id,
p_application_id,p_request_id,p_payload JSONB)`. Обычная authenticated сессия;
actor/org исключительно из current authority. Editor read требует scoped
document.read.full; canSave отдельно от document.manage и lifecycle. Preview
запрещён; application.manage/case.read.full не подменяют document permission.
REVOKE ALL новых функций от PUBLIC/anon/authenticated/service_role/
supabase_auth_admin; GRANT только public wrappers для authenticated.

Editor context строится одним STABLE snapshot: target/binding214, application и
admissions versions (decimal strings), текущий v2, полный source inventory,
same-case selectable candidates, canSave/lifecycle reason, server contextHash.
Candidate: slot ID/version, intent/requirement/checklist identity, label/group/
instructions, nullable currentVersion ID/No, filename, review, technical state
и113 links. Removed slots видны как sources, но не selectable. Нет Storage keys,
download URLs, полного profile/admissions JSON, JWT или session fields.
Context hash — freshness, не authorization; покрывает весь inventory/candidates,
binding и versions, а не только выбранные строки. Fail явно при превышении
лимитов, никогда не усекать sources/candidates незаметно.

`p_payload` имеет ровно ключи:

```
expectedContextHash, expectedApplicationVersion, expectedRevisionId,
expectedRevisionVersion, changeReason, items, sourceDecisions
```

previous revision ID/version — либо оба null, либо полная пара. Каждый item:

```
requirementKey, required, label, groupLabel, instructions, deadline,
material, provenance
```

material — строгий union:

```
{ kind: "existing", documentSlotId, expectedSlotVersion,
  expectedCurrentVersionId, expectedCurrentVersionNo }
{ kind: "new", label, groupLabel }
```

provenance — `{kind,sourceKey,basis}`; kind из typed_starter/country_manifest/
application_details/staff_entry. Первые три требуют существующий подходящий
sourceKey и точный материал; staff_entry имеет null sourceKey и предметное basis.
Source IDs/versions сервер разрешает сам, caller не задаёт готовые snapshots.
Source decision — ровно `{sourceKey,disposition,requirementKey,reason}`:
included требует существующий key, excluded — null key и непустую reason;
required→optional требует непустую reason. Для включения без понижения reason
может быть null. На каждый server source ровно одно решение, extra/duplicate
source keys отклоняются. Multiple origins могут указывать на один item.

Лимиты:1–100 items, до1000 candidates и2000 source facts, payload≤1MiB, basis/
reason/changeReason≤2000 Unicode scalars, sourceKey≤200ASCII. Text/deadline/UUID/
BIGINT rules точно v2; current file ID/No nullable pair. Материальные сроки не
меняют intake. Same-slot duplicate внутри revision запрещён. Unknown keys,
malformed deadline, empty full и unrecognized enum отклоняются сервером/codec.
Сохранение требует непустой changeReason; для первого подтверждения подходит
явное описание основания принятия, а не фиктивный университетский факт.

Immutable receipt: protocolVersion1, requestId, studentCaseId, applicationId,
revisionId, revisionVersion, previousRevisionId, savedAt, ordered items из
requirementItemId/requirementKey/documentSlotId/position. Только результат этой
команды; никакого динамического file/review. Readback — отдельный v2 read.

## Транзакция и совместимость

Request lock → current actor/require_case_operator → case → application → все
relevant case slots по UUID → links в стабильном порядке. После locks повторить
authority, contextHash, application/previous revision и selected slot/current
file guards. Block direct slot/link/inventory concurrent changes совместимыми
Docs locks; повторно вычисленный полный context не заменяет нужные row locks.
Новая запись только active case + portal activation + application preparation
+ binding214. Authorized exact replay выполняется до lifecycle/stale проверок.

Полное нормализованное intent сравнивать через JSONB equality, включая ordered
items/decisions/reasons/tokens. Existing replay_audit `@>` недостаточен для
порядка массива. Same request + другой payload конфликтует; same exact intent
возвращает исторический receipt, без новой revision/slot/link/audit.

Одна транзакция создаёт revision/items/private provenance, только недостающие113
links, новые пустые custom slots и один command audit receipt. Для link insert
соблюдать exact transaction-local114 context и bump slot.version ровно один раз;
существующая связь не bump. Не создавать binary/document_version/review/task/
notification. Любой отказ откатывает всё; старые113 links не удаляются.

Private v2 view становится независимым от starter-only v1 validator, читает и
starter, и full с прежним exact wire224. Public v1 current read на full явно
`application_requirements_client_update_required`, не предыдущий starter.
Initializer218 сохраняет исторический exact replay до latest/lifecycle checks;
новый init intent на full явно ineligible, без нового starter/расширения receipt.
V1 pending storage/receipt codecs не менять. Это не installed-iPhone upgrade или
production enablement; порядок schema/runtime и policy старых приложений — root.

Ошибки нового writer: invalid request, forbidden, request conflict, stale
context, ineligible lifecycle, legacy configuration conflict, editor limit,
unavailable/unknown outcome. Transport/неизвестный error не выдавать за отказ
без записи. Wire error messages должны быть закрыты и сопоставлены явно в action;
выходные SQL details/персональные данные в UI не выводить.

## UX / Impeccable Operate

Существующие EVO/Атлас, Golos, цвета, layout студентов и navigation сохраняются.
В preparation появляется «Настроить список документов» по document.manage,
независимо от application.manage. В editor видны программа/набор/редакция, затем
компактные пункты с title, required, instructions и раскрываемыми деталями срока.
На каждом пункте явный выбор существующего материала либо нового пустого.
Никакого автоматического первого кандидата/текстового совпадения. Материал
показывает файл/версию/проверку/использование, при этом review не означает пакет.

Отдельный обзор всех прежних sources с include/exclude и обязательной причиной
там, где она требуется. До сохранения компактный diff состава/required/text/
mapping; один primary «Сохранить список». После receipt читать новую редакцию;
не писать «Пакет готов». Stale сохраняет ввод и показывает различия при refresh,
не сливает изменённую форму молча. Неизвестный исход сохраняет весь неизменяемый
payload+requestUUID до отправки, повторяет ровно его, не генерирует новый UUID.
Отдельный storage namespace editor; fail-closed при недоступном сохранении
pending. Owner scope org/member/case/application, защита от другой вкладки и
переключения account. После reload unknown intent восстанавливается; выход из
изменённой формы предупреждает, ошибки привязаны к полю, focus возвращается.

Desktop компактный, mobile одноколоночный без широкой таблицы. Existing fonts,
tokens и shared components; no new dependencies. Craft-floor перед UI edits,
context/detector повторно не запускать. Максимум две batched visual rounds после
отдельного разрешения runtime window; старые224 captures не новый editor proof.

## Реализация и приёмка

1. Independent exact precode review до implementation. B SQL owner226; B codec/
   actions owner отдельные files; B integrator editor/доки. Чужой WIP не трогать.
2. Scoped SQL parse, TS codec/pending tests (order, malformed/deadline/stale/
   conflict), typecheck/lint. Pure fixtures только protocol evidence.
3. Подготовить reviewed apply/QA packet: exact SQL/source/hash, root latest
   ledger, single immutable apply, actor/rows/effects, rollback limits и retained
   intent. Ни production, ни широкого финального E2E.
4. В выделенном local окне ordinary scoped staff save/replay/conflict/stale/
   foreign, legacy adoption и один material в двух programs; negatives и
   save-vs-slot/second-staff concurrency с нулём частичных эффектов. Не менять
   роли/создавать факты без отдельного разрешения. Missing combinations явно.
5. Actual staff editor/save/reload + Student v2 parity web/native по доступности;
   before/after complements, old rows/receipts/137/179/files/reviews неизменны.
   Native decode/build не UI, Admin не scoped non-admin acceptance. Затем
   independent exact-head review, short CI, root merge/release coordination.

Официальные основания: [PostgreSQL locks](https://www.postgresql.org/docs/current/explicit-locking.html)
— согласованный порядок блокировок и удержание до конца transaction;
[CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html)
и [Supabase functions](https://supabase.com/docs/guides/database/functions) —
узкие EXECUTE grants и явно ограниченный search_path для SECURITY DEFINER.
Проверены21.09.2026; это архитектурные основания, не runtime evidence.
