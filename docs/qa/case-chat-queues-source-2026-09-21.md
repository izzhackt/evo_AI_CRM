# Очереди клиентского чата — source-проверка

Контракт: [пункт 11 / CRM-07](../EVO_CASE_CHAT_QUEUE_PLAN_2026-09-21.md).
Precode `5e58cb6afb381ba09f798220cb07f0f91c0b667a` получил независимое
APPROVED PRECODE ONLY. Эта запись относится к source-реализации после него;
actual DB/Auth/UI и финальное независимое ревью ещё не заявляются.

## Реализовано в коде

- Новый read-only RPC v2 в миграции 234 фильтрует существующие active cases
  по q/await до 201/200, сохраняя actor/org/case visibility и независимый unread.
  Исторические SQL, v1 и business commands не изменены.
- SSR и action передают одну очередь; ошибочные значения отклоняются. Кнопки
  «Все», «Нужен ответ», «Ждём студента» используют текущие EVO tokens/Golos,
  44 px и перенос. Пустая очередь, пустой поиск, loading и ошибка различимы.
- q/queue/case сохраняются в URL и навигации без remount открытого диалога.
  Заголовок не зависит от присутствия дела в текущей выдаче; прямой URL вне
  очереди использует существующий full-case reader после chat authorization.
- Один sequence защищает success/error/finally списка при query/queue/retry,
  подтверждённых post/set_await/read и selected-case realtime invalidation.
  Callback использует актуальный scope. Дополнительный sequence чтения диалога
  не даёт старому refresh перезаписать подтверждённый await state.
- Attach переносится в persisted draft до удаления из URL. Если Storage write
  не прошёл, URL остаётся до следующего успешного сохранения draft или
  подтверждённого send. Кнопка другого дела и возврат к списку attach не несут.
  Это необходимо именно из-за нового URL sync, не новая семантика сообщений.

## Выполненные локальные проверки

- Node 22.23.1: `case-chat-queues`, `v3-case-chat`, `portal-messages` — 34/34.
  Четыре новых теста исполняют чистые input/URL helpers и проверяют SQL source
  contract. Они не подменяют выполнение SQL/authorization или UI.
- `npm run typecheck`, ESLint пяти изменённых TS/TSX и нового теста — PASS.
  Первый typecheck выявил nullable await header; исправлен fallback на
  проверенное `page.thread.awaitState`, повтор прошёл.
- PostgreSQL parser — 8 SQL statements; PL/pgSQL parser — 1 функция. Это
  синтаксический разбор, без подключения и применения к базе.
- Impeccable detect двух изменённых UI files — exit 0, `[]`. Это статическая
  проверка; новых браузерных screenshots/visual acceptance нет.
- `git diff --check` — PASS. Package/lock не менялись; использованы существующие
  совпадающие зависимости, новая установка или очистка не выполнялась.

Actual 234 apply, ordinary staff/Student denial, реальные transitions,
запаздывающие ответы, reload/draft/attach и desktop/320/390 ожидают окна ROOT
после B232 и ROOT233. Migrations не перенумеровывались; main должен сначала
включить 233. Общая база, Auth, browser, провайдеры и production не затронуты.
Пункт 11 и весь список 1–36 этим source-only этапом не закрываются.
