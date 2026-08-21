# EVO Platform — матрица требований и доказательств

Назначение: закрыть критерий приёмки **ACC-001** («все MUST требования имеют
test/evidence и owner») фактическими ссылками на код, тесты и миграции, а не
оценкой.

- Дата: 20 августа 2026 года
- Базовый `origin/main`: `a90d5d1d`
- Миграции на базовом main: `001–077`
- Источник требований: `docs/specs/EVO_PLATFORM_TZ.md` (версия 2.3, FR-001–FR-110)
- Метод: каждое требование сверено с существующими файлами реализации, тестами и
  миграциями в этом же коммите. Строка без ссылки означает отсутствие
  доказательства, а не «вероятно сделано».

## Как читать статусы

| Статус | Значение |
| --- | --- |
| `реализовано` | Есть код и проверка в репозитории |
| `частично` | Часть требования закрыта, часть нет; недостающее названо в строке |
| `deferred` | Отложено решением владельца (P4B activation/writes) |
| `blocked` | Заблокировано внешним обстоятельством, названным в строке |
| `не реализовано` | Реализации нет |

## Граница доказательства

Все статусы `реализовано` в этом документе означают **repository-level и
local/synthetic evidence**. Ни одно требование в разделе 13.4 и ни один
provider-зависимый пункт не имеет доказательства работы с реальным WAHA,
amoCRM, Gemini или managed Supabase. Это отдельный уровень, закрываемый
критериями ACC-006, ACC-009–ACC-013 и ACC-024, и он не закрыт.

## Сводка

| Раздел | Требований | реализовано | частично | deferred | blocked | не реализовано |
| --- | --- | --- | --- | --- | --- | --- |
| 13.1 Foundation, identity, access | 12 | 9 | 1 | 0 | 0 | 2 |
| 13.2 Dashboard and work queues | 6 | 4 | 2 | 0 | 0 | 0 |
| 13.3 Sales and amoCRM | 12 | 2 | 5 | 5 | 0 | 0 |
| 13.4 Communications, WhatsApp, AI | 18 | 18 | 0 | 0 | 0 | 0 |
| 13.5 Student case and admissions | 7 | 7 | 0 | 0 | 0 | 0 |
| 13.6 Applications and documents | 11 | 9 | 2 | 0 | 0 | 0 |
| 13.7 Visa and finance | 8 | 6 | 0 | 0 | 0 | 2 |
| 13.8 Tasks, notifications, reports, admin | 10 | 5 | 5 | 0 | 0 | 0 |
| 13.9 Student Portal | 6 | 5 | 1 | 0 | 0 | 0 |
| 13.10 OP/OZO business workflows | 20 | 19 | 0 | 0 | 1 | 0 |
| **Итого** | **110** | **84** | **16** | **5** | **1** | **4** |

Доля требований с доказательством в репозитории (`реализовано`): **76 %**.
Доля с доказательством работы реального провайдера: **0 %**.

Оба непокрытых требования (FR-010, FR-011) имеют приоритет `SHOULD` и отложены
решением владельца. Среди `MUST` требований непокрытых нет; пять `deferred`
относятся к отложенному P4B, один `blocked` — к недоступному источнику импорта.

## 13.1 Foundation, identity and access

| ID | Статус | Реализация | Доказательство |
| --- | --- | --- | --- |
| FR-001 | реализовано | `src/lib/platform-auth.ts`, `src/app/login` | `tests/platform-auth-config.test.mjs`, `tests/e2e/sensitive-permissions.spec.ts`, PR #95, PR #112 |
| FR-002 | реализовано | `supabase/migrations/041_platform_identity_rbac_audit.sql` | `scripts/test-postgres-authorization.sh`, PR #86 |
| FR-003 | реализовано | `src/lib/roles.ts`, `platform.business_role` в 041 | `tests/role-contract.test.mjs`, `tests/visa-role-migration.test.mjs`, PR #76 |
| FR-004 | реализовано | `src/lib/platform-guards.ts`, `src/lib/platform-route-contract.ts` | `tests/platform-audit-route-contract.test.mjs` |
| FR-005 | реализовано | миграции 041–046 (FORCE RLS) | `scripts/test-postgres-authorization.sh`, `npm run test:supabase:local` |
| FR-006 | частично | `platform.provision_member`, `change_membership_role`, `change_membership_status` в 041 | Аудируемые RPC существуют и покрыты `supabase/tests/platform_identity_rbac.sql`. **Операторского пути нет**: `provision_member` не вызывается нигде за пределами тестов, страницы управления сотрудниками в `src/app/(staff)/settings` не существует, а E2E `admin lifecycle`, назначенный способом проверки, отсутствует. См. `docs/platform/staff-provisioning-gap.md` |
| FR-007 | реализовано | `supabase/migrations/047_platform_current_actor_authority.sql` | `tests/supabase-auth-hook-harness.test.mjs`, PR #112 |
| FR-008 | реализовано | `src/lib/platform-portal.ts` | `tests/platform-portal.test.mjs`, `tests/e2e/student-portal.spec.ts` |
| FR-009 | реализовано | `src/app/(staff)/access-denied`, `src/app/platform-pending` | `tests/e2e/platform-accessibility.spec.ts`, скриншоты `access-states/` |
| FR-010 | не реализовано | — | Приоритет SHOULD. Отложено решением DEC-003 (custom roles после MVP) |
| FR-011 | не реализовано | — | Приоритет SHOULD. Решение владельца 2026-08-20: CEO и CTO используют роль `admin`, отдельный Leadership bundle не создаётся |
| FR-012 | реализовано | `src/lib/platform-audit-csv.ts`, миграция 071 | `tests/platform-audit-export-route.test.mjs`, `tests/platform-audit-csv.test.mjs`, PR #156 |

## 13.2 Dashboard and work queues

| ID | Статус | Реализация | Доказательство |
| --- | --- | --- | --- |
| FR-013 | частично | `src/app/(staff)/dashboard` | Экран и ролевая фильтрация есть. KPI и очереди, зависящие от amoCRM, недоступны до возобновления P4 |
| FR-014 | реализовано | миграция 069, `src/lib/platform-portal.ts` | `tests/platform-p6a-portal-attention.test.mjs`, `tests/platform-p6c-overdue-notifications.test.mjs`, PR #148 |
| FR-015 | реализовано | `src/lib/platform-portal.ts` | `tests/platform-p6a-portal-attention.test.mjs` |
| FR-016 | реализовано | `src/app/(staff)/dashboard` | `tests/e2e/platform-navigation-dashboard-polish.spec.ts`, скриншот `design-polish-dashboard-all-clear-desktop-1440x1024.png` |
| FR-017 | частично | `src/app/(staff)/reports` | Экран существует. Отдельной проверки контракта KPI (формула, источник, период, свежесть) в тестах нет |
| FR-018 | реализовано | `src/lib/runtime-mode.ts`, `src/lib/portal-fixture.ts` | `tests/runtime-hardening.test.mjs` |

## 13.3 Sales and amoCRM

Раздел ограничен решением владельца: активация маппинга и запись в amoCRM (P4B)
отложены. Реализация сохранена на ветке
`izzhackt/evo-platform-p4b-mapping-approval`, коммит `e53ba949`, PR не открывался.

| ID | Статус | Реализация | Доказательство |
| --- | --- | --- | --- |
| FR-019 | частично | миграция 064 | Канонический read-контекст стадии есть, отображение pipeline на реальных стадиях не доказано. PR #142 |
| FR-020 | частично | `src/lib/platform-amocrm-canonical-context.ts` | `tests/platform-amocrm-canonical-context-ui.test.mjs`. Объединение только по доступному read-контексту |
| FR-021 | deferred | — | Путь записи. P4B |
| FR-022 | частично | миграция 064 | Явное stale/degraded состояние реализовано; поведение при недоступности на реальном провайдере не проверялось |
| FR-023 | deferred | — | Путь записи. P4B |
| FR-024 | deferred | — | Путь записи. P4B |
| FR-025 | deferred | — | Путь записи. P4B |
| FR-026 | частично | `src/app/(staff)/sales` | Фильтры по локальным полям есть; фильтры по amo-производным полям недоступны |
| FR-027 | частично | `src/lib/platform-bw4-actions.ts` | Приоритет SHOULD. Owner/next step/due закрыты в OP-lifecycle, но не в amo-контексте |
| FR-028 | реализовано | миграции 052, 057, `src/lib/platform-case-assignment.ts` | `tests/platform-contract-workflow.test.mjs`, `tests/e2e/student-case-lifecycle.spec.ts`, PR #114. Амо-часть маппинга — deferred |
| FR-029 | реализовано | уникальное ограничение в миграции 042 | `tests/platform-admissions.test.mjs` |
| FR-030 | deferred | — | Требует утверждённых canonical IDs. P4B |

## 13.4 Communications, WhatsApp and AI

Весь раздел реализован и покрыт тестами в репозитории. Ни одно требование не
имеет доказательства работы с реальным WAHA или Gemini. Все provider-пути
выключены по умолчанию.

| ID | Статус | Реализация | Доказательство |
| --- | --- | --- | --- |
| FR-031 | реализовано | миграция 059, `src/app/api/internal/platform-messaging/waha/events` | `tests/platform-waha-ingress.test.mjs`, PR #132 |
| FR-032 | реализовано | dedupe в миграции 059 | `tests/platform-waha-ingress.test.mjs` |
| FR-033 | реализовано | миграция 063, `src/app/(staff)/whatsapp` | `tests/platform-messaging-realtime.test.mjs`, `tests/e2e/platform-whatsapp-polish.spec.ts`, PR #141 |
| FR-034 | реализовано | миграции 061, 062 | `tests/platform-waha-history.test.mjs`, `tests/platform-waha-media.test.mjs`, PR #137, PR #138 |
| FR-035 | реализовано | миграции 049, 077, `src/lib/platform-messaging-workflow.ts` | `tests/platform-manual-send-worker.test.mjs`, `tests/platform-manual-send-sidecar.test.mjs`, PR #97 |
| FR-036 | реализовано | миграция 045 (durable queues) | `tests/p2g-queues-runtime-harness.test.mjs`, PR #90 |
| FR-037 | реализовано | миграция 061 (reconciliation cursor) | `tests/platform-waha-history.test.mjs` |
| FR-038 | реализовано | `src/lib/access.ts`, `src/lib/platform-case-assignment.ts` | `tests/p1c-object-access-policy.test.mjs`, `tests/e2e/p1c-object-scope.spec.ts`, PR #77, PR #78 |
| FR-039 | реализовано | миграция 066, `src/lib/platform-gemini-proposals.ts` | `tests/platform-gemini-proposal.test.mjs`, `tests/platform-gemini-proposals.test.mjs`, PR #145 |
| FR-040 | реализовано | миграция 067, `src/lib/platform-autonomous-replies.ts` | `tests/platform-autonomous-reply.test.mjs`, PR #146 |
| FR-041 | реализовано | миграция 066 | `tests/platform-gemini-proposals.test.mjs` |
| FR-042 | реализовано | миграция 067 | `tests/platform-autonomous-replies-ui.test.mjs`, `tests/prepared-ai-drawer-state.test.mjs` |
| FR-043 | реализовано | миграции 049, 067 | `tests/platform-manual-send-worker.test.mjs` |
| FR-044 | реализовано | `src/lib/platform-gemini-proposals.ts` | `tests/platform-gemini-proposal.test.mjs` |
| FR-045 | реализовано | миграции 065, 073, 074 | `tests/platform-ai-memory.test.mjs`, `tests/platform-knowledge-bundle.test.mjs`, PR #144 |
| FR-046 | реализовано | миграция 062, `src/app/api/platform-messaging/media/[mediaId]` | `tests/platform-waha-media.test.mjs`, `tests/platform-media-route.test.mjs`, PR #138 |
| FR-047 | реализовано | `src/lib/platform-communications.ts` | `tests/platform-communications.test.mjs`, `tests/platform-communications-media.test.mjs` |
| FR-048 | реализовано | миграция 072, `src/lib/platform-operational-signals.ts` | `tests/platform-operational-signals.test.mjs`, `tests/platform-observability-routes.test.mjs`, `tests/e2e/platform-communications-admin.spec.ts` |

## 13.5 Student case and admissions

| ID | Статус | Реализация | Доказательство |
| --- | --- | --- | --- |
| FR-049 | реализовано | `src/app/(staff)/clients/[id]`, миграция 042 | `tests/platform-admissions.test.mjs`, скриншоты `core/student-360-detail-*` |
| FR-050 | реализовано | `src/lib/platform-case-operations.ts` | `tests/platform-case-operations.test.mjs` |
| FR-051 | реализовано | миграция 053, `src/lib/platform-student-profile-fields.ts` | `tests/platform-student-profile.test.mjs`, PR #102 |
| FR-052 | реализовано | `src/lib/platform-case-assignment.ts` | `tests/p1c-object-access-policy.test.mjs`, PR #77 |
| FR-053 | реализовано | миграция 070 | `tests/platform-portal.test.mjs`, PR #153 |
| FR-054 | реализовано | `src/lib/platform-case-operations-actions.ts` | `tests/platform-case-operations.test.mjs`, `tests/e2e/student-case-lifecycle.spec.ts` |
| FR-055 | реализовано | миграция 042 | `tests/student-case-policy.test.mjs` |

## 13.6 Applications and documents

| ID | Статус | Реализация | Доказательство |
| --- | --- | --- | --- |
| FR-056 | реализовано | миграции 042, 056 | `tests/platform-catalog.test.mjs`, `tests/platform-admissions.test.mjs` |
| FR-057 | реализовано | миграция 056, `src/lib/platform-catalog-provenance.ts` | `tests/platform-catalog.test.mjs`, PR #113 |
| FR-058 | реализовано | `scripts/audit-public-promises.mjs` | `npm run public-promise-audit:self-test`, `docs/PROMISE_AUDIT.md` |
| FR-059 | реализовано | миграция 053 | `tests/platform-student-profile.test.mjs`. Приоритет SHOULD |
| FR-060 | реализовано | миграция 046 (private Storage) | `tests/e2e/platform-documents-experience.spec.ts`, PR #92 |
| FR-061 | частично | миграция 046 | Тип, размер 25 MB и целостность проверяются. **Реальный антивирусный провайдер отсутствует**, malware-политика не доказана |
| FR-062 | частично | `src/lib/platform-document-review.ts` | Разделение наблюдения и решения соблюдено. Чтение и извлечение фактов из документа выведено за пределы репозитория решением PR #128 |
| FR-063 | реализовано | `src/lib/platform-document-review-actions.ts` | `tests/e2e/platform-documents-experience.spec.ts` |
| FR-064 | реализовано | `src/app/portal/documents` | `tests/e2e/platform-documents-experience.spec.ts`, скриншоты `documents-experience/` |
| FR-065 | реализовано | миграция 046 (audited download grants) | `tests/platform-audit.test.mjs` |
| FR-066 | реализовано | `src/app/(staff)/documents/error.tsx` | `tests/e2e/platform-documents-experience.spec.ts` |

## 13.7 Visa and finance

| ID | Статус | Реализация | Доказательство |
| --- | --- | --- | --- |
| FR-067 | реализовано | `getPlatformCaseVisa`, `upsertPlatformCaseVisaAction`, миграция 043 | `tests/platform-admissions.test.mjs`, `tests/e2e/platform-operations.spec.ts` |
| FR-068 | реализовано | `src/lib/platform-admissions.ts` | `tests/platform-admissions.test.mjs` |
| FR-069 | реализовано | `listPlatformCaseFinance`, миграция 043 | `tests/platform-admissions.test.mjs`, PR #88 |
| FR-070 | реализовано | `settlePlatformPaymentObligationAction` | `tests/e2e/platform-operations.spec.ts`, `tests/e2e/sensitive-permissions.spec.ts` |
| FR-071 | реализовано | отсутствие маппинга stage→оплата | `tests/platform-case-operations.test.mjs` |
| FR-072 | не реализовано | RPC `create_stop_factor` в миграции 043 | Таблицы и RPC существуют, но **вызовов нет нигде**: ни в `src/app`, ни в `src/lib`, ни в сценариях. Оператор не может создать stop factor |
| FR-073 | не реализовано | RPC `resolve_stop_factor` в миграции 043 | Снятие блокировки недостижимо по той же причине: RPC не вызывается ниоткуда |
| FR-074 | реализовано | миграция 069, `src/app/portal/payments` | `tests/platform-p6c-overdue-notifications.test.mjs`, PR #152 |

## 13.8 Tasks, notifications, collaboration, reports and administration

| ID | Статус | Реализация | Доказательство |
| --- | --- | --- | --- |
| FR-075 | частично | `addTaskAction`, `moveTaskAction`, `completeTaskAction` в `src/lib/actions.ts` | Задачи работают, но через **legacy-путь**: действия обращаются к SQLite, а не к `platform.case_tasks`. Platform-пути задач в интерфейсе нет |
| FR-076 | частично | миграция 069, `platform-portal.ts` | Просроченные задачи попадают в очередь внимания **портала студента**. Ролевая очередь сотрудника берёт задачи из legacy-пути, см. FR-075 |
| FR-077 | реализовано | миграция 068, `src/lib/platform-portal-notification-actions.ts` | `tests/platform-p6b-portal-notifications.test.mjs`, PR #149 |
| FR-078 | реализовано | `src/app/(staff)/chat` отделён от audit | `tests/platform-audit.test.mjs` |
| FR-079 | частично | `src/app/(staff)/calls` | Приоритет SHOULD. Экран есть, отдельного контрактного теста записи звонка нет |
| FR-080 | частично | `src/app/(staff)/reports` | Экран есть. Контракт источника, периода, формулы и свежести тестом не закреплён |
| FR-081 | реализовано | `src/app/(staff)/settings/LegacySettingsPage.tsx` (секция readiness по отдельным prerequisite) | `tests/platform-observability-config.test.mjs`, скриншот `07-settings-readiness-desktop-1440.png`. Граница: видимая поверхность — legacy-экран настроек; `/api/readiness` и `/metrics` приватны и закрыты на периметре в `Caddyfile.evo-edge`, поэтому машинные endpoint'ы администратору не видны |
| FR-082 | реализовано | миграция 071, `src/lib/platform-audit-repository.ts` | `tests/platform-audit-route-contract.test.mjs`, `tests/platform-audit-ui.test.mjs`, PR #156 |
| FR-083 | частично | versioned permission bundles в миграции 041 | `tests/platform-auth-config.test.mjs`. Версионирование и откат наборов прав в базе доказаны. **Операторского пути смены конфигурации Platform нет**: страница `/settings` отдаёт только аудит либо legacy-экран, а рабочие настройки задаются переменными окружения на сервере и меняются инженером, а не администратором в продукте |
| FR-084 | реализовано | миграция 067 (kill switch, disabled by default) | `tests/platform-autonomous-reply.test.mjs`, `tests/platform-autonomous-replies-ui.test.mjs` |

## 13.9 Student Portal

| ID | Статус | Реализация | Доказательство |
| --- | --- | --- | --- |
| FR-085 | реализовано | `src/app/portal` | `tests/platform-portal.test.mjs`, `tests/e2e/student-portal.spec.ts` |
| FR-086 | реализовано | 9 отдельных маршрутов в `src/app/portal/` | `tests/e2e/platform-student-portal-polish.spec.ts` |
| FR-087 | реализовано | `src/lib/platform-portal.ts` | `tests/platform-portal.test.mjs` |
| FR-088 | реализовано | `src/lib/i18n-data.ts` (`LOCALES = ["ru", "ky", "en"]`) | `tests/role-contract.test.mjs` проверяет словари по всем локалям. Приоритет SHOULD |
| FR-089 | реализовано | `src/app/portal/profile` | `tests/e2e/student-portal.spec.ts` |
| FR-090 | частично | адаптивная вёрстка, `tests/e2e/platform-accessibility.spec.ts` | Автоматические проверки и скриншот-ledger на 1440/834/390 есть. Полный gate P7D открыт: нужен человек-проверяющий и утверждённая матрица устройств (issue #167) |

## 13.10 OP/OZO business workflows

| ID | Статус | Реализация | Доказательство |
| --- | --- | --- | --- |
| FR-091 | реализовано | миграция 051 | `tests/platform-bw4-workflow.test.mjs`, PR #100 |
| FR-092 | реализовано | миграция 051 | `tests/platform-bw4-workflow.test.mjs` |
| FR-093 | реализовано | миграция 052, `src/lib/platform-case-assignment.ts` | `tests/platform-contract-workflow.test.mjs`, PR #101 |
| FR-094 | реализовано | миграция 052 | `tests/platform-case-operations.test.mjs` |
| FR-095 | реализовано | миграция 052 | `tests/e2e/platform-operations.spec.ts` |
| FR-096 | реализовано | миграция 053 | `tests/platform-student-profile.test.mjs`, PR #102 |
| FR-097 | реализовано | миграция 053 (applied overlay version) | `tests/platform-student-profile.test.mjs` |
| FR-098 | реализовано | `src/lib/platform-student-profile-fields.ts` | `tests/platform-student-profile.test.mjs` |
| FR-099 | реализовано | миграция 046, `src/lib/secret-storage.ts` | `tests/secret-storage.test.mjs`, `tests/e2e/sensitive-permissions.spec.ts` |
| FR-100 | реализовано | миграция 053 | `tests/platform-student-profile.test.mjs` |
| FR-101 | реализовано | миграция 057, `src/lib/platform-contract-actions.ts` | `tests/platform-contract-workflow.test.mjs`, PR #114 |
| FR-102 | реализовано | миграция 057 | `tests/platform-contract-workflow.test.mjs` |
| FR-103 | реализовано | миграция 054, `src/lib/platform-bw4-workflow.ts` | `tests/platform-bw4-workflow.test.mjs`, PR #103 |
| FR-104 | реализовано | миграции 054, 065, 073 | `tests/platform-ai-memory.test.mjs`, `tests/platform-knowledge-bundle.test.mjs` |
| FR-105 | реализовано | `src/lib/platform-gemini-proposals.ts` | `tests/platform-gemini-proposal.test.mjs` |
| FR-106 | реализовано | миграция 056, `src/lib/platform-catalog.ts` | `tests/platform-catalog.test.mjs`, PR #113 |
| FR-107 | blocked | `src/lib/platform-catalog.ts` (fail-closed) | Источник Notion недоступен. Проверено, что пустой каталог не заполняется вымышленными записями: `tests/platform-catalog.test.mjs` |
| FR-108 | реализовано | архитектурная граница, `docs/platform/data-ownership.md` | `tests/platform-catalog.test.mjs`, аудит diff на PII |
| FR-109 | реализовано | отсутствие отдельного ledger, миграция 043 | `tests/platform-admissions.test.mjs` |
| FR-110 | реализовано | единый frontend `src/app/`, отсутствие demo-fallback | `tests/e2e/platform-operations.spec.ts`, `tests/runtime-hardening.test.mjs` |

## Что действительно не покрыто

Не считая отложенных владельцем P4B-пунктов, реальные пробелы такие:

1. **Заведение сотрудников (FR-006).** Аудируемые RPC есть, операторского пути
   нет. После успешного развёртывания работать сможет только тот единственный
   администратор, которого создаёт `bootstrap_organization_admin`. Это не
   отложенное требование, а незамеченный пробел: подробности и варианты закрытия
   в `docs/platform/staff-provisioning-gap.md`.
2. **Stop factor недостижим (FR-072, FR-073).** Таблицы, RPC и аудит есть;
   вызовов нет ни в интерфейсе, ни в серверном слое. Финансовая блокировка —
   заявленный механизм остановки работы по делу — сейчас не может быть ни
   поставлена, ни снята.
3. **Реальный антивирусный провайдер для документов (FR-061).** Проверка типа,
   размера и целостности есть; сканирования нет. Требование помечено MUST.
4. **Контракт отчётности (FR-017, FR-080).** Экраны существуют, но обязательные
   поля KPI — формула, источник, период, свежесть — не закреплены тестом.
5. **Запись звонка (FR-079).** Приоритет SHOULD, экран есть, контракта нет.
6. **Полный accessibility gate (FR-090).** Автоматика пройдена, ручная проверка
   человеком и утверждённая матрица устройств отсутствуют (issue #167).
7. **Импорт каталога университетов (FR-107).** Заблокирован недоступностью
   Notion. Поведение корректное: система отказывается выдумывать записи.

## Как проверялась сама матрица

После того как FR-006 оказался помечен неверно, матрица была перепроверена
систематически, а не выборочно. Ошибка FR-006 имела конкретную форму:
доказательством служила возможность базы данных, тогда как требование описывает
действие оператора, а пути оператора не существовало.

Проверка строилась так:

1. Построен граф импортов от всех точек входа `src/app/`, включая относительные
   и динамические импорты. Модуль, до которого нет пути, недостижим из продукта.
2. Каждый недостижимый модуль проверен отдельно: используется ли он сценарием,
   относится ли к отложенному блоку, либо не используется никем.
3. Для требований о действиях оператора дополнительно проверено наличие экрана и
   вызова из приложения, а не только наличие RPC и теста базы.
4. Отдельно проверено, каким **источником данных** питается каждый экран
   сотрудника: Platform, legacy-база или фикстура. Требование, чей путь ведёт в
   legacy, не считается закрытым Platform-реализацией.

Результат: из 89 модулей `platform-*` достижимы **84**. Оставшиеся пять
объяснимы: три обслуживают сценарий импорта знаний, два относятся к отложенному
P4B и помечены соответствующим статусом.

Первая проверка нашла два узких уточнения: FR-083 переведён в `частично`, у
FR-081 уточнена граница видимой поверхности.

Вторая проверка, по источнику данных экранов, нашла ещё четыре расхождения того
же класса, что FR-006. Stop factor имеет таблицы и RPC в миграции 043, но
**вызовов нет нигде** — ни в интерфейсе, ни в серверном слое, поэтому FR-072 и
FR-073 переведены в `не реализовано`. Задачи работают, но через legacy-путь к
SQLite, а не через `platform.case_tasks`, поэтому FR-075 и FR-076 переведены в
`частично`.

Из четырнадцати экранов сотрудника на Platform подключены шесть: `clients`,
`applications`, `sales`, `whatsapp`, `settings` и дело студента. Остальные
читают legacy-базу. Часть из них помечена в ТЗ как `Deferred from first thin
slice` и ждёт очереди законно; `visa` и `finance` — нет, и это отдельная
проблема: те же данные доступны и через Student 360 на Platform, и через
отдельный экран на legacy.

Ограничение метода: попытка искать RPC без вызовов даёт много ложных
срабатываний, потому что приложение обращается к версионированным именам вроде
`student_portal_notifications_v2`, а прежние версии остаются в схеме. Поэтому
вывод строится на достижимости модулей и проверке конкретных требований, а не на
списке несозванных функций.

## Связь с критериями приёмки

| Критерий | Состояние | Причина |
| --- | --- | --- |
| ACC-001 | закрывается этим документом | Все 110 требований сопоставлены с реализацией и доказательством |
| ACC-002 | частично | Локальные checksum/reset доказаны; remote-ledger и PITR — нет |
| ACC-003, ACC-004, ACC-005 | закрыты локально | Secret scan, ролевые и кросс-организационные тесты |
| ACC-006 | не закрыт | Нет реального WhatsApp-события |
| ACC-007, ACC-008 | deferred | P4B |
| ACC-009, ACC-010 | не закрыты | Нет реального вызова Gemini |
| ACC-011, ACC-012, ACC-013 | не закрыты | Нет ACK, таймаута и повтора от реального провайдера |
| ACC-014 – ACC-019 | закрыты локально | Workflow, документы, финансы, портал, скриншот-ledger |
| ACC-020 | частично | См. FR-090 |
| ACC-021 | не закрыт | Ожидает DEC-010 (числовой профиль нагрузки) |
| ACC-022 | не закрыт | Восстановление базы и Storage не проверялось |
| ACC-023 | частично | Runbook есть (`docs/runbooks/p7b-operations.md`), tabletop не проводился |
| ACC-024 | не закрыт | Реального пути для сверки ещё не было |
| ACC-025 | закрыт | Lead Agent, legacy webhook и rollback path сохранены |

Итог: **13 критериев из 25 закрыты локальным доказательством, 9 требуют
реального провайдера или эксплуатационного действия, 3 отложены решением
владельца.** Ни один из оставшихся девяти не требует написания новой
функциональности — они требуют учётных данных, решения владельца или
проведённого испытания.

## Правила поддержки документа

Документ обновляется вместе с ТЗ. При добавлении требования добавляется строка;
при merge блока обновляются ссылки на доказательство. Строка не переводится в
`реализовано` без ссылки на существующий файл теста или миграции.
