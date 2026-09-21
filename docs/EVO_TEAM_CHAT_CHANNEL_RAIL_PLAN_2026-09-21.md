# A15 — превью в списке каналов: второй блок, precode

Статус: предложение для независимого precode review; продуктовый код не менялся.
База `c675d4b4d735ccbcc51dc162265e31d64e193990`: #1017 смержен после final review
`f36fec39` и CI35645855198. [Первый контракт](EVO_TEAM_CHAT_CHANNEL_PREVIEWS_PLAN_2026-09-21.md)
и [узкая actual-проверка reader/DTO](qa/team-chat-channel-previews-actual-2026-09-21.md)
остаются основой. Это продолжение пункта15, не новый дизайн всего чата.

Worktree `evo-team-chat-channel-preview-rail/evo_AI_CRM`, branch
`izzhackt/team-chat-channel-preview-rail`. QA принадлежит ROOT; здесь только
файлы и сохранённые доказательства, без runtime/Auth/DB/browser/server.

## Короткий Impeccable brief

- **Задача сотрудника:** понять последнее сообщение каждого доступного канала
  и перейти в нужную переписку. Operate; основной экран desktop, телефон тоже
  должен сохранять понятные состояния и полноценные действия.
- **Вид:** сохраняем EVO/Golos,288px desktop rail, нынешние аватары/цвета,
  порядок/названия, selected,15px имя/13px однострочный preview, ellipsis,
  unread badge,44px controls и breakpoint800. Новая типографика не нужна.
- **Поведение:** один серверный latestPreview для всех строк, включая выбранную;
  поиск/история не подменяют последнее сообщение. Ошибка и пустой канал различимы;
  на мобильной панели каналов видны фоновая ошибка/повтор и закрытый доступ.
- **Границы:** прежние ссылки/URL/aria-current, draft/quote/search/context/Back,
  anchors, feed hydration/watermark, seen и права сохраняются. Новых каналов,
  SQL, migrations, subscriptions, таймеров, API или внешних провайдеров нет.

Применён уже загруженный в этой сессии Impeccable4.3.1 context; launcher не
повторялся. PRODUCT/DESIGN и исходники перечитаны, композиция ранее принята
владельцем. Craft-floor читается непосредственно перед первым UI edit, после
precode review и разрешения вопроса отсутствующего mobile rail incumbent.

## Исходники и настоящая визуальная основа

| Место в base main | Подтверждённый факт |
|---|---|
| `TeamChat.tsx:47,144,332` | Initial channels из SSR; refresh и search затем независимо вызывают setChannels. |
| `TeamChat.tsx:101–110` | Forbidden терминален: очищает каналы/ленту; alive/revoked guards уже существуют. |
| `TeamChat.tsx:73–74,183,289,364,377` | Rail берёт только выбранный latest из feed store. Presentation state latestMessageId отделим от обязательного latestId ref для hydration. |
| `TeamChat.tsx:370–405`, CSS109–113 | На mobile панели взаимно скрываются через display:none; нынешний read alert/login расположен только в conversation. |
| `team-chat-channel-previews.ts:65–88` | Принятый pure acceptor различает устаревший ticket (тот же previous), невозможный snapshot (null) и принятый snapshot. |
| `team-chat/page.tsx:38`, `useTeamChatSeen.ts:75–100` | Instance key включает membership/channel/message; seen наблюдает только видимые data-chat-body внутри истории, не nav. |

Просмотрены одной группой три сохранённых PNG #1014. На1440 виден настоящий
Sales rail: выбранный «Общий» с собственным preview и «Продажи» без preview.
Это частичная визуальная основа существующей композиции.390/320 показывают
conversation с скрытым nav: **они не являются mobile rail baseline**. Ни один
кадр не доказывает Admin three-channel/empty/error/forbidden rail.

Восемь файлов UI/CSS/PRODUCT/DESIGN/fonts/tokens/logo побайтно равны source1014
`2f467e5b`. Все290 business-table snapshots совпадают между сохранённым final1014
и final237; это только историческая сверка, не состояние нынешней ROOT QA.
Полная tree, Auth, catalog и UI-доставка нового reader равными не объявляются.
Evidence `/private/tmp/evo-team-chat-channel-preview-rail-precode-20260921/incumbent-source-evidence.json`,
SHA256 `b28b4823f1341418610334373aee80810f4556acf50608a4dc1d08ef3024ff67`.

## Точное подключение

1. Initial state остаётся `initial.channels`. Добавить component-local request
   counter и ref `{requestId:0, channels:initial.channels}`. Общий counter выдаёт
   ticket непосредственно перед каждым channels-bearing `readTeamChatAction`:
   каждой refresh-итерацией и каждым search/append/retry. V2 readPage не несёт
   channels и не получает такой ticket. Существующие foreground/background IDs
   и contextRequest остаются отдельными и не меняют смысл.
2. Общая локальная commit-функция вызывает существующий `acceptTeamChatChannels`
   после alive/revoked и текущего foreground epoch guard, до setChannels,
   participant/feed изменений и watermark. Новый snapshot синхронно фиксируется
   в ref, затем state. Stale ticket оставляет metadata прежней, но не блокирует
   допустимый результат поиска/ленты. Null означает unavailable в том же owner;
   response прекращается до feed/watermark commit, прежняя metadata остаётся.
3. Forbidden очищает ref и state; late response не проходит revoked. Counter
   не сбрасывается при поиске/Back/panel/refresh. Новый настоящий component
   instance начинает его с0; unmount использует alive guard и освобождение refs.
   Не сбрасывать counter в effect cleanup/setup: это сломало бы Strict Mode.
4. Каждая строка рендерит только `item.latestPreview`: null → «Пока нет сообщений»;
   deleted → «Сообщение удалено» без автора/старого body; live → «Вы: …» либо
   «authorName: …». Plain React text, без HTML, дополнительных ссылок, tooltip
   или data-chat-body. Малый pure formatter добавить в существующий previews
   module; decoder и acceptor оставить побайтно прежними.
5. Удалить только больше не нужный presentation state latestMessageId, его
   setter-вызовы и lookup для rail. `latestId.current`, tailChanged, commitTail,
   hydration failure/cursors и navigate/latest semantics сохраняются.
6. В nav добавить компактный mobile-only feedback. Для transient failure брать
   **background ticket**, ту же `teamChatReadFailureCopy` и `retryRead` с тем же
   owner/id/pending. Не заводить отдельный error state или request. Copy остаётся
   о неудачном обновлении истории: background может отказать уже на hydration,
   когда channels успели загрузиться; нельзя ошибочно утверждать сбой самого RPC.
   Foreground failure остаётся у conversation со своей нынешней приоритетностью;
   на nav не добавляется поиск/retry, который молча поменял бы скрытый экран.
   Forbidden показывает закрытый доступ и обычный `/login`. На desktop эта
   новая область display:none; на mobile скрыта вся противоположная панель.
   Одна и та же ошибка не должна иметь две видимые/доступные alert-копии.
7. Существующие30s/online/visibility refresh и afterSave сохраняются. Не обещать
   realtime остальных каналов; не брать preview из search/before/context/feed.
   Unread и firstUnreadId приходят из принятого snapshot без собственной арифметики.

## Владение и проверки

Ожидаемые product файлы: `TeamChat.tsx`, `team-chat.module.css`, additive formatter
в `src/lib/team-chat-channel-previews.ts`, его targeted protocol tests. Остальные
изменения — этот план, launch/PLAN_CHANGES и evidence/status. MessageRow/Composer,
seen/feed modules, error reducer, repositories/actions/RPC/SQL не меняются.

После precode: formatter cases own/other/null/tombstone/literal Unicode text;
существующие preview/order и read-error/hydration tests, targeted lint/typecheck,
diff-check и независимый source review. Они доказывают чистые контракты; actual
UI и гонки не объявляются пройденными из unit/assertions. Ревью отдельно проверяет
оба ticket allocations/commits, early return до watermark и сохранение latestId.

## Недостающий incumbent и будущий ограниченный QA batch

До runtime ROOT должен назначить окно после manage incumbent/B1018, подтвердить
точный source/DB epoch/config/schema и существующего актёра. Для недостающего
incumbent нужен один batch нынешнего c675 rail:1440×1000,390×1000,320×1000,
mobile `/v3/team-chat` без channel (showChannelsInitially), реальный набор ссылок,
preview/badges/AX/overflow, затем current-channel transition/back. Сохранять
same-input IDs/hash/viewport/theme; никаких fixtures, account/grant/message writes.
Старые mobile feed PNG этот batch не заменяют. Если ROOT даёт source-only
продолжение до окна, missing incumbent остаётся явным gap, не visual PASS.

После реализации один общий desktop/mobile batch проверяет каналы из фактического
RPC, live/empty и доступные author/deleted варианты; keyboard Link/aria-current,
ellipsis/44px/no overflow; выбранный и другие каналы; search/context/Back с draft
не подменяют rail; один существующий refresh. Один scoped browser-offline
background failure и ручной повтор показывают stale данные/error/pending,
восстановление online — обычное успешное обновление. Недоступные варианты
(own/reply/tombstone/long-body, restricted actor/forbidden) остаются gaps;
их нельзя создавать или подменять ответами ради зелёной отметки.

Preview сам не даёт seen. Открытая desktop conversation или переход в канал
могут законно отправить seen: до batch связать точные допустимые existing IDs
и не обещать zero-write для всей сессии. Before/after/final, полная сохранность,
закрытие только собственных Auth/browser/server обязательны в принятом packet.
Incumbent и final учитываются в общем ограничении visual passes; бессрочных
micro-edit/rebuild циклов нет. При непредусмотренном дефекте — конкретный отчёт
ROOT и согласованный scope исправления, без объявления неподтверждённого PASS.

Предложение не разрешает runtime сейчас. Новых migrations не нужно;238 занята
ROOT. Production, весь пункт15, issue708 real-staff acceptance и весь1–36 не закрыты.
