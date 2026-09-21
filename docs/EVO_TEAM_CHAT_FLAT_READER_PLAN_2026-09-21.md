# A15c — чтение общей хронологии командного чата

Текущий статус: **reader реализован; однократный local223 apply и реальный
Auth QA прошли**. Финальное ревью/CI PR#976 — отдельно; UI пока прежний.
[Результат и ограничения](qa/crm-team-chat-flat-reader-223-2026-09-21.md).

История precode:55109f62 одобрен независимым review, ROOT дал GO на код.
Отдельные reviewed-пакеты и окна для apply/QA затем предоставлены и закрыты.
Источник исходного анализа: main `6d01bc8106eeef5c5e397255418d5f584bfdfa0e` после PR#974,
21 сентября2026. Анализ выполнен по исходникам; БД/Auth/UI не использовались.
После анализа интегрирован main `925cf1996e0b2c08e968d513da149793f9c774be`
(PR#973); chat runtime и миграции между этими ревизиями идентичны.
Владелец A. ROOT эксклюзивно зарезервировал **223** после сверки main/PR.
Резерв номера не является разрешением применять миграцию.

## Зачем этот блок и где заканчивается результат

Принятый продуктовый план §9 требует включить старые ответы в одну хронологию,
сохранить их ID/авторов/даты/связи и открывать старые ссылки в контексте переписки.
§12 дополнительно требует нового учёта непрочитанного до снятия обсуждений.
Поэтому сначала добавляем самостоятельный reader общей ленты. Он возвращает
старые сообщения из тех же строк, без копирования и повторной отправки.

Это законченный контракт чтения через реальный authenticated RPC и строгий
TypeScript decoder. В этом блоке экран ещё использует прежний reader; новый
контракт станет основанием для следующего согласованного переключения UI.
Само появление RPC **не означает готовность общей ленты для пользователя**.

A15a убрал автоматические действия задач из сообщений (PR#970). A15b добавил
автовысоту поля (PR#974). Остаток пункта15 и зависимости сохранены в
[EVO_TEAM_CHAT_REMAINDER_ANALYSIS_2026-09-21.md](EVO_TEAM_CHAT_REMAINDER_ANALYSIS_2026-09-21.md).

## Пересверенные зависимости

| Источник | Текущий контракт | Следствие |
| --- | --- | --- |
| Migration141, team_chat_read_page | latest/before выбирают parent=NULL; thread читает ответы; message возвращает root+target | Изменять смысл существующих режимов нельзя: старый клиент фильтрует ответы и ожидает другую пагинацию |
| Migration141, team_chat_messages | sequence_id уникален; parent FK связан с organization/channel/id; tombstone остаётся строкой | Общая лента может читать все строки по прежнему sequence_id; переписывать историю не требуется |
| Migration156, team_chat_can_access | Действующие права team.chat.channel через staff_can_access_for_actor с organization scope | Новый reader использует этот актуальный guard; статическая модель ролей из141 не копируется |
| Migration171, team_chat_command | post принимает только корневой parent; lock request→channel; проверка текущего доступа; receipt сравнивает исходный payload | Новые способы ответа не добавляются в этот read-only блок; сохранённые retryInput/requestId сохраняют прежний смысл |
| Migration141, changes reader | Возвращает изменённые сообщения и связанные корни; watermark относится к журналу изменений, не к sequence сообщения | Reader отдаёт совместимый watermark; существующий changes RPC остаётся отдельным, без новой трактовки cursor |
| TeamChat.tsx | Корневая лента, отдельный aside, отдельные composer/draft keys | До отдельного UI-контракта этот клиент, URLs и sessionStorage остаются прежними |
| Migration171, read command | greatest(read_sequence, message.sequence) читает весь префикс | Reader никогда не вызывает read; автоматическое sparse seen требует отдельного согласованного блока |

## Предлагаемый API

Новая отдельная функция:

```sql
platform.team_chat_read_timeline(
  p_organization_id uuid,
  p_channel_key text,
  p_mode text default 'latest',
  p_cursor bigint default 0,
  p_message_id uuid default null
) returns jsonb
```

Режимы и вход строго ограничены. Сначала текущая channel authority, затем
валидация; ошибки используют существующие42501/22023/P0002 и mapper.

| Режим | Вход | Выборка |
| --- | --- | --- |
| latest | cursor0, messageId=null | Последние50 сообщений любого parent, включая tombstones |
| before | cursor>0, messageId=null | До50 сообщений со sequence<cursor; выбирать ближайшие к границе |
| after | cursor>0, messageId=null | До50 сообщений со sequence>cursor; выбирать ближайшие к границе |
| context | cursor0, messageId обязателен | Сам anchor, до25 сообщений раньше и до24 позже; максимум50 |

Sequence может иметь законные пропуски; непрерывность номеров не требуется.
Порядок возвращённых messages всегда sequence ASC; выборка before/latest
сначала ограничивается в DESC, затем нормализуется в ASC. OFFSET не используется.
Не дополнять короткий context выдуманными соседями и не считать квоту25/24
обязательным числом при начале/конце канала. Anchor может быть старым ответом
или tombstone. Несуществующий/чужой-channel anchor даёт not_found в разрешённом
канале, не переносит пользователя в другой канал и не раскрывает чужую цитату.

Ответ имеет отдельный DTO `TeamChatTimelinePage`:

- `messages`: прежний полный message DTO, максимум50, без root-only фильтра.
  id, sequence, authorMembershipId, createdAt, parentMessageId и version исходные.
- `quotes`: максимум50 уникальных проекций родителей возвращённых сообщений;
  только явно связанные ID из того же organization/channel. Каждая содержит
  id, sequence, authorMembershipId, authorName, version, deletedAt и bodyPreview.
  bodyPreview — первые240 Unicode-символов текущего текста; для tombstone пустая
  строка. Никакого сохранённого удалённого текста или транзитивного обхода веток.
- `beforeCursor` / `afterCursor`: min/max sequence выбранных messages как строки;
  обе"0" при пустой выборке. Эти значения никогда не являются read_sequence.
- `hasBefore` / `hasAfter`: наличие строк за соответствующими границами в том же
  snapshot и канале; false/false при пустой выборке. Пустая страница before/after
  не означает пустой канал; клиент не должен заменять ею уже загруженную историю.
- `watermark`: максимум cursor из прежнего team_chat_changes в том же snapshot;
  применим только к существующему mode=changes, не к history cursors.
- `latestMessageId`: реальный последний ID канала или null.
- `focusMessageId`: anchor только у context; иначе null.

quotes — отдельные данные для представления, не дубликаты строк истории и не
сообщения, просмотренные пользователем. При будущей интеграции использовать
нормализованный cache по ID/version: edit/delete оригинала, пришедший через
changes, обязан обновить и его цитаты. Нельзя хранить текст цитаты как вечный
снимок внутри каждого ответа. A15c не вводит новый quote target или запись.

Строгий decoder проверяет размеры, UUID, положительные decimal-bigint
sequence/version без Number-преобразования, timestamps, текущий channel,
уникальность UUID и возрастающий порядок только sequence, соответствие min/max cursors,
focus в context и допустимость quote IDs только среди parentMessageId этой
страницы. Все необходимые parent-проекции должны присутствовать; повреждённый
контракт возвращает unavailable вместо тихого исключения ответов/цитат.
Существующий decoder/readTeamChatPage остаётся прежним. Новые типы/decoder и
repository reader живут отдельно; общий рефакторинг валидаторов не нужен.

## SQL, права и совместимость

Функция STABLE SECURITY DEFINER, search_path='', все relations/helper names
полностью квалифицированы. Внутри только SELECT; каждый путь включая quote,
anchor, tail, watermark и existence probes ограничен organization+channel.
Использовать текущий team_chat_can_access с проверкой `IS NOT TRUE`, чтобы
NULL тоже запрещал доступ; дополнительно связывать repository
query с actor.organizationId и staffCanAccessChatChannel, включая существующее
ограничение staff preview. DB остаётся окончательным источником авторизации.

Создание функции и REVOKE от PUBLIC/anon/authenticated/service_role/
supabase_auth_admin, затем GRANT EXECUTE только authenticated — в одной транзакции.
Новых table grants/policies/private schema USAGE не требуется. Service-role
обход не становится способом продуктового чтения или доказательством доступа.

Добавить отдельный B-tree `team_chat_timeline_idx` на
`(organization_id, channel_key, sequence_id DESC)`
без parent/deleted predicate: существующий history index исключает ответы,
а unread index исключает tombstones. Старые индексы сохраняются для v1.
Ни строки сообщений, ни preferences, receipts, changes, audit не изменяются
миграцией. Старые функции/OID/grants/trigger definitions не заменяются.

Прежнее приложение продолжает работать после миграции. Откат приложения
оставляет неиспользуемый новый reader и индекс; data rollback/удаление истории
не требуется. Если new-reader deployment не состоялся, новый consumer должен
получить явную ошибку, а не fallback root-only историю. В A15c consumer UI
вообще не переключается.

Технические основания проверены по официальной документации21сентября:
[STABLE snapshot](https://www.postgresql.org/docs/current/xfunc-volatility.html)
обеспечивает единый snapshot SELECT внутри вызова; не разрешает reader вызывать
пишущие helper-функции.
[CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html)
требует учитывать SECURITY DEFINER/search_path и исходный PUBLIC EXECUTE.
[Порядок LIMIT](https://www.postgresql.org/docs/current/queries-limit.html)
обосновывает уникальный порядок по sequence; отсутствие OFFSET — наше решение
для существующей модели курсоров. Это API-основания, не benchmark или новый
проверенный номер версии живой БД.

## Владение файлами и границы реализации

После независимого precode review55109f62 и решения ROOT зарезервирован scope:

1. Одна новая миграция `223_platform_team_chat_flat_reader.sql`.
2. Новый `src/lib/platform-team-chat-timeline.ts`: DTO/query/decoder.
3. Новый `src/lib/server/platform-team-chat-timeline-repository.ts`: actual
   authenticated RPC с текущими guard/error semantics.
4. Scope-local decoder/query tests и подготовленный отдельный QA packet.
5. QA-ведомость; append-only изменения плана и журнала.

Не менять в этом блоке TeamChat.tsx, MessageRow, Composer, CSS, страницу,
существующие server actions/RPC, read accounting, notifications, task links,
private-realtime payload, parent semantics или sessionStorage. Не создавать
параллельных агентов/новую release authority. ROOT сохраняет review/merge,
номера миграций и координацию общей QA-среды.

## Проверка и необходимые следующие разрешения

До кода: independent precode review; ROOT выбирает номер миграции. До DDL:
отдельный проверенный packet с exact source/SQL hashes, явным local Docker pin,
текущим ledger и единственным writer. Это precode не разрешает apply или Auth.

Офлайн: проверить SQL AST и точечный diff, decoder boundary tests (bad channel,
UUID/cursors/order/duplicates/missing/deleted quote/anchor), scoped lint/types.
Тесты проверяют контракт и ошибки; не заменяют настоящий RPC и реальные права.

После отдельного разрешения проверить через существующие ordinary Auth аккаунты:
разрешённые каналы/пользовательские staff-права; запрет другого tenant/канала,
Student/anonymous; malformed queries; empty/tombstone cases; old root+reply IDs,
пагинацию >50 без потерь и повторов, context до/после старого ответа, сохранение
watermark и отсутствие изменений read/preferences/receipts/business state от
чтения. Подтвердить обратную совместимость старых reader/commands без новых
записей от этого reader.

На последней подтверждённой локальной проверке A15b глобальная история была0.
Это датированный факт, не обещание текущей populated среды. Для положительного
прогона ROOT должен отдельно принять конкретный пакет контролируемых QA-записей
через существующий настоящий post/edit/delete путь, с точным лимитом операций,
владением ID и ожидаемыми изменениями. Никаких новых identities/role grants,
прямого наполнения history SQL, моков, fabricated receipts или подмены реальной
истории. При отсутствии такого разрешения честно отмечать populated/pagination/
context незавершёнными; пустой ответ не доказывает полноту ленты.

Не запускать тяжёлые unrelated suites или общий пользовательский E2E-этап,
отложенный владельцем. В этом блоке нет UI-перерисовки; Impeccable Operate
фиксирует цель будущего экрана: одна понятная хронология, цитата возле ввода,
сохранённое место чтения и EVO-типографика. Новый визуальный мир не предлагается.

## До будущего включения общей ленты

Следующие решения обязательны, но здесь не реализуются:

- Sparse seen: сохранить прежний read_sequence как историческую нижнюю границу,
  отдельно отмечать действительно показанные IDs; search/quote/jump не покрывают
  пропущенные сообщения. Существующий read command не автоматизировать.
- Quote writes: отдельный прямой quote target при сохранении старого root-parent
  назначения для v1 rollback либо другая доказанная совместимая схема. Не
  разрешать nested parent молча: старый thread-reader их не увидит.
- Один composer: сохранить все старые scoped keys, включая edit и отдельные
  thread drafts. Явное восстановление выбранного черновика, без автоматического
  объединения/удаления/отправки; uncertain retryInput/requestId не преобразуются.
- Old URLs: message ID открывается через context без потери соседей; восстановить
  точку возврата. Поиск с сохранением запроса/позиции и live quote invalidation
  должны учитывать тот же нормализованный store.
- Только после этих контрактов/проверок переключить страницу на новую ленту и
  убрать aside/counters. Сохранить исходные данные и возможность app rollback.

A15c закрывает серверное чтение общей истории и контекста; пункт15 целиком
остаётся открытым до принятия следующих зависимых блоков.


## A15c: реализация и локальная проверка, 21сентября2026

Реализован только read-foundation из этого плана:223 + timeline DTO/decoder и
server repository. Runtime9c589938 проверен настоящими локальными Sales/Student
Auth-путями:19 страниц,17 отказов/невалидных запросов,58 обычных команд и replay
без добавочного эффекта. Сохранены56 явно обозначенных QA-сообщений; вся прежняя
история/данные, prefs/read_sequence и уведомления не изменены. Общая QA-среда
освобождена на001–223. Полный отчёт и ограничения:
[реальная проверка223](qa/crm-team-chat-flat-reader-223-2026-09-21.md).

PR#976 ещё проходит финальное exact-head ревью/CI. UI не переключён; sparse-seen,
quote-write/draft совместимость и остальные зависимости выше остаются открытыми.
Production apply/release не выполнялся. Второй Sales-аккаунт и другой tenant
недоступны для этой проверки; соответствующее покрытие не заявлено.
