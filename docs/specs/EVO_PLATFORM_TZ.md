# Техническое задание

## Единая платформа автоматизации EVO Admissions

**Идентификатор документа:** EVO-PLATFORM-TZ-001
**Версия:** 1.0
**Статус:** проект для согласования владельцем бизнеса
**Дата:** 26 июля 2026 года
**Базовая версия репозитория:** `0ecd95d6b248572269bec17d60072a49230e626e`
**Язык документа:** русский

> **Назначение документа.** Это ТЗ является контрактом на последующую
> реализацию единой EVO Admissions Platform. Оно не утверждает, что внешние
> интеграции уже работают, и не разрешает начинать backend-миграцию до
> письменного согласования раздела 32.

## Карточка документа

| Поле | Значение |
| --- | --- |
| Заказчик | EVO Admissions |
| Владелец продукта | Назначается руководством EVO Admissions |
| Владелец бизнес-процессов | Назначается руководством EVO Admissions |
| Технический владелец | Назначается руководством EVO Admissions |
| Разработчик | Команда реализации EVO Platform |
| Объект автоматизации | Продажи, коммуникации, поступление, документы, визы, финансы, задачи, отчётность и кабинет студента |
| Формат согласования | Письменное утверждение версии и открытых решений |
| Источник бренда | `docs/company/brand/evo-admissions-logobook.pdf` |
| Принятый preset | `standard_business_brief` |

> **Главная граница.** amoCRM остаётся источником истины для контакта, лида,
> менеджера и стадии продаж. Supabase хранит собственные операционные данные
> EVO Platform.

## 1. Как читать это ТЗ

В документе используются пять типов утверждений:

- **Текущее состояние** — подтверждено кодом, миграциями, документацией или
  зафиксированной проверкой.
- **Обязательное решение** — уже согласованная граница будущей платформы.
- **Требование** — то, что должна обеспечить реализация.
- **Открытое решение** — вопрос, который должен утвердить владелец до
  соответствующего этапа.
- **Будущая опция** — не входит в первый production-запуск.

Слова **MUST / обязательно**, **SHOULD / желательно** и **MAY / опционально**
задают приоритет. Если требование с приоритетом MUST не выполнено или не
проверено указанным способом, соответствующий этап не считается завершённым.

Статусы внешних интеграций:

| Статус | Что означает |
| --- | --- |
| Не настроено | Нет утверждённых или действующих реквизитов подключения |
| Настроено, не проверено | Конфигурация присутствует, но реальный вызов не доказан |
| Проверено на тестовой среде | Выполнен реальный контролируемый сценарий без production-пользователей |
| Проверено в production | Выполнен утверждённый сценарий на рабочем контуре и сохранены доказательства |
| Ошибка / деградация | Интеграция не выполняет контракт; данные и действия не должны изображаться успешными |

## 2. Резюме решения

EVO Admissions нужна единая рабочая платформа, чтобы сотрудник видел
ответственного, историю коммуникаций, текущий этап продажи, состояние
поступления, документы, заявки, визу, оплаты, задачи и следующие действия в
одном интерфейсе. Студенту нужен отдельный безопасный кабинет с прогрессом,
документами, сообщениями и понятными блокировками.

Целевая система строится поверх уже завершённого frontend EVO Platform, но не
поверх текущих разрозненных баз как равноправных источников. Архитектура должна
устранить дублирование EVO Inbox и EVO Lead Agent, не потеряв полезную логику
amoCRM, WhatsApp, AI-черновиков, повторов, handoff и аудита.

Обязательные решения:

1. amoCRM остаётся единственным источником истины для контакта, лида,
   ответственного менеджера и стадии продаж.
2. Supabase становится основным хранилищем собственных данных EVO Platform:
   пользователей, ролей, студенческих дел, заявок, документов, виз, финансовых
   обязательств, задач, коммуникаций, AI-черновиков, синхронизации и аудита.
3. Используется один Supabase-проект на каждую среду: development, staging и
   production. Inbox и CRM не получают отдельные production-проекты.
4. Используется один входящий WhatsApp/WAHA-контур и одна активная сессия на
   первом этапе.
5. Полезная логика EVO Lead Agent переносится в единый backend как модули
   интеграции и фоновой обработки.
6. EVO Lead Agent не удаляется до реального end-to-end доказательства,
   сверки данных, окна отката и письменного решения владельца.
7. AI создаёт только черновик. Сотрудник проверяет, редактирует и вручную
   отправляет каждое клиентское сообщение.
8. Продажная воронка и операционный путь студента — разные модели.
9. Figma, прототипы и скриншоты являются дизайн-доказательствами, но не
   заменяют это ТЗ и не доказывают работу внешнего provider.

## 3. Цели и измеримый результат

### 3.1 Бизнес-цели

- убрать повторный ввод одного и того же клиента в нескольких системах;
- сделать ответственность, следующий шаг и срок видимыми для команды;
- сократить ручной поиск сообщений, документов и истории решений;
- не допускать незаметной потери лида, сообщения, документа или задачи;
- обеспечить прозрачный аудит действий сотрудников и интеграций;
- дать студенту понятный маршрут без доступа к чужим данным;
- сохранить привычную amoCRM как каноническую систему продаж;
- подготовить основу для управленческой отчётности без «нарисованных» KPI.

### 3.2 Критерии результата первого production-запуска

- сотрудник входит под собственной учётной записью и видит только разрешённые
  разделы и записи;
- входящий WhatsApp-контакт связан с каноническим контактом и лидом amoCRM;
- история разговора, AI-черновик, ручная отправка и статусы доставки сохранены
  в одной последовательной истории;
- после договора создаётся связанное операционное дело студента без создания
  второго независимого лида;
- документы, заявки, визовый кейс, платежные обязательства и задачи ведутся
  отдельными объектами;
- студент видит только своё дело, свои файлы и свои сообщения;
- каждое чувствительное изменение имеет автора, время, исходное и новое
  значение либо ссылку на неизменяемое событие;
- финальный контролируемый сценарий проходит по цепочке:
  **WhatsApp → amoCRM → EVO Platform → AI-черновик → ручная отправка →
  delivery/read status → audit history**.

## 4. Источники и порядок приоритета

После утверждения этого документа противоречия разрешаются в следующем порядке:

1. письменное решение владельца EVO Admissions;
2. утверждённая версия этого ТЗ и зарегистрированные изменения к нему;
3. ADR, launch-plan и security/runbook репозитория;
4. production-код, миграции и проверенные интеграционные контракты;
5. бизнес-процесс и утверждённая база знаний;
6. дизайн-материалы и принятый frontend;
7. исходное ТЗ «Платформа автоматизации ОЗО» как контекст первой итерации.

Исходный документ ОЗО содержит полезные потребности, но не является
автоматически правильной архитектурой. Его предположения о владельце оплаты,
«CRM» как одной системе, автоматической AI-валидации и мгновенных webhook
должны подтверждаться отдельными контрактами.

### 4.1 Проверенный набор источников

- 892 отслеживаемых файла репозитория на базовом коммите;
- корневая Next.js EVO CRM и её SQLite-модель;
- EVO Inbox, миграции Supabase и серверные маршруты;
- EVO Lead Agent, его FastAPI/SQLite/amoCRM/WAHA контракты;
- `CONTEXT.md`, действующие ADR и launch-plan;
- бизнес-контекст, процесс поступления и матрица владельцев данных;
- итоговый frontend audit, completion checklist и дизайн-review closure;
- EVO Admissions logobook;
- исходный `TZ_Platforma_avtomatizacii_OZO.docx`;
- ограниченная read-only проверка открытой amoCRM 23 июля 2026 года.

Операционный screenshot amoCRM с именами сотрудников и реальными показателями
не включён в документ, чтобы не распространять персональные и внутренние
данные. В ТЗ используются обезличенные screenshots EVO Platform.

## 5. Текущее состояние системы

Текущий репозиторий уже содержит три технических контура вокруг amoCRM.

| Компонент | Назначение сейчас | Хранилище | Главный риск |
| --- | --- | --- | --- |
| Корневая EVO CRM | Staff UI: продажи, клиенты, заявки, документы, виза, финансы, задачи, звонки, WhatsApp-контекст | Локальная SQLite | Локальные записи могут расходиться с amoCRM и Inbox |
| EVO Inbox | WhatsApp UI, контакты, история, AI-черновики, ручная отправка | Supabase/Postgres | Собственные contacts/deals/pipeline могут стать вторым CRM |
| EVO Lead Agent | WAHA webhook, amoCRM resolution, заметки, задачи, AI-решение и sync в CRM | Локальная SQLite | Отдельный runtime, отдельная память и незавершённый retry/replay контракт |
| amoCRM | Контакт, лид, ответственный, стадия продаж | Внешний SaaS | Webhook/API могут задержаться или временно быть недоступны |
| WAHA | Приём и отправка WhatsApp, session/status/ack events | Приватный runtime | Дубли webhook, неизвестный результат send, QR/session failure |

Текущая система имеет две WAHA-сессии и два webhook-пути. Это было безопасной
границей для параллельной проверки Inbox, но не является целевой архитектурой
единой платформы.

### 5.1 Что уже можно переиспользовать

- завершённый responsive frontend staff workspace и Student Portal;
- серверные проверки маршрутов для ролей;
- доменные статусы продаж и поступления;
- Supabase Auth, RLS, аккаунты, разговоры, сообщения и настройки Inbox;
- idempotency входящих WAHA-сообщений;
- неизменяемые AI draft и acknowledgement audit records;
- amoCRM contact/lead resolution и внутренний signed-sync шаблон;
- handoff, буферизация, readiness/preflight и безопасные feature flags;
- существующие проверки lint, type, build, security, scenarios и Playwright.

### 5.2 Что нельзя считать доказанным

- реальная отправка WhatsApp и provider acknowledgement в новом едином пути;
- live OAuth и двусторонняя синхронизация amoCRM;
- production-связь корневого `/whatsapp` с Supabase Inbox;
- реальное Supabase-хранилище документов студента;
- payment gateway, telephony, email delivery или автоматическая подача в вуз;
- production AI generation как утверждённая бизнес-функция;
- автоматические ответы клиенту;
- готовность удаления Lead Agent.

## 6. Целевая архитектура

### 6.1 Архитектурный стиль

Первый production-релиз должен быть **модульным монолитом**: один продукт,
один backend-контур и одна схема данных на среду, но отдельные модули с
явными обязанностями. Это уменьшает число сетевых отказов и синхронизаций.
Разделение на microservices допускается позже только по измеренной нагрузке или
организационной необходимости.

Целевые модули:

- Web Staff Workspace;
- Student Portal;
- Authentication and Access;
- amoCRM Adapter;
- WhatsApp/WAHA Adapter;
- Communications and AI Drafts;
- Admissions Operations;
- Documents and Storage;
- Finance and Stop Factors;
- Tasks, Notifications and Team Collaboration;
- Reporting and Audit;
- Background Jobs, Outbox and Reconciliation.

### 6.2 Целевая схема взаимодействия

```text
Клиент WhatsApp
      |
      v
Приватная WAHA session
      |
      v
Единый webhook EVO Platform -> Event Inbox / Deduplication
      |                                  |
      |                                  v
      |                           Background Jobs
      v                                  |
amoCRM Adapter <-> amoCRM                v
      |                           Supabase/Postgres
      v                                  ^
Linked Lead/Contact Read Model            |
      |                                   |
      +----------> Staff Workspace <------+
                         |
                         v
                  AI Draft (no auto-send)
                         |
                         v
                  Human approval -> Outbox -> WAHA

Student Portal -> Supabase Auth/RLS -> Admissions, Documents, Finance, Messages
```

### 6.3 Среды и Supabase

| Среда | Назначение | Данные | Внешние provider |
| --- | --- | --- | --- |
| Development | Локальная разработка и автоматические тесты | Синтетические/обезличенные | Mocks или sandbox, явно помеченные |
| Staging | Реальные интеграционные проверки до релиза | Обезличенные либо специально разрешённые тестовые записи | Тестовые аккаунты/номер |
| Production | Рабочая система EVO Admissions | Реальные данные в утверждённом объёме | Production accounts |

Для каждой среды создаётся отдельный Supabase project с одинаковыми миграциями.
Внутри одной среды Inbox, CRM, Admissions и Portal используют одну схему
платформы, а не разные проекты. Schema changes хранятся в Git и применяются
последовательно через официальный migration workflow. Production secrets и
service-role key не передаются в браузер.

### 6.4 Границы источников истины

| Факт | Единственный владелец | Что хранит EVO Platform | Кто может менять |
| --- | --- | --- | --- |
| Контакт, lead ID, ответственный менеджер, sales stage | amoCRM | ID, нормализованный read model, sync status, version/timestamp | Через amoCRM API и разрешённый UI |
| Профиль пользователя и роль | Supabase Auth + EVO profile/role tables | Учётная запись, роль, scope, status | Admin по утверждённому процессу |
| Операционное дело студента | EVO Platform | Полная рабочая модель и история | Разрешённые сотрудники |
| Заявка в университет | EVO Platform; решение принадлежит внешнему вузу | Статусы, evidence, deadlines, response | Куратор; внешний result только по evidence |
| Документ и review | EVO Platform + private Storage | Metadata, versions, checks, decisions | Студент загружает; сотрудник принимает решение |
| Визовый result | Внешний орган | Case, tasks, received decision evidence | Visa role records evidence |
| Финансовое обязательство | EVO Platform или утверждённая учётная система | Obligation, invoice/reference, payment evidence, sync state | Finance; источник утверждается |
| WhatsApp transport status | WAHA | Durable event, normalized status, unknown state | Только server integration |
| Разговор и сообщения | EVO Platform | Полная durable history и links | Server ingest; employee manual outbound |
| AI-черновик | EVO Platform | Prompt/context version, output, evidence, reviewer action | Server creates; employee reviews |
| Audit event | EVO Platform append-only audit | Actor, action, target, before/after hash, source, time | Server only |
| Admission/visa decision | Университет/орган | Полученный результат и evidence | Сотрудник фиксирует без переименования в «гарантию» |

## 7. Модель данных

### 7.1 Обязательные группы сущностей

1. **Организация и доступ:** organizations, profiles, roles, permissions,
   role_permissions, user_scopes, invitations, sessions.
2. **amoCRM read model:** amo_contacts, amo_leads, amo_users,
   amo_pipeline_stages, amo_sync_events, amo_sync_conflicts.
3. **Студент:** student_cases, student_profiles, admissions_routes,
   case_assignments, case_updates.
4. **Поступление:** university_applications, application_events, offers,
   enrollment_events.
5. **Документы:** document_requirements, document_slots, document_versions,
   document_reviews, document_access_events.
6. **Виза:** visa_cases, visa_requirements, visa_events.
7. **Финансы:** payment_obligations, payment_events, payment_evidence,
   stop_factors.
8. **Работа команды:** tasks, task_events, notifications, calls,
   team_channels, team_messages.
9. **Коммуникации:** whatsapp_accounts, conversations, participants, messages,
   message_events, provider_raw_events.
10. **AI:** ai_drafts, ai_context_snapshots, knowledge_documents,
    knowledge_chunks, ai_review_events.
11. **Надёжность:** integration_outbox, job_queue, dead_letter_events,
    idempotency_keys, reconciliation_runs.
12. **Контроль:** audit_events, access_events, integration_health_snapshots.

### 7.2 Идентификаторы и связи

- Внутренние сущности используют UUID.
- Внешние ID хранятся отдельно с указанием provider и environment.
- `amo_contact_id` и `amo_lead_id` уникальны в пределах организации и
  amoCRM-аккаунта.
- Телефон нормализуется к E.164, но не является единственным первичным ключом.
- Provider message ID уникален в пределах WAHA session/account.
- Inbound idempotency key обязательно включает `account_id`, session и
  provider message ID; глобального ключа только из session/message недостаточно.
- Студенческое дело связывается с amo lead/contact, но не наследует sales stage
  как операционный статус.
- Каждая заявка, версия документа, оплата и решение имеют собственный ID и
  отдельную историю.
- Hard delete чувствительных business records запрещён через обычный UI.

### 7.3 Состояния синхронизации

Каждая внешняя ссылка должна иметь один из статусов:

`unlinked`, `pending`, `linked`, `stale`, `conflict`, `failed`, `disabled`.

Поле `linked` разрешено показывать только после подтверждённого внешнего ID.
`configured` не равно `linked`, а HTTP timeout не равно success или failure
бизнес-действия.

## 8. Синхронизация amoCRM

### 8.1 Правила чтения и записи

- Все изменения контакта, ответственного и sales stage сначала отправляются в
  amoCRM.
- Локальный read model обновляется после подтверждённого API response или
  канонического webhook/reconciliation.
- Если amoCRM недоступна, платформа не создаёт «успешное» локальное изменение
  канонического поля.
- Неканонические admission-поля не записываются в amoCRM без отдельной mapping
  таблицы и business approval.
- Webhook быстро валидируется, сохраняется и подтверждается; тяжёлая обработка
  выполняется асинхронно.
- Периодическая reconciliation сверяет изменения, пропущенные webhook.

### 8.2 Поиск, создание и дубли

1. Нормализовать телефон и email.
2. Искать точное совпадение в amoCRM по разрешённым полям.
3. Если найден один контакт — проверить связанные активные leads.
4. Если найдено несколько кандидатов — создать `conflict`, не объединять
   автоматически.
5. Если контакт отсутствует — создать его идемпотентно.
6. Найти или создать lead в утверждённой pipeline и начальном status.
7. Сохранить внешние ID и evidence ответа.
8. Назначить ответственного по утверждённому business rule.

### 8.3 Конфликт

Конфликт обязан показывать:

- какие записи конкурируют;
- какие поля различаются;
- какой источник владеет каждым полем;
- время последней подтверждённой синхронизации;
- безопасные варианты: обновить из amoCRM, повторить запрос, связать вручную,
  передать Admin;
- полный audit решения.

## 9. WhatsApp, WAHA и коммуникации

### 9.1 Единый входящий путь

Первый production-релиз использует одну WAHA session и один private webhook
EVO Platform. Dashboard/API WAHA не публикуются в internet.

Минимальные события:

- `message` — входящее/исходящее сообщение;
- `message.ack` — изменение доставки/прочтения;
- `session.status` — состояние session;
- при подтверждённой необходимости — message reaction/media events.

Webhook проверяет HMAC по raw body, timestamp и request ID. Повторная доставка
не должна создавать второе сообщение или повторное business-действие.

### 9.2 Статусы сообщения

Платформа хранит и показывает точные состояния:

`received`, `prepared`, `sent`, `delivered`, `read`, `failed`, `unknown`.

- `prepared` означает запись в outbox, а не отправку provider.
- `sent` допустим только после подтверждённого ответа send API.
- `delivered` и `read` приходят из acknowledgement.
- При timeout/неясном ответе статус — `unknown`; автоматический resend
  запрещён до reconciliation или решения сотрудника.
- Неизвестный provider code сохраняется как raw event и не переводится в
  «доставлено».
- Acknowledgement меняет статус только вперёд
  `sent -> delivered -> read`; поздний или повторный event не понижает status.

### 9.3 Ручная отправка

1. Сотрудник открывает разговор.
2. Платформа показывает канонический lead/contact context и sync state.
3. Сотрудник пишет текст либо запрашивает AI-черновик.
4. Сотрудник проверяет и при необходимости редактирует текст.
5. Сотрудник нажимает «Отправить».
6. Server фиксирует immutable draft/review evidence и создаёт outbox record с
   idempotency key.
7. Worker выполняет один controlled send.
8. Результат и acknowledgement дописываются в историю.
9. Ошибка или unknown state видимы и требуют безопасного следующего действия.

## 10. AI-черновики

AI используется только как помощник сотрудника.

Обязательные правила:

- автоматическая отправка клиенту выключена;
- draft создаётся только по явному действию сотрудника;
- в audit сохраняются provider, model, prompt version, context snapshot,
  knowledge evidence, output, requester, timestamp и итоговая редакция;
- AI не утверждает цену, срок, наличие, визу, грант, поступление или другой
  внешний outcome без owner-approved evidence;
- чувствительные данные отправляются внешнему AI только по утверждённой
  privacy/data-processing политике;
- unsupported вопрос вызывает handoff, а не уверенный вымысел;
- AI не принимает финальное решение по документу, оплате, заявке или визе;
- качество измеряется по принятию/редактированию draft, handoff, ошибкам и
  grounded evidence, а не по количеству автоматически отправленных ответов.

## 11. Пользователи, роли и доступ

### 11.1 Базовые роли первого запуска

| Роль | Основная ответственность | Ограничение |
| --- | --- | --- |
| Admin | Пользователи, роли, настройки, интеграции, audit и полный операционный обзор | Доступ к secret value не показывается после сохранения |
| Sales | Лиды, pipeline, Lead 360, звонки, консультации, WhatsApp и старт дела студента | Не утверждает document/visa/payment evidence вне разрешения |
| Curator | Student 360, стратегия, заявки, документы, задачи и коммуникации | Не меняет каноническую sales stage напрямую в локальной БД |
| Visa | Визовая очередь, требования, evidence, задачи и связанные документы | Нет доступа к системным secret и sales administration |
| Finance | Обязательства, фактические оплаты, debt/stop factor и финансовые отчёты | Нет доступа к содержимому чувствительных документов без необходимости |
| Client / Student | Свой портал, свои задачи, документы, заявки, платежные статусы и сообщения | Только собственное дело; никаких staff/API administration функций |

«ОЗО», «ОП», «руководство» и «оператор Inbox» из исходного документа являются
бизнес-функциями. В первом запуске они назначаются одной или нескольким
базовым ролям. Отдельная роль Leadership или настраиваемые custom roles
добавляются только после утверждения матрицы полномочий.

### 11.2 Базовая матрица разделов

| Раздел | Admin | Sales | Curator | Visa | Finance | Student |
| --- | --- | --- | --- | --- | --- | --- |
| Dashboard | Полный | Свой/командный scope | Свой scope | Свой scope | Финансовый scope | Нет |
| Sales / Lead 360 | Полный | Чтение и работа | Только связанный контекст | Связанный контекст | Только разрешённый read | Нет |
| Clients / Student 360 | Полный | Связанные дела | Назначенные дела | Назначенные visa cases | Финансовый read | Только своё дело |
| Applications | Полный | Read/start handoff | Работа и решения EVO | Read для visa context | Нет по умолчанию | Только свои |
| Documents | Полный | Read по делу | Review/work | Связанные visa docs | Только payment evidence | Свои upload/resubmit |
| Visa | Полный | Read | Work/read | Полная работа | Read payment-related | Только свой кейс |
| WhatsApp | Полный | Assigned/team | Assigned | Нет по умолчанию | Нет по умолчанию | Свои portal messages |
| Calls | Полный | Работа | Нет по умолчанию | Нет | Нет | Нет |
| Tasks/Notifications/Chat | Полный | Свой scope | Свой scope | Свой scope | Свой scope | Свои notifications/messages |
| Reports | Полный | Sales | Admissions при утверждении | Visa при утверждении | Finance | Нет |
| Finance | Полный | Статус без чувствительных деталей | Статус/stop factor | Статус/stop factor | Полная работа | Свои обязательства |
| Settings/Integrations/Audit | Полный по политике | Нет | Нет | Нет | Нет | Нет |

### 11.3 Правила авторизации

- Проверка выполняется server-side для каждого route, action, API и object.
- Скрытие кнопки не является контролем доступа.
- Supabase RLS повторяет object-level ограничения для прямого browser access.
- Service-role используется только на server и обходит RLS, поэтому каждый
  service route обязан повторно проверять actor, organization, scope и action.
- Admin не может выдать себе несуществующее business approval.
- Изменение роли, scope, integration config, payment evidence, document
  decision и destructive action всегда попадает в audit.
- Удалённый или заблокированный сотрудник теряет sessions и доступ.
- Student identity должен быть однозначно связан с одним или несколькими
  разрешёнными student cases; доступ к чужому UUID возвращает 403/404 без
  утечки существования записи.
- Экспорт чувствительных данных требует отдельного permission и audit.

## 12. Основные пользовательские сценарии

### 12.1 Новый лид из WhatsApp

1. WAHA доставляет signed webhook.
2. Platform проверяет HMAC/timestamp и сохраняет raw event.
3. Deduplication проверяет provider message ID и session.
4. amoCRM Adapter ищет контакт и активный lead.
5. При однозначном совпадении сохраняются canonical IDs; при нескольких
   кандидатах создаётся conflict.
6. Сообщение появляется в Inbox с владельцем, sales stage и sync status.
7. Сотрудник отвечает вручную либо запрашивает AI draft.
8. Все действия и provider acknowledgements сохраняются.

### 12.2 Лид уже существует в amoCRM

Платформа не создаёт новый contact/lead. Она связывает разговор с существующей
записью, показывает ответственного и stage, а любые изменения канонических
полей выполняет через amoCRM.

### 12.3 Переход от продажи к делу студента

1. Sales подтверждает договор или утверждённое business condition.
2. Платформа проверяет linked amo lead/contact и отсутствие существующего
   student case.
3. Создаётся student case с отдельным operational stage.
4. Назначаются manager/curator и admissions route.
5. Создаётся checklist и первичные задачи.
6. При утверждённой политике создаётся или активируется portal account.
7. amoCRM получает ссылку/заметку, но operational stage не подменяет sales
   stage.

### 12.4 Документ студента

1. Система показывает требование, формат, срок и объяснение.
2. Student загружает файл в private Storage.
3. Server проверяет тип, размер, malware/quality rule и создаёт новую version.
4. AI может сформировать наблюдение, но не решение.
5. Curator/Visa открывает preview и выбирает approve, correction required или
   reject с причиной.
6. Student видит status, комментарий и действие resubmit.
7. Предыдущая version и review history не исчезают.

### 12.5 Заявка в университет

Каждая заявка относится к одному student case, одному university/program и
одному intake. Preparation, submission, provider response, offer, rejection и
enrollment фиксируются как отдельные события с evidence и owner. Один status
студента не заменяет статусы нескольких заявок.

### 12.6 Визовый кейс

Visa specialist видит очередь, completeness, appointment, submission,
provider decision, риски и next action. Approval/rejection отображается только
после фиксации внешнего evidence. Платформа не обещает визу.

### 12.7 Финансовый stop factor

Finance создаёт обязательство и фиксирует evidence оплаты. Если утверждённое
правило требует оплаты до действия, система создаёт видимую блокировку с
причиной, ответственным и следующим шагом. Блокировка снимается только по
подтверждённому событию или audit-решению уполномоченного сотрудника.

### 12.8 Student Portal

Student видит progress, next action, deadlines, documents, applications, visa,
payments, messages, notifications, EVO team и security profile. Отсутствующий
provider или storage не изображается успешным действием.

## 13. Функциональные требования

### 13.1 Foundation, identity and access

| ID | Требование | Приоритет | Проверка |
| --- | --- | --- | --- |
| FR-001 | Система должна поддерживать отдельные staff и student login flows с безопасной session lifecycle. | MUST | E2E login/logout/expiry |
| FR-002 | Каждый пользователь должен иметь organization, status, role и object scope. | MUST | DB constraints + auth tests |
| FR-003 | Staff roles первого запуска: admin, sales, curator, visa, finance; client/student отделён от staff. | MUST | Migration + route matrix |
| FR-004 | Все защищённые routes/actions/API должны проверять permission server-side. | MUST | Negative authorization suite |
| FR-005 | RLS должна ограничивать browser access organization и user scope. | MUST | Disposable Postgres tests |
| FR-006 | Admin должен приглашать, блокировать и деактивировать сотрудника без передачи пароля. | MUST | E2E admin lifecycle |
| FR-007 | Изменение роли или scope должно завершать неподходящие active sessions и создавать audit. | MUST | Integration test |
| FR-008 | Student должен видеть только собственные cases/files/messages. | MUST | Cross-user denial tests |
| FR-009 | UI должен показывать access denied/read-only/approval required без утечки данных. | MUST | E2E + Axe |
| FR-010 | Custom roles допускаются после MVP через versioned permission bundles. | SHOULD | Product acceptance |
| FR-011 | Leadership read/report profile должен быть отдельным утверждённым bundle, а не выдачей полного Admin. | SHOULD | Permission review |
| FR-012 | Экспорт данных должен требовать отдельное permission и сохранять audit. | MUST | Security test |

### 13.2 Dashboard and work queues

| ID | Требование | Приоритет | Проверка |
| --- | --- | --- | --- |
| FR-013 | Dashboard должен зависеть от роли и показывать только разрешённые KPI и queues. | MUST | Role E2E |
| FR-014 | Attention queue должна сортировать по реальной срочности, deadline и priority, а не по нулевым показателям. | MUST | Scenario test |
| FR-015 | Каждый queue item должен показывать reason, owner, deadline и next action. | MUST | UI contract test |
| FR-016 | Пустой queue должен показывать честный all-clear state. | MUST | Browser test |
| FR-017 | KPI должен содержать formula, source, period и last refresh. | MUST | Report contract |
| FR-018 | Demo/local values не должны появляться как production business KPI. | MUST | Environment test |

### 13.3 Sales and amoCRM

| ID | Требование | Приоритет | Проверка |
| --- | --- | --- | --- |
| FR-019 | Sales pipeline должна отображать canonical amoCRM stages и IDs. | MUST | amo sandbox E2E |
| FR-020 | Lead 360 должен объединять identity, owner, stage, activity, communications, tasks и linked student case. | MUST | E2E detail |
| FR-021 | Изменение canonical lead/contact/owner/stage должно выполняться через amoCRM Adapter. | MUST | Contract test |
| FR-022 | При недоступной amoCRM каноническое изменение не должно подтверждаться локально. | MUST | Failure injection |
| FR-023 | Система должна искать контакт по нормализованным данным и не создавать duplicate при однозначном совпадении. | MUST | Provider fixture + E2E |
| FR-024 | Неоднозначное совпадение должно создавать conflict для ручного решения. | MUST | Conflict scenario |
| FR-025 | Новому WhatsApp-контакту должен создаваться contact и lead только после idempotency check. | MUST | Replay test |
| FR-026 | Lead list должна фильтровать по stage, owner, source, task risk, sync state и search. | MUST | Browser tests |
| FR-027 | Каждое действие Sales должно иметь owner, next step и due date при применимости. | SHOULD | Scenario evaluation |
| FR-028 | Создание student case должно быть отдельным controlled action после утверждённого business condition. | MUST | E2E conversion |
| FR-029 | Один amo lead не должен создавать два active student cases без Admin exception. | MUST | Unique constraint |
| FR-030 | Ссылка из EVO Platform в amoCRM и обратно должна использовать canonical IDs. | SHOULD | Integration acceptance |

### 13.4 Communications, WhatsApp and AI

| ID | Требование | Приоритет | Проверка |
| --- | --- | --- | --- |
| FR-031 | Все входящие WAHA events должны сохраняться до business processing. | MUST | Integration test |
| FR-032 | Повтор webhook с тем же provider ID не должен создавать duplicate message/action. | MUST | Replay test |
| FR-033 | Inbox должен показывать conversation list, unread, assignee, latest message, lead context и sync state. | MUST | E2E |
| FR-034 | Conversation history должна объединять received, prepared, sent, delivered, read, failed и unknown. | MUST | Status mapping test |
| FR-035 | Отправка должна выполняться только через server outbox с idempotency key. | MUST | Outbox integration test |
| FR-036 | Unknown send result не должен автоматически повторяться. | MUST | Timeout test |
| FR-037 | Employee должен иметь безопасное manual retry/reconcile действие с предупреждением duplicate risk. | MUST | Failure E2E |
| FR-038 | Assignment/handoff должен хранить actor, reason, target owner и timestamp. | MUST | Audit test |
| FR-039 | AI draft создаётся только по явному запросу сотрудника. | MUST | E2E |
| FR-040 | Автоматический customer send должен отсутствовать/быть fail-closed. | MUST | Security test + config |
| FR-041 | Draft должен сохранять provider/model/prompt/context/evidence/requester. | MUST | DB assertion |
| FR-042 | Employee может редактировать draft; исходный draft остаётся immutable. | MUST | E2E + audit |
| FR-043 | Отправленное сообщение связывается с review/draft, но хранит фактический текст отправки. | MUST | DB assertion |
| FR-044 | Unsupported/sensitive question должен предлагать handoff. | MUST | AI eval set |
| FR-045 | Knowledge documents должны иметь owner, version, approval state и effective date. | MUST | Admin workflow |
| FR-046 | Media должна храниться private, иметь retention и audited access/deletion. | MUST | Storage/RLS tests |
| FR-047 | Search и filters Inbox не должны раскрывать разговоры вне scope. | MUST | Cross-role tests |
| FR-048 | Session status и integration health должны быть видимы Admin без открытия WAHA dashboard наружу. | MUST | Admin E2E |

### 13.5 Student case and admissions

| ID | Требование | Приоритет | Проверка |
| --- | --- | --- | --- |
| FR-049 | Student 360 должен показывать profile, linked amo context, operational stage, team, route, timeline и next actions. | MUST | E2E |
| FR-050 | Operational stage не должен автоматически менять amoCRM sales stage. | MUST | Integration test |
| FR-051 | Admissions route должна хранить country, level, program direction, intake, language/funding assumptions и approval. | MUST | DB + UI test |
| FR-052 | Manager и curator assignment должны быть versioned и audited. | MUST | Audit test |
| FR-053 | Case update должен иметь author/source/time и быть видим соответствующему student при публикации. | MUST | Portal E2E |
| FR-054 | Closure требует evidence delivered/open items/storage/ongoing owner. | SHOULD | Business scenario |
| FR-055 | Archive не должен удалять историю и документы. | MUST | Retention test |

### 13.6 Applications and documents

| ID | Требование | Приоритет | Проверка |
| --- | --- | --- | --- |
| FR-056 | Каждая university application должна быть отдельным объектом с university/program/intake/deadline/status. | MUST | DB + E2E |
| FR-057 | Submission/provider response должен иметь evidence и actor/source. | MUST | E2E |
| FR-058 | External outcome нельзя вводить как гарантированный внутренний result. | MUST | Copy + workflow review |
| FR-059 | Document checklist должен конфигурироваться по route/program/version. | SHOULD | Admin acceptance |
| FR-060 | Student должен загружать новую version в конкретный document slot. | MUST | Storage E2E |
| FR-061 | File validation должна проверять разрешённый type, size, integrity и malware policy. | MUST | Security tests |
| FR-062 | AI document observation не должно менять decision/status самостоятельно. | MUST | Authorization test |
| FR-063 | Reviewer должен выбрать approve/correction/reject и обязательную reason при негативном решении. | MUST | E2E |
| FR-064 | Student должен видеть понятный resubmission path и историю версий. | MUST | Portal E2E |
| FR-065 | Document access/download должен проверять permission и фиксироваться при чувствительном классе. | MUST | RLS + audit |
| FR-066 | Preview failure не должен подменять файл пустым success state. | MUST | Failure test |

### 13.7 Visa and finance

| ID | Требование | Приоритет | Проверка |
| --- | --- | --- | --- |
| FR-067 | Visa case должен иметь country, requirements, completeness, appointment, submission, result evidence и next action. | MUST | E2E |
| FR-068 | Visa decision фиксируется только как внешний outcome с evidence. | MUST | Business rule test |
| FR-069 | Payment obligation должен отделять EVO service fee от third-party costs. | MUST | Data validation |
| FR-070 | Payment event должен иметь amount/currency/date/source/evidence и actor. | MUST | Finance E2E |
| FR-071 | Paid/debt/pending нельзя выводить из sales stage без утверждённого mapping. | MUST | Contract test |
| FR-072 | Stop factor должен содержать reason, owner, blocked action, created/resolved evidence. | MUST | E2E |
| FR-073 | Снятие блокировки требует provider/finance event либо уполномоченного audit decision. | MUST | Authorization test |
| FR-074 | Student видит только понятный статус и инструкцию; внутренние финансовые поля скрываются. | MUST | Portal privacy test |

### 13.8 Tasks, notifications, collaboration, reports and administration

| ID | Требование | Приоритет | Проверка |
| --- | --- | --- | --- |
| FR-075 | Task должна иметь type, assignee, related entity, priority, due date, status и history. | MUST | E2E |
| FR-076 | Overdue/urgent tasks должны попадать в role-scoped attention queue. | MUST | Scenario test |
| FR-077 | Notification должна быть deduplicated, адресной, read/unread и ссылаться на действие. | MUST | Integration test |
| FR-078 | Team chat не должен заменять audit или canonical case update. | MUST | Product review |
| FR-079 | Call record должен иметь direction, participant, owner, outcome и linked lead при наличии. | SHOULD | E2E |
| FR-080 | Reports должны показывать data source, period, formula, freshness и drill-down. | MUST | Report acceptance |
| FR-081 | Admin должен видеть integration readiness по отдельным prerequisite, а не один зелёный badge. | MUST | E2E |
| FR-082 | Admin должен видеть immutable audit search/export в пределах permission. | MUST | Security E2E |
| FR-083 | Config change должен быть versioned, validated и reversible. | MUST | Integration test |
| FR-084 | Неутверждённые broadcasts, flows и unattended automations должны оставаться выключенными. | MUST | Feature flag test |

### 13.9 Student Portal

| ID | Требование | Приоритет | Проверка |
| --- | --- | --- | --- |
| FR-085 | Portal home должен показывать progress, next action, deadline и block reason. | MUST | Mobile/desktop E2E |
| FR-086 | Documents, applications, visa, payments, messages, notifications, team и profile должны быть отдельными routes. | MUST | Route tests |
| FR-087 | Upload/submit action без реального backend contract должен быть unavailable, а не fake success. | MUST | Failure state test |
| FR-088 | Portal должен поддерживать RU, KY и EN с одинаковыми security semantics. | SHOULD | i18n E2E |
| FR-089 | Student должен управлять profile/security в утверждённом объёме без изменения canonical staff fields. | MUST | Authorization test |
| FR-090 | Portal desktop/tablet/mobile должны сохранять функциональную полноту и доступность. | MUST | Responsive + Axe |

## 14. Требования к интеграциям

| ID | Требование | Приоритет | Проверка |
| --- | --- | --- | --- |
| INT-001 | amoCRM Adapter должен использовать утверждённую OAuth-интеграцию и хранить refresh/access token только зашифрованно на server. | MUST | Security review + live preflight |
| INT-002 | amoCRM account, pipeline, status и custom-field mapping должны быть versioned configuration. | MUST | Config test |
| INT-003 | amoCRM webhook должен быть сохранён и быстро подтверждён до тяжёлой обработки. | MUST | Latency/replay test |
| INT-004 | Пропущенные amoCRM events должны обнаруживаться reconciliation job. | MUST | Drift injection |
| INT-005 | Canonical write должен иметь idempotency/correlation ID и evidence provider response. | MUST | Contract test |
| INT-006 | Система не должна циклически повторять собственное amoCRM изменение из webhook. | MUST | Loop-prevention test |
| INT-007 | WAHA должна быть доступна только по private network/server route. | MUST | Network scan |
| INT-008 | WAHA webhook должен проверять SHA-512 HMAC raw body, допустимый timestamp и replay ID. | MUST | Security tests |
| INT-009 | WAHA subscription первого запуска должна включать message, message.ack и session.status. | MUST | Live config evidence |
| INT-010 | WAHA retry не должен нарушать platform deduplication. | MUST | Duplicate replay |
| INT-011 | Send API timeout должен приводить к unknown + reconciliation, а не к слепому resend. | MUST | Failure injection |
| INT-012 | Supabase schema должна разрабатываться миграциями из Git и воспроизводиться с нуля. | MUST | Clean reset |
| INT-013 | Development, staging и production должны иметь разные project IDs/secrets и одинаковую migration history. | MUST | CI/environment audit |
| INT-014 | Browser Supabase client использует только publishable/anon credential; service-role не попадает в bundle/log. | MUST | Secret scan |
| INT-015 | Storage buckets с документами и media должны быть private и открываться короткоживущими authorized URL или server stream. | MUST | Cross-user denial |
| INT-016 | AI provider должен подключаться через server adapter с model/prompt/version audit и timeout. | MUST | Contract + eval |
| INT-017 | При недоступности AI ручная работа Inbox/Documents должна продолжаться. | MUST | Degradation test |
| INT-018 | Email, telephony, payment gateway и другие provider не могут отображаться live до отдельного contract и acceptance. | MUST | Readiness UI |
| INT-019 | Каждый provider должен иметь readiness checklist, last verified time и actionable blocker. | MUST | Admin E2E |
| INT-020 | Все внешние вызовы должны иметь correlation ID, redacted structured log, timeout и bounded retry policy. | MUST | Observability test |

## 15. Требования к данным

| ID | Требование | Приоритет | Проверка |
| --- | --- | --- | --- |
| DATA-001 | У каждого business field должен быть зафиксирован canonical owner. | MUST | Schema/data dictionary review |
| DATA-002 | Поля amoCRM read model должны быть server-write-only для browser users. | MUST | RLS/trigger test |
| DATA-003 | Provider raw event должен храниться неизменяемо с hash, received_at и processing result. | MUST | DB test |
| DATA-004 | Audit/draft/ack records должны быть append-only; update/delete через browser запрещены. | MUST | Authorization suite |
| DATA-005 | Внешние и внутренние IDs должны быть раздельными и индексированными. | MUST | Schema audit |
| DATA-006 | Уникальные constraints должны блокировать duplicate provider message, active link и outbox key. | MUST | Concurrency test |
| DATA-007 | Изменение status должно создавать event/history, а не только перезаписывать последнее значение. | MUST | DB assertion |
| DATA-008 | Времена хранятся в UTC и показываются в timezone пользователя/организации. | MUST | Timezone tests |
| DATA-009 | Деньги хранят amount minor units/decimal + ISO currency; float запрещён. | MUST | Schema test |
| DATA-010 | Файл хранится вне Git/DB blob; metadata, checksum, MIME, size, version и retention — в БД. | MUST | Storage test |
| DATA-011 | Sensitive fields должны классифицироваться и маскироваться по роли. | MUST | Privacy test |
| DATA-012 | Logs и analytics не должны содержать raw token, password, passport или полный message body без утверждённой цели. | MUST | Log scan |
| DATA-013 | Retention/deletion policy должна применяться job и оставлять audit без содержимого удалённого файла. | MUST | Retention E2E |
| DATA-014 | Migration должна сверять count, IDs, checksums и orphan links. | MUST | Reconciliation report |
| DATA-015 | Seed/demo данные должны быть технически отделены от production. | MUST | Deployment test |
| DATA-016 | Backup должен включать Postgres, Storage metadata/config и необходимые encrypted secrets references. | MUST | Restore rehearsal |
| DATA-017 | Business export должен быть machine-readable, permission-controlled и audited. | SHOULD | Export acceptance |
| DATA-018 | Data dictionary должен описывать owner, type, nullable, sensitivity, retention и API exposure. | MUST | Architecture gate |

Append-only audit не должен исчезать каскадно при удалении parent record.
Для audit/draft/ack связей применяются `RESTRICT`, `SET NULL` с сохранённым
external reference либо архивирование, но не незаметный `ON DELETE CASCADE`.

## 16. Безопасность и конфиденциальность

| ID | Требование | Приоритет | Проверка |
| --- | --- | --- | --- |
| SEC-001 | Весь public traffic использует HTTPS; internal provider traffic — private network или взаимно authenticated channel. | MUST | TLS/network audit |
| SEC-002 | Admin и integration-management требуют MFA; MFA для всех staff должна быть включаемой политикой. | MUST | Auth E2E |
| SEC-003 | Пароли не хранятся приложением в открытом виде; используется Supabase Auth policy. | MUST | Security review |
| SEC-004 | Secrets хранятся в provider dashboard/VPS secret store/encrypted settings; Git содержит только placeholders. | MUST | Gitleaks + runtime audit |
| SEC-005 | Service-role, amoCRM token, WAHA key и AI key никогда не возвращаются browser client. | MUST | Bundle/API scan |
| SEC-006 | Webhooks защищаются HMAC/signature, timestamp window, replay detection и rate limit. | MUST | Penetration tests |
| SEC-007 | Все input boundaries валидируют schema, length, type и authorization. | MUST | Fuzz/negative tests |
| SEC-008 | File upload проверяет extension, MIME/content, size, malware policy и unsafe filename. | MUST | Upload security suite |
| SEC-009 | Private file URL должен истекать и быть связан с текущей авторизацией. | MUST | Expiry/cross-user tests |
| SEC-010 | RLS включается для browser-exposed tables; отсутствие policy означает deny. | MUST | Postgres harness |
| SEC-011 | Privileged service routes повторно проверяют organization, actor, role, scope и action. | MUST | Authorization tests |
| SEC-012 | Audit access ограничен; audit export тоже фиксируется. | MUST | Role test |
| SEC-013 | Sensitive action использует CSRF/origin protection и не выполняется GET-запросом. | MUST | Security test |
| SEC-014 | Session cookies имеют Secure, HttpOnly, SameSite и controlled lifetime. | MUST | Header test |
| SEC-015 | UI и API защищаются от XSS, injection, unsafe redirect и IDOR. | MUST | Security scan/E2E |
| SEC-016 | Error response не раскрывает stack, secret, provider payload или существование чужого объекта. | MUST | Negative tests |
| SEC-017 | Dependencies проходят blocking production audit; исключения dev chain узкие, time-bound и fail-closed. | MUST | CI |
| SEC-018 | Backup зашифрован, доступ ограничен, восстановление регулярно проверяется. | MUST | Restore evidence |
| SEC-019 | Incident process определяет severity, owner, containment, notification, recovery и postmortem. | MUST | Tabletop exercise |
| SEC-020 | Юридический владелец должен утвердить privacy, consent, retention, cross-border processing и provider DPA до production PII. | MUST | Signed checklist |

## 17. Нефункциональные требования

| ID | Требование | Цель / правило | Проверка |
| --- | --- | --- | --- |
| NFR-001 | Доступность | Предлагаемая цель 99,5% в месяц без учёта согласованных external outages; утвердить до launch | Monitoring report |
| NFR-002 | Скорость UI | p95 server read до 2 с, accepted write до 3 с без времени внешнего provider | Load test |
| NFR-003 | Webhook acknowledgement | Внутренний budget до 1 с после signature + durable persist | Timed integration test |
| NFR-004 | Event freshness | p95 подтверждённых events видимы UI до 30 с | End-to-end timing |
| NFR-005 | Capacity | До performance test владелец утверждает staff/case/message/file volume profile; отсутствие profile блокирует release | Approved capacity sheet |
| NFR-006 | Concurrency | Duplicate и lost update не возникают при параллельных webhook/send/review actions | Concurrency suite |
| NFR-007 | Recovery | Предлагаемые RPO 24 ч и RTO 4 ч; более строгие значения зависят от Supabase plan и утверждаются отдельно | Restore rehearsal |
| NFR-008 | Observability | Metrics, structured logs, traces/correlation, alerts, queue depth, dead letter и provider health | Ops acceptance |
| NFR-009 | Accessibility | WCAG 2.2 AA для основных routes; keyboard, focus, labels, contrast, dialog semantics | Axe + manual audit |
| NFR-010 | Responsive | Staff: 1440x1024 и 834x1194; urgent staff mobile и Portal: 390x844 | Playwright screenshots |
| NFR-011 | Locales | RU базовый; KY и EN без изменения permissions/status semantics | i18n tests |
| NFR-012 | Browser support | Актуальные stable Chrome, Safari, Edge; mobile Safari/Chrome для Portal | Compatibility matrix |
| NFR-013 | Maintainability | Modular boundaries, typed contracts, migrations, ADR, tests и no hidden provider calls | Architecture review |
| NFR-014 | Deployability | Repeatable container build, environment config validation, health/readiness and rollback | Staging rehearsal |
| NFR-015 | Data portability | Документированный export без provider lock-in для основных EVO records | Export test |
| NFR-016 | Auditability | Любой sensitive decision восстанавливается по actor/source/time/evidence | Audit scenario |
| NFR-017 | Graceful degradation | AI/report/provider failure не блокирует разрешённую ручную работу | Chaos scenarios |
| NFR-018 | Documentation | Runbook, data dictionary, API contracts, recovery, onboarding и owner matrix актуальны в GitHub main | Release checklist |

## 18. UX/UI контракт

Принятый frontend является базовой моделью взаимодействия. Backend может
заменить demo/read-model данные реальными, но не должен ухудшить:

- role-aware navigation и server-side access denied;
- отдельные Sales stage и operational stage;
- Dashboard, Sales/Lead 360, Clients/Student 360;
- Applications, Documents, Visa, Finance;
- Tasks, Calls, WhatsApp, Chat, Notifications, Reports, Settings;
- Student Portal с девятью рабочими разделами;
- desktop/tablet/mobile поведение;
- draft-only маркировку AI;
- точные WhatsApp delivery states;
- loading, empty, error, blocked, read-only, approval-required,
  integration-unavailable и sync-unverified states.

Screenshots в приложении к DOCX подтверждают дизайн и структуру экранов, но не
live provider. В интерфейсе запрещены:

- fake success после отсутствующего backend action;
- общий зелёный badge «всё работает» без prerequisite evidence;
- маскировка unknown как success;
- красный цвет для обычного исходящего сообщения;
- emoji в системном статусе вместо понятного текста;
- critical action только по цвету или недоступной keyboard control.

## 19. Наблюдаемость и эксплуатация

### 19.1 Обязательные метрики

- WAHA session status и время последнего события;
- webhook accepted/rejected/duplicate/invalid HMAC;
- amoCRM API success/error/rate limit/token refresh;
- outbox queued/sending/unknown/failed/acknowledged;
- message acknowledgement latency;
- background queue depth, retry и dead letter;
- sync lag, stale links и conflicts;
- AI request success/timeout/handoff и draft review outcome;
- Storage upload/download/delete/error;
- authorization denial и privileged actions;
- backup age и результат последнего restore rehearsal.

### 19.2 Alerting

Alert должен иметь severity, affected module, first seen, correlation links,
owner и runbook. Необходимо минимум:

- WAHA session disconnected;
- invalid HMAC spike;
- message queue growth;
- unknown outbound result;
- amoCRM auth/rate-limit failure;
- sync conflict growth;
- Supabase/storage unavailable;
- backup or retention job failure;
- repeated authorization anomaly;
- audit append failure.

## 20. Тестирование и доказательства

### 20.1 Уровни проверки

1. Unit tests для domain/state/mapping/idempotency.
2. Database tests для constraints, migrations, RLS, triggers и audit.
3. Contract tests для amoCRM/WAHA/Supabase/AI adapters.
4. Integration tests с sandbox/test accounts.
5. Browser E2E для ролей, workflows, states и responsive.
6. Accessibility: automated + keyboard + screen-reader spot check.
7. Security: secret scan, dependency audit, auth negative tests, file upload,
   webhook replay и IDOR.
8. Performance/load для approved capacity profile.
9. Backup/restore and rollback rehearsal.
10. Controlled live acceptance с отдельным WhatsApp number и test lead.

### 20.2 Запрещённые подмены

- health 200 не доказывает provider integration;
- unit test не доказывает live OAuth/send;
- configured environment variable не доказывает корректный secret;
- created outbox row не доказывает sent/delivered;
- frontend badge не доказывает storage/payment/telephony;
- один удачный сценарий не доказывает idempotency и failure recovery.

## 21. Миграция и поэтапный запуск

### Этап 0. Утверждение и инвентаризация

Работы:

- утвердить ТЗ, владельцев и открытые решения;
- получить комментарии реальных сотрудников ОЗО/ОП/Finance/Visa и связать
  каждое решение с разделом ТЗ;
- утвердить amo fields/pipeline, payment owner, document taxonomy, retention,
  capacity, RPO/RTO и incident policy;
- создать новый ADR, который явно заменит companion-era решения об отдельном
  Supabase/WAHA/runtime.
- запретить одновременно активных старого и нового amoCRM/WAHA writers после
  начала cutover.

Exit gate: подписанная версия ТЗ и ноль blocking open decisions для Этапа 1.

### Этап 1. Supabase foundation

Работы:

- projects development/staging/production;
- migration baseline, Auth, organization, roles, scopes, RLS;
- audit, jobs, outbox, idempotency и encrypted configuration;
- CI clean reset + authorization harness;
- импорт только обезличенных данных в staging.

Exit gate: migrations воспроизводимы; cross-role/cross-tenant denial доказан.

### Этап 2. amoCRM canonical adapter

Работы:

- OAuth/config/field mapping;
- read-only sync contacts/leads/users/stages;
- reconciliation и conflicts;
- затем controlled canonical writes;
- Lead 360 показывает реальный sync status.

Exit gate: sandbox/test lead создаётся/находится без duplicate, stage/owner
совпадают с amoCRM, failure не создаёт ложный local success.

### Этап 3. Миграция operational CRM с SQLite

Работы:

- новая Supabase-модель student cases/applications/documents/visa/finance/tasks;
- mapping и dry-run существующей SQLite;
- counts, IDs, orphan/checksum report;
- staging dual-read comparison без долгосрочного dual-write;
- controlled production cutover с backup и rollback.

Exit gate: согласованная сверка данных и успешный rollback rehearsal.

### Этап 4. Единый Inbox/WAHA и draft-only AI

Работы:

- перенести Inbox conversations/messages/media/drafts/audit в общий project;
- подключить один private WAHA webhook;
- перенести useful Lead Agent logic;
- выполнить receive-only, linking, draft, manual send, ack и failure tests;
- отключить второй webhook только после доказательства.

Exit gate: полный controlled end-to-end путь и duplicate/unknown recovery.

### Этап 5. Documents, Student Portal and finance gates

Работы:

- private Storage, versions, review и retention;
- portal auth/scope;
- payment obligations и утверждённые stop-factor rules;
- real notifications/messages;
- accessibility и mobile acceptance.

Exit gate: два разных student accounts не видят данные друг друга; upload,
review, correction и resubmit проходят с audit.

### Этап 6. Lead Agent retirement

Работы:

- reconciliation текущей SQLite/queues/amo links;
- запрет нового traffic в Lead Agent;
- archive/export необходимых audit records;
- наблюдение в стабилизационном окне;
- удаление Compose/runtime/config/code только отдельным reviewed PR.

Exit gate: все условия раздела 22 выполнены и владелец подписал retirement.

### Этап 7. Оптимизация и будущие функции

Custom roles, advanced reporting, multi-number WAHA, telephony, payment gateway,
document AI и автоматизации рассматриваются отдельными изменениями ТЗ. Auto-send
AI не входит в этот этап автоматически.

## 22. Перенос и удаление EVO Lead Agent

### 22.1 Что переносится

| Lead Agent capability | Целевой модуль |
| --- | --- |
| Phone normalization | Shared identity utilities |
| WAHA HMAC validation | Webhook Gateway |
| Provider message deduplication | Event Inbox / idempotency_keys |
| Short message buffering/grouping | Background Jobs |
| amo contact/lead resolution | amoCRM Adapter |
| amo notes/tasks | amoCRM Adapter с отдельным mapping |
| CRM signed sync event | Internal domain event; внешний HMAC не нужен внутри монолита |
| Handoff reason/state | Communications assignment/history |
| Knowledge curation/redaction checks | AI Knowledge Governance |
| Readiness/preflight | Admin Integration Readiness |
| Retry/dead-letter evidence | Job Queue / Audit |

Auto-reply decision/send logic не переносится как активная функция. Оно
заменяется draft-only контрактом.

### 22.2 Условия удаления

Lead Agent можно удалить только если одновременно:

1. новый webhook получает реальное входящее сообщение;
2. contact/lead однозначно resolved/created в amoCRM;
3. linked IDs и stage отображаются EVO Platform;
4. AI draft создан и сохранён с evidence;
5. сотрудник вручную отправил утверждённый текст;
6. sent/delivered/read либо честный unknown/failed сохранены;
7. audit восстанавливает всю цепочку;
8. повтор одинакового webhook не создал duplicate;
9. timeout/retry не отправил второе сообщение;
10. reconciliation не выявила потерянные contacts/leads/messages;
11. backup и rollback проверены;
12. утверждено стабилизационное окно (предлагается минимум 14 дней);
13. владелец бизнеса и технический владелец письменно согласовали retirement.

До выполнения всех условий Lead Agent остаётся frozen/isolated fallback и не
становится параллельным активным webhook owner.

## 23. Приёмочные критерии

| ID | Критерий | Доказательство |
| --- | --- | --- |
| ACC-001 | Все MUST требования имеют test/evidence и owner | Traceability report |
| ACC-002 | Development/staging/production projects разделены, migrations совпадают | Supabase migration list |
| ACC-003 | Production service-role отсутствует в browser bundle/log | Secret scan |
| ACC-004 | Все staff roles проходят positive и negative route/object tests | Authorization report |
| ACC-005 | Два student accounts изолированы на DB/API/UI/Storage | Cross-user E2E |
| ACC-006 | Реальный test WhatsApp event проходит HMAC, persist и dedup | Signed evidence |
| ACC-007 | amo contact/lead resolution не создаёт duplicate | amoCRM comparison |
| ACC-008 | Stage/manager совпадают с amoCRM | Linked record evidence |
| ACC-009 | AI draft-only: no auto-send path остаётся fail-closed | Config/code/security test |
| ACC-010 | Manual send сохраняет фактический текст, actor и outbox ID | Audit record |
| ACC-011 | WAHA acknowledgement обновляет exact delivery state | Provider event evidence |
| ACC-012 | Timeout создаёт unknown и не auto-resend | Failure injection |
| ACC-013 | Повтор webhook/outbox не создаёт duplicate | Replay report |
| ACC-014 | Student case создаётся отдельно от lead и не меняет sales stage | Workflow E2E |
| ACC-015 | Application/document/visa/payment имеют независимые histories | Data audit |
| ACC-016 | Document upload private; чужой доступ запрещён | Storage/RLS evidence |
| ACC-017 | Correction/resubmit сохраняет обе версии и причины | Portal/staff E2E |
| ACC-018 | Payment stop factor имеет owner/reason/evidence и controlled resolve | Finance E2E |
| ACC-019 | Critical screens проходят 1440, 834 и 390 viewports без overflow | Screenshot ledger |
| ACC-020 | WCAG automated tests и manual keyboard/screen-reader spot check пройдены | Accessibility report |
| ACC-021 | Performance соответствует утверждённому capacity profile | Load report |
| ACC-022 | Backup восстановлен в isolated environment в пределах RPO/RTO | Restore report |
| ACC-023 | Alerts и runbooks проверены tabletop/controlled failure | Ops report |
| ACC-024 | Migration reconciliation не содержит unexplained loss/orphans | Signed reconciliation |
| ACC-025 | Lead Agent retirement checklist подписан до удаления | Approval record |

## 24. Открытые решения до реализации

На момент подготовки в репозитории не найдены raw-интервью, комментарии
сотрудников, аннотированные screenshots или утверждённый feedback ledger.
Исходный OZO DOCX не содержит Word comments. Поэтому эта версия подходит для
первого согласования, но не может называться окончательно business-approved,
пока замечания сотрудников не внесены в traceable appendix.

| ID | Решение | Кто утверждает | До этапа |
| --- | --- | --- | --- |
| DEC-001 | Назначить Product Owner, Business Process Owner, Technical Owner и Data/Privacy Owner по именам | Руководство | 0 |
| DEC-002 | Передать комментарии ОЗО, Sales, Visa, Finance и руководства; принять/отклонить каждое замечание | Product Owner | 0 |
| DEC-003 | Утвердить финальную role/action/field/scope matrix и необходимость Leadership role | Руководство + владельцы функций | 0 |
| DEC-004 | Утвердить источник фактической оплаты: EVO Platform, amoCRM field или отдельная учётная система | Finance Owner | 0 |
| DEC-005 | Утвердить условия активации Student Portal и правила payment stop factor | Business + Finance | 0 |
| DEC-006 | Утвердить amoCRM account/pipeline/status/custom fields и manager-assignment rules | Sales Owner | 2 |
| DEC-007 | Утвердить один production WhatsApp number/session и ответственного за QR/session recovery | Operations Owner | 4 |
| DEC-008 | Утвердить document taxonomy, допустимые formats/sizes, retention и review reasons | Admissions + Visa | 1 |
| DEC-009 | Утвердить Supabase region, plan, PITR/backup возможности и cost owner | Technical + Finance | 1 |
| DEC-010 | Утвердить capacity profile: staff, active cases, messages/day, files/day, storage growth | Product + Technical | 1 |
| DEC-011 | Утвердить SLA/SLO, RPO/RTO и support/on-call модель | Руководство + Technical | 1 |
| DEC-012 | Утвердить privacy notice, consent, data residency, retention/deletion и provider DPA | Legal/Data Owner | 1 |
| DEC-013 | Утвердить AI provider/model, разрешённые данные, knowledge approval и evaluation owner | Business + Data Owner | 4 |
| DEC-014 | Утвердить channels для email/push/WhatsApp notification и delivery policy | Product Owner | 5 |
| DEC-015 | Утвердить KPI definitions, formulas, targets и owners | Руководство | 5 |
| DEC-016 | Устранить конфликт обещания «гарантии» в Malaysia knowledge source с запретом гарантировать external outcome | Business Owner | 0 |
| DEC-017 | Утвердить migration window, freeze rules и rollback authority | Technical + Operations | 3 |
| DEC-018 | Утвердить длительность стабилизационного окна перед удалением Lead Agent | Product + Technical | 4 |
| DEC-019 | Решить, нужны ли telephony, payment gateway, email provider и university submission в следующей версии | Product Owner | 7 |
| DEC-020 | Определить правила жалоб, возвратов, incident notification и запросов на данные | Business + Legal | 1 |

## 25. Что не входит в первый production-релиз

- автоматические AI-ответы клиенту;
- массовые рассылки и unattended campaigns;
- broad no-code flows/automations;
- несколько WhatsApp numbers/accounts;
- замена amoCRM собственной sales master-базой;
- native iOS/Android приложение;
- автоматическое решение по документу, заявке, гранту или визе;
- автоматическая подача заявки в университет или госорган;
- payment gateway до отдельного договора и security review;
- телефония/email provider до отдельного integration contract;
- свободно настраиваемый workflow engine;
- predictive scoring, facial recognition или profiling;
- удаление Lead Agent до выполнения раздела 22.

## 26. Сопоставление исходного OZO ТЗ

| Потребность OZO | Решение в этом ТЗ | Коррекция |
| --- | --- | --- |
| «Интеллектуальный хаб» вокруг CRM | Единый frontend/backend + amoCRM Adapter + Supabase | amoCRM остаётся master только для sales identity/stage |
| Student загружает и исправляет документы | FR-059–FR-066, private Storage, versions и review | AI даёт observation, не decision |
| ОЗО проверяет документы | Curator/Visa permissions, review queue и audit | ОЗО — функция, не техническое имя роли |
| ОП добавляет лида | FR-019–FR-030 через canonical amoCRM | Локальный duplicate lead запрещён |
| Финансовый контроль и блокировка | FR-069–FR-074, stop factor | Источник оплаты и unblock rule пока DEC-004/005 |
| «Оплачено» открывает Portal | Controlled activation policy | Не принимается без утверждённого evidence и business rule |
| Мгновенная sync по webhook | Event inbox + async processing + visible sync state + reconciliation | Webhook не гарантирует мгновенность и может повторяться/теряться |
| FIFO очередь документов | Priority/deadline/risk + created_at как tie-breaker | Чистый FIFO опасен для срочных deadlines |
| Admin меняет правила без программиста | Versioned configuration с permission и audit | Только разрешённые rules; schema/security не редактируются UI |
| Audit всех действий | Append-only audit, access events и exports | Browser не может подделывать audit |
| Большое число студентов | Capacity profile и load test | Числа должен утвердить владелец, не придумывает разработчик |
| CRM блокирует всё при возврате/отказе | Explicit mapped stop factor | Один sales status не должен автоматически блокировать все процессы |

## 27. Принятые экраны как дизайн-доказательства

Ниже перечислены поверхности, которые должны быть подключены к реальным
контрактам без нового redesign from scratch.

### 27.1 Staff Dashboard

![Dashboard EVO Platform: приоритеты, показатели и воронка](../design/evo-platform/implementation-screenshots/final-audit/01-dashboard-desktop-1440x1024.png)

### 27.2 Sales pipeline

![Sales pipeline EVO Platform с каноническими стадиями amoCRM](../design/evo-platform/audit-screenshots/staff-pipeline-1440x1024.png)

### 27.3 WhatsApp workspace

![WhatsApp workspace EVO Platform с историей, контекстом и ручной отправкой](../design/evo-platform/implementation-screenshots/final-audit/04-whatsapp-detail-desktop-1440x1024.png)

### 27.4 Student 360

![Student 360 EVO Platform: операционное дело, разделы и действия](../design/evo-platform/implementation-screenshots/core/design-polish-student-360-desktop-1440x1024.png)

### 27.5 Roles matrix

![Матрица ролей EVO Platform с семантическими индикаторами доступа](../design/evo-platform/implementation-screenshots/communications-admin/10-roles-matrix-desktop-1440.png)

### 27.6 Student Portal

![Student Portal EVO Platform: прогресс и следующие действия](../design/evo-platform/implementation-screenshots/final-audit/06-student-portal-desktop-1440x1024.png)

Все screenshots используют тестовые/демонстрационные данные. Они подтверждают
информационную архитектуру и visual contract, но не подтверждают live amoCRM,
WAHA, Supabase Storage, AI, telephony или payment provider.

## 28. Управление изменениями

- Утверждённое ТЗ получает immutable version tag/commit.
- Любое изменение data owner, role authority, auto-send, retention, provider,
  migration order или acceptance требует change request.
- Architecture change фиксируется ADR до реализации.
- Scope/acceptance/merge-order change добавляется в `docs/PLAN_CHANGES.md`.
- Каждая implementation phase разбивается на GitHub Issues и reviewable PR.
- Production merge не равен deployment; deployment имеет release record,
  migration evidence и rollback point.
- Срочное исключение имеет owner, reason, expiry и post-incident review.

## 29. Требования к handoff после утверждения

Команда реализации должна создать:

1. Target Architecture ADR, superseding companion-era Supabase/WAHA/runtime
   decisions.
2. Data dictionary и ERD.
3. Role/action/field/object-scope matrix.
4. amoCRM field/status/user mapping.
5. API/event contracts для amoCRM, WAHA, AI и internal jobs.
6. Migration plan с dry-run/reconciliation/rollback.
7. Threat model и privacy data-flow.
8. Test plan с traceability FR/NFR/SEC/ACC.
9. Production runbooks и incident/recovery plan.
10. Phase backlog с owners, dependencies и exit gates.

## 30. Глоссарий

| Термин | Простое объяснение |
| --- | --- |
| Contact | Человек в amoCRM |
| Lead | Продажная возможность/сделка в amoCRM |
| Sales stage | Стадия продажи, канонически принадлежит amoCRM |
| Student case | Операционное дело студента после утверждённого перехода |
| Operational stage | Этап поступления внутри EVO Platform |
| Source of truth | Система, где факт считается правильным и изменяется |
| Read model / shadow | Локальная копия для быстрого показа; не новый master |
| Provider | Внешняя система: amoCRM, WAHA, Supabase, AI и т. п. |
| Webhook | HTTP-уведомление о событии внешней системы |
| HMAC | Подпись, позволяющая проверить отправителя и неизменность webhook |
| Idempotency | Повтор одного запроса не создаёт второе действие |
| Event Inbox | Durable хранилище входящих provider events до обработки |
| Outbox | Durable очередь исходящих действий до подтверждения provider |
| Reconciliation | Периодическая сверка локальных данных с master system |
| Conflict | Неоднозначное или противоречивое соответствие, требующее решения |
| Draft-only AI | AI предлагает текст, но не отправляет его клиенту |
| Evidence | Проверяемый файл, provider response, event или audit record |
| External outcome | Решение университета, консульства или другого органа |
| Stop factor | Явная блокировка с причиной, владельцем и правилом снятия |
| RLS | Правила Postgres, ограничивающие строки по пользователю/роли |
| RPO | Сколько данных допустимо потерять при аварии |
| RTO | За какое время система должна восстановиться |
| PII | Персональные данные человека |

## 31. Нормативные и технические ссылки

### 31.1 Официальные внешние источники

- [amoCRM Contacts API](https://www.amocrm.ru/developers/content/crm_platform/contacts-api)
- [amoCRM Leads API](https://www.amocrm.ru/developers/content/crm_platform/leads-api)
- [amoCRM Webhooks format](https://www.amocrm.ru/developers/content/crm_platform/webhooks-format)
- [WAHA Events, retries, HMAC and acknowledgement](https://waha.devlike.pro/docs/how-to/events/)
- [WAHA Receive messages](https://waha.devlike.pro/docs/how-to/receive-messages/)
- [Supabase Managing environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Supabase Database migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)

### 31.2 Основные источники репозитория

- `AGENTS.md`, `CONTEXT.md`;
- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`;
- `docs/platform/system-overview.md`;
- `docs/platform/data-ownership.md`;
- `docs/business/evo-business-context.md`;
- `docs/business/admissions-process.md`;
- `docs/EVO_INBOX_COMPANION_PRD.md`;
- `evo-lead-agent/functional-spec.md`;
- `evo-lead-agent/technical-spec.md`;
- `agent-lead2-inbox/docs/supabase-managed-store.md`;
- `docs/adr/0003–0013`;
- `docs/design/evo-platform/COMPLETION_CHECKLIST.md`;
- `docs/design/evo-platform/FINAL_FRONTEND_AUDIT_2026-07-24.md`;
- `docs/design/evo-platform/DESIGN_REVIEW_CLOSURE_2026-07-25.md`;
- `docs/company/brand/evo-admissions-logobook.pdf`.

### 31.3 Каталог источников для traceability

| Код | Источник и область доказательства |
| --- | --- |
| SRC-OWNER | Письменные решения владельца, зафиксированные в `docs/EVO_LAUNCH_PLAN.md` и `docs/PLAN_CHANGES.md` для этого goal |
| SRC-OZO | `TZ_Platforma_avtomatizacii_OZO.docx` (SHA-256 `0d4cb67e8d44057b765efd336c5199d888e3dc912e7c95d1c298cba0a056c5b1`) и `docs/design/evo-platform/SOURCE_BRIEF_IT_TZ.md` |
| SRC-BIZ | `docs/business/evo-business-context.md`, `docs/business/admissions-process.md`, `docs/business/sales-playbook.md` и утверждённые knowledge sources |
| SRC-ARCH | `CONTEXT.md`, `docs/platform/system-overview.md`, `docs/platform/data-ownership.md` и применимые ADR |
| SRC-INBOX | `docs/EVO_INBOX_COMPANION_PRD.md`, Inbox migrations, `agent-lead2-inbox/docs/supabase-managed-store.md` и ADR 0004/0005/0008/0009/0010/0013 |
| SRC-LEAD | `evo-lead-agent/functional-spec.md`, `evo-lead-agent/technical-spec.md` и текущая integration logic |
| SRC-UI | Реализованный frontend, `docs/design/evo-platform/IMPLEMENTATION_PLAN.md`, completion checklist и финальные frontend/design audits |
| SRC-OPS | `docs/BLOCK_G_FINAL_AUDIT.md`, disaster-recovery/release runbooks и доказанные production boundaries |
| SRC-AMO | Официальные amoCRM Contacts, Leads и Webhooks API из раздела 31.1 |
| SRC-WAHA | Официальные WAHA Events и Receive messages из раздела 31.1 |
| SRC-SUPA | Официальные Supabase environments, migrations и RLS guidance из раздела 31.1 |
| SRC-SEC | `AGENTS.md`, server authorization code, security migrations/tests и правила хранения secrets |
| SRC-GAP | Явные противоречия, недостающие владельцы/policies и открытые решения, зафиксированные в `docs/PLAN_CHANGES.md`, production audits и разделе 24 |

### 31.4 Поэлементная матрица происхождения требований

Каждый ID ниже перечислен отдельно. Колонка «Источник» показывает, из какого
проверяемого материала или явного решения выведено требование. Это provenance
требования; способ его будущей проверки остаётся в основной таблице
соответствующего раздела.

| ID требования | Источник |
| --- | --- |
| FR-001 | SRC-OWNER; SRC-UI; SRC-SEC |
| FR-002 | SRC-OWNER; SRC-UI; SRC-SEC |
| FR-003 | SRC-OWNER; SRC-UI; SRC-SEC |
| FR-004 | SRC-OWNER; SRC-UI; SRC-SEC |
| FR-005 | SRC-OWNER; SRC-UI; SRC-SEC |
| FR-006 | SRC-OWNER; SRC-UI; SRC-SEC |
| FR-007 | SRC-OWNER; SRC-UI; SRC-SEC |
| FR-008 | SRC-OWNER; SRC-UI; SRC-SEC |
| FR-009 | SRC-OWNER; SRC-UI; SRC-SEC |
| FR-010 | SRC-OWNER; SRC-UI; SRC-SEC |
| FR-011 | SRC-OWNER; SRC-UI; SRC-SEC |
| FR-012 | SRC-OWNER; SRC-UI; SRC-SEC |
| FR-013 | SRC-OZO; SRC-BIZ; SRC-UI |
| FR-014 | SRC-OZO; SRC-BIZ; SRC-UI |
| FR-015 | SRC-OZO; SRC-BIZ; SRC-UI |
| FR-016 | SRC-OZO; SRC-BIZ; SRC-UI |
| FR-017 | SRC-OZO; SRC-BIZ; SRC-UI |
| FR-018 | SRC-OZO; SRC-BIZ; SRC-UI |
| FR-019 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-UI |
| FR-020 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-UI |
| FR-021 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-UI |
| FR-022 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-UI |
| FR-023 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-UI |
| FR-024 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-UI |
| FR-025 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-UI |
| FR-026 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-UI |
| FR-027 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-UI |
| FR-028 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-UI |
| FR-029 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-UI |
| FR-030 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-UI |
| FR-031 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-WAHA |
| FR-032 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-WAHA |
| FR-033 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-WAHA |
| FR-034 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-WAHA |
| FR-035 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-WAHA |
| FR-036 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-WAHA |
| FR-037 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-WAHA |
| FR-038 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-WAHA |
| FR-039 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-BIZ |
| FR-040 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-BIZ |
| FR-041 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-BIZ |
| FR-042 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-BIZ |
| FR-043 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-BIZ |
| FR-044 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-BIZ |
| FR-045 | SRC-OWNER; SRC-INBOX; SRC-LEAD; SRC-BIZ |
| FR-046 | SRC-INBOX; SRC-SUPA; SRC-SEC; SRC-WAHA |
| FR-047 | SRC-INBOX; SRC-SUPA; SRC-SEC; SRC-WAHA |
| FR-048 | SRC-INBOX; SRC-SUPA; SRC-SEC; SRC-WAHA |
| FR-049 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-050 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-051 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-052 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-053 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-054 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-055 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-056 | SRC-OZO; SRC-BIZ; SRC-SUPA; SRC-SEC; SRC-UI |
| FR-057 | SRC-OZO; SRC-BIZ; SRC-SUPA; SRC-SEC; SRC-UI |
| FR-058 | SRC-OZO; SRC-BIZ; SRC-SUPA; SRC-SEC; SRC-UI |
| FR-059 | SRC-OZO; SRC-BIZ; SRC-SUPA; SRC-SEC; SRC-UI |
| FR-060 | SRC-OZO; SRC-BIZ; SRC-SUPA; SRC-SEC; SRC-UI |
| FR-061 | SRC-OZO; SRC-BIZ; SRC-SUPA; SRC-SEC; SRC-UI |
| FR-062 | SRC-OZO; SRC-BIZ; SRC-SUPA; SRC-SEC; SRC-UI |
| FR-063 | SRC-OZO; SRC-BIZ; SRC-SUPA; SRC-SEC; SRC-UI |
| FR-064 | SRC-OZO; SRC-BIZ; SRC-SUPA; SRC-SEC; SRC-UI |
| FR-065 | SRC-OZO; SRC-BIZ; SRC-SUPA; SRC-SEC; SRC-UI |
| FR-066 | SRC-OZO; SRC-BIZ; SRC-SUPA; SRC-SEC; SRC-UI |
| FR-067 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-068 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-069 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-070 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-071 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-072 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-073 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-074 | SRC-OZO; SRC-BIZ; SRC-ARCH; SRC-UI |
| FR-075 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-OPS |
| FR-076 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-OPS |
| FR-077 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-OPS |
| FR-078 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-OPS |
| FR-079 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-OPS |
| FR-080 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-OPS |
| FR-081 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-OPS |
| FR-082 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-OPS |
| FR-083 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-OPS |
| FR-084 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-OPS |
| FR-085 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-SEC |
| FR-086 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-SEC |
| FR-087 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-SEC |
| FR-088 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-SEC |
| FR-089 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-SEC |
| FR-090 | SRC-OZO; SRC-BIZ; SRC-UI; SRC-SEC |
| INT-001 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-LEAD |
| INT-002 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-LEAD |
| INT-003 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-LEAD |
| INT-004 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-LEAD |
| INT-005 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-LEAD |
| INT-006 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-LEAD |
| INT-007 | SRC-OWNER; SRC-INBOX; SRC-WAHA |
| INT-008 | SRC-OWNER; SRC-INBOX; SRC-WAHA |
| INT-009 | SRC-OWNER; SRC-INBOX; SRC-WAHA |
| INT-010 | SRC-OWNER; SRC-INBOX; SRC-WAHA |
| INT-011 | SRC-OWNER; SRC-INBOX; SRC-WAHA |
| INT-012 | SRC-OWNER; SRC-SUPA; SRC-INBOX; SRC-SEC |
| INT-013 | SRC-OWNER; SRC-SUPA; SRC-INBOX; SRC-SEC |
| INT-014 | SRC-OWNER; SRC-SUPA; SRC-INBOX; SRC-SEC |
| INT-015 | SRC-OWNER; SRC-SUPA; SRC-INBOX; SRC-SEC |
| INT-016 | SRC-OWNER; SRC-INBOX; SRC-LEAD |
| INT-017 | SRC-OWNER; SRC-INBOX; SRC-LEAD |
| INT-018 | SRC-OWNER; SRC-OPS; SRC-UI |
| INT-019 | SRC-OWNER; SRC-OPS; SRC-UI |
| INT-020 | SRC-OWNER; SRC-OPS; SRC-UI |
| DATA-001 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-SEC |
| DATA-002 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-SEC |
| DATA-003 | SRC-INBOX; SRC-LEAD; SRC-SEC |
| DATA-004 | SRC-INBOX; SRC-LEAD; SRC-SEC |
| DATA-005 | SRC-INBOX; SRC-LEAD; SRC-SEC |
| DATA-006 | SRC-INBOX; SRC-LEAD; SRC-SEC |
| DATA-007 | SRC-INBOX; SRC-LEAD; SRC-SEC |
| DATA-008 | SRC-BIZ; SRC-SUPA; SRC-SEC |
| DATA-009 | SRC-BIZ; SRC-SUPA; SRC-SEC |
| DATA-010 | SRC-BIZ; SRC-SUPA; SRC-SEC |
| DATA-011 | SRC-BIZ; SRC-SUPA; SRC-SEC |
| DATA-012 | SRC-BIZ; SRC-SUPA; SRC-SEC |
| DATA-013 | SRC-BIZ; SRC-SUPA; SRC-SEC |
| DATA-014 | SRC-ARCH; SRC-OPS; SRC-SUPA |
| DATA-015 | SRC-ARCH; SRC-OPS; SRC-SUPA |
| DATA-016 | SRC-ARCH; SRC-OPS; SRC-SUPA |
| DATA-017 | SRC-OWNER; SRC-ARCH; SRC-BIZ; SRC-SEC |
| DATA-018 | SRC-OWNER; SRC-ARCH; SRC-BIZ; SRC-SEC |
| SEC-001 | SRC-SEC; SRC-OPS |
| SEC-002 | SRC-SEC; SRC-SUPA |
| SEC-003 | SRC-SEC; SRC-SUPA |
| SEC-004 | SRC-SEC; SRC-SUPA |
| SEC-005 | SRC-SEC; SRC-SUPA |
| SEC-006 | SRC-SEC; SRC-WAHA; SRC-AMO |
| SEC-007 | SRC-SEC |
| SEC-008 | SRC-SEC; SRC-OZO; SRC-SUPA |
| SEC-009 | SRC-SEC; SRC-OZO; SRC-SUPA |
| SEC-010 | SRC-SEC; SRC-OZO; SRC-SUPA |
| SEC-011 | SRC-SEC; SRC-UI; SRC-OPS |
| SEC-012 | SRC-SEC; SRC-UI; SRC-OPS |
| SEC-013 | SRC-SEC; SRC-UI; SRC-OPS |
| SEC-014 | SRC-SEC; SRC-UI; SRC-OPS |
| SEC-015 | SRC-SEC; SRC-UI; SRC-OPS |
| SEC-016 | SRC-SEC; SRC-UI; SRC-OPS |
| SEC-017 | SRC-SEC; SRC-UI; SRC-OPS |
| SEC-018 | SRC-SEC; SRC-OPS |
| SEC-019 | SRC-SEC; SRC-OPS |
| SEC-020 | SRC-OWNER; SRC-GAP |
| NFR-001 | SRC-OWNER; SRC-OPS; SRC-GAP |
| NFR-002 | SRC-OWNER; SRC-OPS; SRC-GAP |
| NFR-003 | SRC-OWNER; SRC-OPS; SRC-GAP |
| NFR-004 | SRC-OWNER; SRC-OPS; SRC-GAP |
| NFR-005 | SRC-OWNER; SRC-OPS; SRC-GAP |
| NFR-006 | SRC-OWNER; SRC-OPS; SRC-GAP |
| NFR-007 | SRC-OWNER; SRC-OPS; SRC-GAP |
| NFR-008 | SRC-OWNER; SRC-OPS; SRC-GAP |
| NFR-009 | SRC-UI; SRC-OWNER |
| NFR-010 | SRC-UI; SRC-OWNER |
| NFR-011 | SRC-UI; SRC-OWNER |
| NFR-012 | SRC-UI; SRC-OWNER |
| NFR-013 | SRC-ARCH; SRC-OPS; SRC-OWNER |
| NFR-014 | SRC-ARCH; SRC-OPS; SRC-OWNER |
| NFR-015 | SRC-ARCH; SRC-OPS; SRC-OWNER |
| NFR-016 | SRC-ARCH; SRC-OPS; SRC-OWNER |
| NFR-017 | SRC-ARCH; SRC-OPS; SRC-OWNER |
| NFR-018 | SRC-ARCH; SRC-OPS; SRC-OWNER |
| ACC-001 | SRC-OWNER; SRC-SEC; SRC-SUPA |
| ACC-002 | SRC-OWNER; SRC-SEC; SRC-SUPA |
| ACC-003 | SRC-OWNER; SRC-SEC; SRC-SUPA |
| ACC-004 | SRC-OWNER; SRC-SEC; SRC-SUPA |
| ACC-005 | SRC-OWNER; SRC-SEC; SRC-SUPA |
| ACC-006 | SRC-OWNER; SRC-INBOX; SRC-WAHA; SRC-AMO |
| ACC-007 | SRC-OWNER; SRC-INBOX; SRC-WAHA; SRC-AMO |
| ACC-008 | SRC-OWNER; SRC-INBOX; SRC-WAHA; SRC-AMO |
| ACC-009 | SRC-OWNER; SRC-INBOX; SRC-WAHA; SRC-AMO |
| ACC-010 | SRC-OWNER; SRC-INBOX; SRC-WAHA; SRC-AMO |
| ACC-011 | SRC-OWNER; SRC-INBOX; SRC-WAHA; SRC-AMO |
| ACC-012 | SRC-OWNER; SRC-INBOX; SRC-WAHA; SRC-AMO |
| ACC-013 | SRC-OWNER; SRC-INBOX; SRC-WAHA; SRC-AMO |
| ACC-014 | SRC-OZO; SRC-BIZ; SRC-UI |
| ACC-015 | SRC-OZO; SRC-BIZ; SRC-UI |
| ACC-016 | SRC-OZO; SRC-BIZ; SRC-UI |
| ACC-017 | SRC-OZO; SRC-BIZ; SRC-UI |
| ACC-018 | SRC-OZO; SRC-BIZ; SRC-UI |
| ACC-019 | SRC-UI |
| ACC-020 | SRC-UI |
| ACC-021 | SRC-OPS; SRC-GAP |
| ACC-022 | SRC-OPS; SRC-GAP |
| ACC-023 | SRC-OPS; SRC-GAP |
| ACC-024 | SRC-OWNER; SRC-ARCH; SRC-LEAD; SRC-OPS |
| ACC-025 | SRC-OWNER; SRC-ARCH; SRC-LEAD; SRC-OPS |
| DEC-001 | SRC-OZO; SRC-GAP |
| DEC-002 | SRC-OZO; SRC-GAP |
| DEC-003 | SRC-OZO; SRC-GAP |
| DEC-004 | SRC-OZO; SRC-GAP |
| DEC-005 | SRC-OZO; SRC-GAP |
| DEC-006 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-WAHA; SRC-GAP |
| DEC-007 | SRC-OWNER; SRC-ARCH; SRC-AMO; SRC-WAHA; SRC-GAP |
| DEC-008 | SRC-OZO; SRC-SUPA; SRC-OPS; SRC-GAP |
| DEC-009 | SRC-OZO; SRC-SUPA; SRC-OPS; SRC-GAP |
| DEC-010 | SRC-OZO; SRC-SUPA; SRC-OPS; SRC-GAP |
| DEC-011 | SRC-OZO; SRC-SUPA; SRC-OPS; SRC-GAP |
| DEC-012 | SRC-OZO; SRC-SUPA; SRC-OPS; SRC-GAP |
| DEC-013 | SRC-BIZ; SRC-INBOX; SRC-GAP |
| DEC-014 | SRC-BIZ; SRC-INBOX; SRC-GAP |
| DEC-015 | SRC-BIZ; SRC-INBOX; SRC-GAP |
| DEC-016 | SRC-BIZ; SRC-GAP |
| DEC-017 | SRC-OWNER; SRC-LEAD; SRC-OPS; SRC-GAP |
| DEC-018 | SRC-OWNER; SRC-LEAD; SRC-OPS; SRC-GAP |
| DEC-019 | SRC-OZO; SRC-BIZ; SRC-GAP |
| DEC-020 | SRC-OZO; SRC-BIZ; SRC-GAP |


## 32. Согласование

| Роль | ФИО | Решение | Дата | Подпись / ссылка |
| --- | --- | --- | --- | --- |
| Владелец продукта |  | Утверждено / с замечаниями / отклонено |  |  |
| Владелец бизнес-процессов |  | Утверждено / с замечаниями / отклонено |  |  |
| Ответственный Sales |  | Утверждено / с замечаниями / отклонено |  |  |
| Ответственный Admissions |  | Утверждено / с замечаниями / отклонено |  |  |
| Ответственный Visa |  | Утверждено / с замечаниями / отклонено |  |  |
| Ответственный Finance |  | Утверждено / с замечаниями / отклонено |  |  |
| Data/Privacy Owner |  | Утверждено / с замечаниями / отклонено |  |  |
| Технический владелец |  | Утверждено / с замечаниями / отклонено |  |  |

**Решение по версии 1.0:** _________________________________________________

**Обязательные замечания до реализации:** _________________________________
