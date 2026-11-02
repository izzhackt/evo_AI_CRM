# EVO Platform

Один продукт EVO Admissions: сотрудники ведут продажи, поступление, студентов,
документы и задачи в одном месте. Репозиторий публичный: в нём нет данных
клиентов, телефонов, ключей и паролей.

Что входит в платформу:

- **CRM для сотрудников** — `crm.evoadmissions.com`;
- **кабинет студента** — `app.evoadmissions.com` (то же приложение);
- **iPhone-приложение студента** — папка `ios/`;
- **ИИ-агенты Claude** — готовят черновики ответов, сотрудник проверяет сам.

Стек: Next.js 16, собственный (self-hosted) Supabase, Docker на одном VPS.

Публичный сайт — отдельный репозиторий
[evoadmissions-website](https://github.com/izzhackt/evoadmissions-website).
Общий приватный контекст — [izzhackt/EVO](https://github.com/izzhackt/EVO).

## Карта папок

| Папка | Что внутри |
| --- | --- |
| `src/` | код приложения: страницы, серверная логика, компоненты |
| `supabase/` | миграции базы данных и SQL-тесты |
| `ios/` | приложение студента для iPhone (SwiftUI) |
| `tests/` | автотесты приложения |
| `scripts/` | служебные скрипты: выпуск, проверки, локальный запуск, импорт |
| `deploy/` | как приложение живёт на сервере: Docker, выпуск, `deploy/edge/` — публичный прокси |
| `docs/` | вся документация, см. [`docs/README.md`](docs/README.md) |
| `config/` | настройки инструментов (проверки зависимостей, Playwright) |
| `public/` | статические файлы сайта (бренд) |
| `assets/` | шрифты и шаблоны, нужные приложению при работе |
| `drizzle/` | замороженная история старой схемы БД (V2); не менять, нужна тестам |

## Запуск на своём компьютере

Нужны: Node.js 22 (версия в `.nvmrc`), npm, Supabase CLI. На macOS контейнеры
запускаем только через OrbStack (Docker context `orbstack`, см. `AGENTS.md`).

```bash
nvm use
npm ci
npm run dev
```

Нужны настоящие локальные ключи Supabase в игнорируемых `.env*` файлах, шаблон —
`.env.example`. Без URL, ключей и организации приложение останавливается
сознательно: заглушек и подмены данных нет.

Проверки выбираются по изменению: `npm run lint`, `npm run typecheck`,
`npm run test:unit`; для интерфейса — `npm run test:e2e`.

## Как идёт работа

1. Задача — GitHub Issue.
2. Короткая ветка от свежего `main`, один смысл на ветку.
3. Pull request, независимая проверка, squash-слияние в `main`.
4. Сообщения коммитов — Conventional Commits (`feat(crm): ...`, `fix: ...`, `docs: ...`).
5. Выпуск на сервер — только из `main`, после 21:00 по Бишкеку или в воскресенье
   (пока работает телефония). Порядок — в [`deploy/production-release.md`](deploy/production-release.md).

`main` на GitHub — единственная точка правды; сервер — только среда запуска.

## Где лежат правила

| Файл | О чём |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | правила для людей и агентов: границы, безопасность, WhatsApp |
| [`CLAUDE.md`](CLAUDE.md) | инструкции для Claude Code |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | как вносить изменения и открывать PR |
| [`CONTEXT.md`](CONTEXT.md) | словарь терминов и текущие решения |
| [`PRODUCT.md`](PRODUCT.md) | для кого продукт и каким он должен быть |
| [`DESIGN.md`](DESIGN.md) | дизайн-контракт интерфейса |
| [`SECURITY.md`](SECURITY.md) | как сообщить об уязвимости |

План работ: [`docs/EVO_LAUNCH_PLAN.md`](docs/EVO_LAUNCH_PLAN.md), журнал решений
(только дописывается): [`docs/PLAN_CHANGES.md`](docs/PLAN_CHANGES.md).
Архитектурные решения: [`docs/adr/`](docs/adr/).
Старые lead-agent и EVO Inbox удалены 2026-11-02; их код сохранён в git-теге
`archive/lead-agent-and-inbox-2026-11-02`.
