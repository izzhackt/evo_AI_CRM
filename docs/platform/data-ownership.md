# Владение данными в EVO Platform

- Owner: технический ответственный EVO Admissions
- Status: active canonical ownership contract under #376 and ADR 0021
- Last reconciled: 2026-08-25 at
  `cfc75ca29a66546886de320aa80c454d18104b92`
- Architecture decision:
  `docs/adr/0021-unified-net-new-pilot-and-human-reviewed-gemini.md`

## 2026-08-24 canonical Supabase and migration boundary

EVO/Supabase is canonical for operational data. The pilot is net-new after an
explicit cutoff or authorized small allowlist; existing active/history legacy
records remain excluded or read-only until separately approved post-pilot
work. No runtime SQLite restoration, dual-read, dual-write, write-through,
fallback repository or compatibility layer is permitted. amoCRM is temporary
read/import source; WAHA is private transport; Gemini Flash is the single
pilot AI provider and remains advisory and human-reviewed.

- Student Profile document reading, extracted-fact confirmation, profile
  autofill and profile-form export belong to a separate system outside this
  repository. EVO Platform owns no automatic exchange with that system. A
  future integration requires a separately approved mapping, privacy/consent,
  authentication, validation and acceptance contract.
- Supabase boundary: `docs/adr/0015-establish-canonical-supabase-schema-and-migration-boundary.md`
- External automation boundary:
  `docs/adr/0017-separate-student-profile-document-automation-from-evo-platform.md`
- Historical autonomy/read-mostly decision (superseded):
  `docs/adr/0019-gate-autonomous-inbound-replies-and-resume-read-only-amocrm.md`

## Зачем фиксировать владельца

«Владелец» здесь означает систему, в которой запись считается канонической.
Копия внешнего ID, shadow field или синхронизированное представление не меняют
владельца. Это правило предотвращает расхождение sales stage, ответственного
менеджера и admissions status.

## Канонические владельцы

| Данные | Канонический владелец | Что хранит EVO Platform |
|---|---|---|
| Client/contact | EVO Platform Supabase | canonical UUID, normalized identity, provenance и optional external IDs such as `amo_contact_id` |
| Lead | EVO Platform Supabase | canonical lead, source/provenance, `amo_lead_id` when imported and duplicate-resolution evidence |
| Responsible staff | EVO Platform Supabase | current assignment, history and optional imported external user reference |
| Sales pipeline/stage, next action and deadline | EVO Platform Supabase | canonical operational state and imported amoCRM provenance where applicable |
| Contract plus first-payment handoff gate | EVO Platform Supabase | evidence, actor, time, override reason and immutable audit |
| Staff identity и platform role | Supabase Auth + Platform profiles | account, role claims, organization membership, block/invite audit |
| Student case и Curator assignment | EVO Platform Supabase | весь operational lifecycle и audited reassignment |
| University applications | EVO Platform Supabase | несколько параллельных applications одного студента |
| Document metadata и review history | EVO Platform Supabase | checklist, versions, validation, integrity/malware evidence state и review/rework history |
| Document binary objects | private Platform Storage после P2H | private objects, object-policy enforcement, download/access audit и separate backup |
| Visa case | EVO Platform Supabase | Curator-owned operational states и evidence |
| Platform admissions tasks | EVO Platform Supabase | assignment, priority, due/status и lifecycle history |
| Pilot cohort membership | EVO Platform Supabase after U10 | cutoff/allowlist reason, actor, time, provenance, current membership and immutable inclusion/removal history |
| Call/recording and existing chat-record references | amoCRM/Kommo | verified external IDs, safe metadata/links and sync evidence; raw recordings are not duplicated |
| Notification intent v1 | EVO Platform Supabase | receive-only stage uses in-app state only; later external delivery needs a separate write-stage decision |
| WhatsApp provider delivery/ACK | WAHA | наблюдаемое provider evidence, ACK progression и reconciliation state; Platform record не создаёт provider truth |
| Obligations, payments и refunds v1 | EVO Platform Supabase | manual confirmation by staff with explicit permission, evidence and audit |
| Conversation и staff workflow | EVO Platform Supabase | единая история, role queue ownership, handoff и access scope |
| WhatsApp transport/session state | WAHA | отдельные `session`, message ID, ACK и reconciliation records |
| Kommo Chats identity | Kommo | отдельные `conversation.id` и `message.id`, не смешанные с WAHA IDs |
| AI draft evidence | EVO Platform Supabase | explicit request/source message, provider/model/prompt-policy references, source context + SHA, approved-knowledge citations, original generated text, review evidence и exact human final text + SHA |
| Structured qualification/reply proposal | EVO Platform Supabase | inbound trigger, Gemini model/prompt/policy/context evidence, extracted facts, confidence/risk, proposed memory update, citations and proposed reply |
| Human AI-review decision | EVO Platform Supabase | suggestion, sources, uncertainty/risk, accept/edit/reject actor and time; no send authority |
| Lead memory and approved retrieval | EVO Platform Supabase + pgvector | immutable events, normalized messages/media, rolling summaries and only approved versioned knowledge chunks |
| Human review/workflow state | EVO Platform Supabase | durable actor, reason, time and append-only transition history |
| Communications audit/reconciliation state | EVO Platform Supabase после P2F | immutable append-style evidence; не доказательство Queue или provider delivery |
| Outbox/queue/dead-letter processing | EVO Platform Supabase после P2G | durable work, attempts, retry budget, dead-letter и manual reconciliation |
| Operator live-update state | EVO Platform Supabase | RLS-safe normalized events distributed through private Realtime in a later block; never a direct browser subscription to WAHA |

Imported amoCRM stage or owner values never overwrite canonical EVO state
without an explicit, audited migration decision. Stage one authorizes no
amoCRM write; any later provider write requires a new owner-approved contract.

## Temporary amoCRM read/import adapter

Pipeline, status, custom-field, user and chat IDs are account-specific. The
temporary bounded adapter must:

1. discover account identity and values through authorized GET/read APIs;
2. retain versioned mapping, granted scope and verification time;
3. read/import external contact, lead, responsible Sales and stage plus
   permitted references to tasks, calls/recordings and chat records;
4. keep CRM IDs, Kommo chat IDs, WAHA IDs and Platform UUIDs separate;
5. fail closed on missing/stale/conflicting mapping, credentials or scope;
6. use bounded paging, rate limits and reconciliation without provider writes;
7. preserve source ID, source version/time and import outcome on canonical EVO
   records without creating a permanent synchronization path.

No name-based inference, hardcoded account/stage ID, SQLite/mock substitution or
silent fallback is allowed. Exact source mapping is required only for a
specifically authorized, bounded legacy read/import case; U10 does not create a
broad migration or synchronization path. Any such real provider read remains a
U12 acceptance concern until authorized evidence proves it. Any provider write
requires a later owner decision.

## Platform roles и object scope

В первом внутреннем пилоте есть три human-facing роли: Sales Manager
(`sales`), Admissions Manager (существующая canonical admissions role) и
Director/Admin (`admin`). Contract/payment confirmation — отдельные permissions,
а не автоматическое следствие роли. Finance — внутренний модуль, доступный
только через такие permissions, а не четвёртая pilot role. Student Portal
следует в более позднем milestone. Отдельной роли `visa` нет.

| Роль | Разрешённый scope |
|---|---|
| Director/Admin | staff activation/suspension; role administration; Admissions assign/reassign с обязательной причиной, before/after и audit; разрешённые cross-case operations |
| Sales | conversation и sales queue до contract-plus-first-payment handoff; после handoff только разрешённый несекретный summary |
| Admissions Manager | только назначенные student cases, applications, documents, visa, tasks и communication |

Admissions Manager/Director/Admin могут close или reopen student case только с
обязательной причиной и audit. Admin — permission bundle для личных аккаунтов уполномоченных
сотрудников; shared credentials запрещены.

Payment/contract evidence может подтверждать только actor с соответствующим
explicit permission; таблица ролей сама по себе такого права не создаёт.

## Historical implementation evidence

The P2-P8 paragraphs below record exact merged repository behavior and remain
useful source evidence. They do not override ADR 0020, define the first-pilot
role set, authorize autonomous send or prove provider/production behavior.

Migration 042 реализует эту границу локально в Supabase/PostgreSQL: pending
case создаётся только узким service RPC после подтверждённого contract signal;
Admin assignment активирует handoff/Portal и ротирует object scope; после
handoff Sales получает только фиксированный summary, а Student — только
self-only Portal projections. Это database contract, а не доказательство
реального amoCRM mapping, production import или Portal cutover.

P2E начинается строго после migration 042 и добавляет additive migration 043.
Его merged contract не расширяет base-table grants для сокращённых
аудиторий: Admin и текущий Curator получают полный document workflow в своём
scope; Sales до handoff — только фиксированный checklist; Student — только
fixed self history; Finance не получает sensitive document access. Исторический
P2E bundle позволял Admin/Finance подтверждать evidence-bearing events; U1
явно supersedes это role-derived право и требует отдельный индивидуальный grant
для contract/first-payment confirmation. Sales, текущий Curator и Student
используют отдельные безопасные projections. Полный исторический контракт:
[`p2e-documents-finance-notifications.md`](p2e-documents-finance-notifications.md).
PR #88 merged migration 043 as
`aac1cba851e89070a7eb54baab4eddf921e3447c`; exact-main CI
[30402311903](https://github.com/izzhackt/evo_AI_CRM/actions/runs/30402311903)
зелёный. Это repository evidence, а не Storage, provider или production proof.

P2F начинается от этого checkpoint и добавляет additive migration 044 для
unified communications/provider identity/draft-only AI data contracts. PR #89
controller-merged его как `8567455f281fa157fb088970db1c2a2397850843`;
post-merge exact-main CI
[30407638837](https://github.com/izzhackt/evo_AI_CRM/actions/runs/30407638837)
зелёный. Pinned artifact содержит 6,881 lines и 194,076 bytes; SHA-256
`8d52b476981faed4a42a9c13ff2813a718bde6ad4aea1b315c4d61be9fd1ebc8`.
Внутренние UUID, WAHA session/message IDs, Kommo
conversation/message IDs и amoCRM contact/lead IDs остаются отдельными
namespaces. Private raw payload/evidence сохраняется до normalized processing;
browser получает только разрешённые transcript/safe-summary projections.
Подробная граница:
[`p2f-communications-contracts.md`](p2f-communications-contracts.md).

Merged P2G начинается от merged P2F checkpoint и добавляет только migration
045. Private work/attempt/event/idempotency/dead-letter ledgers ссылаются на
P2F source rows по UUID; PGMQ payload не содержит customer text, raw provider
payload, verification headers или secrets. Две exposed review relations дают
только Admin своей organization фиксированную reconciliation projection и
reason-required resolution. Manual-send authorization одноразовая,
`max_attempts = 1`; explicit unknown и истёкший ambiguous worker lease
архивируют active message и никогда не попадают в retry/DLQ. Полный контракт:
[`p2g-durable-work-queues.md`](p2g-durable-work-queues.md).

P5A is merged at current main with migration 059. It owns signed WAHA raw-event
receipt and verified pointer-only enqueue, but remains disabled by default and
does not prove a provider. Draft PR #133 is the unmerged P5B receive/project
candidate. Its private worker may claim, project and finish one bounded inbound
item through narrow service RPCs; it may not generate AI output or send through
WAHA. Full provider identifiers and lease/attempt evidence stay private while
RLS-safe conversation/message state becomes operator-visible. Media-only inbound
must project and hand off rather than complete as a missing-text no-op.

### RLS и server authorization

Все exposed tables включают RLS. Политики проверяют не только role, но и:

- organization membership;
- assignment конкретного Curator;
- sales/curator handoff state;
- owner student identity;
- разрешённый financial или administrative scope.

Custom JWT claims используются только для coarse role. Backend и Server
Components повторно проверяют authorization на record/object level. В Next.js
16 Supabase SSR использует `@supabase/ssr`, `proxy.ts`, асинхронный `cookies()`
и server authorization через `getClaims()`; `getSession()` не считается
достаточным доверенным доказательством identity.

P2C claims `platform_role` и `platform_access_version` действительны только
вместе с live active profile, organization, membership, published
role-matched permission bundle и record scope. Любое изменение authority
увеличивает server-owned access version; старый token после этого должен
получить zero rows до refresh. `service_role` не получает blanket direct DML к
Platform business tables: backend использует только узкие audited RPC grants.

Browser получает publishable key и безопасную session информацию. Supabase
secret/service-role, WAHA, amoCRM и AI provider secrets в browser bundle,
client logs или committed files запрещены.

Schema ownership во время P2:

- `public` — legacy Inbox compatibility для 001–039;
- `platform` — exposed Platform schema с explicit grants и RLS на каждой
  table;
- `platform_private` — backend-only, вне Data API и без browser grants;
- `auth`, `storage`, `vault`, `pgmq`/`pgmq_public` — provider-owned.

Browser также не получает direct access к `pgmq_public`. Legacy
`owner/admin/agent/viewer` не маппятся автоматически на Platform роли, а
legacy signup не создаёт Platform organization membership.

### Среды и migrations

Есть одна логическая Platform data model и один dedicated production Supabase
project, но среды физически разделены:

- local/dev;
- persistent staging branch/project;
- preview branches, где поддерживаются;
- production.

Production data по умолчанию не копируется в preview. P2A делает root
`supabase/` единственным источником schema/config, переносит 001–039
byte-for-byte и фиксирует checksums. После этого proof P2B добавляет migration
040 для namespace/default-grant и legacy secret containment. Merged migrations
immutable; исправление — новая forward migration. Clean reset, diff/pull
discipline и parity checks обязательны.

Local reset/migration list не доказывает managed project ledger, branch
configuration или production parity. Нельзя делать irreversible production
migration без expand/contract, backup, rollback proof и отдельного разрешения.

### Documents и Storage

Document upload принимает только PDF/JPG/PNG до 25 MB. Объекты private,
versioned и связаны с metadata; review, rework и resubmit сохраняют историю.
Integrity и malware policy должны дать явный quarantined/rejected state.
Download проходит через authenticated access или короткоживущий signed URL и
пишется в audit.

P2E покрывает только checklist, declared metadata, versions, validation,
review/rework и evidence-backed integrity/malware state. Declared type/size или
synthetic state transition не доказывает содержимое файла, успешный upload,
scanner result, preview или download. Реальный binary/object contract и
access-аудит доказывает P2H.

Прямые записи в таблицы `storage` запрещены. DB backup/PITR не включает Storage
objects, поэтому для них нужен отдельный backup и isolated restore test.
Retention и legal deletion period остаются открытым решением; необратимый
auto-delete запрещён.

P2H создаёт новые private Platform buckets через реальный local Storage API.
P2B не меняет молча legacy public `avatars`/`flow-media`; их compatibility и
future cutover проверяются отдельно. `chat-media` уже private после legacy 039.

### Manual finance

EVO Platform является manual operational finance source v1 и отдельно хранит
EVO service fee и third-party study cost. В U1 подтверждение payment/refund
event через существующий `finance.event.confirm` требует действующего
индивидуального `finance.first.payment.confirm`; название роли само по себе это
право не даёт. Создание obligation и управление stop factor пока остаются под
bundle permissions `finance.manage` и `finance.stop.manage` соответственно;
индивидуальное permission для них не заявляется. Сумма хранится целым числом в
минимальной единице одной currency; payment не может превысить остаток, а
refund обязан ссылаться на exact confirmed payment и не может превысить его
невернутую часть. Actor, effective time, source, evidence и request key
обязательны; подтверждённая история не редактируется и не удаляется.

Outstanding/overdue вычисляются из obligation, confirmed payments, valid
refunds, due time и current time. Они не берутся из amoCRM stage. Sales и
Curator видят только разрешённый operational status/next action в своём case
scope; Student — только self overdue notice и next action без amount, evidence,
transaction history и внутренних stop-factor полей.

### Messaging, queues и audit

P2E notification intent всегда адресован одному Student membership и одному
channel. Только Student управляет своим individual WhatsApp consent; staff-роли
не могут создавать неиспользуемые consent records. Individual WhatsApp intent
требует consent snapshot и dedupe; модель не имеет audience list, segment,
broadcast или mass-send объекта. Это durable database intent, а не provider
delivery.

Merged P2F contract добавляет единую conversation/message history и five-role
handoff scope. Sales владеет transcript до contract handoff, текущий Curator —
после; former Sales получает только фиксированный несекретный summary. Admin
ограничен своей organization, Finance по умолчанию не видит transcript/raw
provider data, Student видит только безопасную self history. Cross-org,
cross-student, previous-Curator и post-handoff Sales transcript access
запрещены.

WAHA webhook owner должен проверить HMAC/timestamp и сохранить private raw
event до normalized processing. P2F хранит supplied verification evidence, но
не доказывает выполнение real runtime validation. Дедупликация использует:

- `X-Webhook-Request-Id`;
- для WAHA semantic key из provider account, session, event type, `payload.id`
  и raw event variant, если он обязателен.

WAHA `message.ack` сохраняет raw ACK variant, включая неизвестный code;
`message.any` требует `NULL` variant. Kommo/amoCRM в P2F не получают
вымышленный semantic raw-event dedupe. Отдельный canonical reconciliation key
дедуплицирует normalized effect, а `unknown_result` — single-use manual-send
authorization.

Raw payload, verification evidence и processing diagnostics остаются в
backend-only boundary. Принятый database row не доказывает, что webhook был
реальным или provider event был успешно обработан. Replay одного ключа не
создаёт второе message/action, а конфликтующий replay fail-closed.

Valid media-only inbound remains a message, not an empty event. Raw evidence and
private media/provider references persist, an RLS-safe operator-visible message
is projected, and human review opens. Missing text cannot terminally consume the
item. Autonomous media understanding is outside the approved scope.

Approved versioned knowledge in pgvector is the only reusable knowledge context
for an autonomous proposal. Gemini emits structured qualification/reply data;
deterministic EVO code owns the gate. Supabase retains model, prompt, policy,
context/hash, knowledge citations, structured output, lead-memory changes,
every gate result, final rendered text/hash, transport response and later
ACK/session/human evidence.

Autonomy is limited to an exact inbound-triggered reply in the same conversation
inside the rolling 24-hour service window. Staff outbound/takeover creates an
immediate durable pause; only authorized staff may resume. Opt-out, outside
`Asia/Bishkek 09:00-21:00` until organization configuration, unsupported
language/content, media-only, low confidence, missing approved knowledge,
complaint, payment/refund, legal/privacy, guarantee risk, unhealthy WAHA or
unknown provider outcome fail closed to human review. Cold outbound, broadcast,
campaign, autonomous follow-up/re-engagement, out-of-window free-form and
model-direct WAHA sends are prohibited.

Durable work P2G идёт через две fixed Supabase Queues. Consumer-ы
идемпотентны; исчерпанные обычные ошибки переходят в dead-letter, тогда как
unknown/ambiguous manual send остаётся только в reconciliation/manual review.
Database Webhooks допустимы для асинхронного push, но не являются durable
business queue.

P5B receive/project work uses a pointer-only item, bounded lease and separate
organization/session/account-bound claim, project and finish RPCs. Retryable
projection failures remain unacknowledged until lease expiry; finite exhausted
processing records immutable dead-letter/manual-review evidence. Exact replay is
idempotent and conflicting replay fails closed. P5B has no outbound capability.

A later autonomous send intent is immutable and single-use. The send worker
rechecks policy, pause state, service/business windows, idempotency and session
health immediately before transport. Unknown/ambiguous result opens
reconciliation/human review and never creates an automatic second attempt.

P2G проверяет реальный local Supabase Queues/PGMQ contract: `read()` с
visibility timeout, concurrency, retry budget и dedupe. Handcrafted mock и
at-most-once `pop()` не являются доказательством durable retryable work.

`message.any` может связать собственные API-send события, а `message.ack` —
дать evidence для progression `ERROR`, `PENDING`, `SERVER`, `DEVICE`, `READ`,
`PLAYED`. P2F лишь хранит соответствующее состояние/provenance; реальный
provider и Queue behavior остаются недоказанными. Неизвестный send result
требует reconciliation и ручного решения, а не автоматического retry.

Audit фиксирует actor, action, object, before/after, reason, evidence reference,
request/idempotency keys и timestamp. Audit export не должен раскрывать secrets,
PII сверх разрешённого scope или полный customer message без необходимости.

The accepted root UI later receives normalized updates through private Supabase
Realtime with RLS-safe authorization. Browsers never subscribe directly to WAHA.

## Current-to-target boundary

Root SQLite, companion Supabase, Inbox and Lead Agent data are legacy/archive
sources, not current target authorities. U10 establishes the explicit net-new
cutoff/allowlist cohort and blocks legacy writes; it does not broadly migrate
active records. U14 handles approved historical/archive records after U13.

During preparation, legacy systems may remain operational for records outside
the pilot. Pilot records start and remain in EVO and cannot depend on legacy
writes or fallback.
No dual-read, dual-write, write-through, alias, fallback repository or
compatibility translation is allowed.

Provider cutover, managed migration, service retirement and rollback require
their later U-slice authority and real evidence. U0 was documentation-only and
is merged. U1 changes repository and disposable-local staff authorization only;
it performs no managed Supabase apply, amoCRM/WAHA mutation, customer send or
production action. AI remains advisory; the first live stage is receive-only.
