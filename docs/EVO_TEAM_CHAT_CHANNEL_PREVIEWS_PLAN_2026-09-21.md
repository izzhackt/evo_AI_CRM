# A15: последние сообщения всех доступных каналов — предложение до кода

Текущий статус, 2026-09-22: первый reader/DTO блок #1017 смержен в
`c675d4b4d735ccbcc51dc162265e31d64e193990` после final-head reviewf36fec39
и CI35645855198 (6 SUCCESS/2 SKIP) наab45c3a6. Узкая локальная SQL/Auth/RPC
проверка относится к неизменному sourcebb24f35f; [actual-квитанция](qa/team-chat-channel-previews-actual-2026-09-21.md)
сохраняет её пределы. [Второй rail UI блок](EVO_TEAM_CHAT_CHANNEL_RAIL_PLAN_2026-09-21.md)
реализован в #1020, его [ограниченная actual-проверка](qa/team-chat-channel-rail-actual-2026-09-22.md)
и закрытие ресурсов независимо приняты (2de97c08). QA передана B1018 по решению
ROOT; после интеграции main e8fc98dc final-head177e8dc2 прошёл review5ae91c79
и CI35665853126. #1020 смержен ROOT вeec9c548; прежние STOP и пределы actual
сохранены в квитанции.
Это не production-доставка и не завершение всего item15.

## Исходное принятие precode и база анализа

Исходный статус: independent precode APPROVED, 2026-09-21. ROOT разрешил первый
SOURCE-only блок reader/strict DTO и зарезервировал миграцию237. Исходный
precode SHA256: `1ee575811b3ed7a9531609bf637f366b9ee165a8de9acdf03605abd18e06d3d8`;
review receipt: `7a844584673f10a135e6016160e0a1a867319391a16027b9bb06a53a065a573e`.
Это разрешение на source/tests/draft PR, не на apply, Auth, DB, browser, сервер
или actual acceptance. ROOT сохраняет shared QA; migration236 принадлежит ему.
Второй rail UI блок начинается только после принятия и merge первого.

Источник: свежий `origin/main` = `24e78024cec2d8c9689ed67e73e20376815ee30e`
после merge #1014. Анализ выполнен в чистом замороженном worktree
`/Users/iskhak.tazhibaev/.codex/worktrees/evo-team-chat-service-row/evo_AI_CRM`,
HEAD `5f46d6ac9c1fd6ea09a2df5f13c61b0a8842859d`. Сверка HEAD с этим main
не нашла изменений в team-chat UI, типах/reader/source и migrations.

## Задача и границы

Сотрудник должен видеть последнее сообщение каждого разрешённого канала до
перехода в него. До этого блока краткий текст был доступен только у выбранного канала,
причём зависит от наличия последней строки в загруженном диапазоне истории.
У других каналов исходный DTO вообще не содержал такого текста. Это оставшийся пункт
A15g из `EVO_TEAM_CHAT_FLAT_UI_PLAN_2026-09-21.md`, а не повтор #1012/#1014.

Impeccable применяется как refinement в существующем Operate-контексте:
сохранить EVO, Golos, rail, названия/порядок каналов, их цвета, выбранное
состояние, ширины и нынешнюю однострочную типографику preview. Новый дизайн,
шрифт, поиск по всем каналам и новые каналы не нужны. Время каждого сообщения
уже сохранено в #1014; дополнительное время в rail не входит в этот узкий блок.

## Исходный анализ до реализации reader/DTO

| Источник | Факт и следствие |
|---|---|
| `src/lib/platform-team-chat.ts:15` | `TeamChatChannel` содержит key, muted, preferenceVersion, readSequence, unreadCount, firstUnreadId; preview отсутствует. |
| `src/components/v3/team-chat/TeamChat.tsx:364` | Выбранный preview берётся из latestMessageId/store; для остальных строк он вообще не рендерится. Первая строка поиска или текущего диапазона не является последним сообщением канала. |
| `src/lib/v3/team-chat-source.ts:10` и `:18` | Начальная лента и обычный read/search уже вызывают один `readTeamChatChannels`, затем фильтруют каналы через staffCanAccessChatChannel. Не нужны три отдельных клиентских запроса. |
| `src/lib/server/platform-team-chat-repository.ts:51` | Reader вызывает существующий `platform.team_chat_channels`; ошибки RPC и неверный DTO превращаются в typed read failure. |
| `supabase/migrations/225_platform_team_chat_sparse_seen.sql:74` | Последняя версия channels RPC: STABLE SECURITY DEFINER, пустой search_path, current actor/tenant/Student guard, фильтрация каждого канала, sparse-seen исключения для обоих unread полей. |
| `supabase/migrations/156_platform_scoped_staff_consumers.sql:484` | Доступ определяется `team.chat.<key>` на organization scope, включая custom staff. Нельзя возвращаться к старым предположениям только по coarse role. |
| `supabase/migrations/141_platform_team_chat.sql:103` | Автор сообщения разрешается через membership той же организации и profile. Это исторический автор; его не надо скрывать только потому, что он больше не активный участник. |
| `supabase/migrations/141_platform_team_chat.sql:317` | Удаление сохраняет строку/sequence, увеличивает version и обнуляет body. Превью должно показывать tombstone, а не незаметно подставлять предыдущее живое сообщение. |
| `supabase/migrations/223_platform_team_chat_flat_reader.sql:5` | Есть индекс `(organization_id, channel_key, sequence_id DESC)`; новый индекс для latest не обоснован. |
| `src/components/v3/team-chat/TeamChat.tsx:128` и `:203` | Все channels metadata уже обновляются при refresh. Выбранный канал имеет invalidation subscription; видимая вкладка вызывает refresh каждые 30 секунд, при возврате visibility и online. Мгновенная доставка для остальных каналов сейчас не обещана. |
| `src/components/v3/team-chat/TeamChat.tsx:316` | Search и background refresh могут завершаться в разном порядке и оба устанавливают channels. Без защиты новый текст/удаление можно откатить поздним старым ответом. |
| `src/components/v3/team-chat/TeamChat.tsx:100` | Терминальный forbidden очищает channels/store; поздний ответ не должен восстанавливать их. |
| `src/components/v3/team-chat/team-chat.module.css:111` | На телефоне rail и conversation — разные панели. Нынешняя ошибка внутри conversation не видна на панели каналов; для нового read-содержимого это надо учесть. |

## Предлагаемый контракт данных

Добавить обязательное поле `latestPreview` в каждый разрешённый channel:

```ts
type TeamChatChannelPreview = Readonly<{
  id: string;
  sequence: string;
  version: string;
  authorMembershipId: string;
  authorName: string;
  bodyPreview: string;
  deletedAt: string | null;
}>;
// TeamChatChannel.latestPreview: TeamChatChannelPreview | null
```

`null` означает подтверждённое отсутствие сообщений. Пропущенное поле,
невалидная форма или ошибка RPC означают unavailable, не пустой канал.
UUID, положительные BIGINT cursor strings и nullable timestamp проверяются
существующими правилами. Не переводить sequence/version в JS Number.
Текст ограничивается 240 Unicode code points на сервере и проверяется через
Array.from на клиентской границе: это уже принятая длина существующих цитат,
а не передача 8000 символов ради CSS ellipsis. Автор остаётся текущей разрешённой
profile display_name без выдуманного имени или новых пользовательских данных.
Удалённый preview обязан иметь пустой bodyPreview; живой — непустой.
В preview нет mentions, linked tasks, replyCount, raw body, email или credentials.

Список каналов: максимум три известных уникальных ключа; существующие поля
валидируются как раньше. Preview имеет ровно перечисленные поля. Декодер
возвращает typed unavailable для нарушений; отсутствующие поля не заполняются
успешной заглушкой. Отдельная RPC/schemaVersion не нужна для одного additive
поля: старый reader игнорирует добавленное поле, новый требует применённую SQL.

## SQL и права

Будущая отдельная согласованная миграция изменяет только тело существующего
`platform.team_chat_channels`. Сигнатура, grants, STABLE, SECURITY DEFINER,
пустой search_path и actor guard сохраняются. Никаких direct table grants.

В одном RPC/SQL statement для каждого разрешённого канала берётся одна строка
с наибольшим sequence_id, включая reply и deleted строку. Использовать уже
имеющийся индекс и ограниченный LATERAL/subquery LIMIT 1. Не вызывать тяжёлый
message_json с подсчётом replies ради этих семи полей. Author join ограничен
organization_id и author_membership_id как в нынешнем message_json.
`bodyPreview` — LEFT(body, 240), для tombstone явно пустая строка.
Нулевой результат поиска сообщения даёт JSON null.

Оба unread подзапроса из225 сохраняются буквально по смыслу, включая sparse
seen, own-message/deleted исключения, исторический readSequence и порядок
firstUnreadId. Превью не вызывает acknowledge/seen/read command, ничего не
пишет и не раскрывает каналы вне актуального staff permission/tenant scope.
Student/anonymous/cross-tenant/inactive и custom-staff ограничения проверяются
на обычном авторизованном RPC. Service-role обход не является доказательством.

Сначала SQL, затем код, требующий новое поле. Старый код совместим с новым
ответом. Rollback приложения может оставить additive SQL; откат SQL при уже
новом приложении дал бы честный unavailable, поэтому не считается безопасным
порядком выкладки. Production apply/deploy не входит в разрешение на этот план.

## Обновление и видимое поведение

1. Использовать `latestPreview` как единый источник строки rail для всех
   каналов, включая выбранный. Context/search/before страницы не заменяют его
   своей первой/последней загруженной строкой. Feed tail refs и hydrate protocol
   остаются отдельно и не упрощаются ради UI.
2. Показать `Вы: …` для собственного сообщения либо `authorName: …` для
   чужого; tombstone — «Сообщение удалено». Подтверждённый null — «Пока нет
   сообщений». Plain text внутри нынешнего Link, без HTML/вложенных ссылок.
   Существующие ellipsis, accessible link name, unread badge, aria-current и
   клавиатурный переход сохраняются; preview не получает data-chat-body и не
   становится источником отметки «прочитано».
3. Сохранить текущие triggers/30s refresh; дополнительных подписок и таймеров
   не вводить. Для остальных каналов заявлять обновление при refresh, а не
   мгновенный push. После send/edit/delete используется существующий afterSave.
4. Учесть реальную гонку search/background: маленький pure merge для preview
   выбирает больший sequence, а для той же строки — большую version. При
   равных sequence/version принимать свежеполученный author projection.
   Входящий список разрешённых каналов определяет результат; не возвращать
   отсутствующие в нём каналы из cache. Состояние только in-memory, очищается
   при forbidden/unmount, никакого хранения в localStorage.
   Дополнительно общий монотонный request ticket для channels metadata охватывает
   search и background: после принятия более нового ticket старый ответ не меняет
   ни channel set, ни preview. Иначе старый разрешённый snapshot мог бы вернуть
   уже исчезнувший канал. Это узкая защита принятия channels; не менять нынешние
   foreground/background владельцы ошибок, feed cursors и семантику search.
   Ticket сбрасывается только вместе с новым component/actor/channel instance.
5. Для позднего null после уже подтверждённого сообщения сохранять известный
   preview: текущие продуктовые операции не удаляют строки физически и latest
   не может снова стать пустым. Это свойство явно ограничено нынешним soft-delete
   контрактом. Исторические hard purge/внешний rewrite — не предусмотренная
   операция; новая загрузка страницы начинает с актуального снимка.
   При одинаковом sequence и другом id, либо том же id и другом sequence,
   нужен typed unavailable без принятия противоречивого preview, а не выбор
   удобной версии. Merger должен возвращать результат/ошибку до setState;
   существующий request owner получает ошибку без изменения watermark.
6. Для мобильной панели каналов показать компактную ошибку обновления и
   существующий retry при background failure; при terminal forbidden —
   закрытый доступ и вход. Переиспользовать существующий read-error owner,
   pending и retry attempt. На desktop остаётся текущая ошибка conversation;
   не создавать одновременно две доступные alert-поверхности. Старые данные
   при transient failure сохраняются с видимой ошибкой, не изображают empty.

## Ограниченный порядок поставки

Рекомендуются два последовательных блока одной функции, чтобы UI не зависел
от непроверенного DB-контракта:

1. **Reader/DTO:** после принятия precode ROOT назначает свободную миграцию;
   новый isolated worktree от текущего main. До кода добавить launch/PLAN_CHANGES
   и короткий repo plan. Реализовать только SQL, тип, pure decoder/merge и
   подключение decoder в repository, целевые тесты. Independent exact-head
   review/short CI. Принятое отдельное QA-окно для реального RPC/apply и
   наблюдения фактических эффектов; затем review и merge.
2. **Rail:** только после первого merge — TeamChat.tsx и минимальный CSS для
   мобильной ошибки. Перед изменением UI перечитать Impeccable craft-floor и
   действующий context, не начинать новый design/critique цикл. Source review,
   один заранее связанный desktop/mobile actual batch, scoped correction только
   при дефекте, затем независимое review/CI/merge.

Предполагаемые файлы: новая миграция с ещё не назначенным номером;
`src/lib/platform-team-chat.ts`; новый `src/lib/team-chat-channel-previews.ts`
(decoder/merge, без server-only для meaningful protocol tests);
`src/lib/server/platform-team-chat-repository.ts`; целевые node/SQL tests;
во втором блоке `TeamChat.tsx`, `team-chat.module.css`; launch/PLAN_CHANGES,
план и доказательства. MessageRow, Composer, feed store, seen, quote protocols,
roles, AppShell и остальные CRM страницы не меняются без выявленной зависимости.

## Что должно доказать выполнение

- Node protocol tests: null vs missing; malformed/extra preview fields;
  duplicate/unknown channels; BIGINT precision; emoji/code-point boundary240;
  tombstone body пуст; неправильный UUID/timestamp; последовательность и version;
  поздний старый search после нового/deleted preview не восстанавливает текст;
  удалённый из входного списка канал не воскресает, включая поздний старый
  snapshot с меньшим request ticket; противоречивая identity
  отклоняется; pending/forbidden ownership не ослабляется.
- Точная SQL-проверка обычным Auth: permitted channel previews совпадают с
  реальным latest sequence и автором; reply/deleted/empty варианты при наличии;
  все read/unread/preferences/seen данные до и после эквивалентны. Проверить
  разрешённые custom staff и доступность только их каналов, Student/anon,
  cross-tenant и inactive/no-scope отрицательные варианты. Не менять production
  роли или чужие данные ради проверки. Недоступный вариант записать как gap.
- Нынешний разрешённый QA-набор не доказывает положительные сообщения во всех
  остальных каналах. Future evidence bind обязан сначала определить доступные
  строки и права; никакие новые фиктивные сообщения/actors автоматически не
  разрешены. Если позитивного материала нет, ROOT должен решить ограниченный
  test scope; нельзя назвать mocked test настоящей проверкой канала.
- UI в1440/390/320: корректные превью и badges, выбранный/остальные каналы,
  запретные каналы отсутствуют, длинный текст не ломает ширину, keyboard focus
  и переход работают; при доступных данных own/foreign/deleted/empty. Search,
  context и возврат не превращают preview в найденный старый текст, не сбивают
  draft/anchor. Одна scoped проверка обновления по существующему refresh.
  На мобильной панели канала ошибка/retry/forbidden различимы.
- Preview сам не помечает чужие сообщения прочитанными. Открытие conversation
  может законно вызвать нынешний seen hook: точные допустимые IDs и эффекты
  связать заранее, не заявлять zero-write для всей UI-сессии по привычке.
- Fresh source/actor/runtime binding, before/after/final и закрытие своих
  Auth/browser/server ресурсов — только после передачи QA от ROOT. Исторический
  packet #1014 не переиспользуется как доказательство изменённого reader/UI.

На этапе исходного precode были доказаны структура проблемы и ограниченный
способ реализации; новый SQL/RPC тогда не исполнялся. Последующая узкая
actual-проверка первого блока описана в текущем статусе и отдельной квитанции.
Рабочий preview всех каналов в UI, весь пункт15, пункты1–36 и production
по-прежнему не объявляются завершёнными.


## Исполнение первого блока и проверенные справочники

Новый owned worktree: `evo-team-chat-channel-previews/evo_AI_CRM`; branch
`izzhackt/team-chat-channel-previews`; база main24e78024. Этот документ и записи
launch/PLAN_CHANGES добавлены до продуктового кода. Два блока и ограничения
исходного принятого precode выше сохраняются. На момент этой source-записи
SQL237 ещё не применялась; последующий локальный apply отражён в actual-квитанции.

Официальные PostgreSQL docs проверены 2026-09-21: CREATE OR REPLACE сохраняет
права/владельца существующей функции; STABLE подходит для чтения состояния,
SECURITY DEFINER требует сохранения безопасного search_path и grants.
[CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html).
LEFT ограничивает текст по символам, а не байтам; SQL237 использует240.
[String functions](https://www.postgresql.org/docs/current/functions-string.html).
LATERAL допускает обращение к предшествующей строке FROM; LEFT JOIN сохраняет
канал при отсутствии сообщения.
[Table expressions](https://www.postgresql.org/docs/current/queries-table-expressions.html).
