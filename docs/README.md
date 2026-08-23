# Документация EVO Admissions Platform

Эта страница — входная точка в знания о компании и платформе. Она помогает
найти один актуальный ответ, не искать его по случайным локальным файлам и не
создавать вторую копию уже существующего документа.

## Если вы впервые в проекте

Читайте в таком порядке:

1. [Onboarding участника команды](team/onboarding.md)
2. [Текущее архитектурное решение](adr/0020-unify-evo-v1-on-canonical-supabase.md)
3. [Обзор систем](platform/system-overview.md)
4. [Кто владеет какими данными](platform/data-ownership.md)
5. [Текущий проверенный статус](platform/current-status.md)
6. [Crosswalk draft PR и исторических issues](platform/u0-draft-pr-issue-crosswalk.md)
7. [Безопасность Transcription Lab](platform/transcription-security.md)
8. [Профиль EVO Admissions](business/evo-company-profile.md)
9. [Бизнес-контекст EVO Admissions](business/evo-business-context.md)
10. [Процесс поступления](business/admissions-process.md)
11. [Руководство по продажам](business/sales-playbook.md)

Для показа коллегам или партнёрам используйте
[материалы презентации](../presentations/README.md) и
[demo script](../presentations/demo-script.md).

## Карта разделов

### Платформа и данные

- [Текущее архитектурное решение](adr/0020-unify-evo-v1-on-canonical-supabase.md)
  — один внутренний продукт, canonical Supabase и U0-U14.
- [Обзор систем](platform/system-overview.md) — простая схема внутренних
  модулей EVO Platform и внешних adapters.
- [Владельцы данных](platform/data-ownership.md) — где менять лид, заявку,
  сообщение, документ, секрет или задачу.
- [Текущий статус](platform/current-status.md) — что подтверждено сейчас, что
  ещё не завершено и что нельзя обещать.
- [U0 crosswalk](platform/u0-draft-pr-issue-crosswalk.md) — судьба каждого
  открытого draft PR и каждого исторического issue, открытого до #376.
- [Безопасность Transcription Lab](platform/transcription-security.md) —
  серверные ограничения, хранение, удаление и production-флаги.
- [Архитектурные решения](adr/) — почему EVO является одним продуктом на
  canonical Supabase, а amoCRM и WAHA остаются adapters и AI — advisory.

### Компания и юридические материалы

- [Каталог материалов компании](company/README.md)
- [Список и правила хранения исходных документов](company/source-documents.md)
- [EVO Admissions logobook](company/brand/evo-admissions-logobook.pdf)

Банковские и регистрационные документы хранятся в закрытой игнорируемой папке
`docs/company/private-source-documents/`. На отдельные файлы здесь намеренно
нет ссылок: доступ к ним должен выдаваться только тем, кому он нужен по работе.

### Бизнес и поступление

- [Индекс бизнес-знаний](business/README.md)
- [Профиль компании](business/evo-company-profile.md)
- [Полный бизнес-контекст](business/evo-business-context.md) — клиенты, услуги,
  коммерческая модель, путь поступления, роли, системы, AI и KPI.
- [Процесс поступления](business/admissions-process.md)
- [Руководство по продажам](business/sales-playbook.md)
- [Upload pack базы знаний](business/knowledge-base/README.md) — два очищенных
  текста по Китаю и Малайзии и инструкция по загрузке в EVO Inbox.
- [Исследование бренда и продукта](EVO_BRAND_RESEARCH.md) — исследовательская
  база; проверяйте статус факта перед внешним использованием.

### Команда и выполнение работы

- [Onboarding](team/onboarding.md)
- [Как используются GitHub Issues](agents/issue-tracker.md)
- [Triage labels](agents/triage-labels.md)
- [Словарь доменных терминов](../CONTEXT.md)
- [Launch plan](EVO_LAUNCH_PLAN.md) и [история изменений плана](PLAN_CHANGES.md)

### Unified frontend

- [Индекс EVO Platform frontend](design/evo-platform/README.md)
- [План реализации](design/evo-platform/IMPLEMENTATION_PLAN.md)
- [Checklist готовности](design/evo-platform/COMPLETION_CHECKLIST.md)
- [Финальный frontend-аудит](design/evo-platform/FINAL_FRONTEND_AUDIT_2026-07-24.md)
- [Master prompt для Claude Design](design/evo-platform/CLAUDE_DESIGN_MASTER_PROMPT.md)

### EVO Inbox

- [Product requirements](EVO_INBOX_COMPANION_PRD.md)
- [Implementation issues](EVO_INBOX_IMPLEMENTATION_ISSUES.md)
- [README приложения](../agent-lead2-inbox/README.md)
- [Хранилище данных Supabase](../agent-lead2-inbox/docs/supabase-managed-store.md)

### Проверки и отчёты

- [QA launch report](QA_LAUNCH_REPORT.md)
- [Scenario evaluation](SCENARIO_EVALUATION.md)
- [Promise audit](PROMISE_AUDIT.md)
- [Архив завершённых планов и handoff-документов](archive/README.md)

Отчёт фиксирует результат на момент проверки, но не заменяет текущий статус.
Если отчёт и [current-status.md](platform/current-status.md) расходятся, сначала
проверьте дату и источник, затем обновите документ-владелец.

## Что является общей точкой правды

Единая актуальная матрица находится в документе
[«Кто владеет данными»](platform/data-ownership.md). Не копируйте её в другой
handbook: поставьте ссылку. Slack сейчас не используется как хранилище знаний,
а локальная папка одного сотрудника не является общей точкой правды.

## Как поддерживать документ актуальным

В начале важного документа указывайте:

```text
Owner: роль или конкретный ответственный
Status: Draft (черновик) | Active (действующий) |
        Verified snapshot (проверенный снимок) | Archived (архив)
Last verified: YYYY-MM-DD
Sources: файлы, сервисы или команды проверки
```

- Меняйте факт в одном документе-владельце; в других местах ставьте ссылку.
- Не публикуйте догадки как подтверждённый факт.
- Для внешнего обещания указывайте источник и дату проверки.
- Исторический план после завершения помечайте `Archived`; не используйте его
  как текущий список задач.
- Документ без владельца должен получить владельца до того, как команда начнёт
  считать его обязательной инструкцией.
