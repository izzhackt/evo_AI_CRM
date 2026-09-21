# A15g-1 — ошибки чтения и точный повтор командного чата

Статус: precode, 21 сентября2026. Основание: принятый ROOT минимальный остаток
пункта15 после A15f/#992 и завершённого A11/#1002. Входящий main
`479dd6788b87fc14d4d9e3e809c16e9efff1badd`; исходники повторно прочитаны на нём.
Сохранённый [A15f actual](qa/crm-team-chat-unified-feed-actual-2026-09-21.md)
не является свежим выполнением этой партии.

## Подтверждённая проблема

`TeamChat.tsx` объединяет ошибки поиска, истории, context и background changes
в один `error`, используя write-copy `TEAM_CHAT_FAILURE_COPY`. Поэтому ошибка
чтения обещает сохранённый черновик/повтор отправки. «Обновить историю» вызывает
changes, а не упавший search; успешный background refresh очищает чужую ошибку.
`readPage` сообщает не-terminal ошибку до проверки foreground epoch, поэтому
запоздалый ответ прежнего context может испортить новый экран.

## Результат для сотрудника — Impeccable shape / Operate

Сотрудник видит, какое чтение не получилось, и повторяет именно его. Текст
поиска, уже прочитанные сообщения, результаты, anchor и черновик сохраняются
при временном сбое. Чтение не обещает отправку сообщения. Используем нынешние
EVO/Golos, inline alert и существующие кнопки/токены без новой визуальной темы.
Новые модальные окна, группировка сообщений, плотность и превью каналов сюда
не входят. Ошибка соединения имеет собственное действие «Подключить снова».

## Контракт

1. Ошибка хранит origin операции и неизменяемые аргументы попытки: search term,
   search cursor/append, timeline query для navigation/pagination, либо changes
   cursor background-refresh. Новый явный submit создаёт новую попытку; retry
   не берёт новое значение из input. Для «Ещё результаты» предыдущая страница
   остаётся, повтор добавляет страницу исходного term/cursor. Для navigation
   сохраняется семантика returnPoint, для pagination — направление/cursor.
2. Foreground и background read failures имеют раздельную принадлежность.
   Background success не очищает foreground failure. Успех очищает только
   соответствующую попытку. Новый foreground запрос, back или закрытие поиска
   отменяют прежний foreground retry. Поздний non-terminal результат прежней
   эпохи не меняет данные/ошибку нового context.
3. `forbidden` остаётся terminal для actor/channel instance: немедленно очистить
   feed/channels/participants/search и запретить позднее возвращение данных.
   Даже запоздалый forbidden старой попытки обрабатывается до epoch rejection.
   Actor/org/channel/Student/preview/server authorization не изменяются.
4. `unavailable`/допустимый временный conflict предлагают точный повтор.
   `not_found` не предлагает повтор отсутствующего сообщения; `invalid`
   предлагает исправить запрос/выбор. Формулировки называют чтение/поиск,
   а не запись. Не скрывать загруженный контент при временном сбое.
5. Recovery чтения для восстановления правки сохраняет имеющийся composer
   handshake: повтор через его существующее действие восстановления, без
   самостоятельного выбора нового draft/target через общий retry. Его read
   ошибка может объяснить этот путь; write-copy/uncertain protocol не меняются.
6. Composer/DeleteConfirmation сохраняют собственные action states и передают
   наверх только forbidden. Frozen requestId/payload, stored drafts, write
   actions, Realtime subscriptions, seen acknowledgement и их retry не менять.
   Background failure может повторить прежнюю changes-попытку; watermark
   продвигается только после успешного исходного чтения и hydration.

## Владение и размер

A владеет `src/components/v3/team-chat/TeamChat.tsx`, новым небольшим client-safe
helper `src/lib/team-chat-read-errors.ts` и его поведенческими tests. Использовать
существующий CSS без редизайна; не менять Composer, DeleteConfirmation, RPC/SQL,
DTO, server actions, permissions, package/lock. Нет новой миграции или fixture.
Текущие fronts flat-UI/remainder/ledger обновлять только для фактически закрытой
части. Пункт15/весь1–36/issue708 не объявлять завершёнными.

## Проверка

- Поведенческие проверки используемого helper: frozen search/cursor/append,
  разные владельцы ошибок, stale non-terminal failure/success, close/new query,
  terminal late forbidden и отсутствие retry для missing/invalid.
- Scoped typecheck/lint и затронутые feed/search/draft/seen проверки; без полного
  product suite. Изменённый runtime source требует независимого exact-head review.
- Actual QA после B1003 → ROOT235 и нового ROOT handoff: существующий ordinary
  staff/channel, реальный offline search, online exact retry, неизменность
  результатов/draft/anchor, failure/history/context и отказ доступа в доступном
  реальном состоянии. Никаких posts/edits/deletes/new actors. Если чтение UI
  создаёт обычные seen receipts, это отдельный явно ограниченный effect budget;
  local runtime нельзя объявлять «без записей» только из-за отсутствия posts.
- Один batched desktop/mobile pass, одна партия исправлений и максимум один
  confirmation batch. Нет canned responses/подмены успеха. Недоступные реальные
  состояния отмечать как непроверенные. Production не относится к этой партии.

До кода требуется независимое precode review этого контракта. Пока исходники
не изменены, общий runtime/DB/Auth/browser не используются.
