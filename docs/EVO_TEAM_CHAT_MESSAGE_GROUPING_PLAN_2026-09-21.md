# A15g-2 — компактные последовательности сообщений одного автора

Статус: precode принят ROOT после независимого APPROVED_PRECODE; реализация разрешена после merge #1008. Основа реализации: main `d6add88372778758b23686fb0bba6ae74181e15b`. Проверка актуальности повторена: целевой исходный код идентичен main29e0fb46 и actual A1005 7d70a71d. Runtime пока занят очередью B32 → B1006 → ROOT22F; A выполняет только исходники и локальные проверки кода.

Принятый частный план SHA-256: `51ded3855666a6eeb793cae8cf99912a6e453667628d7734d711bf452e953e67`; независимое review: `b42dbc42a69b03f9c449754a8c2babf16f90cd575c95ed536451204b32d27631`. Ни approval плана, ни source tests не означают actual UI acceptance.

Источник: main `29e0fb46a8067a6a4f5a9bedce81971aba2f56ff`; просмотрен worktree evo-team-chat-read-retry/evo_AI_CRM. `git diff` от фактически проверенного A1005 `7d70a71d8156c70195567d9ee8c44e7cc6c2d5ae` до main пуст для всей папки team-chat, team-chat-feed.ts, team-chat-read-errors.ts и platform-team-chat.ts. Перед будущей реализацией после A1008 повторить только эту проверку актуальности.

Impeccable: прочитаны SKILL, Operate и critique reference; это ограниченное планирование refinement, НЕ запуск полного critique/detector и не новый context. PRODUCT и DESIGN сохраняют вариант «Мессенджер», EVO shell, нейтральные чужие/мягкие красные свои сообщения, закреплённый composer. Основание принятого остатка: EVO_TEAM_CHAT_FLAT_UI_PLAN § таблица проблем/отдельный A15g; READ_RETRY_PLAN прямо оставляет grouping/density/previews вне A1005.

## Подтверждённая проблема и выбор

Просмотрены только существующие `ui-proof/confirm-history-ready-desktop1440.png` и `confirm-history-ready-mobile320.png` из /private/tmp/evo-team-chat1005-local-20260921. На desktop несколько коротких сообщений одного автора в одну минуту повторяют полное имя/время/ряд действий и занимают почти всю историю; на320 повторение ещё заметнее. Это настоящие сохранённые QA сообщения, не новые fixtures. По снимкам не выводим наличие всех видов сообщений/доступов.

Первый блок: компактная последовательность одного автора, без переноса/скрытия действий. Сокращаем повторяемое имя/аватар и внутренний вертикальный отступ. Время каждой реплики, changed marker, цитата, mentions, reply/menu остаются доступными и видимыми. Не объединяем сообщения в один body/DOM article; не уменьшаем основной текст16px или touch targets44px. Устраняем измеренное повторение, не начинаем полную перестройку bubble/toolbar. Hover-only действия и перенос меню — отдельное решение, не prerequisite этой небольшой поставки.

## Точная ownership будущего A

1. Новый pure helper `src/lib/team-chat-message-grouping.ts` + `tests/team-chat-message-grouping.test.mjs`.
2. `src/components/v3/team-chat/TeamChat.tsx`: только вычисление presentation flags из уже полученных `rows` перед/в существующем map, передача prop в Row. Не менять async handlers, store/range, tickets, retries, refresh, navigation, realtime, composer state.
3. `src/components/v3/team-chat/TeamChatMessageRow.tsx`: optional compact continuation prop; имя сохраняется screen-reader текстом, placeholder того же avatar-column width; time и edited marker видимы. Все IDs/data-chat-row/data-chat-body, DOM key, refs, quote/menu callbacks неизменны.
4. Локальные классы `team-chat.module.css`: только продолжение группы, меньший gap/padding; никакого глобального overflow hidden, новых шрифтов/цветов, hover-only функций.
До продуктового кода принятие и границы записаны в Launch/PLAN_CHANGES. Настоящий файл сохраняет содержание принятого precode; историческое предложение стало контрактом этого ограниченного блока.

## Детерминированное правило (принятое UI-правило, не бизнес-факт)

Первый элемент видимого range всегда полный. Продолжение только для соседних строк ЭТОГО range: одинаковые channelKey и authorMembershipId (не displayName), оба не deleted, createdAt валиден/не убывает, один календарный день PLATFORM_ORGANIZATION_TIMEZONE; интервал не более5минут. Порог5минут — явное принятое значение presentation, не выданное за прежнюю политику. Не группировать через известный разрыв последовательности: decimal sequence сравнивать BigInt, current = previous+1, без Number precision loss. Это консервативно: пропуски могут разделять группу, но не связывают неполный контекст. Смена автора/дня, удалённая строка, malformed timestamp/sequence разрывают группу. Target/highlighted сообщение показывать полным, чтобы deep-link/context однозначно называл автора. Строка, чей message.id равен существующему currentChannel.firstUnreadId, также всегда начинает полную группу с видимым автором/аватаром, даже при том же авторе и близком времени предыдущей строки. Передавать этот серверный ID в pure presentation helper; null или ID вне видимого range не создаёт искусственную границу. Не вычислять unread по sequence и не менять DTO, unreadCount или seen/ack. Цитата сама по себе сохраняется внутри собственной строки; не используется для thread grouping. SearchResult остаётся прежним, не группируется.

Границы диапазона важны: ни quote cache, ни cached rows вне range не дают права спрятать имя первой строки. При prepend предыдущая первая строка может стать continuation: сохранить действующий captureAnchor/restoreAnchor по тому же messageId; не внедрять новый scroll manager. Открытое details, фокус меню, edit/delete frozen attempts не должны ремонтироваться из-за flags. Новая высота меняет реально видимую область: useTeamChatSeen остаётся на реальном body,500ms/min(50%,160px), исключения window/overlay/dialog не трогаются; нельзя требовать прежнее количество seen после уплотнения или вручную пересчитывать unread.

## Почему previews не входят

`platform-team-chat.ts: TeamChatChannel` даёт key/muted/preferenceVersion/readSequence/unreadCount/firstUnreadId — нет последнего сообщения. TeamChat.tsx rail показывает preview только для selected channel из `latestMessageId`/текущего store. Поэтому нельзя получить полные правдивые previews всех каналов из этих полей, брать первую строку поиска/страницы, выводить «Нет сообщений» при отсутствии preview или делать N запросов на все каналы для косметики. Позднейший блок потребует отдельного рассмотрения bounded authorized latest-preview reader/DTO с текущими channel ACL и deleted semantics. Эта поставка не меняет rail и не резервирует миграцию.

## Проверки будущей реализации

Pure behavior tests: same actor within threshold; threshold boundary; actor/channel/day switch (Bishkek, включая UTC boundary); deleted обе стороны; невалидные даты/sequence; большие decimal IDs; sequence gap; first visible row after context load; highlighted target; firstUnreadId совпадает с текущей строкой при том же авторе/дне/интервале — полная строка, null и ID вне range не меняют grouping; displayName одинаковый у разных membership не группируется. Это проверки решений алгоритма, не JSX string snapshots.

Scope lint/typecheck и существующие feed/read-errors/seen/drafts tests только как прямые риски; не заявлять их доказательством UI. В review проверить неизменность Composer/actions/DTO/SQL и идентичность row IDs/keys/permissions. Никаких новых fixtures, send/edit/delete для проверки плотности без отдельной обусловленной необходимости.

Один будущий actual UI batch1440/390/320 на существующем разрешённом канале с сохранёнными соседними QA сообщениями: сравнить число полностью видимых реальных реплик/высоту пары при одинаковом viewport и scroll context; первая строка/время/автор понятны; reply/menu/Ссылка доступны клавиатурой и touch44; no overflow; search→context→Back возвращает прежний anchor; prepend сохраняет видимую строку; unsent composer draft сохраняется при навигации. Существующие retry/error flow не должны исчезнуть. При доступном quote/deleted/foreign message проверить именно их, иначе назвать непроверенными; не создавать сообщения ради скриншотов. Read-only просмотр чужих сообщений может законно дать sparse-seen effects: будущий QA scope заранее связывает реальные IDs/ack, не объявляет zero-write без evidence. Не отправлять/сохранять draft. По обнаруженным проблемам один пакет исправлений и максимум один confirmation batch; никакого третьего visual round.

Вне scope: channel preview reader, весь item15 целиком, новая сетка/rail/header, message virtualization, авто-pagination, attachment redesign, permissions/SQL, Composer/IME, новые сообщения/actors/providers, managed production release. Результат этого файла — принятый контракт ограниченного блока после A1008; реализация и реальная UI-проверка ещё не завершены.
