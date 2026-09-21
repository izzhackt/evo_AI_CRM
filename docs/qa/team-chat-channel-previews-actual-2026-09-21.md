# A237: локальный reader/DTO, actual и закрытие сессий

Статус: **APPROVED_SCOPED_ACTUAL_RPC_AND_STRICT_CLOSURE**. Первый блок
[плана A15](../EVO_TEAM_CHAT_CHANNEL_PREVIEWS_PLAN_2026-09-21.md), PR #1017,
source `bb24f35f6d44ed227021368acbc41f9c0f8e7278`. Это локальная проверка
существующего Auth/PostgREST-пути и строгого decoder. Rail UI ещё не подключён;
final integration/CI/review и merge оформляются отдельно. Production не менялся.

## Применение237

Один принятый baseline, затем один canonical local Supabase CLI apply: exit0,
2026-09-21T19:16:12Z. SQL237 SHA256
`c2a13596f4030ef8f640558a1877d0c5ae741f168da27b2f4058fbcb7d30b965`.
Независимое DDL reviewe133a066 подтвердило:

- Ledger001–236 →001–237, прежний префикс сохранён; одна новая запись237
  `platform_team_chat_channel_previews`, три сохранённых statements совпали с SQL.
- Из1191 функций изменилось только тело `platform.team_chat_channels(uuid)`;
  OID29807, owner, ACL, signature, STABLE/DEFINER и пустой search_path сохранены.
  Старый body `cf3566e5ccece6dd49a511d2bcc361c9431a11f4ccc1db0c662765dfe52d23af`,
  новый `dde262ea77896cc5ac6e0417624ea0376159ed8ea519d4802958d4eedb49af32`.
- Все290 business tables,33 Auth/Storage tables и effects при DDL неизменны.
  Новых таблиц, grants, индексов, accounts или fixtures не создавали.
- Reviewed driver записал новую config-ссылку только после verification:
  `a575fa043fb25f4a6c4f7f089f1835d72a309a51e4977efe7483a043c329ccd6`.
  Reviewer не читал содержимое config; полный независимый config-diff не заявлен.

## Ordinary Auth/PostgREST и decoder

Использованы два существующих QA-пользователя и четыре однократных RPC probes.
Каждая фаза завершилась exit0; повторов не было. Production decoder из exact
source получил сохранённый настоящий ответ. Ожидание получено отдельной
direct-table проекцией разрешённых каналов и latest/unread, а не самим RPC.
Reviewer также независимо сравнил raw Admin JSON с canonical projection.

| Путь | Фактический результат |
|---|---|
| Admin, своя организация | HTTP200; ровно3 разрешённых канала:2 с latest preview,1 пустой. Полное равенство состава/порядка, sparse unread, author/body/id/sequence/version и nullable projection. |
| Admin, nil-org mismatch | HTTP403, SQLSTATE42501. Это отрицательный случай неверной организации, не проверка заполненного другого tenant. |
| Student, своя организация | HTTP403, SQLSTATE42501. |
| Anonymous | HTTP401, SQLSTATE42501. |

Два latest принадлежат другому автору; один содержит non-ASCII. Текущие данные
не содержали latest вариантов own-author, reply, tombstone и long-body. Custom
staff, inactive/no-scope actors, заполненный foreign tenant не исполнялись.
Новые данные/права ради покрытия не создавались.16 pure protocol/order tests
из [source-квитанции](team-chat-channel-previews-source-2026-09-21.md) остаются
отдельным доказательством; они не заменяют эти отсутствующие runtime-варианты.
UI, native, реальные races/concurrency и весь пункт15 не проверены этим блоком.

## Сохранность и передача ресурса

Before, after-rpc и final сохранили все290 business tables, schema/catalog/ledger
и chat seen. Из33 Auth/Storage таблиц финальные отличия ограничены timestamps
входа/обновления двух существующих пользователей и четырьмя их login/logout
audit rows. Прежние8 users, stable identities, все старые audits, Student данные
и Storage сохранены. Все входящие224 sessions,239 refresh rows и224 AMR rows
точно восстановлены после закрытия двух собственных сессий.

Оба обычных local logout дали204. После hash-проверки удалены только два своих
private login-response captures. Свои browser/server не создавались. Closure
остаётся неизменной: `CLOSED_OWN_AUTH`, `released:false`, `nextOwner:null`.
После независимого review ROOT выпустил отдельный handoff с `released:true`,
`nextOwner:ROOT_COORDINATOR`; ресурс больше не принадлежит A. Closure и handoff
не подменяют друг друга. Повторные RPC/apply и UI-сессия здесь не выполняются.

## История остановки и восстановления среды

До принятого actual старая inert-v1 baseline-попытка остановилась один раз
с FileNotFoundError до SQL/DDL. ROOT подтвердил остановленную OrbStack-среду
после ENOSPC. По прямому разрешению пользователя ROOT восстановил Docker:
команда сообщила timeout/panic, но VM запустилась; повторного запуска не было.
Независимая полная сверка290/33 подтвердила сохранность данных при новой epoch
2026-09-21T18:57:07.001844169Z. Старые admissions отменены, baseline/apply/RPC
выше привязаны к новой epoch. STOP остаётся историей, не успешным baseline.

## Закреплённые локальные доказательства

Private packets содержат полный материал; ниже только безопасные ссылки/hashes.
Секреты, payload сообщений и Auth captures в репозиторий не копируются.

| Материал | SHA256 |
|---|---|
| Старый baseline STOP | `f2a5e19c4bac9fd43d275732c6d723b58a63c1e870aa69c9291d2f448313b5f5` |
| Recovery actual review | `4a532a54296fd20a967dd2793e6487619fc4f3714fbc6cd550ade68c08a1e3ec` |
| Recovered baseline | `65bec357f8826ea8d55d4f76e28778441da271bd6718bd7f78a32feec2f36afb` |
| Apply receipt | `9949a28a83a2010177616b00c75391fd10408cecd2db97a2da6a99e2715ed617` |
| After apply | `eee7a93f81d4db90115022e4c35b097f63ab45a2279b6b5047019786b130ac60` |
| Independent DDL review | `e133a066534e6fc41d5546c88aa247ed5004514c0e84a546fb861e84e9c7ef4f` |
| RPC before | `6607791db8b8bc582d6ea3f3e9f7e3fe372711962a13717d304584f7c575b1b0` |
| RPC after | `32da5b6fc525e8c05de033c737b1a5c7a877d41c1698a9287b2e3d29d92be4d8` |
| Strict final | `3610d43fd29e42fd03ff38ff4914503c75eda20fd5e78db4ec42f3a536e7a2fd` |
| Closure | `3d267de893e4b645786ca5d211b2c99065674060627a77e05047916a6bc8e842` |
| Actual summary, до review | `810546971c225c6bf828702011b5289be1172f210027a3aadacb93b5ce263d1b` |
| Independent RPC/closure review | `97acb1ae9b0c1d809195eae4304dba096d92f10d6e733e8a71525675cd633c0a` |
| ROOT resource handoff | `07d280839b27411449061a1af45c7bb6fcf04ec43c8fedcee0361372029675d0` |

DDL packet: `/private/tmp/evo-team-chat-channel-previews237-recovered-20260921`,
`baseline.json`, `apply-output/apply-receipt.json`, `apply-output/after-apply.json`.
RPC packet: `/private/tmp/evo-team-chat-channel-previews237-rpc-inert-20260921/proof`,
`before.json`, `after-rpc.json`, `final.json`, `closure-receipt.json`,
`actual-summary.json`, `handoff-ROOT_COORDINATOR.json`. Reviews:
`/private/tmp/evo-a237-recovered-apply-actual-review-20260921.md` и
`/private/tmp/evo-a237-rpc-actual-closure-review-20260921.md`.
