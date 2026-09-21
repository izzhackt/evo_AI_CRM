# A15 command feedback — source check, 22.09.2026

База eec9c548 (#1020); принятый [план](../EVO_TEAM_CHAT_COMMAND_FEEDBACK_PLAN_2026-09-22.md)
записан до кода в a4b59a62. Corrected approved precode1b5bcf4d, independent
reviewa67c4d25: повтор может создать первое сообщение, но не его дубликат.

## Изменение

Новая typed таблица выбирает сообщение по post/edit/delete/moderate и каждому
TeamChatFailure. Composer и форма удаления поменяли только импорт и выражение
текста внутри прежнего role=alert. Unknown post/edit/delete называют действие;
удаление допускает уже состоявшийся результат и предлагает тот же запрос.
Удаление/модерация больше не предлагают исправлять текст/упоминания и не обещают
сохранённый черновик. Причина модерации соответствует существующему лимиту3–500.
Unavailable не выдаётся ни за успех, ни за подтверждённую отмену.

Общая TEAM_CHAT_FAILURE_COPY сохранена: её использует server page вне command
scope. Существующие сообщения Composer для остальных failure states остаются
основой, post conflict уточняет тот же конфликт request binding. Storage warning
не менялся. Typed exhaustive table не добавляет state/network/storage логику.

## Source verification

На Node22.23.1 выполнен npm ci --ignore-scripts; targeted ESLint трёх файлов
завершился0. Первый tsc в новом worktree остановился TS2307 на PNG EvoLogo из-за
ещё не сгенерированных Next declarations. Штатный next typegen сгенерировал
игнорируемые типы; следующий tsc --noEmit --incremental false завершился0.
Это подготовка нового worktree, а не исправление продукта или подавление ошибки.
Git diff --check чист. Проверки отражены как наблюдавшиеся tool exits, без
заявления о сохранённом raw subprocess log.

43-file parity против eec9c548:
`b1598006f84e90d34686bf194b8cd5ecf1d6c03b8d9c0b4adcf99f1836ceb1e8`
(`/private/tmp/evo-a15-command-feedback-source-20260922/source-parity.json`).
После удаления только нового импорта/замены copy selector два компонента
побайтно равны исходным. Handler/action/requestId/expectedVersion/frozen input,
reason lock, saved/forbidden, retry, storage и вся остальная разметка сохранены.
Другие chat source/tests/SQL, package/lock, globals CSS и AppShell точные.
Новый presenter SHA256:
`456edb59b41cba25794b75843d2e6d3d4533ce85b273085997a15c0de4a6a8ff`.

Source-check receipt SHA256 `084d08afd332cb242e09878827980900053456e7c6a6a06a06c7e82189bdf290`
(`/private/tmp/evo-a15-command-feedback-source-20260922/source-checks.json`).

Не добавлены тесты, повторяющие строки таблицы. Нового поведенческого алгоритма
нет; прежние тесты не запускались и здесь не заявляются новым evidence.
Из source перечитаны command validation/moderation limit и idempotency receipt
в migrations171/227, без SQL execution. Independent exact-head source review
и protected short CI — следующие шаги.

## Границы

Новый UI/error path ещё не выполнялся. Shared QA принадлежит B1018 → ROOT16;
Auth/SQL/browser/server/production не запускались. Один отдельный offline
negative submit существующей delete/moderate формы остаётся будущей проверкой
по accepted плану, после ROOT admission; online retry/delete не разрешены.
Это source-ready стадия, не merge-ready, не positive command acceptance,
не whole item15 и не issue708 real-staff acceptance. Timestamp slice остаётся
следующим отдельным блоком после feedback merge.
