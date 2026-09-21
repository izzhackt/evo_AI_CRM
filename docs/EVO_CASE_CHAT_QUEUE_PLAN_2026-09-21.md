# Пункт 11 / CRM-07 — очереди клиентских сообщений

Статус: контракт перед реализацией. База `ca7c98ec2`; A15f / PR #992
смёржен. ROOT выделил миграцию 234; 233 принадлежит ROOT. Общая локальная
база занята задачей B. Этот документ не разрешает применение миграции,
Auth/business writes, запуск второго QA-сервера или production-релиз.

## Задача и неизменяемые условия

Сотруднику нужно быстро выбрать дела, где требуется его ответ или ожидается
студент. Три очереди: «Все», «Нужен ответ», «Ждём студента». Источник —
существующий `await_state`; unread остаётся отдельным признаком. Открытие
диалога и обычное сообщение сотрудника не закрывают вопрос. Меняет отметку
существующая явная команда `set_await`; Student post сохраняет текущую
серверную семантику `needs_reply`.

Сохраняются EVO/Golos, токены, поиск, две панели desktop, мобильный возврат,
цитаты, вложения, черновик, frozen retry, read cursor, права и tenant scope.
Командный чат, native, portal, провайдеры и полная E2E-кампания вне блока.

## Контракт чтения

- Миграция 234 добавляет `platform.staff_case_chat_threads_v2(TEXT, TEXT)`:
  `p_query` и `p_await_state DEFAULT NULL`. Второй параметр допускает только
  NULL, `needs_reply`, `awaiting_student`; иные значения дают `22023`.
- Авторизация, active/org/case visibility, literal case-insensitive поиск,
  формат rows/truncated и grants такие же, как у v1. Отбор await применяется
  вместе с q **до LIMIT 201**; результат содержит максимум 200 строк.
  Порядок остаётся last_message_at DESC NULLS LAST, case id DESC. Никаких
  новых counts, таблиц, data writes или клиентской фильтрации первых 200.
- V1 и исторические SQL неизменны. Страница и list action переходят на v2,
  валидируют очередь и запрос; SSR и интерактивный путь совпадают.
- URL `queue` принимает `all`, `needs_reply`, `awaiting_student`; отсутствие
  означает all, ошибочное/повторное значение — notFound. `all` в новых ссылках
  опускается. q, case и attach проходят существующие проверки.

## Интерфейс и переходы

- Компактные кнопки очередей рядом с поиском: min 44 px, перенос на узком
  экране, явный выбранный вариант и keyboard focus. Без выдуманных счётчиков.
- Search/filter/retry/refresh используют единый sequence: изменение q/queue
  сразу отменяет debounce и инвалидирует предыдущие success/error/finally.
  Search ждёт 250 ms; переключение очереди и retry выполняются сразу.
  Realtime выбранного дела и подтверждённые post/set_await обновляют текущий
  q/queue. Callback берёт актуальный scope из ref, не пересоздаёт подписку
  при каждом нажатии клавиши. После фактического mark-read обновляется unread
  списка, но await state не меняется.
- Loading скрывает прежнюю выдачу; error предлагает повтор текущей очереди;
  пустая очередь отличается от отсутствия результатов по имени. Сброс поиска
  сохраняет очередь. Ограничение 200 остаётся видимым при truncated.
- Ссылки выбора и возврата сохраняют q/queue. Native history replaceState
  сохраняет текущий URL без remount диалога/черновика; изменения выбора дела
  по-прежнему используют обычную навигацию. Attach остаётся только в контексте
  исходного дела и удаляется из URL после потребления; к другому делу и к
  общему списку вложение не переносится.
- Если дело исчезло из выдачи, открытый диалог остаётся. Имя берётся из
  отдельного начального значения, а не из текущей filtered row. При прямом
  URL/перезагрузке вне очереди после успешного chat authorization используется
  существующий `getPlatformStudentCaseView` / staff snapshot только для этого
  case; принимается только full access. В клиент передаётся только имя.
  Не делать второй unfiltered list и не расширять новый list RPC параметрами.
  При ошибке этого чтения показывать ошибку, не выдумывать имя/успех.

## Проверка и завершение

До QA: independent precode review, SQL parser, узкие regression tests для
контракта/URL, существующие case-chat/portal-message tests, ESLint changed
files, typecheck, diff check. Это source evidence, не execution DB/UI.

После отдельного окна ROOT: реальные ordinary staff/Student denial и existing
case visibility, invalid enum/query, q+queue; явные состояния и переходы на
разрешённых существующих QA cases. Открытие диалога может записывать read cursor:
эффекты перечислить и сверить, не обещать zero writes. Не создавать 201 кейс
ради лимита и не отправлять тесты реальному студенту. Нет подходящих данных —
назвать предел actual coverage.

Один batched desktop/390/320 pass: три очереди, поиск/сброс, pending/race,
error/retry, selected case leaving queue, header/draft/quote/attach, возврат и
reload URL. Исправить найденное одним набором и максимум один confirm pass.
Existing screenshots/search QA report — исторический incumbent; свежих
визуальных доказательств этого блока ещё нет. Independent final exact-head
review + protected CI обязательны; merge 234 ждёт main с 233.

## Проверенные технические основания

SQL WHERE предшествует LIMIT; порядок нужен для воспроизводимого ограниченного
результата: [PostgreSQL SELECT](https://www.postgresql.org/docs/17/sql-select.html).
Именованные аргументы RPC сохраняют существующий transport:
[Supabase rpc](https://supabase.com/docs/reference/javascript/rpc).
Next поддерживает native replaceState без reload с интеграцией router:
[Next.js Native History API](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api).

## Коррекция по фактической первой QA-проверке — 2026-09-21

На `999040d0`, local234, ordinary admissions обнаружены два дефекта: native
Back/Forward возвращает cached q/queue и старое await-state; выбранный чат
переполняет 320px (body360px при awaiting_student). Три разрешённых ordinary
await-перехода завершены возвратом к none, сообщений/файлов не отправляли.

В этой же партии: q/queue/attach читать из текущего URL, менять URL только
действием пользователя/подтверждённым сохранением attachment в черновик.
При восстановлении истории перечитать список и выбранную переписку обычными
авторизованными actions; composer не пересоздавать из-за изменения фильтра.
Сохранить immediate sequence invalidation и debounce поиска. Разрешить сжатие
flex-контейнеров/textarea; мобильный header распределить на две строки, сохранив
имя, статус и доступ к меню. Не скрывать overflow глобально.

SQL234 и apply receipt остаются неизменными. Сохранить текущую staff-сессию;
новый source/runtime binding требует независимого delta-review. Один общий
confirmation pass desktop/390/320, только чтение и local draft actions: новых
await-записей/сообщений не делать. Исходные фактические доказательства не менять.
