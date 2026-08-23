# EVO Platform capability matrix

> **Status:** historical read-only snapshot. Product, ownership and sequencing
> statements are superseded in conflict by #376/ADR 0020. It is evidence input,
> not a current authority document or live-readiness proof.

Статусный снимок: `origin/main` / `d243b2bb370d052750278e7f5cc2625991d5f870`, 2026-08-17 (Asia/Bishkek).

Этот документ отвечает на вопрос «что уже есть внутри Platform, а что пока существует только как код, локальное доказательство или отдельная система». Он не является production-проверкой. Во время аудита production, Supabase, WAHA, amoCRM, Gemini, WhatsApp и клиентские данные не читались и не изменялись. Активный P8D4 rollout выполняется отдельной задачей; его ещё не завершённый результат здесь не считается доказательством.

## Как читать статусы

- **Merged** — реализация присутствует в текущем `main`. Это не означает, что она развёрнута.
- **Repository proof** — в репозитории есть миграция, тест или принятый evidence contract. Этот аудит не переисполнял весь набор тестов.
- **Deployed** — подтверждено на production точным runtime evidence. Если live-среда не проверялась, статус — `unknown`.
- **Enabled** — runtime-флаг и нужная конфигурация включены. Наличие кода не означает включение.
- **Real-provider proof** — был доказан настоящий вызов провайдера/реальный путь, а не mock или synthetic fixture.
- **V1** — практическая роль возможности в первой контролируемой версии.

## Полная матрица

| Часть | Где находится сейчас | Внутри Platform? | Merged | Repository proof | Deployed | Enabled | Real-provider proof | Что отсутствует / блокирует | Роль в V1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Единая Platform schema | `supabase/migrations/040-076` в canonical root `supabase/` | Да | Да | Миграции, RLS/SQL tests | `unknown`; rollout проверяется отдельно | Не отдельный флаг | Не требуется для схемы; managed-production proof отдельно | Подтвердить contiguous `001-076` на production и exact deployed revision | Основа всех новых модулей |
| Platform Auth и роли | Migration `041`, server guards, `/auth/platform-session` | Да | Да | `tests/platform-auth/**`, `tests/role-contract.test.mjs`, SQL/RLS gates | `unknown` | Зависит от Supabase/Auth config | Managed Auth proof не подтверждён этим аудитом | Production staff identities, invitations, access-version and negative-scope smoke | Обязательная граница доступа |
| Object-scope и audit | Migrations `041-055`, guards, audit events | Да | Да | RLS tests, `tests/student-case-policy.test.mjs`, P1/P2 evidence docs | `unknown` | Основной scope не feature flag | Production object-scope proof — `unknown` | Реальные роли/назначения и production negative tests | Обязательный safety layer |
| Unified staff frontend | `src/app/(staff)` — dashboard, sales, clients, WhatsApp, applications, documents, visa, finance, tasks, reports, settings | Да | Да | UI/E2E suites and accepted frontend contract | `unknown` | Зависит от Platform session/runtime | Не provider capability | Exact-candidate browser smoke and employee acceptance | Основной интерфейс сотрудников |
| Sales workspace | `/sales`, accepted board/list UI | Частично | UI — да; live feed — нет | UI contract and connected-route tests; connected provider returns an empty lead list | `unknown` | Live amoCRM feed не реализован | Нет | Canonical list/read model, approved mapping, sales ownership and real account proof | Показывает честный blocked state; продажи остаются в amoCRM |
| amoCRM mapping discovery | Migration `058`, GET-only discovery client, immutable sanitized snapshots | Да, backend seam | Да | P4A tests/SQL RLS; PR #117 evidence | `unknown` | Нет runtime job/route; effectively off | Нет | Authorized credential, exact account run, orchestrating route/job, Admin selection/approval | Подготовка account-specific mapping, без активации |
| amoCRM mapping approval/activation | Только docs contract `p4b-amocrm-mapping-selection-approval.md`; implementation preserved outside main | Нет | Нет | Docs-only plan; failed earlier full gate is non-evidence | Нет доказательства | Нет | Нет | Merge reviewed P4B successor; approval/revocation/current pointer and semantic mapping | Не входит в V1, пока не пройдёт отдельный gate |
| amoCRM canonical conversation context | Migration `064`, GET-only adapter, `/whatsapp/[id]` card | Да | Да | P4R1 unit/SQL/UI tests; PR #142 evidence | `unknown` | Config defaults off; P8D4 contract keeps `EVO_PLATFORM_AMOCRM_READ_ENABLED=0` | Нет sanctioned credential/test entity proof | Exact account/contact/lead bindings, credential/scope, provider E2E | После отдельного включения: read-only имя контакта/лида, ответственный, pipeline/status |
| amoCRM sales tasks / calls / recordings / chat references | Target contract only | Нет | Нет | Ownership/ADR requirements only | Нет доказательства | Нет | Нет | GET adapters, safe projections, scope, reconciliation and UI | Отложить после базового canonical context |
| amoCRM webhooks and reconciliation | Target/TZ requirement | Нет | Нет | Требования `INT-003/004`; implementation отсутствует | Нет доказательства | Нет | Нет | Persist-first webhook inbox, async idempotent consumer, polling reconciliation, drift evidence | Обязательно до автоматического handoff/cutover |
| amoCRM writes / stage changes / test-lead creation | Explicitly deferred | Нет | Нет | Negative/fail-closed contracts | Нет | Нет | Нет | Fresh owner approval, approved mapping, write contract, loop prevention, sanitized test lead | Не входит в первый read-only rollout |
| Sales-to-Curator automatic handoff | Migration `042` supports pending case + Admin assignment, but amo contract signal is not integrated | Частично | Platform lifecycle — да; real trigger — нет | Local synthetic BW7/student lifecycle proof | `unknown` | Automatic provider-triggered handoff off | Нет | Approved signed-contract mapping, verified provider event, idempotent case creation, Admin assignment E2E | Handoff остаётся контролируемым человеком |
| WAHA signed inbound ingress | Migration `059`, `/api/internal/platform-messaging/waha/events` | Да | Да | P5A tests and local proof | `unknown` | P8D4 contract keeps ingress `0` | Нет live WAHA proof | Exact webhook/session/HMAC, sanitized inbound, rollback evidence | Disabled until controlled provider proof |
| WAHA receive/project worker | Migration `060`, private `/waha/work` | Да | Да | P5B worker/SQL/browser tests | `unknown` | P8D4 contract keeps worker `0` | Нет | Scheduler secret/config, real inbound projection | Disabled first; later receive-only proof |
| WhatsApp history reconciliation | Migration `061`, private history worker | Да | Да | P5C local contract/tests | `unknown` | P8D4 contract keeps history `0` | Нет | Real WAHA paging, bounded lifetime expectations, sanitized chat | Deferred until messaging pilot |
| Private WhatsApp media | Migration `062`, private Storage binding and download grants | Да | Да | P5D Storage/RLS/UI tests | `unknown` | P8D4 contract keeps media worker `0` | Synthetic bytes only | Real media event, supported size/type and human handoff evidence | Staff-only; autonomous media understanding stays off |
| ACK/session state and Realtime | Migration `063`, private Realtime invalidation | Да | Да | P5E local tests | `unknown` | Depends on WAHA lane; not proven enabled | Нет live ACK/session proof | Real delivered/read/unknown sequence and reconnect test | Needed before any send automation |
| Manual staff reply workflow | Migrations `049-055`, Platform messaging actions/UI | Да | Да | Local RLS/browser proof | `unknown` | Provider transport path not proven enabled | Нет real Platform WAHA manual-send proof | Exact staff actor, healthy session, real ACK/unknown proof | Draft review + deliberate employee send target |
| Staff takeover / autonomy pause | Migration `067`, UI/action state | Да | Да | Local autonomous-reply tests | `unknown` | Autonomy off; pause state still repository capability | Нет | Production actor/scope smoke and later real conversation proof | Human control is mandatory |
| Platform conversation memory | Migrations `065`, `076`; Supabase repository/UI/actions | Да | Да | Memory contract/RLS tests, consultative-memory migration | `unknown` | P8D4 contract keeps AI memory `0` | Provider not required for manual memory; live runtime unproved | Production config, staff workflow proof, retention/quality checks | Durable per-conversation facts and summaries, not per-client files |
| Platform-native approved knowledge retrieval | Migration `065`, `platform.approved_knowledge_chunks` and retrieval evidence | Да | Да | P5F1 retrieval/RLS tests | `unknown` | P8D4 contract keeps Platform AI memory/retrieval lane `0` | Lexical/local proof only; semantic/provider production proof absent | Approved-content publication path into Platform schema, embedding run and exact retrieval evaluation | Future grounding for Platform conversation drafts |
| Companion knowledge audience isolation/import/audit | Migrations `073-075` on legacy-compatible `public.ai_knowledge_*`; importer/retrieval in `agent-lead2-inbox` | Отдельный companion data plane в том же repo, не Platform `065` storage | Да | Bundle/import/audience/security tests and deterministic tooling | `unknown`; rollout separate | Only bounded P8D4 import/pilot authorized | Real production import/Gemini pilot is separate rollout evidence | Complete controlled 11 client / 291 internal import and verify client/internal isolation | Powers supervised internal assistant/client playground; does not by itself populate Platform-native retrieval |
| Full WhatsApp/Gmail/Drive/Notion audit | Local knowledge workspace, not runtime | Нет | Repo tooling partly; audit results outside Platform | Local handoff/evidence outside this repo | Нет | Нет | Not a provider runtime path | Managed review/publication of post-freeze candidates and new bundle | Source for later curated knowledge, never raw ingestion |
| New knowledge from correspondence | Post-freeze candidates in knowledge workspace | Пока нет | Нет current production publication | Local review artifacts only | Нет | Нет | Нет | Review, publish, rebuild deterministic bundle, retrieval rerun | Deferred second knowledge release |
| Client knowledge playground | K2-K4 companion app/runtime and 11-document client bundle contract | Пока companion surface, не unified Platform messaging lane | Code/migrations merged | Knowledge tests and P8D4 contract | `unknown` | Only authenticated staff pilot is authorized | Real Gemini pilot is separate rollout evidence | P8D4 import + authenticated non-customer test question; later decide Platform consumption contract | Staff-supervised client-answer preview |
| Gemini structured draft proposals | Migration `066`, private API/adapter, staff UI | Да | Да | Schema/adapter/UI tests; stateless `store=false` contract | `unknown` | P8D4 contract keeps Platform proposals `0` except bounded pilot surface | No live customer-data provider proof accepted here | Credential/model allowlist, exact prompt/eval, staff pilot evidence | Draft-only; employee reviews/edits |
| Consultative-sales personality | Prompt contract and migration `076`; supervised Lead Agent policy | Частично | Prompt/memory contract merged | Contract/unit coverage | `unknown` | Automatic replies stay off | No representative real-conversation quality proof | Curator/sales review set, scored edits, prompt promotion governance | Supervised drafts; corrections do not auto-train |
| Deterministic autonomous inbound replies | Migration `067`, worker and double gate | Да as disabled code | Да | Local gate/idempotency/negative tests | `unknown` | P8D4 mandates `0` + kill switch `1` | Нет real Gemini/WAHA/customer send proof | Separate explicit approval, real receive-to-ACK, hours/consent/knowledge/session gates | Не включать в first version |
| Applications | Migrations `042`, `052`, `056`; `/applications` staff + portal pages | Да | Да | Catalog/application/RLS/E2E tests | `unknown` | Core runtime, no provider flag | University/provider submission not integrated/proved | Real catalog publication and staff workflow acceptance | Curator manages multiple applications manually |
| University catalog import/approval | Migration `056`, staged validate/Admin approve flow | Да | Да | BW5 catalog tests/local Supabase proof | `unknown` | No scheduled external connector | Нет live university-source connector proof | Governed current source import, review cadence, expiry/refresh rules | Approved manual catalog only |
| Student case / Student 360 | Migrations `042-057`, `/clients/[id]` and case operations | Да | Да | BW7/P6D synthetic cross-role E2E | `unknown` | Core runtime | Not provider-dependent; real production case proof absent | Real assignment/access smoke after rollout; amo handoff still blocked | Operational source after signed contract and Admin assignment |
| Student Portal | `/portal/*`, migrations `042-070` | Да | Да | Portal/RLS/E2E and P6A-P6D proofs | `unknown` | P6 flags planned `0` in P8D4 first rollout | Not external provider | Real student account, assignment activation and two-student isolation smoke | Read-only/self-service views under staff control |
| Private document upload/download | Migration `046`, document pages and private grants | Да | Да | Storage/RLS/document E2E | `unknown` | Core/config dependent | Managed Storage production proof absent here | Real safe test file, access/revocation, backup/restore and malware policy | Upload/download/version/review, staff controlled |
| Document review/rework/finalization | Migrations `043`, `051-055`; staff queue/actions | Да | Да | Document review and lifecycle tests | `unknown` | Core runtime | No external provider | Employee workflow acceptance and real Storage evidence | Curator reviews; Student sees safe outcome/comment |
| AI document reading, extraction, autofill, Student Profile DOCX | Separate `evo_student_document_system` under ADR 0017 | Нет | Нет in this repo | Separate local-first implementation/tests | Not Platform | Not Platform | No Platform integration proof | Auth, secure object storage, scan/retention, import/export contract and separate approval | Curators use separate supervised assistant; no automatic exchange |
| OZO Curator assistant | Requirements/knowledge work and future docs; no autonomous OZO runtime | Частично | General Platform AI/retrieval exists; OZO workflow not complete | Requirements and knowledge artifacts, not end-to-end proof | `unknown` | No dedicated enabled OZO agent | Нет | Country playbooks, curator task UX, draft evaluation and monitored pilot | Assistant only; Curator owns decisions/actions |
| Visa case management | Migration `042`; `/visa` staff/portal, Curator/Admin role | Да | Да | Visa role/RLS and P6D tests | `unknown` | Core runtime | No embassy/visa provider integration | Country playbooks, real staff acceptance, dates/evidence workflow | Manual Curator-owned module |
| Finance/payment tracking | Migration `043`; `/finance` and `/portal/payments` | Да | Да | Finance/RLS/P6D local proof | `unknown` | Core runtime | No bank/payment-provider proof | Real evidence/reconciliation workflow, permissions, reports | Manual evidence-based tracking, not payment execution |
| Tasks and overdue state | Migrations `042-043`, `069-070`; `/tasks` + portal attention | Да | Да | P6A/P6C tests | `unknown` | Overdue producer planned `0` in first rollout | Not provider-dependent | Scheduler config and real due-transition proof | Staff tasks plus portal-visible actions |
| In-app notifications | Migrations `043`, `068-070`; staff/portal notifications | Да | Да | P6B/P6C local proof | `unknown` | P6B/P6C flags planned `0` initially | No WhatsApp notification provider proof | Enablement plan, real actor delivery/read-state smoke | In-app only first; individual WhatsApp notifications deferred |
| Contract drafts and post-contract reports | Migration `057`, Student 360 workspace | Да | Да | BW6 contract/report tests | `unknown` | Core runtime | No e-sign/PDF/DOCX/legal-provider proof | Approved templates, legal review, production staff acceptance | Versioned draft/report, not signed legal document |
| Audit search/export | Migration `071`, Settings and export route | Да | Да | P7A tests/local proof | `unknown` | P8D4 contract keeps P7A `0` | Not provider-dependent | Authorized production enablement and Admin export smoke | Admin-only, bounded redacted audit evidence |
| Private observability | Migration `072`, readiness/metrics and configs | Да | Да | P7B tests and redaction proof | Intended in P8D4; actual `unknown` | P8D4 contract requires `1` | External log-drain/pager unproved | Confirm private access, secrets, alerts/runbook ownership | Health/readiness only; no public metrics |
| Backup/recovery | P7C contract and partial managed inventory | Частично | Contract/tooling partly merged | Local/contract evidence; managed drill deferred | Production backup state not verified here | N/A | No complete recovery drill/PITR/non-empty Storage proof | Owner-authorized recovery target, restore drill, measured RPO/RTO | Operational blocker, not product UI |
| Capacity/performance | Deferred P7D large capacity test | Нет complete proof | Some runtime guards/tests | No representative managed load result | `unknown` | N/A | Нет | Workload model, managed test target, limits and alerts | Defer scale claim; monitor small pilot |
| Accessibility | Focused contract and automated E2E | Частично | Automated/focused work merged | Accessibility Playwright and contract evidence | Exact deployed candidate proof `unknown` | N/A | N/A | Owner-led keyboard/zoom/VoiceOver/mobile review on exact candidate | Required before broad staff/student adoption |
| Legacy root CRM | Existing SQLite/custom-auth implementation | Отдельно | Да, legacy | Legacy tests/runtime history | Plan says deployed; not live-verified here | Current legacy runtime | Provider state not inferred | Maintain rollback boundary; do not treat as Platform data source | Temporary operational fallback |
| EVO Inbox companion | Separate companion app/Supabase contour | Отдельно | Да | Companion tests/contracts | Plan describes deployed reference; live state `unknown` | Session/runtime state `unknown` | Not established by this audit | Controlled cutover decision and exact provider evidence | Retained messaging reference |
| Legacy Lead Agent | `evo-lead-agent` separate container/runtime | Пока отдельно | Да | Agent tests and Compose/release contracts | Plan states deployed/frozen; not live-verified here | P8D4 mandates worker/autoreply/outbound off and frozen | No new live proof | Keep rollback; later explicit retirement/cutover plan | Safety fallback, not target brain |

## Что это означает простыми словами

1. **В Platform уже есть большая часть каркаса продукта:** роли, Student 360, Portal, applications, documents, visa, finance, tasks, notifications, WhatsApp data plane, memory, retrieval, AI drafts and audit.
2. **Самый большой разрыв — не отсутствие экранов, а отсутствие живого end-to-end доказательства.** Merged code and local tests do not prove current production flags, provider credentials, real WAHA/amoCRM/Gemini behavior or employee workflow quality.
3. **На момент снимка первая версия считалась supervised.** Текущий контракт
   сохраняет human review, но делает EVO/Supabase canonical и исключает любой
   outbound send из первого receive-only stage.
4. **Sales funnel is not yet inside Platform as a working canonical funnel.** The `/sales` screen exists, but the connected path intentionally returns no live deals until the amoCRM mapping/authority work is completed.
5. **Document AI remains separate by design.** Platform already owns secure document lifecycle; extraction/autofill/export is a separate local-first Student Profile system and requires a future reviewed integration.

## Evidence index

Core authority and status:

- `CONTEXT.md`
- `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`
- `docs/adr/0020-unify-evo-v1-on-canonical-supabase.md` (current authority)
- `docs/specs/EVO_PLATFORM_TZ.md` (historical source)
- `docs/adr/0014-unified-evo-platform-target-architecture.md` (historical)
- `docs/adr/0017-separate-student-profile-document-automation-from-evo-platform.md`
- `docs/adr/0018-defer-amocrm-and-retain-lead-agent.md` (historical)
- `docs/adr/0019-gate-autonomous-inbound-replies-and-resume-read-only-amocrm.md` (superseded)
- `docs/platform/current-status.md` (historical per-block evidence; not a live production snapshot)
- `docs/platform/p8d4-current-main-staff-pilot.md` (superseded rollout source)

Implementation evidence:

- `supabase/migrations/040_platform_namespaces_and_secret_containment.sql` through `supabase/migrations/076_platform_consultative_sales_memory.sql`
- `src/app/(staff)/**`, `src/app/portal/**`
- `src/lib/platform-*.ts`, `src/lib/server/platform-*.ts`
- `tests/platform-*.test.mjs`, `tests/e2e/platform-*.spec.ts`, `tests/e2e/student-*.spec.ts`
- `supabase/tests/platform_*.sql`

Official integration constraints used by the target design:

- [Kommo API limitations](https://developers.kommo.com/docs/limitations)
- [Kommo webhooks](https://developers.kommo.com/docs/webhooks-general)
- [Kommo leads](https://developers.kommo.com/reference/leads-list)
- [Kommo pipelines](https://developers.kommo.com/reference/pipelines-list)
- [WAHA events](https://waha.devlike.pro/docs/how-to/events/)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
