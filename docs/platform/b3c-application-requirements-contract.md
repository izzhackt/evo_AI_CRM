# B218 — требования выбранной программы и существующие Docs

Контракт согласован до реализации, 21 сентября 2026. Реализация SQL/TS/Swift
подготовлена после main946+960. [Локальные RPC/DTO проверки пройдены](b3c-application-requirements-qa.md);
новый UI остаётся следующим срезом.
Root зарезервировал218;216 принадлежит A,217 root. Начало runtime только после
main946+960 и review окончательного контракта. Источник анализа: B941a42ae; isolated
contract branch основан на215 integration32f53535. Root принял направление
и поручил B владение этими appendices только в своём worktree.

## Результат среза

У подготовки214 появляется собственная неизменяемая редакция требований,
явная идемпотентная инициализация и reader для Student/staff. Файлы и их версии
остаются в существующих document_slots/document_versions того же дела.
Чтение не создаёт требований, слотов или связей. Выбор программы и активация
сопровождения сохраняют принятый контракт; ни нового одобрения выбора, ни оплаты.

## Согласованные границы

1. 218 ограничен стартом EVO, а не редактором полного перечня. Для новой простой
   подготовки старт — Фото и Загранпаспорт, оба обязательны, origin=evo_starter,
   configurationState=needs_confirmation. Это не утверждённый перечень вуза.
   Этот флаг относится к полноте перечня: он не вводит одобрение выбора программы
   сотрудником и не блокирует подготовку/черновую работу с Фото и Загранпаспортом.
   В218 нынешний upload сохраняет прежнее поведение; разделение draft/submit
   появится отдельно до обещания двух разных действий в интерфейсе.
   При existing113 links или документном составе137 автоматический старт не
   заменяет существующее: named needs_configuration без изменений. Existing
   case-wide179 checklist также не объявляется требованиями конкретной программы.
   Консервативное поведение при существующем полном перечне дела: не создавать
   конкурирующий starter, вернуть needs_configuration; явное принятие полного
   состава сотрудником — следующий отдельный контракт.
2. Совместимость автоматически устанавливается только для материалов,
   созданных и типизированных218. Legacy слоты, названия и approved сами по себе
   не доказывают совместимость. Для старых файлов нужен отдельный явный staff
   mapping. Разные эссе/переводы/форматы не объединяются по похожему названию.
3. Старые действия удаления113/soft-delete108 сохраняются. Reader не выкидывает
   обязательный пункт из редакции, а показывает unavailable/needs_configuration.
   Никакого нового guard, ломающего действующие действия Docs, в218.

## Данные и операции

Две приватные append-only таблицы: application_requirement_revisions (tenant,
case, application214, revision UUID/number, origin/configuration, actor/time) и
application_requirement_items (stable key/order, required bool, immutable label/
instructions/compatibility identity, nullable source requirement, same-case slot).
Составные FK закрепляют tenant/case/application; private RLS/ACL и append-only
защита. Публикация214 и бинарные файлы не копируются. В218 создаётся только первая
редакция; будущие редакции/пакеты ссылаются на прежнюю, не переписывая её.

Публичные auth wrappers student_initialize_application_requirements_v1(case,
application,request) и staff-вариант(org,case,application,request); общий private
operation. Authority сейчас и после lock; Student только собственное active
portal-eligible дело и preparation214; staff scoped document.manage. Не выдавать
Student document.manage. Запрос с тем жеID и другим intent конфликтует. Exact
replay возвращает исходную immutable receipt; read current state отдельно.
Уже инициализированная preparation не создаёт повторные slots/revision при новом
requestID. Все изменения атомарны, lock order согласован с существующим Docs.
Свежая authority проверяется первой и повторно после lock; поиск существующей
receipt/revision предшествует eligibility новой инициализации (active/preparation
и legacy checklist/links). Собственные218 links и последующая смена состояния
не ломают replay, но отозванная authority не обходится старой receipt.
Уникальность (organization, application, revision number) и (revision, item key)
защищена БД. Поиск/создание совместимого material slot сериализован блокировкой
того же case до поиска: параллельные init разных applications не создают
два Фото/Паспорт. Повтор не восстанавливает удалённые links/slots автоматически.

Для новых materials использовать существующий custom slot, затем113 relevance
link для application. Совместимый активный типизированный slot того же дела
переиспользуется без смены файла/status/review. Семантика Photo/Passport выражена
устойчивыми versioned keys, не regex по отображаемому названию. Удалённый слот
не становится активным автоматически; неоднозначность — needs_configuration.

Reader student_application_requirements_v1(case,application), staff-вариант:
Student document.read.self+portal case gate; staff document.read.full (одного
case.read.full из214 недостаточно). Возвращает configuration/revision и полный
упорядоченный состав с required, slot/current-version IDs, фактическим review
status и технической доступностью. Finalized+integrity verified+malware clean
отдельны от approved. Никаких storage keys/URL/лишних reviewer identifiers.
Uninitialized не является пустым готовым списком; исчезнувший/removed link/slot
остаётся видимым непригодным пунктом immutable состава.

TS/Swift DTO различают receipt и текущий reader; строгая корреляция case,
application, revision/item/slot IDs. В reader отдельные оси: required:boolean,
slotStatus, nullable reviewDecision, technicalAvailability и unavailableReasons.
Статус слота required не является флагом обязательности; отсутствие review не
означает approved. Не вычислять эти признаки из одного общего status.
Uninitialized/needs_configuration имеют явный discriminator и nullable
revisionId/revisionVersion; отсутствие revision не превращается в revision0
или готовый пустой список. Для созданной редакции revisionVersion — положительное
целое в согласованном decimal-string DTO, проверяемое TS/Swift без потери точности.
Nullable file version отдельно от revision; состав требований сохраняется при
unavailable slot/link. Счётчика готового/отправленного пакета ещё нет.

## UX и границы

Impeccable Operate/clarify: сохранить EVO и существующий Docs. Будущий экран
программы показывает «Стартовый список EVO — требования уточняются», явные
обязательные пункты и состояние каждого файла. Неизвестное не означает готово.
Общий список дела остаётся доступен; новый reader не заменяет его.
В218 нет UI/CTA, upload/draft/submit separation, пакетов, очереди/review,
external application submitted, бинарных копий, новых стран, Auth identities,
production/provider действий. Native/web UI подключается отдельным срезом.

## Проверка изменённого пути

Существующий local QA Student/case/preparation, обычный Auth. До mutation —
exact reviewed SQL и согласованное writer window с root/A. Read-only before/after
для обоих readers; idempotent explicit init, same-request replay/conflict,
new-request duplicate, foreign-case/permission denials, точный набор новых
revision/items/slots/links/audit, неизменность старых перечней/files/roles/ledger.
Реальные RPC responses декодируются TS/Swift. Ни новые Auth/роли, ни synthetic
fixtures вместо реального path не нужны. Если старый checklist блокирует starter,
это доказанный needs_configuration; нельзя тайно чистить/обходить его ради успеха.
Отказ needs_configuration не доказывает положительную инициализацию. При
отсутствии подходящего существующего QA-кандидата результат остаётся непроверенным;
это не повод создавать подставной успешный сценарий.
Исторические baseline/links и semantic reuse проверяются там, где есть настоящие
подходящие данные; непроверенные варианты явно отделяются от source review.

## Оставшаяся часть принятого пользовательского плана

Этот срез не закрывает весь admissions-путь. Явное принятие сотрудником полного
существующего перечня и смысловое сопоставление прежних файлов остаются
обязательными следующими частями общего плана, как и отдельная отправка/пакет,
очередь проверки и UI веб/iPhone. Старые перечни сохраняются целиком. Отложенное
сопоставление не является решением навсегда оставить клиента без рабочего пути.
Будущая отправка фиксирует requirements revision и exact file versions одного
дела. Наличие approved не требуется для первой отправки технически доступных
обязательных материалов. Старый137 approved gate этим контрактом не меняется.

## Исходники

043:95/132 — case-route requirements/slots;108 — dynamic custom/soft removal;
053:464–550 и179:156–390 — immutable whole-case checklist/route binding;
113:17–71,245–485 — tenant/case links и mutable relevance;114:51–80,308–336 —
обязательный точный transaction-local context для увеличения версии связи;
137:104,162–173,436–466 —
старый approved gate/admissions_details;128:675–752,192:95–112 — Student docs gate;
156:106/2394 — scoped document.manage/read.full;055:210 — upload сейчас submitted;
platform-university-catalog.ts:18–26 — каталог не хранит document requirements.

## Wire и совместимость — уточнение до кода

Root согласовал правила legacy/reuse/metadata ниже. Wire фиксирует детали
исходного API-контракта по source review; RPC возвращают JSONB:

- student_initialize_application_requirements_v1(case,application,request);
- staff_initialize_application_requirements_v1(org,case,application,request);
- student_application_requirements_v1(case,application);
- staff_application_requirements_v1(case,application), org из current authority.

Параметры именуются p_student_case_id, p_application_id, p_request_id,
p_organization_id соответственно. Успешная immutable receipt:
requestId, studentCaseId, applicationId, revisionId, revisionVersion,
origin=evo_starter, configurationState=needs_confirmation, initializedAt,
items[{requirementItemId,requirementKey,documentSlotId}].

Current reader: studentCaseId, applicationId,
state=uninitialized|initialized|needs_configuration,
nullable revisionId/revisionVersion/origin/configurationState/initializedAt,
configurationReasons, items. Для uninitialized все nullable поля null,
items/reasons пустые. Legacy-blocked: needs_configuration, revision null,
причина названа, записей нет. Starter: initialized/needs_confirmation.
Просто отсутствие файла не ломает конфигурацию. Нарушение текущей связи/слота
меняет только current state на needs_configuration, сохраняя старую редакцию,
её состав и receipt. Для недоступной ассоциации file/review поля null.

Каждый item: requirementItemId, requirementKey, documentSlotId, position,
required, label, groupLabel, instructions, compatibilityKey; nullable slotStatus
(required|submitted|approved|correction_required|rejected), currentVersionId,
currentVersionNo, reviewDecision(approved|correction_required|rejected),
reviewReason, reviewedAt; technicalAvailability=available|unavailable и
unavailableReasons. Review берётся только для текущей версии; reviewReason
показывается только для correction_required/rejected. Rejected файл может быть
технически доступен: эти оси не смешиваются. Available требует finalization,
integrity verified, malware clean. Никаких storage keys/URL или reviewer identity.

Configuration reasons: legacy_case_checklist, legacy_application_links,
legacy_application_configuration, ambiguous_material,
material_association_unavailable, material_metadata_changed.
Unavailable reasons: slot_missing, slot_removed, application_link_missing,
slot_metadata_changed, file_missing, upload_not_finalized, integrity_pending,
integrity_failed, malware_pending, malware_infected, malware_error.

Стартовые immutable compatibility/requirement keys: evo.photo.v1 и
evo.passport.v1,
порядок1/2. Decimal versions — строки1..9223372036854775807. Decoders проверяют
UUID, уникальность item/key/slot внутри редакции, корреляцию внешнего case/app,
пары nullable current version и отсутствие потери точности. Новый request для
существующей редакции даёт новую audit receipt с новым requestId; остальные
immutable факты те же. Exact replay возвращает исходную receipt.

Ошибки:22023 application_requirements_invalid_intent / request_conflict;
42501 application_requirements_unavailable;PT409
application_requirements_case_ineligible / application_ineligible /
needs_configuration;55000 application_requirements_invariant_conflict.
Все сокращённые варианты имеют префикс application_requirements_. Не раскрывать
foreign case/application отдельно. При неизвестном transport failure клиент
сохраняет тот же intent/requestId и не придумывает успешную инициализацию.
Причины configuration читаются только через
авторизованный reader; отказ команды не создаёт частичных записей.

Порядок: read authority → lock_p2e_request → действующие actor locks → case
FOR UPDATE до поиска материалов → application/нужные slots → fresh authority →
exact receipt → existing revision → eligibility/legacy gates новой редакции.
Использовать current_actor_authority, require_domain_actor(_read),
require_case_operator и staff_can_access_for_actor в их действующих signatures;
Student дополнительно role/ownership/document.read.self/portal gate. Audit
convention214: action application.requirements.initialize, resource
university_application, after_state {intent,receipt}; intent включает org,
actor membership/mode, case/application/request. Не вызывать staff-only RPC
под подменённым Student actor.

Case legacy gate исключает slots, чьё происхождение218 доказано immutable items
другой программы того же дела. Applied179 binding либо активный нетипизированный
legacy/custom перечень остаётся needs_configuration. Target-app113/137 gate
применяется только к этой application после receipt/revision lookup. Links другой
программы сами по себе reuse не блокируют. Совместимых активных typed slots больше
одного — ambiguous_material, без произвольного выбора или новой замены.

108 metadata edits сохраняются. Текущие custom intent/NULL requirement/display
label/group должны соответствовать immutable typed definition; иначе reader
needs_configuration + slot_metadata_changed, без reuse/retyping/replacement.
GroupLabel хранится в immutable item как основание сравнения. Labels нетипизированных
старых слотов не доказывают совместимость. Удалённые links/slots не восстанавливать.
Создание113 link сохраняет существующее увеличение aggregate slot version на1;
файл/status/review не изменяются. Source-based порядок и safeguards проверяются
на реальном runtime до заявления приёмки, а не считаются доказанными по контракту.
