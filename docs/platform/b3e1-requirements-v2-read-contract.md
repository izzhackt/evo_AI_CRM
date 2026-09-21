# B3e-1 / 224 — чтение требований v2

До реализации, source `ad46744c1a3fcc80eda0e78168887b28de3a3fc8` (#979).
Основание: [B3e](b3e-full-requirements-and-mapping-plan.md). Root выделил224
только этому read-срезу; это не разрешение на применение SQL или QA/Auth записи.

## Предел среза

Дать текущим CRM/web/iPhone один расширяемый строгий reader, сохранив реальное
содержимое218. Подтвердить чтение существующего starter через v2. Полные редакции,
staff editor/save, mapping и записи — B3e-2, здесь их нет. Для будущих форм
проверяется только decoding/presentation contract, не рабочий full backend.

224 добавляет два public RPC и один закрытый private преобразователь JSON.
Новых таблиц, columns, writes, audit, locks, init и repair нет. Все существующие
функции/ACL218, commands, receipt decoders и pending intents остаются прежними.
Публичные RPC с существующими case/application UUID аргументами:

- `platform.student_application_requirements_v2(p_student_case_id, p_application_id)`;
- `platform.staff_application_requirements_v2(p_student_case_id, p_application_id)`.

Оба `STABLE SECURITY DEFINER SET search_path=''`: вызывают соответствующий
existing v1 wrapper с его обычной Auth/ownership/scoped authority, затем private
проекцию. Не принимать organization/actor от клиента и не обращаться service_role.
Проекция строит только перечисленные ниже ключи, сохраняет порядок items,
проверяет исходную форму и отказывает invariant error на NULL/неожиданные поля.
Не заменять malformed data пустым списком. Не использовать spread неизвестного JSON.

REVOKE ALL новых функций для PUBLIC/anon/authenticated/service_role/supabase_auth_admin;
GRANT EXECUTE только public v2 wrappers роли authenticated. Private helper недоступен
напрямую. Штатные anonymous/foreign-case отказы218 сохраняются.

## Точный wire

Верхние ключи — ровно:

`protocolVersion, studentCaseId, applicationId, state, revisionId, revisionVersion,
origin, configurationState, initializedAt, configurationReasons, items`.

- `protocolVersion`: JSON number2, не строка.
- `studentCaseId`, `applicationId`: canonical lowercase nonzero UUID, совпадают
  с параметрами запроса.
- `state`: `uninitialized | initialized | needs_configuration`.
- `revisionId`, `revisionVersion`, `origin`, `configurationState`, `initializedAt`
  либо все null, либо полная metadata-группа. Version — decimal string
  от1 до9223372036854775807; initializedAt — время создания данной редакции.
- Допустимые пары origin/configurationState:
  `evo_starter / needs_confirmation`, `staff_confirmed / confirmed`.
  Подтверждение состава не означает одобрение файлов.
- `configurationReasons`: прежний закрытый enum218 без дублей.
- Без редакции: items пусты; uninitialized требует пустых reasons,
  needs_configuration — непустых. С редакцией: список непустой;
  initialized/needs_configuration и reasons согласованы с причинами нарушения
  material associations, как в текущем218.

Каждый item — ровно прежние поля218 плюс три поля:

`requirementItemId, requirementKey, documentSlotId, position, required, label,
groupLabel, instructions, compatibilityKey, slotStatus, currentVersionId,
currentVersionNo, reviewDecision, reviewReason, reviewedAt, technicalAvailability,
unavailableReasons, deadline, reviewScope, definitionImpact`.

- ID: canonical UUID. Уникальны itemID, requirementKey и slotID внутри редакции;
  position соответствует порядку1..N, без пропусков и повторов.
- requirementKey/compatibilityKey:1–100 Unicode scalar values,
  `^[a-z][a-z0-9_.-]*$`. Для full equality не требуется. Серверное подтверждение
  совместимости остаётся B3e-2, ключ сам по себе не даёт права переиспользовать файл.
- required — JSON Boolean. Label/group/instructions — непустые после trim;
  максимумы500/200/4000 соответственно, в Unicode scalar values/code points,
  согласованные с PostgreSQL character length. JS UTF-16/Swift grapheme count
  нельзя незаметно использовать вместо этого ограничения.
- Остальные enum, paired nullable version/review fields, reasons и structural
  masking — прежние инварианты218. Missing/removed slot, broken application link
  или identity metadata conflict не раскрывают file/review через другую проекцию.
  Upload/currentVersion/review не превращаются в нарушение mapping.
- `reviewScope`: ровно `document_version`. Decision/reason относятся к
  currentVersionId, не к полному требованию или комплекту. Не выдавать новый
  requirement approval. Null/approved decision не несут reason; reviewedAt
  присутствует тогда и только тогда, когда есть decision.
- `definitionImpact`: `null | changed`. Null не утверждает, что определение
  неизменно или прошлое одобрение применимо. Changed в будущем выводится только
  из сохранённого provenance редакций; не из времени upload или UI сравнения.

`deadline` либо null, либо exact object:

`{date, time, timezone, sourceUrl, verifiedOn}`.

Date/verifiedOn — реальные календарные YYYY-MM-DD. Time — null либо HH:mm;
если time задан, timezone обязателен. Общий v2 predicate: строка1–100 ASCII
символов без whitespace, ровно `UTC` / `GMT` либо named identifier по
`^[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)+$`; префиксы `posix/` и `right/` запрещены
без учёта регистра. Named identifier дополнительно должен распознаваться runtime:
TS — успешным `Intl.DateTimeFormat` с этим timeZone, Swift — ненулевым
`TimeZone(identifier:)`. Numeric offsets, неизвестные names и отдельные
аббревиатуры вроде `CST` не принимаются. Это новая общая v2 проверка, а не
наследование неодинаковых catalog decoders; общий codec corpus включает
`UTC`, `GMT`, `Asia/Shanghai`, `Asia/Dubai`, `Europe/Prague`, date-only и invalid
prefix/name/offset случаи в обеих реализациях. Date-only не получает полночь/смещение.
Timezone при date-only может быть null или проходить тот же predicate.
SourceUrl — null либо display-only HTTPS URL по одному v2 predicate в TS/Swift:
1–1000 Unicode scalar values, точный префикс `https://`, без Unicode White_Space
плюс U+FEFF, C0/DEL, backslash и `#`. Та же явная whitespace-группа используется
для trim v2 текстов, чтобы JS/Swift одинаково оценивали U+0085 и BOM;
v1 validators остаются прежними. Raw authority до первого `/` или `?` после префикса
должен целиком соответствовать ASCII DNS regex
`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`
без учёта регистра. Запрещены suffix `.localhost`, `.local`, `.internal`, `.test`,
`.invalid`, `.example`; raw authority исключает credentials, IP literals,
encoded authority и любой explicit port, в том числе `:443`.
В raw query, разделённом по `&`, key до первого `=` не содержит `%` и после
замены `+` на пробел не совпадает с `token|secret|password|auth|api.?key`
без учёта регистра. Runtime URL parser также должен принять строку как HTTPS
без user/password. Это syntactic display-link policy без server fetch или DNS
проверки; существующий catalog-v1 helper не меняется. Общий corpus включает
positive Unicode path/uppercase DNS и negative ports/credentials/private suffix/
encoded query key/secret query/scalar length случаи.
Null допускает непубличное основание, сохраняемое будущим staff-save в private
provenance. Present deadline требует
verifiedOn; это дата проверки, не дата наступления срока. V2 не содержит private
source URLs, registry payload, Storage keys, reviewer identity или Auth data.

Starter branch сохраняет все строгие два-item правила v1: ключи Фото/Паспорт,
порядок, required=true, compatibilityKey=key. Reserved full branch допускает
непустой произвольный состав/optional пункты в пределах правил выше.
Полнота metadata-пары, версии, корреляция, отсутствие неожиданных ключей,
противоречивые file/review/malware/integrity состояния проверяются одинаково
в TypeScript и Swift. Не ослаблять v1 receipt под видом reuse этих валидаторов.

## Что действительно выдаёт224

Тонкая проекция текущего218 v1 сохраняет все существующие значения и добавляет:
`protocolVersion:2`; у каждого item `deadline:null`,
`reviewScope:document_version`, `definitionImpact:null`.
Срок не выводится из slot deadline, frozen intake, другой публикации или даты
проверки источника. `required` копируется из218, а не жёстко задаётся в UI.
Origin/configurationState по-прежнему starter/needs_confirmation; staff_confirmed
на текущей схеме не создаётся и его реальная выдача не заявляется.

При B3e-2 обязательно заменить внутренний v2 reader на generic representation
ДО full writes и одновременно ограничить старый v1 явной unsupported ошибкой.
Нельзя оставить v2 зависимым от уже отказывающего v1. Exact218 historical receipt
replay и authority остаются отдельными; в224 вообще не меняются.

## Потребители и владение

- SQL worker: только новая224 и SQL-specific source checks/notes, без применения.
- TS/web worker: отдельный v2 DTO/parser и meaningful codec tests; переключение
  `application-requirements-source`, reader result types в Student/staff actions,
  `ApplicationRequirementsUI`, `StaffPreparationPanel`, нужные requirements i18n.
  Init actions/receipts/storage keys остаются v1. Ошибкаv2 не вызывает fallbackv1.
- Swift worker: отдельный v2 DTO, только reader method в SupabaseService,
  requirements type в ProgramPreparationModel, requirementsSection в
  ProgramPreparationView, requirements-only RU/KY keys и pbxproj entry.
  Init method/receipt v1 и root27b signup sections не менять.
- B интегратор: этот контракт/appendices, проверка согласованности, QA packet,
  scope-local validation, independent exact-head review/PR; общий writer — root.

Impeccable refinement: existing EVO/Атлас и layout сохраняются. В обоих клиентах
обязательное и optional различаются, starter/confirmed получают точную подпись,
срок материала выводится только когда присутствует, review подписан как проверка
файла. Proven changed показывает короткое действие проверить соответствие файла.
Нет процентов готовности, ложного package-approved и новых submit controls.
Перед фактическими UI-правками прочитать craft-floor; detector/context повторно
в этой сессии не запускать. Новых шрифтов/зависимостей/перестройки навигации нет.

## Проверка и порядок включения

1. Независимо принять этот exact pre-code contract до исходников. Root утвердил
   направление #979;224 зарезервирован, но не применён. Прежде любого apply/QA
   представить точный SQL hash, актуальный ledger/source и effects/rollback limits.
2. Scope-local codec tests TS/Swift: текущие valid218-derived формы, full reserved
   optional/deadline/changed формы и реальные границы rejection. Это pure protocol
   evidence; fixtures не становятся действующими university facts или UI success.
3. TypeScript/scoped lint и native compilation по изменённому коду. Не запускать
   весь unrelated suite; full application build — только если прямой риск/CI.
4. В конкретном разрешённом local QA окне обычные retained Student и scoped staff
   читают ту же существующую preparation черезv1/v2. Сверить полный состав,
   версии, required, file/review/reasons и только три новых item literals.
   Проверить имеющиеся реальные anonymous/foreign/scoped denials без provision.
5. Before/after business data, schema/function и Auth evidence по пакету root:
   schema diff строго новые224 functions/ACL, старые function definitions
   неизменны; business revisions/items/slots/links/versions/reviews/audit неизменны.
   Auth counts не доказывают неизменность sessions. Не создавать новый выбор,
   не выполнять init replay-write или менять материалы ради read-only сценария.
6. Реальный текущий starter-путь нового reader в CRM/web/native. Native запуск
   зависит от доступного изолированного simulator и разблокированного Mac;
   BUILD SUCCEEDED не заменяет UI. Недоступные full/optional/legacy/unsafe сочетания
   перечислить как непроверенные; не подменять их fake responses или screenshots.
7. После merge source переход клиентов ещё не означает production enablement.
   Root отдельно координирует schema/runtime order и installed-client policy.
   Full-write/editor не включать до v2 потребителей; блок B3e-2 остаётся следующим.
