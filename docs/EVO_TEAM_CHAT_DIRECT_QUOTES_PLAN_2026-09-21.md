# A15e: прямая цитата при сохранении старых ответов

21 сентября 2026. Precode от main `439a66def6c068970d9c7ffb5d52fe9833b3f335`
(A15d / PR#983). Это план отдельного backend-контракта; runtime и UI ещё не меняются.
Продолжает [общую ленту](EVO_TEAM_CHAT_FLAT_UI_PLAN_2026-09-21.md), раздел9
[функционального плана](EVO_CRM_UX_AND_ADMISSIONS_PLAN_2026-09-20.md).
ROOT32 сейчас владеет локальным DB/Auth/UI окном;226 зарезервирована B.
ROOT подтвердил резерв227 за A15e до реализации; применять его можно только
после actual226 release и отдельной передачи локального окна.

## Результат для сотрудника и границы блока

В будущей общей ленте сотрудник отвечает на конкретное сообщение, включая
ответ другого сотрудника. Цитата показывает именно выбранный оригинал.
Изменение оригинала обновляет выдержку; удаление оставляет ссылку на tombstone,
но не раскрывает прежний текст. Старые ответы и их IDs сохраняются.

Impeccable применяется к этой модели взаимодействия: адресат ответа должен
быть однозначным, рядом остаётся один редактор, цитата не создаёт ещё одну панель.
Визуальное подключение, плотность, шрифты, клавиатура, мобильный viewport и
восстановление черновиков проверяются отдельно в A15f/A15g по сохранённому EVO.
Этот backend PR не меняет компоненты, стили, drafts, поиск, уведомления или seen.

## Что установлено по коду

| Текущий контракт | Следствие |
|---|---|
| `171_platform_team_chat_remove_mute.sql` — последнее полное определение `team_chat_command`, с scoped permissions из156 | Основа post-пути —171, не ранний coarse-role вариант141 |
| Post171 разрешает `parentMessageId` только на root без собственного parent | Нельзя заменить parent на произвольный direct target: это сломает v1 thread/read |
| Receipt хранит точный input+channel и result; locks идут request→channel | V2 должен разделять разные quote IDs, даже если у них один root, и сохранять тот же порядок locks |
| Reader223 возвращает до50 сообщений, а `quotes` — ровно их distinct root parents | Нельзя подменить `quotes` на direct targets в прежнем DTO |
| Decoder223 сверяет `quotes` с `parentMessageId` и current message/version/body | Для direct quotes нужен отдельный V2 decoder, а не ослабление старого |
| Edit/delete171 меняют оригинал и публикуют только invalidation | Текст цитаты следует читать из оригинала, не хранить копию body |
| Старые sessionStorage drafts содержат frozen input/request ID | Не преобразовывать их в V2 и не отправлять через другой RPC |

Исходные точки: `supabase/migrations/141_platform_team_chat.sql`,
`171_platform_team_chat_remove_mute.sql`, `223_platform_team_chat_flat_reader.sql`,
`225_platform_team_chat_sparse_seen.sql`, `src/lib/platform-team-chat-timeline.ts`,
`src/lib/server/platform-team-chat-repository.ts` и `TeamChatComposer.tsx`.

## Аддитивное хранение: private direct-quote map

Одна новая таблица `platform_private.team_chat_quotes`:

- `organization_id`, `channel_key`, `message_id`, `quoted_message_id` — NOT NULL.
- PK `(organization_id, channel_key, message_id)` — одна прямая цитата на сообщение.
- Два составных FK на исходные `team_chat_messages(organization_id,channel_key,id)`:
  сообщение-ответ и его direct target. CHECK `message_id <> quoted_message_id`.
- RLS включён. REVOKE ALL от PUBLIC/anon/authenticated/service_role/supabase_auth_admin;
  прямого client read/write нет. Нет body, имени автора, timestamp-копии или metadata
  исходного текста в этой таблице.
- Tombstones сохраняют связи. Никакого backfill старых сообщений и переписывания
  `parent_message_id`, sequence, авторов, дат, versions, старых receipts или seen.

Эффективный `quoteMessageId` = direct map target, иначе существующий parent,
иначе null. У старых ответов это прежний root; у нового ответа на ответ — выбранный
ответ. Root-parent нового сообщения вычисляет сервер: `target.parent_message_id`
или `target.id`. Если target имеет parent, сервер дополнительно проверяет, что этот
parent действительно root в той же организации/канале. Arbitrary nesting не вводится.

V1 reader продолжает показывать прежнее root-обсуждение, включая новые ответы.
Точность direct quote — возможность V2; при UI rollback map остаётся сохранённой,
но старый UI отображает свой прежний root-контекст. Не обещать визуальную
эквивалентность двух разных форматов.

## Новый post RPC: старую command не заменять

`platform.team_chat_post_v2(p_organization_id UUID, p_channel_key TEXT,
p_request_id UUID, p_input JSONB) RETURNS JSONB`.

Input — объект ровно с `body`, `quoteMessageId`, `mentionedMembershipIds`.
`quoteMessageId` обязателен и равен UUID или JSON null. Parent/root, actor,
organization, schemaVersion и operation не принимаются внутри пользовательского
input. Body/mentions сохраняют ограничения171; preview и текущие custom-staff
права не обходятся. Ошибочный batch/target не создаёт message или receipt.

1. Получить actor обычным `current_actor_authority`, явно проверить membership,
   совпадение organization и `team_chat_can_access(...) IS NOT TRUE` как отказ.
   Проверить request ID, shape input и известный channel.
2. Взять прежние advisory locks request→channel с теми же ключами, что171.
   После ожидания повторно проверить actual permission.
3. Проверить **существующую** `platform_private.team_chat_receipts` для actor/request.
   Canonical V2 identity — исходный точный input плюс server-owned
   `schemaVersion:2`, `operation:'post'`, `channelKey`. Не приводить его к V1 input
   с одним root: две разные цитаты того же root должны давать conflict.
4. Совпавший canonical input возвращает сохранённый V2 result без новых effects;
   любое расхождение, включая V1/V2 collision, вызывает40001. Старые V1 receipts
   не переписываются. Прежняя command171 при V1 обращении к V2 request также
   увидит несовпадение input и откажет; frozen V1 request идёт только в V1.
5. Для новой операции проверить body/mentions по актуальной171 и direct target
   в том же org/channel. Target может быть tombstone: это разрешённая безопасная
   ссылка с пустым preview, в том числе если его удалили после выбора в UI.
6. Атомарно вставить одно message с вычисленным root-parent; при quote — одну
   строку private map. Затем те же change/audit effects post171, invalidation-only
   Realtime и одна receipt с полным V2 result. Никакого seen/read продвижения.

RPC содержит только post-путь с сохранёнными проверками171. Edit/delete/moderate
остаются в прежней command; direct target после создания неизменяем, как прежний
parent. Не рефакторить общий writer и не добавлять скрытый обход старой receipt
семантики. Небольшое повторение post-проверок допускается ради неизменности V1;
контрактные проверки должны фиксировать их parity.

Ack — ровно:

```
{ schemaVersion:2, requestId, channelKey, operation:'post', messageId,
  version, quoteMessageId, rootParentMessageId }
```

Version — положительная int64-совместимая строка. UUID/канал/request/quote должны
соответствовать вызову, messageId отличаться от target. При null quote root также
null; при quote root — UUID. Receipt не содержит текста цитаты: её актуальное
состояние читается отдельно, поэтому replay остаётся детерминированным после
edit/delete target. HTTP200 с malformed/partial ack не считается успехом.

Новый RPC — SECURITY DEFINER, пустой search_path, explicit authenticated execute
и REVOKE остальным ролям в той же миграционной транзакции. V1 command171 и её
grants/body,223,225 и старые table definitions остаются неизменными.

## Отдельный timeline V2

`platform.team_chat_read_timeline_v2` принимает те же параметры и четыре режима,
что223: latest/before/after/context. Сначала scope/permission check, затем вызов
неизменённого223. Read-only wrapper сохраняет его messages/order/bounds/cursors/
watermark/anchor и добавляет `schemaVersion:2`, а каждому message — обязательный
nullable `quoteMessageId` по private-map-or-parent правилу.

В новом V2 `quotes` содержат ровно distinct effective quote IDs **этой страницы**:
до50. Только same-org/channel targets, текущая версия/автор/sequence/deletedAt,
текущий preview до240 Unicode code points; у удалённого оригинала пустая строка.
Нет arbitrary quote lookup RPC, рекурсивного обхода цитат или history-wide scan.
Root-parent остаётся отдельным `parentMessageId` внутри message.

Wrapper — STABLE, SECURITY DEFINER, пустой search_path и authenticated-only execute.
Messages, direct map и quotes используют snapshot вызывающего SQL statement.
Не использовать IMMUTABLE для чтения изменяемой истории. Удалённый или изменённый
оригинал вне текущей страницы всё равно попадает в bounded current projection,
если на него ссылается сообщение страницы.

Новый чистый TypeScript V2 decoder сохраняет правила223: max50, strict ordering,
positive int64 versions/sequences, exact page boundaries/anchor, same channel,
unique message/quote IDs, полный quote set без extras/пропусков. Взаимная проверка
in-page originals теперь использует `quoteMessageId`, не root-parent. Unicode
preview и tombstone правила прежние. Старый decoder223 не менять и не ослаблять.

Repository/server actions используют обычную SSR Auth, actor organization,
channel permission и запрет staff preview. Их пока не вызывать из UI. Новый post
с явно frozen V2 input/request ID никогда не деградирует в V1 fallback при ошибке.
Позже A15f выберет V1 или V2 по реальному сохранённому draft contract.

## Доказательство перед merge и будущим включением UI

Сначала focused pure validator/ack/page tests, scoped lint/typecheck и protected
migration checks. Проверить Unicode, строгие nullable поля, подмену root/quote,
неполный/чужой quote set, context bounds и V1/V2 response rejection. Не подменять
реальный RPC fake-клиентом ради приёмки. Старые функциональные поля не удалять.

Далее после actual226 release, свежей baseline, отдельного reviewed packet и
передачи локального окна — один apply выделенной миграции. Все старые таблицы,
functions/ACL/ledger/seen/root27/B226 сохраняются; новые объекты только private map
и два RPC. Число таблиц брать из будущего живого реестра: не закреплять старое282
как будущую baseline после226.

Предложение ограниченной local QA, не выполненные действия:

- Existing ordinary Sales как автор и Admin как reader после положительной
  actual authority; Student/anon/forbidden channel как negative controls.
  Не использовать invalid salesOther и не создавать/сбрасывать identities/роли.
- Четыре явно маркированных новых QA сообщения: V2 root без quote, V1 reply на
  него, V2 quote этого V1 reply, V2 quote предыдущего V2 reply. Для новых V2 ответов
  root остаётся первым сообщением, direct target — конкретным выбранным ответом.
  Две map rows; старые сообщения не редактируются и не переносятся.
- Один concurrent identical V2 post request даёт один message/effect; точный retry
  после изменения target возвращает тот же ack. Изменённый direct target того же
  root под тем же request ID — conflict без записи. V1/V2 request collision —
  conflict, старый frozen V1 replay — прежний результат без новой записи.
- Edit и delete выполняются только над новым QA V1 reply, созданным этим пакетом.
  V2 quote projection показывает свежий текст, затем tombstone без старого текста,
  включая after-страницу с cursor на target: ответ виден, сам target исключён.
  Context с прежним root вне страницы проверяется на сохранённом A15c reply55
  без изменения его оригинала. Никаких правок A15c оригиналов.
- Всего не более6 эффективных message commands:4 posts,1 edit,1 delete. Ноль
  provider/customer actions. Exact intents сохраняются до вызова; при неизвестном
  результате сначала reconciliation, не новый request ID и не полный повтор.
- Отсутствующий/чужой channel target, malformed/null input, actor-injection,
  invalid request/body/mentions отклоняются до эффектов. Cross-tenant runtime
  coverage только при существующем другом tenant, иначе явно ограничена.
- Реальные V1 page/thread/223 decoder остаются рабочими; V2 latest/before/after/
  context декодируются настоящим новым decoder. Reader/search не меняют seen/floor.
  Прямой RLS доступ закрыт; actual custom-staff scope проверен отдельно от Admin.
- После QA все исходные rows и их metadata сохраняются. Допускаются только заранее
  перечисленные новые messages/map/changes/audit/receipts и edit/delete собственных
  новых QA IDs; старые receipts/preferences/seen не меняются. Полный snapshot/SQL,
  source/ledger/hashes и честные ограничения передать следующему владельцу окна.

Если нужны дополнительные positive effects для конкретной ветки поведения,
включить их в bounded packet до выполнения. Не объявлять V2 UI, native или весь
пункт15 готовыми по backend/API проверке. Миграция на production и публикация
приложения не входят в A15e.

## Владение и последовательность

A владеет новым quote SQL, pure types/decoders, server repository/actions и
focused tests, этим планом и append-only launch/PLAN_CHANGES. Существующие UI,
171/223/225, B requirements и ROOT32 KB не редактируются.

1. Независимый precode review и принятие этого bounded контракта.
2. Подтверждённая ROOT резервация227; один isolated implementation worktree.
3. Offline реализация, focused проверки и independent exact-head source review.
4. После226 — actual local apply/API packet, execution, receipt и освобождение окна.
5. Final docs review/CI/merge; только затем A15f UI cutover с Impeccable и реальным
   browser journey на desktop/mobile. Native acceptance остаётся отдельным фактом.

## Первичные основания

- PostgreSQL17 [function volatility](https://www.postgresql.org/docs/17/xfunc-volatility.html):
  STABLE использует snapshot начала вызывающего query; это основание для общей
  временной точки page/map/quotes в V2 reader. Writer остаётся VOLATILE.
- PostgreSQL17 [CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html):
  SECURITY DEFINER требует безопасного search_path и явных execute grants.
  Новые RPC создаются и лишние privileges отзываются в одной транзакции.
- PostgreSQL17 [advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS):
  transaction-level locks освобождаются при завершении транзакции. Новый writer
  использует существующий request→channel порядок для совместной сериализации
  с171; сами locks не заменяют permission/receipt validation.

Сопоставление этих правил с конкретным кодом EVO — архитектурный вывод этого
плана; документация PostgreSQL не доказывает runtime-поведение ещё не написанного RPC.
