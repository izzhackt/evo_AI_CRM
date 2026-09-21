# A15g-1 — source-проверка чтения и повтора командного чата

Контракт: [план A15g-1](../EVO_TEAM_CHAT_READ_RETRY_PLAN_2026-09-21.md).
Precode `a90fda0c413a680073e18c8db02bdb27ef1e3812` независимо одобрен. Эта запись
описывает исходники и локальные проверки кода; actual UI/DB/Auth не выполнены.

## Реализовано

- Небольшой client-safe reducer хранит отдельные foreground/background попытки:
  origin операции, скопированные query/cursor/append/context параметры, failure
  и pending. Успех другой попытки не очищает ошибку. Новый foreground запрос и
  отмена context снимают прежний retry; late non-terminal результат игнорируется.
- `forbidden` остаётся terminal, включая старую эпоху. TeamChat очищает прежние
  данные и блокирует последующий commit. Composer/DeleteConfirmation по-прежнему
  передают наверх только forbidden; их write-copy и uncertain payload не менялись.
- Кнопка повторяет исходный поиск, navigation, pagination или changes cursor;
  новый несохранённый input не становится аргументом retry. Предыдущие результаты
  search pagination остаются и объединяются обычным способом после успеха.
- Background refresh success не очищает foreground failure. Его собственная
  ошибка остаётся видимой во время автоматического повтора до подтверждённого
  успеха. Watermark и latest tail marker продвигаются после успешного changes
  read и всей необходимой V2 hydration. Частичный успех latest с ошибкой context
  или after оставляет прежний marker: повтор снова выполняет нужную догрузку.
- Ошибка чтения сообщает про поиск/чтение. Missing/invalid не предлагают
  бесконечный повтор. Resume-edit использует прежнюю кнопку/handshake редактора;
  общий alert не выбирает новый draft. Ошибка соединения и reconnect сохраняют
  свою ответственность. Существующие EVO/Golos, error/button CSS и44px controls
  используются без изменения стиля или нового modal.

## Выполненные проверки

Node22.23.1, matching existing dependencies, без установки:

- `team-chat-read-errors`, `team-chat-feed`, `team-chat-drafts`, `team-chat-seen`:
  **29/29 PASS**, включая11 новых поведенческих проверок reducer/argument capture
  и hydration commit protocol.
  Проверяются mutation isolation, сохранение term/cursor/append, независимые
  владельцы ошибок, pending refresh, старые failure/success, отмена и terminal
  late forbidden. Это чистые unit-проверки, не подмена API/real-auth доказательств.
- Независимое source review `2941170b` обнаружило ранний commit latest marker.
  Исправление переносит его после context/after через используемый TeamChat helper.
  Две регрессии проходят partial-success → context/after failure → exact retry:
  старые marker/cursor и видимый диапазон сохраняются при ошибке; реальный helper
  расширения диапазона добавляет сообщение перед успешным commit. Ответы сервера
  не подменялись; это unit evidence, не actual UI proof.
- Стандартный `npm run typecheck` (scope-local Next typegen + tsc): PASS.
  Первый прямой tsc в новой рабочей копии не имел generated next-env.d.ts и
  сообщал об отсутствующих PNG declarations. После обычной подготовки типов
  проверка прошла; продуктовый asset и контракты не менялись.
- ESLint изменённого TSX, helper и теста: PASS. `git diff --check`: PASS.
- Package/lock, Composer/DeleteConfirmation, CSS, server actions, RPC/DTO/SQL,
  Realtime subscription и seen helper не изменены.

Impeccable shape/Operate/craft-floor применены к ошибкам, месту действия повтора,
сохранению контекста и существующим токенам. Новый браузерный/визуальный pass
пока не выполнялся. Сохранённый A15f actual остаётся историческим доказательством
предыдущего блока и не выдаётся за проверку нового retry.

## Открытые gates

Независимый exact-head source review одобрил
`f882fedc39148873e2585bd006866bf2934fa5bc`: единственное P2 предыдущей ревизии
закрыто, новых замечаний нет. Review SHA-256:
`adfcb5e985e1d0175be4b37305ef2aeb4ba0a46f29fc5eaa6bdd04cd57062c56`.
Сохранённые проверки приняты без повторного запуска; это одобрение исходников.

Остаются CI/final exact-head admission и последующий coordinated actual UI
после B1003 → ROOT235. До передачи runtime эта ветка не использует общие
DB/Auth/browser/server; нет posts/edits/deletes, новых actors/fixtures или SQL.
Обычные seen-effects будущего UI требуют отдельного конечного бюджета по
фактическому incoming state. Отказ доступа, pagination, потеря сети, anchors и
сохранность drafts проверяются на доступных реальных путях; недоступные варианты
не объявляются успешными. Пункт15/all1–36 и production не завершены этой записью.
