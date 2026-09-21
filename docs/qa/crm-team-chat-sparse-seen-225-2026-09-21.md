# A15d: sparse seen — реализация и фактическая local QA

21 сентября 2026. Runtime `fb12146e5fdd3470c061ac7c321ddeadb7cc7e53`;
фактически проверенный integration head `3fc9ef3435882cb431fbe291e9582474f59666cc`.
Принятый [precode](../EVO_TEAM_CHAT_FLAT_UI_PLAN_2026-09-21.md) — PR#981.
PR#982/main `2b23285d5127b2e8d633c733bf102c25b093baa6` включён до применения225;
SQL224 совпадает с действительно применённым B source `1fa3ef0e…`.
Все пять A runtime hashes сохранены. CI35555819344 полностью прошёл на3fc9ef34.

## Что реализовано

- Приватная RLS-таблица `platform_private.team_chat_seen`: уникальный набор
  organization/channel/membership/message и два составных FK. Прямые grants закрыты.
- RPC `team_chat_mark_seen(p_organization_id,p_channel_key,p_message_ids)` принимает
  1–50 разных UUID и берёт actor из текущей Auth authority. Весь batch проверяется
  до вставки под существующим channel lock; ошибка отклоняет весь batch.
- Полный acknowledgement `{channelKey,messageIds}`. Повтор/перестановка/subset/
  пересечение идемпотентны. Собственные, удалённые и покрытые прежней read_sequence
  сообщения — допустимые no-op; неизвестные и чужие IDs отклоняются.
- Прежний DTO/custom-staff guard `team_chat_channels` сохранён. Одинаковые sparse
  exclusions добавлены к unread count и first unread; историческая граница остаётся.
- Новый validator/ack decoder, repository и server action сохраняют ordinary
  Auth/channel permission и запрещают staff preview. UI пока их не вызывает.
- Сообщения, parent links, черновики, старые commands, timeline223, уведомления и
  компоненты UI кодом этого блока не изменены.

## Применение225 — один фактический запуск

После B224 release и передачи исключительного окна A снята свежая READ ONLY
baseline:281 business tables, ledger001–224, Auth users/identities8/8. Она целиком
совпала с B final state, включая сохранённые данные ROOT27c. Independent review
одобрил apply driver, затем окончательный source/manifest binding; ROOT дал GO.

Штатный pinned local migration CLI применил только225 один раз. Проверены:

- все281 старые таблицы и прежние metadata/ACL/ledger rows сохранены;
- одна новая private RLS seen table,4 столбца и PK index с4 catalog columns,
  3 constraints и8 внутренних FK triggers, включая referenced tables;
- новая функция с authenticated-only execute, точное reviewed body и атрибуты;
- у прежнего channels меняется только reviewed body, прежние metadata/ACL те же;
- ledger содержит точные parsed SQL statements; seen пуста после apply;
- local config обновлён на225 только после успешной проверки.

Apply receipt: `/private/tmp/evo-a225-apply-20260921/apply-receipt.json`, SHA256
`3b89416d3ddcfeb90d384f978bedb7647f3fa1a3d501750282535e091f9a0214`.

## Ordinary Auth и точные результаты QA

Существующие Admin, Sales и Student вошли обычным способом. Actual Auth user,
profile/membership/org, staff snapshot и разрешённые channels положительно
сверены. Admin оказался допустимым other-author reader; Sales совпал с автором
56 сохранённых сообщений LOCAL A15c QA (55 general и1 sales). Новые identities,
смена ролей/паролей, service-role обход и недоступный salesOther не использовались.

- 15 настоящих negative RPC дали ожидаемые HTTP/SQLSTATE: anon, Student,
  запрещённый Sales канал, NULL/unknown канал, invalid/NULL/empty/duplicate/nested/
  oversized batch, invalid/missing UUID, mixed missing/cross-channel IDs.
- Собственные Sales1/3 и удалённое Admin3 — два успешных no-op без изменений.
- Одна legacy read-команда для позиции1 и точный replay с тем же request ID/input:
  ровно одна preference и одна receipt; replay ничего не добавил.
- Mark_seen позиции1, уже покрытой floor, — no-op. Позиции2/55 дали ровно две seen.
  Повтор, обратный порядок и subset ничего не добавили;2/4 добавил только4.
- Два одновременных HTTP batch4/5 и5/6 добавили только5/6, без дубля5.
- Итоговые seen: **ровно5** IDs на позициях2/4/5/6/55, только Admin/general.
  Unread54→53→51→50→48; first unread последовательно2/4/5/7. Пропуски остаются
  непрочитанными. Старый floor остаётся на sequence позиции1.
- Sales и другой канал не меняются; search/thread/context не создают read state.
- Все10 actual acknowledgements прошли production TypeScript decoder.
- READ ONLY EXPLAIN ANALYZE выполнен для count и first unread на настоящих
  сохранённых55 сообщениях. Это маленькая QA история, не production benchmark.

### Сохранённая остановка harness и ограниченное продолжение

Первый запуск остановился после15 negatives и2 no-op, до `exact-intent.json` и
до legacy command. Отсутствующая preference вернула SQL NULL, который psql вывел
пустой строкой; Python JSON decoder закономерно отказал. Реальная READ ONLY
сверка подтвердила ноль business writes и полное равенство282 state после stop.

Отдельный, независимо одобренный continuation исправил только nullable SELECT
через `COALESCE(...,'null'::jsonb)`, закрепил31 исходный файл по hashes и заново
проверил actual actors/state.15 negatives и2 no-op **не повторялись**: их реальные
результаты использованы как неизменные доказательства. Новый запуск выполнил
только ещё не начатую legacy read/replay и8 оставшихся mark_seen calls. Перед
первой записью request ID/input сохранены. Total10 acks —2 прежних +8 новых.
Первичный failure не удалён и не переименован в успех; reapply/cleanup не было.

## Итоговая сверка и передача ROOT32

Полный282 snapshot после continuation совпал с QA receipt. По сравнению с
postapply меняются только seen0→5, preference0→1 и command receipts58→59.
Остальные279 business hashes, все прежние preferences/receipts, root27/B224
данные и весь catalog послеapply неизменны. Ledger001–225, Auth users/identities8/8.
Sessions после обычных входов не объявляются неизменными.

A освободил окно для ROOT32. В этом API-only блоке собственные server/browser
не запускались; процесс QA завершён. Дальше A работает только с docs/PR.
Приватный каталог `/private/tmp/evo-a225-local-qa-continuation-20260921`:

| Артефакт | SHA256 |
|---|---|
| `qa-receipt.json` | `601fe96766b2e92010abed6e8562680226a48fe2e2d5ddfb3b23b290c7a9ee3e` |
| `release-receipt.json` | `2d7c943dfc475edb903f70f30652bf6bf6916b1242651d7c817dcbb9105d6fad` |
| `final-qa-snapshot.json` | `7f64e5d0179b4240ec54458cb1941082200bdda2a58d28d1161bf2644526a38b` |
| `snapshot.sql` | `19076b9133de18a400aa1a42ae3440a353a10cc6dc26c138e8728a2bd339917e` |

Release содержит полный `after_state` и точный `snapshot_sql`, а не только counts.
[История подготовки и review](crm-team-chat-sparse-seen-225-packet-2026-09-21.md)
сохраняет отдельные hashes драйверов и manifests.

## Ранее выполненные checks и пределы доказательства

При неизменном runtimefb12146e переиспользованы7/7 pure wire-contract tests,
scoped ESLint, Next typegen/TypeScript, pglast9 statements/2 function definitions
и static141+156 comparison. Это не выдаётся за новые тестовые прогоны. После
интеграции224 собственный CI35555819344 прошёл на3fc9ef34; финальный docs head
проходит отдельные protected checks и exact-head review.

Другой tenant в локальной базе отсутствует; cross-tenant runtime acceptance
не заявляется. UI/server-action journey ещё не подключён и не проверен этим
API-only блоком. Нет production apply/release, provider/customer acceptance
или завершения всего пункта15. После merge A15d следующий блок — A15e quote
model по принятому precode; новый UI остаётся A15f/A15g.

## Неизменяемые runtime-файлы

| Файл | SHA256 |
|---|---|
| `supabase/migrations/225_platform_team_chat_sparse_seen.sql` | `2ccb57a6c26b7004c23f7cf4683ba5d13fa39a4d0c9e0c3c64a86520731d8e32` |
| `src/lib/platform-team-chat-seen.ts` | `14213f5d526658f80986aaec1bbe14c5214d3fde26ff6f661676d15225db16c6` |
| `src/lib/platform-team-chat-seen-actions.ts` | `f43900524da393dd8d045031ccf4a29db491dcf0af0c15b45a6a8ce1fc393bae` |
| `src/lib/server/platform-team-chat-seen-repository.ts` | `ec00dcc276f71fa8fbe51e5005e45b5c7d076090d323864c2103279d43159dfb` |
| `tests/team-chat-seen.test.mjs` | `4350e11d235bf239b0bfe699865c22ac34ef8256e16cf618a8212755516ac168` |
