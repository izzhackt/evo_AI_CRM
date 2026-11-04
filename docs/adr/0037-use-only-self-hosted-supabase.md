# 0037 — Единственная база EVO: self-hosted Supabase, облачного пути нет

- Статус: принято 2026-11-04. Решение владельца: 2026-11-02 не возвращаться на
  облако, 2026-11-04 отменена подписка Supabase Pro.
- Владелец решения: владелец продукта EVO.
- Заменяет: [ADR 0024](0024-use-managed-supabase-for-the-evo-production-successor.md)
  «Use managed Supabase for the EVO production successor» целиком в части того,
  что рабочая база — управляемый облачный проект. [ADR 0034](0034-run-production-on-self-hosted-supabase.md)
  уже перенёс рабочую базу на self-hosted; этот ADR убирает облачный путь из
  кода, CI и документов. Пункты 2 и 3 решения ADR 0034 (переменная выбора цели,
  облачный проект как источник отката) этим ADR отменены.
- Сохраняет: всё остальное из ADR 0024 и 0034: один Supabase-фундамент
  (Postgres, Auth, приватный Storage, RLS, нужные Realtime и очереди), корневой
  `supabase/` как единственный источник миграций, Supabase Auth как единственный
  вход сотрудников, replace-not-layer, ADR 0027 и ADR 0032.

## Контекст

С 2026-10-20 00:47 UTC рабочая CRM работает на self-hosted Supabase
(`https://supabase.evoadmissions.com`). Облачная ветка в коде осталась только
как временное сосуществование для отката (issue #1271, правило «replace, do not
layer» из `AGENTS.md`). Окно отката закрыто: в self-hosted накопились новые
данные, обратного переноса нет, подписка Pro на облако отменена.

## Решение

1. **Одна база.** Рабочая база — только `https://supabase.evoadmissions.com`.
   Выпуск, ledger миграций, контракт env, операторские скрипты, приложение и
   Content-Security-Policy edge принимают ровно этот адрес. Недоступный
   self-hosted Supabase останавливает выпуск; перехода на облако или на другую
   базу нет.
2. **Нет выбора цели.** Переменные GitHub `EVO_SUPABASE_TARGET` и
   `EVO_SUPABASE_PROJECT_REF` и секрет `SUPABASE_ACCESS_TOKEN` код и workflow не
   читают. Идентичность базы в манифесте образа и контроллере — постоянное слово
   `selfhosted` (поле `supabaseProjectRef` сохранено, значение одно).
3. **Облачные инструменты удалены.** Экспорт и проверка восстановления
   управляемого проекта (`export-v3-managed-supabase-backup.mjs`,
   `managed-supabase-readonly-lease.mjs`,
   `test-v3-managed-supabase-recovery-orbstack.mjs`, их тесты и вспомогательные
   скрипты) и одноразовые скрипты окна переключения (`deploy/selfhosted-cutover/`)
   убраны из репозитория; они остаются в истории Git. Runbook
   [selfhosted-cutover.md](../runbooks/selfhosted-cutover.md) сохранён как история.
4. **Облачный проект.** Агенты его не трогают; удалить его вправе только
   владелец.
5. **Резервные копии.** Этот ADR их не вводит и не предлагает: решение владельца
   от 20.10 («скажет сам, когда делать») не менялось.

## Последствия

- Старые ключи и адрес облачного проекта операторскими скриптами больше не
  принимаются (`credential_invalid`, `project_mismatch`); ключ с claim `ref` к
  self-hosted не отправляется.
- Сборки iPhone и письма Auth со старым облачным адресом перестают работать после
  удаления облачного проекта владельцем; новые сборки используют адрес
  self-hosted (`ios/Release.xcconfig.example`).
- Исторические записи (ADR, `docs/PLAN_CHANGES.md`, датированные квитанции и
  runbook переключения) облачный проект упоминают как факт прошлого и не
  переписываются.
- Первый выпуск после изменения — проверка нового workflow: идентичность
  `selfhosted` берётся константой, переменные репозитория для неё не нужны.

## Источники

- Issue #1271; ADR 0024, 0027, 0032, 0034.
- `docs/runbooks/selfhosted-cutover.md` (история), `docs/runbooks/infrastructure-map.md`.
