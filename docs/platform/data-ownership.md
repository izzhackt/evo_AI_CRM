# Владение данными в EVO Platform

- Owner: технический ответственный EVO Admissions
- Status: Target contract; current split storage remains until controlled cutover
- Last verified against repository: 2026-07-28
- Architecture decision: `docs/adr/0014-unified-evo-platform-target-architecture.md`

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
| Documents и review history | EVO Platform Supabase + private Storage | metadata, versions, integrity/malware state, access audit |
| Visa case | EVO Platform Supabase | Curator-owned operational states и evidence |
| Tasks и notifications | EVO Platform Supabase | durable state, recipient, consent, dedupe и delivery attempts |
| Obligations, payments и refunds v1 | EVO Platform Supabase | ручное Finance/Admin confirmation, evidence и audit |
| Conversation и staff workflow | EVO Platform Supabase | единая история, queue ownership, handoff и access scope |
| WhatsApp transport/session state | WAHA | отдельные `session`, message ID, ACK и reconciliation records |
| Kommo Chats identity | Kommo | отдельные `conversation.id` и `message.id`, не смешанные с WAHA IDs |
| AI output | EVO Platform Supabase | draft, model/policy version, knowledge citations и human final version |
| Audit/outbox/queue/dead-letter/reconciliation | EVO Platform Supabase | immutable append-style evidence и processing state |

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

В release v1 есть `admin`, `sales`, `curator`, `finance` и
`client/student`. Отдельной роли `visa` нет; `/visa` является module.

| Роль | Разрешённый scope |
|---|---|
| Admin | staff invite/block; role administration; Curator assign/reassign с обязательной причиной, before/after и audit; разрешённые cross-case operations |
| Sales | conversation и sales queue до contract; после handoff только разрешённый несекретный summary |
| Curator | только назначенные student cases, applications, documents, visa, tasks и communication |
| Finance | financial operations и evidence в разрешённом organization scope; без Curator reassignment |
| Client/student | только собственный portal object scope и безопасные представления |

Curator/Admin могут close или reopen student case только с обязательной причиной
и audit. Admin — permission bundle для личных аккаунтов уполномоченных
сотрудников; shared credentials запрещены.

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

Browser получает publishable key и безопасную session информацию. Supabase
secret/service-role, WAHA, amoCRM и AI provider secrets в browser bundle,
client logs или committed files запрещены.

## Среды и migrations

Есть одна логическая Platform data model и один dedicated production Supabase
project, но среды физически разделены:

- local/dev;
- persistent staging branch/project;
- preview branches, где поддерживаются;
- production.

Production data по умолчанию не копируется в preview. Источник схемы —
versioned migrations и `supabase/config.toml`; clean reset, diff/pull discipline
и parity checks обязательны. Нельзя делать irreversible production migration
без expand/contract, backup и rollback proof.

## Documents и Storage

Document upload принимает только PDF/JPG/PNG до 25 MB. Объекты private,
versioned и связаны с metadata; review, rework и resubmit сохраняют историю.
Integrity и malware policy должны дать явный quarantined/rejected state.
Download проходит через authenticated access или короткоживущий signed URL и
пишется в audit.

Прямые записи в таблицы `storage` запрещены. DB backup/PITR не включает Storage
objects, поэтому для них нужен отдельный backup и isolated restore test.
Retention и legal deletion period остаются открытым решением; необратимый
auto-delete запрещён.

## Messaging, queues и audit

WAHA webhook owner сохраняет raw event до обработки, проверяет HMAC/timestamp и
dedupe-ит:

- `X-Webhook-Request-Id`;
- бизнес-ключ `session + payload.id`.

Durable work идёт через Supabase Queues. Consumer-ы идемпотентны; исчерпанные
ошибки переходят в dead-letter и reconciliation. Database Webhooks допустимы
для асинхронного push, но не являются durable business queue.

`message.any` связывает собственные API-send события, а `message.ack` хранится
как progression `ERROR`, `PENDING`, `SERVER`, `DEVICE`, `READ`, `PLAYED`.
Неизвестный send result требует reconciliation и ручного решения, а не
автоматического retry.

Audit фиксирует actor, action, object, before/after, reason, evidence reference,
request/idempotency keys и timestamp. Audit export не должен раскрывать secrets,
PII сверх разрешённого scope или полный customer message без необходимости.

## Current-to-target boundary

До контролируемого cutover root SQLite, отдельный Inbox Supabase и состояние
Lead Agent остаются текущими runtime sources в своих старых путях. Target
ownership не даёт права выполнять production migration, dual-write или
отключать старый webhook.

Переход требует read-only inventory и backup, deterministic UUID mapping,
dry-run counts/orphans/checksums, staging import, временное dual-read сравнение,
rollback rehearsal и отдельное разрешение. Постоянный dual-write не является
целевой архитектурой.
