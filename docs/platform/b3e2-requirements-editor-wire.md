# B3e-2 / 226 — точный editor wire

Дополнение к [контракту226](b3e2-requirements-editor-contract.md), до реализации.
Source анализа: `b34108b610ca12926aa41686a1c17cc3d8579ab4`. Это DTO/SQL контракт,
не утверждение о выполненных миграции, RPC или UI. Save payload и immutable
receipt остаются точно из основного контракта; ниже закрывается editor context.

## Общие правила

Каждый объект имеет ровно перечисленные ключи. Поле nullable передаётся как JSON
null, не отсутствует. UUID, timestamps, decimal BIGINT и Unicode scalar rules —
[v2](b3e1-requirements-v2-read-contract.md). Положительные версии — строки1..BIGINT_MAX;
`admissionsVersion` дополнительно допускает строку `"0"`. Boolean не число.
`protocolVersion` — JSON number1. `contextHash` —64 lowercase hex characters.

Items≤100, candidates≤1000, sources≤2000; превышение — editor_limit, без усечения.
Лимит1MiB относится к UTF-8 байтам `payload::jsonb::text`, включая пробелы после
разделителей JSONB; compact JSON на проводе не задаёт этот размер. NUL запрещён:
PostgreSQL JSONB/text не может его представить. Для нового custom material
label/group также действует существующий108 запрет Unicode control characters
(категория Cc). Это ограничения формата хранения, не изменение v2 reader.
Legacy display-текст не обрезается и не
превращается автоматически в новый item: исторические043 label/instructions
не имели v2 maxima. При сохранении новый item обязан пройти500/200/4000 limits;
сотрудник исправляет текст явно. Source display strings проверяются по типу,
непустоте при наличии и Unicode validity, но не по максимумам нового item.

## Верхний объект

```ts
{
  protocolVersion: 1,
  studentCaseId: UUID,
  applicationId: UUID,
  applicationVersion: PositiveBigintString,
  admissionsVersion: NonnegativeBigintString,
  binding: Binding,
  requirements: ApplicationRequirementsV2,
  legacyApplication: LegacyApplication,
  sources: Source[],
  candidates: Candidate[],
  canSave: boolean,
  saveBlockReason: null | "permission_required" | "case_inactive"
    | "portal_inactive" | "application_not_preparation",
  contextHash: Hex64
}
```

`requirements` — существующий exact v2 DTO без изменений; его case/application
совпадают с верхними ID. `canSave` тогда и только тогда true, когда reason=null.
При нескольких причинах приоритет: нет scoped document.manage → case не active →
portal_activated_at отсутствует → application не preparation. Нет214 binding или
нет scoped document.read.full — error42501, не успешный пустой editor.

```ts
Binding = {
  institutionId: UUID, publicationId: UUID, publicationVersion: number,
  programId: string, intakeId: UUID,
  institutionName: string, programTitle: string, intakeLabel: string,
  selectedAt: Timestamp,
  deadlineStateAtSelection: "confirmed" | "needs_confirmation"
}
```

Publication version и program ID сохраняют ограничения214/catalog codec.
Все identity/display поля берутся из binding и её сохранённой публикации,
никогда не из latest catalog. Это узкий header, не копия всего university content.
Он не заменяет существующее отображение frozen intake deadline из214.

```ts
LegacyApplication = {
  documentsApplicability: null | "needs_confirmation" | "required" | "not_required",
  documentsSource: string | null,
  documentsCheckedOn: CalendarDate | null,
  documentSlotIds: UUID[],
  documentExceptionSlotIds: UUID[],
  documentsExceptionReason: string | null,
  documentsExceptionEvidence: string | null
}
```

Это только семь перечисленных137 полей. Отсутствующие scalar fields → null,
отсутствующие selections →[]. UUID arrays разбираются штатной137 грамматикой,
без дублей, ≤50; в DTO сортируются по UUID. Не выдавать raw admissions_details.
Exception IDs должны быть subset documentSlotIds. Malformed existing137 данные —
legacy_configuration_conflict; не чинить и не заменять пустыми массивами.
Текст137 сохраняет существующий предел2000 scalars.

## Материалы для явного выбора

```ts
Candidate = {
  documentSlotId: UUID, slotVersion: PositiveBigintString,
  intentKind: "baseline" | "custom",
  sourceRequirement: null | {
    requirementId: UUID, requirementKey: string,
    checklistVersion: PositiveBigintString
  },
  rawLabel: string | null, rawGroupLabel: string | null,
  label: string, groupLabel: string, instructions: string | null,
  slotStatus: DocumentSlotStatus,
  currentVersionId: UUID | null, currentVersionNo: PositiveBigintString | null,
  filename: string | null,
  reviewDecision: DocumentReviewDecision | null,
  reviewReason: string | null, reviewedAt: Timestamp | null,
  technicalAvailability: "available" | "unavailable",
  unavailableReasons: FileUnavailableReason[],
  links: { linkId: UUID, targetKind: "university_application" | "visa_case", targetId: UUID }[]
}
```

Candidates — все не removed slots этого дела, включая пустые и технически
недоступные файлы, сортировка documentSlotId. Baseline требует sourceRequirement;
custom имеет sourceRequirement=null и непустые rawLabel/rawGroupLabel.
Effective label/group = slot override либо requirement metadata. Instructions —
только действующий requirement.instructions, у custom null; не подставлять текст
другой программы. Raw metadata нужны для объяснимого выбора и snapshot guard.

DocumentSlotStatus и DocumentReviewDecision — закрытые существующие218 enums.
FileUnavailableReason: `file_missing | upload_not_finalized | integrity_pending |
integrity_failed | malware_pending | malware_infected | malware_error`.
Candidate не представляет mapping item, поэтому structural reasons здесь нет.
Нет версии → filename/review fields null и ровно[file_missing]. Есть версия →
filename непустой; current ID/No paired; decision/reviewedAt paired; reason null
при null/approved decision. Available требует версии и пустых reasons.
Unavailable с версией требует непустых reasons без file_missing; не больше одной
integrity_* и одной malware_* причины. Правила проверки файла те же, что218.

Links сортируются targetKind,targetId,linkId; linkId и пара targetKind/targetId
уникальны. Все связи из того же case, только ID и target kind, без чужих profile/
application/visa details. Это provenance использования, не доказательство
совместимости и не команда изменения137. Storage keys/URLs и reviewer ID отсутствуют.

## Полный перечень источников

```ts
Source = {
  sourceKey: string,
  kind: "prior" | "country" | "link" | "application",
  documentSlotId: UUID | null,
  materialState: "selectable" | "removed" | "missing",
  required: boolean | null,
  label: string | null, groupLabel: string | null, instructions: string | null,
  reference: PriorReference | CountryReference | LinkReference | ApplicationReference,
  legacyException: boolean,
  mustRetain: boolean
}
PriorReference = {
  revisionId: UUID, revisionVersion: PositiveBigintString,
  requirementItemId: UUID, requirementKey: string,
  origin: "evo_starter" | "staff_confirmed", compatibilityKey: string,
  typedStarterEligible: boolean
}
CountryReference = {
  manifestId: UUID, manifestVersion: PositiveBigintString,
  manifestStatus: "approved" | "retired",
  requirementId: UUID, requirementKey: string,
  requirementStatus: "active" | "retired"
}
LinkReference = { linkId: UUID }
ApplicationReference = { applicationVersion: PositiveBigintString }
```

Sources сортируются по sourceKey, keys уникальны и ровно соответствуют kind:
`prior:<requirementItemId>`, `country:<requirementId>`, `link:<documentSlotId>`,
`application:<documentSlotId>`. Никаких автоматически generated/caller source keys.

- Prior: все current revision items; reference указывает именно эту revision;
  required из item, label/group/instructions из immutable definition.
- Country: все requirements exact bound manifest, не latest approved; ID/version/
  route сопоставляются сервером. documentSlotId — единственный same-case baseline
  slot с этим requirement ID, либо null. Required=null; display из requirement.
- Link: каждый113 link target application, включая removed material. Required=null;
  display из slot effective metadata. Отсутствующий slot остаётся source problem.
- Application: каждый parsed137 selected slot; required=true при applicability
  required, false при not_required, null при needs_confirmation/null. Display из
  slot effective metadata. legacyException=true только при membership в137
  exception IDs. mustRetain=true только для application kind при applicability
  required, включая exception. Для всех других sources оба flags=false.

Selectable требует существующий активный slot и соответствующий candidate;
removed — существующий removed slot, отсутствующий в candidates; missing — slot
не найден или country slot ещё не создан. У missing source ID может оставаться
из137/prior/link, а у неназначенного country null. Если definition существует,
сохранять её display; при missing untyped slot display fields=null. Не скрывать
source из-за отсутствующего файла, удаления, пустого текста или broken mapping.

Included decisions проверяются сервером: prior → тот же stable requirementKey
(явная смена material допустима); link/application → тот же slot; country →
точный bound requirement и его existing baseline slot. Остальное — excluded с
reason. Несколько origins могут указывать на item только при доказанной общей
material identity; исключение — prior с тем же key и явной сменой material.
mustRetain запрещает excluded, смену slot и обход137 через reason226.

Provenance typed_starter ссылается только на prior с typedStarterEligible=true:
оригинальный218 item либо доказанная сервером неизменённая typed lineage через
immutable predecessors/provenance. Одного совпадения compatibilityKey недостаточно.
country_manifest — country; application_details — application. Link сам по себе
не является provenance-видом: его явный reuse требует staff_entry с basis и
отдельным included решением link. Existing full prior сохраняет stable key и
predecessor; сохранение ещё одной full редакции не теряет доказанную typed lineage.

## Hash, блокировки и ошибки

Hash — SHA256 server canonical JSONB с внутренним domain/version tag, текущими
organization/membership ID и полным context без contextHash. Arrays имеют указанную
стабильную сортировку. Не включать generated-at clock. Private raw source snapshot
дополнительно хранит проверенные источники, не принимает их от клиента.
Полный context hash включает canSave/reason, dynamic candidate state и current v2:
чужая загрузка/проверка между editor read и save может дать stale; после сохранения
она не нарушает material mapping. Save повторно строит snapshot после locks.

Порядок остаётся canonical request → actor/organization → case → application →
case slots по UUID → links. Новые необязательные catalog locks не добавлять.
Текущий156 заменяет country-admin helper на organization operator с тем же
organization lock;158 сохраняет его для requirement writes. Поэтому canonical
manifest/requirement mutations сериализованы. Bound approved/retired requirement
composition дополнительно immutable053.179 и108/113 используют case-first;
финализация055 и validation115 тоже берут case lock. Нельзя заменить эти locks
одним повторным hash или вызвать save с read-only authority helper вместо writer.

| Exact SQL message | SQLSTATE | Client classification |
|---|---|---|
| `application_requirements_invalid_intent` | `22023` | invalid |
| `application_requirements_unavailable` | `42501` | forbidden |
| `application_requirements_request_conflict` | `22023` | request_conflict |
| `application_requirements_stale_context` | `PT409` | stale_context |
| `application_requirements_case_ineligible` | `PT409` | case_ineligible |
| `application_requirements_application_ineligible` | `PT409` | application_ineligible |
| `application_requirements_legacy_configuration_conflict` | `PT409` | legacy_configuration_conflict |
| `application_requirements_editor_limit` | `PT413` | editor_limit |
| `application_requirements_invariant_conflict` | `55000` | unavailable; retain pending |
| `application_requirements_client_update_required` | `PT409` | v1 reader only |

Stale covers mismatched hash/application/revision/slot/current-version tokens.
Legacy conflict covers malformed source configuration and violation of137 retained
selection. Limit covers count/size bounds, never partial serialization. SQL raw
DETAIL/HINT и identities не выводить. Unknown message/transport/malformed receipt
оставляют immutable intent pending; их нельзя трактовать как отсутствие записи.
New v1 init intent при latest full использует существующий
`application_requirements_application_ineligible`; исторический exact replay
выполняется раньше и возвращает прежний218 receipt без изменения wire.
