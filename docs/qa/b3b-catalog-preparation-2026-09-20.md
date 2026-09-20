# B3b / 214 — исходники и локальная приёмка

До кода принят контракт `e337a135` поверх main `1e03c6be`.
Подробный scope и API: [контракт B3b](../platform/b3b-catalog-preparation-contract.md).
Исходники проверены на `934660995e5e3f8c199129d03259137f00fa81b2`.
Миграция214 применена только в согласованной локальной базе. Первоначальные11
чтений/отказов выполнены на001–214; затем положительный выбор, readback и повторы
подтверждены обычным Auth на001–215 после отдельного исправления handoff.
Фактические ответы разобраны существующими TS/Swift моделями. Полный UI-путь
веб/iPhone этим не проверен.

## Выполнено

- Node 22: `next typegen`, `tsc --noEmit`, ESLint для трёх новых TS модулей,
  application contract и wording прошли. Зависимости свежего worktree установлены
  через `npm ci --ignore-scripts`.
- SQL parser: 24 statements, 8 PL/pgSQL functions, 2 SQL function bodies прошли
  на финальном файле; это не разрешение имён, RLS или выполнение PostgreSQL.
  Использован уже установленный parser из `/private/tmp/evo-intake-sql-parser-211`.
- Swift: все Services + AppConfig прошли typecheck для iOS Simulator arm64 с
  существующим Supabase `40344fb3` / 2.55.2, соответствующим Package.resolved.
  Осталось прежнее предупреждение `SessionRouter.swift:90` о
  `.mfaChallengeVerified`; оно не менялось и не скрыто.
- Xcode project содержит ровно четыре новые строки включения модели;
  `plutil -lint` прошёл. Генератор сначала потребовал отсутствующий Local.xcconfig;
  для генерации создан только игнорируемый комментарий без runtime-настроек.
  Посторонние изменения GUID ресурсов не включены. Приложение не устанавливалось.
- `git diff --check` прошёл. Сохранены прежние UI, auth, приложения и файлы;
  только словарь application дополняется существующим уровнем «Диплом».

SQL SHA-256:
`e5c1bd56f522917114b89b780593f7637378e138b4ea74ca1921fbbbd434b879`.

Swift model SHA-256:
`f6c79f8bd2ec2c1a75ccdcc45514784421beca227b635ba4a7cfd6d3824a065b`.

Swift service SHA-256:
`0a467deb4255f998e6e76069af33d4c364932bbd5dca271e195e115c084c363a`.

При проверке исходников исправлена проекция неопределённого срока: исходная дата
сохраняется в публикации, но `university_deadline_on` остаётся NULL, пока срок
не подтверждён. Иначе прежний отчёт считал бы спорную дату фактическим дедлайном.

## Выполненная локальная проверка — 2026-09-20 UTC

Два независимых source review одобрили точный `93466099`. A как единственный
исполнитель применил этот SQL в `evo-local-0fd3559d0240c989` после проверенной
коррекции неопубликованной локальной 213. Порядок 212 → 213 → 214 соблюдён;
схема после применения — 001–214. До применения 214 исходники были заморожены.

Квитанция `local214-receipt.json` от `20:22:18Z` подтверждает DDL PASS,
неизменность ledger 001–213 и бизнес-данных, пустую новую таблицу bindings.
Первоначальный preflight скрипта A остановился до копирования SQL и DDL из-за
разбора PostgreSQL boolean; после исправления только скрипта и подтверждения
отсутствия применения 214 выполнено одно фактическое применение. SQL не менялся.

Один запуск через существующие обычные Student 1, Student 2, Admin и анонимный
клиент завершился **11/11 PASS** (`b214-local-read-denial-result.json`,
`20:23:04Z`):

- Три чтения возвращают пустой список: Student 1 и Student 2 читают каждый своё
  pending-дело, Admin читает то же дело через staff reader.
- Чтение или выбор в чужом деле, Student-вызовы staff API, чтение или выбор без
  входа отклонены с `42501` — шесть проверок.
- Выбор набора в своём pending-деле Student и staff-выбор Admin отклонены с
  `PT409` / `catalog_preparation_case_ineligible` — две проверки.

A отдельно сравнил состояние до DDL и после этого запуска
(`b214-after-denial-parity.json`, `20:23:45Z`): counts/hashes всех 12 проверяемых
существующих бизнес-таблиц, включая `university_application_events`, неизменны;
число Auth users не изменилось; bindings остаётся 0; ledger 001–213 неизменён.
Ни заявка, ни событие, ни audit receipt запрещёнными командами не добавлены.
Все квитанции хранятся локально вне Git в приватном QA-каталоге; credentials
и личные данные в этот документ не включены. Это реальные RPC-проверки без
service-role подмены пользователя, но не положительный сценарий поступления.

## Положительный сценарий на001–215 — 20 сентября UTC / 21 сентября локально

После разрешения владельца выполнен точный frozen QA packet: существующее
Student дело и staff accounts, назначение существующего Sales владельцем lead,
девять согласованных полей локальной QA продажи. Новые identities, роли и дела
не создавались.213 sale save/replay/conflict/stale прошли; соседние поля сохранены.

Первый обычный208 handoff вернул HTTP500 / `40001 portal_identity_conflict`.
A подтвердил полный rollback20 таблиц и связанных scopes/access versions.
Оказалось,208 синхронизирует seller pending-дела, а guard126 запрещает это.
Ошибка и исходные command/request/started receipts сохранены без перезаписи.

Исправление вынесено в [PR #960](https://github.com/izzhackt/evo_AI_CRM/pull/960),
миграцию215. Два независимых review одобрили `0e0f87db0493855f5ad4a208204531872391c5cd`;
A применил SQL SHA256 `8b6a97eb416f11fb177014bd1d0786a3e3c23f4f34f6b481a4139acbce518d66`
только локально. Ledger001–214 и20 существующих бизнес-таблиц неизменны, новый
private receipt table пуст; ACL/RLS/deferred FK проверены. Runtime214 не менялся.

Повтор буквально той же команды208 с прежним request ID прошёл. То же дело
стало active, создана одна продажа и квитанция handoff; seller соответствует
владельцу lead, месяц — дате продажи. Scope1→2, три затронутых profile получили
access_version+1. A отдельно подтвердил ожидаемые эффекты и неизменность
прочих строк. Это изолированная QA продажа, не реальная клиентская операция.

Затем обычным Student Auth выполнен выбор уже опубликованного набора:

- Созданы ровно одна application со status `preparation` / version1, одна
  immutable binding, одно application event и один audit выбора.
- Student и назначенный Admissions читают одну и ту же подготовку. Реальные
  ответы прошли существующий TS decoder и exact product Swift DTO harness;
  совпали intent/receipt, application, program/intake и полная pinned publication.
- Exact replay вернул исходный receipt, всё состояние базы неизменно.
- Тот же выбор с другим заранее согласованным request ID вернул прежнюю
  application/binding/version. Добавился только audit новой команды.
- Изменённая publicationVersion при прежнем request ID отклонена22023
  `catalog_preparation_request_conflict`; Student2 не получил чужое дело42501.
  После отказов полное состояние неизменно.

A сравнивал21 таблицу, target/other rows, functions, ledger и число Auth users
между каждым шагом. До и после handoff выполнены6+5 ограниченных SQL guard
probes с rollback; финальное состояние точно совпало с состоянием после denials.
SQL probes не выдаются за Auth acceptance. Swift проверял actual RPC JSON,
а не установленный native UI. Node сообщил прежний MODULE_TYPELESS warning
при импорте TS; настройки package.json ради harness не менялись.

Приватные create-only receipts: `b215-retry-*-result.json`,
`a-b215-handoff-parity-result.json`, `a-b215-selection-parity-result.json`,
`a-b215-replay-parity-result.json`, `a-b215-duplicate-parity-result.json`,
`a-b215-denials-parity-result.json`, `a-b215-final-parity-result.json` и
`b214-actual-swift-decode-result.json`. Credentials и личных данных в Git нет.

## Что остаётся непроверенным

До отдельного разрешения QA packet существующие дела были pending; этот
прежний блокер снят описанным обычным handoff, без ручной смены состояния.
Конкурентность, изменение срока во время повтора, действия со связанной
терминальной заявкой и non-NULL previous-seller вариант215 остаются непроверенными.
Прежний211 UI-прогон не подменяет положительный UI-путь214.

Требования/Фото/Загранпаспорт, работа с файлами и пакетами, полный путь веб/iPhone,
managed rollout и production release этим срезом не объявляются завершёнными.
