# Общая строка времени и действий — source-проверка

Статус: ограниченная реализация и проверки исходников готовы; actual UI,
независимое exact-head review и merge ещё впереди. Проверка скринридером,
результат на телефоне и количественный выигрыш плотности не заявляются.

- Base: merged PR #1012, `7faa4748c899b58e25d630f6c3942a6dd21ff663`.
- Принятый precode: SHA256 `83cf121791c7967d5d3eedb0b2835727d9137bb9e9c03bc6df51fb847fbb6964`.
- Независимое APPROVED_PRECODE: `eeceef77074e6a9450d2803128f5e2d85f4ed4dc13d374212f8039017ab30a5b`.
- Контракт записан до кода: `be254e6f`.
- Проверенный product source: `30f8fa3fbd400ac42bcdcfcb18080995b75ebbbd`.

## Изменение и сохранённые границы

`TeamChatMessageRow.tsx` сохраняет единственный time с прежним dateTime,
полным title и timezone, переносит его и edited marker к прежним Ответить/menu.
Имя остаётся перед body; у continuation весь header становится srOnly.
Footer/details имеют одно стабильное положение между full/continuation.

CSS локально оформляет metadata и запрещает сжатие footer controls. Shared
messageActions/textButton, DeleteConfirmation,16px body и44px targets не менялись.
Grouping helper, TeamChat/composer, permissions/handlers/keys/IDs, quote/mentions,
read retries, seen, DTO/SQL/миграции также без изменений. Старый header-time
selector заменён footer metadata styling; параллельной раскладки времени нет.

Impeccable Operate и craft-floor применены как refinement существующего EVO:
сократить повторяемую служебную строку, сохранить текстовые действия и доступность,
разрешить wrap на узком экране вместо скрытия данных. Bundled Next.js CSS Modules
guide подтверждает использование существующего локального CSS module.

## Выполнено

Node `22.23.1`. Повторно использован существующий node_modules только после
совпадения package.json и lockfile SHA256 с worktree evo-requests-queue.
Все команды ниже завершились exit0 на source30f8fa3f:

| Проверка | Результат | Лог SHA256 |
|---|---|---|
| `eslint src/components/v3/team-chat/TeamChatMessageRow.tsx` | PASS | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `npm run typecheck` (clean local Next types → typegen → tsc) | PASS | `dd8145086836aaed592b736d5d2abf5e521cada876212e044f406db1756e9d5b` |
| `git diff --check` | PASS | Лог пуст |

Логи: `/private/tmp/evo-team-chat-service-row-source-20260921/{lint,typecheck}.log`.
Scoped ESLint не является CSS или UI тестом. Прежние39/39 на неизменённой логике
#1012 не запускались снова и не доказывают новую геометрию. Зеркальные JSX/CSS
tests не добавлялись. Diff ограничен двумя продуктовыми файлами и документацией.

## Что остаётся проверить

Одно отдельно согласованное actual окно1440/390/320: время/автор/edited,
размеры controls, wrap и открытый menu, reply/quote, keyboard/permalink,
search/context/Back и prepend anchors, unsent draft. Baseline высот той же пары
112.1875/136.984375/161.78125px сохранён в [плане](../EVO_TEAM_CHAT_SERVICE_ROW_PLAN_2026-09-21.md).
Не обещаем процент, новые available variants или весь item15. Возможное
изменение intrinsic ширины bubble и рост footer при wrap — явные actual риски.

Во время source-проверки QA владеет ROOT22G. Auth/DB/Storage/browser/server
не запускались и не менялись. Старая login binding не переиспользована.
Production deploy и all-channel preview reader не входят в этот PR.
