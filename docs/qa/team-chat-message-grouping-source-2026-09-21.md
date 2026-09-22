# A15g-2 — source-проверка компактных последовательностей

Исторический source-only срез; последующий actual и закрытие — в [отдельной квитанции](team-chat-message-grouping-actual-2026-09-21.md).

Статус на момент source05705f7a: исходники и ограниченные проверки готовы; actual UI, независимое
code review и merge ещё не пройдены. Новое поведение в production не доставлено.

Основа: main `d6add88372778758b23686fb0bba6ae74181e15b` (#1008).
Precode commit `6a128cbc` предшествует продуктовым изменениям.
Проверенный source commit: `05705f7ab5aa3a907b9fbfb997ce4440aa636065`.
Контракт: [A15g-2](../EVO_TEAM_CHAT_MESSAGE_GROUPING_PLAN_2026-09-21.md).

Соседние сообщения одного автора/канала в пределах пяти минут и одного дня
Bishkek скрывают повторные имя/аватар только визуально и получают меньшие
вертикальные отступы. У каждой строки сохранены время, edited, quote, mentions,
body, reply/menu и все прежние IDs. Имя остаётся screen-reader текстом, скрытый
аватар сохраняет свою колонку. Первая видимая строка, highlighted target и
server firstUnreadId всегда показывают автора. Deleted, смена автора/канала/дня,
невалидные даты/sequence и разрывы последовательности не объединяются.

Изменены только pure helper, его тесты, три presentation-вставки в TeamChat,
optional prop/классы строки и три локальных CSS-правила. Composer, actions,
DTO, SQL, seen, retry/refresh/navigation handlers не менялись.

## Выполненные проверки

Node22.23.1. Существующие node_modules переиспользованы после совпадения
SHA-256 package.json и package-lock.json с evo-requests-queue.

- `node --experimental-strip-types --test tests/team-chat-message-grouping.test.mjs tests/team-chat-feed.test.mjs tests/team-chat-read-errors.test.mjs tests/team-chat-seen.test.mjs tests/team-chat-drafts.test.mjs`: 39/39 PASS, включая10 новых pure decision tests.
- Scope ESLint: helper, TeamChat.tsx, TeamChatMessageRow.tsx и новый test — PASS, без вывода.
- `npm run typecheck`: PASS. Первый запуск выявил TS2737 для `1n` при текущем target; заменено на `BigInt(1)` без изменения tsconfig, повтор прошёл. Первоначальная ошибка сохранена отдельно.
- `git diff --check`: PASS.

Локальные журналы: `/private/tmp/evo-team-chat-grouping-source-20260921/`.

| Файл | SHA-256 |
|---|---|
| tests.log | 3e34fa6d3a314a1f0681555e57cbfa8d502df7fc0661308ab9316f8dc8dc9b48 |
| lint.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| typecheck.initial.log | cf6739115ff9222fc035e2080dbbdd228bed9224434c39bf99c5c75950ca60f5 |
| typecheck.log | dd8145086836aaed592b736d5d2abf5e521cada876212e044f406db1756e9d5b |

## Границы доказательства

Auth/DB/Storage/browser/server runtime не запускались. Показатели плотности,
1440/390/320, keyboard/touch, actual first-unread, search/context/Back, prepend
anchor и unsent draft требуют отдельного будущего окна после ROOT22F.
Снимки прежнего A1005 совпадают с исходной версией целевых файлов и использованы
для выбора улучшения; они не доказывают новую реализацию.
Отсутствие новых DTO/SQL не означает отсутствие будущих seen effects при
реальном просмотре; такие эффекты надо отдельно ограничить и сверить.
Channel previews, весь item15, broad E2E/native и production остаются вне claim.
