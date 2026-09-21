# A15d: sparse seen — реализация, пока без локального apply

21 сентября2026. Runtime `fb12146e5fdd3470c061ac7c321ddeadb7cc7e53`, база main67934327d.
[Принятый precode](../EVO_TEAM_CHAT_FLAT_UI_PLAN_2026-09-21.md), PR#981.
225 выделена ROOT;224 принадлежит B. Это offline evidence, не приёмка SQL/Auth.

## Что реализовано

- Приватная RLS-таблица `platform_private.team_chat_seen` с составными FK
  и уникальным organization/channel/membership/message. Прямые grants закрыты.
- `team_chat_mark_seen(p_organization_id,p_channel_key,p_message_ids)` принимает
 1–50 разных UUID, actor берёт из текущей Auth authority. Весь batch проверяется
  до вставки; использует тот же channel lock, что существующий command.
- Ответ `{channelKey,messageIds}` подтверждает всё валидное множество. Повтор
  и пересечение batch идемпотентны. Собственные, удалённые или покрытые старым
  read_sequence IDs — допустимые no-op; неизвестные/чужие отклоняют batch целиком.
- `team_chat_channels` сохраняет прежний DTO/custom-staff guard; оба unread
  условия исключают seen того же actor. Прежняя историческая граница не меняется.
- Новые validator/ack decoder, repository и server action строго проверяют
  batch/полное подтверждение и запрещают staff preview. UI их ещё не вызывает.
- Старые команды, receipts, сообщения, read_sequence, parent links, черновики,
  UI, timeline223 и уведомления не изменены кодом этого блока.

## Реально выполненные offline checks

- Node22.23.1: `--conditions=react-server --experimental-strip-types --test
  tests/team-chat-seen.test.mjs` —7 passed,0 failed. Это чистые wire-contract
  примеры, не fake-Supabase/Auth или доказательство SQL-idempotency.
- Scoped ESLint: три новых TypeScript файла и новый test —PASS.
- Next typegen + TypeScript `--noEmit` —PASS; финальная incremental typecheck
  после уточнения строгих ключей —PASS.
- pglast:9 SQL statements и2 PL/pgSQL definitions синтаксически разобраны.
  Это parser check, не установка/исполнение миграции.
- Статическое сравнение `team_chat_channels` с141+replacement156 подтверждает,
  что body изменён только двумя одинаковыми sparse exclusions.
- `git diff --check` —PASS; product UI files не затронуты.

## Чего это не доказывает

225 не применялась; shared Auth/DB/browser window занят ROOT. Права, реальные
ошибки/ack, конкурентные batch, планы SQL и динамика unread ещё не проверены
на настоящей базе.225 не следует ставить перед224. Нужны review кода, отдельно
reviewed local packet и эксклюзивное GO после освобождения общего стенда.

Для unread нужен существующий разрешённый наблюдатель, отличный от Sales-автора
сохранённых сообщений, с положительным ordinary login/actor/access snapshot.
Он пока не подтверждён для этого блока. Не повторять неработающий salesOther,
не создавать/сбрасывать staff identity и не заменять это JWT-подменой.
Legacy-floor positive QA требует текущего подходящего состояния или заранее
разрешённой точной старой read-команды; не сбрасывать маркеры для удобства теста.

Будущий apply receipt должен сохранить все исходные281 таблицы, старую схему/
grants/функции за исключением согласованного channels body и migration ledger.
Допустимые новые объекты — seen table с её PK/FK/RLS и mark_seen function.
Положительные QA-записи в seen/старую read preference отдельно перечисляются
в packet; runtime-история сообщений и чужие данные сохраняются. Production
apply/release, UI-cutover и завершение всего пункта15 не заявляются.

## Неизменяемые runtime-файлы

| Файл | SHA256 |
|---|---|
| `supabase/migrations/225_platform_team_chat_sparse_seen.sql` | `2ccb57a6c26b7004c23f7cf4683ba5d13fa39a4d0c9e0c3c64a86520731d8e32` |
| `src/lib/platform-team-chat-seen.ts` | `14213f5d526658f80986aaec1bbe14c5214d3fde26ff6f661676d15225db16c6` |
| `src/lib/platform-team-chat-seen-actions.ts` | `f43900524da393dd8d045031ccf4a29db491dcf0af0c15b45a6a8ce1fc393bae` |
| `src/lib/server/platform-team-chat-seen-repository.ts` | `ec00dcc276f71fa8fbe51e5005e45b5c7d076090d323864c2103279d43159dfb` |
| `tests/team-chat-seen.test.mjs` | `4350e11d235bf239b0bfe699865c22ac34ef8256e16cf618a8212755516ac168` |
