# Владение данными в EVO Platform

- Owner: технический ответственный EVO Admissions
- Status: Target contract; current split storage remains until controlled cutover
- Last verified against repository: 2026-07-29
- Architecture decision: `docs/adr/0014-unified-evo-platform-target-architecture.md`
- Supabase boundary: `docs/adr/0015-establish-canonical-supabase-schema-and-migration-boundary.md`

## Зачем фиксировать владельца

«Владелец» здесь означает систему, в которой запись считается канонической.
Копия внешнего ID, shadow field или синхронизированное представление не меняют
владельца. Это правило предотвращает расхождение sales stage, ответственного
менеджера и admissions status.

## Канонические владельцы

| Данные | Канонический владелец | Что хранит EVO Platform |
|---|---|---|
| Contact и его amoCRM identity | amoCRM | `amo_contact_id`, внутренний UUID и безопасные operational links |
| Lead | amoCRM | `amo_lead_id`, link status и sync metadata |
| Responsible sales manager | amoCRM | ссылку на account-specific user и version mapping |
| Sales pipeline и sales stage | amoCRM | ссылку и последнюю подтверждённую sync-версию |
| Signed-contract signal | account-specific amoCRM status mapping | подтверждённое событие, создавшее pending student case |
| Staff identity и platform role | Supabase Auth + Platform profiles | account, role claims, organization membership, block/invite audit |
| Student case и Curator assignment | EVO Platform Supabase | весь operational lifecycle и audited reassignment |
| University applications | EVO Platform Supabase | несколько параллельных applications одного студента |
| Document metadata и review history | EVO Platform Supabase | checklist, versions, validation, integrity/malware evidence state и review/rework history |
| Document binary objects | private Platform Storage после P2H | private objects, object-policy enforcement, download/access audit и separate backup |
| Visa case | EVO Platform Supabase | Curator-owned operational states и evidence |
| Tasks | EVO Platform Supabase | assignment, priority, due/status и lifecycle history |
| Notification intent v1 | EVO Platform Supabase | один recipient, in-app/individual-WhatsApp channel, consent snapshot и dedupe |
| WhatsApp provider delivery/ACK | WAHA | наблюдаемое provider evidence, ACK progression и reconciliation state; Platform record не создаёт provider truth |
| Obligations, payments и refunds v1 | EVO Platform Supabase | ручное Finance/Admin confirmation, evidence и audit |
| Conversation и staff workflow | EVO Platform Supabase | единая история, role queue ownership, handoff и access scope |
| WhatsApp transport/session state | WAHA | отдельные `session`, message ID, ACK и reconciliation records |
| Kommo Chats identity | Kommo | отдельные `conversation.id` и `message.id`, не смешанные с WAHA IDs |
| AI draft evidence | EVO Platform Supabase | explicit request/source message, provider/model/prompt-policy references, source context + SHA, approved-knowledge citations, original generated text, review evidence и exact human final text + SHA |
| Communications audit/reconciliation state | EVO Platform Supabase после P2F | immutable append-style evidence; не доказательство Queue или provider delivery |
| Outbox/queue/dead-letter processing | EVO Platform Supabase после P2G | durable work, attempts, retry budget, dead-letter и manual reconciliation |

Operational admissions status никогда не записывается как замена sales stage.
Canonical amoCRM writes используют `pipeline_id`, `status_id`,
`responsible_user_id` и `custom_fields_values` только после account discovery.

## Account-specific amoCRM mapping

Pipeline, status, custom-field и user IDs уникальны для аккаунта. Adapter
обязан:

1. обнаружить значения через API;
2. сохранить versioned mapping с account identity и временем проверки;
3. блокировать canonical write при отсутствующем или устаревшем mapping;
4. быстро сохранять webhook, обрабатывать его асинхронно и идемпотентно;
5. периодически выполнять reconciliation и отмечать conflicts;
6. соблюдать лимит не более 7 requests/s/IP и предпочитать не более 50 writes
   в одном batch.

Точный production mapping остаётся release blocker до проверки на выделенном
sanitized test lead. Глобальные hardcoded stage IDs запрещены.

## Platform roles и object scope

В release v1 есть `admin`, `sales`, `curator`, `finance` и `student`;
Client/Student — user-facing label последней роли. Текущий root identifier
`client` остаётся legacy до explicit P3 mapping и не создаёт Platform
membership автоматически. Отдельной роли `visa` нет; `/visa` является module.

| Роль | Разрешённый scope |
|---|---|
| Admin | staff invite/block; role administration; Curator assign/reassign с обязательной причиной, before/after и audit; разрешённые cross-case operations |
| Sales | conversation и sales queue до contract; после handoff только разрешённый несекретный summary |
| Curator | только назначенные student cases, applications, documents, visa, tasks и communication |
| Finance | financial operations и evidence в разрешённом organization scope; без Curator reassignment |
| Student (Client/Student UI) | только собственный portal object scope и безопасные представления |

Curator/Admin могут close или reopen student case только с обязательной причиной
и audit. Admin — permission bundle для личных аккаунтов уполномоченных
сотрудников; shared credentials запрещены.

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
fixed self history; Finance не получает sensitive document access. В finance
Admin/Finance подтверждают evidence-bearing events, а Sales, текущий Curator и
Student используют отдельные безопасные projections. Полный контракт:
[`p2e-documents-finance-notifications.md`](p2e-documents-finance-notifications.md).
PR #88 merged migration 043 as
`aac1cba851e89070a7eb54baab4eddf921e3447c`; exact-main CI
[30402311903](https://github.com/izzhackt/evo_AI_CRM/actions/runs/30402311903)
зелёный. Это repository evidence, а не Storage, provider или production proof.

P2F candidate начинается от этого checkpoint и добавляет additive migration
044 для unified communications/provider identity/draft-only AI data
contracts. Frozen artifact содержит 6,881 lines и 194,076 bytes; SHA-256
`8d52b476981faed4a42a9c13ff2813a718bde6ad4aea1b315c4d61be9fd1ebc8`.
Внутренние UUID, WAHA session/message IDs, Kommo
conversation/message IDs и amoCRM contact/lead IDs остаются отдельными
namespaces. Private raw payload/evidence сохраняется до normalized processing;
browser получает только разрешённые transcript/safe-summary projections.
Подробная граница:
[`p2f-communications-contracts.md`](p2f-communications-contracts.md).

## RLS и server authorization

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

## Среды и migrations

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

## Documents и Storage

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

## Manual finance

EVO Platform является manual operational finance source v1 и отдельно хранит
EVO service fee и third-party study cost. Только Finance/Admin подтверждают
obligation, payment, refund или stop factor. Сумма хранится целым числом в
минимальной единице одной currency; payment не может превысить остаток, а
refund обязан ссылаться на exact confirmed payment и не может превысить его
невернутую часть. Actor, effective time, source, evidence и request key
обязательны; подтверждённая история не редактируется и не удаляется.

Outstanding/overdue вычисляются из obligation, confirmed payments, valid
refunds, due time и current time. Они не берутся из amoCRM stage. Sales и
Curator видят только разрешённый operational status/next action в своём case
scope; Student — только self overdue notice и next action без amount, evidence,
transaction history и внутренних stop-factor полей.

## Messaging, queues и audit

P2E notification intent всегда адресован одному Student membership и одному
channel. Только Student управляет своим individual WhatsApp consent; staff-роли
не могут создавать неиспользуемые consent records. Individual WhatsApp intent
требует consent snapshot и dedupe; модель не имеет audience list, segment,
broadcast или mass-send объекта. Это durable database intent, а не provider
delivery.

P2F candidate добавляет единую conversation/message history и five-role
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

Approved versioned knowledge — единственный разрешённый AI context. P2F хранит
immutable original draft/evidence отдельно от human edit/final text. Customer
draft разрешён только на RU/EN; uncertain или другой язык требует manual
selection/handoff. Кыргызский customer draft, auto-reply, unattended outbound,
broadcast и mass send запрещены. Review/manual-send evidence не доказывает
provider send.

Durable work относится к P2G и идёт через Supabase Queues. Consumer-ы
идемпотентны; исчерпанные ошибки переходят в dead-letter и reconciliation.
Database Webhooks допустимы для асинхронного push, но не являются durable
business queue.

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

## Current-to-target boundary

До контролируемого cutover root SQLite, отдельный Inbox Supabase и состояние
Lead Agent остаются текущими runtime sources в своих старых путях. Target
ownership не даёт права выполнять production migration, dual-write или
отключать старый webhook.

P2 добавляет новые schemas/tables без rename/drop legacy objects, root-auth
cutover, real-secret copy или legacy bucket flip. Root auth/SQLite migration
остаётся P3, а Inbox/Lead Agent/WAHA cutover — P5.

Переход требует read-only inventory и backup, deterministic UUID mapping,
dry-run counts/orphans/checksums, staging import, временное dual-read сравнение,
rollback rehearsal и отдельное разрешение. Постоянный dual-write не является
целевой архитектурой.
