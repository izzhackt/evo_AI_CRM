# CRM-09d — календарная дата платежа

Основание: precode `550d546e`, 2026-09-21. Только offline source/pure regression.

`recordCasePaymentAction` передавал в DATE `occurred_on` первые десять символов UTC ISO. Для введённого времени Бишкека 00:00–05:59 это предыдущая дата. Новый `financeLocalDate` использует существующую полную валидацию `financeDateTime`, но возвращает календарную дату исходного ввода. Сам `financeDateTime` и timestamp-потребители не изменены. Права, суммы, валюта, requestId и RPC-параметры сохранены.

Проверки Node 22.23.1:

- `node --experimental-strip-types --test tests/sales-finance-entry.test.mjs`: 12/12 PASS. Покрыты 00:00, 05:59, 06:00, 23:59, границы месяца/года, високосный февраль; отдельно отклоняются неверные даты/время, неполные и расширенные форматы. Для валидных случаев также проверён прежний UTC timestamp.
- Scoped ESLint двух изменённых TS-файлов: PASS.
- `tsc --noEmit --incremental false`: BLOCKED единственным TS2307 в неизменённом `src/components/platform/brand/EvoLogo.tsx:2`: декларация PNG-импорта отсутствует в свежем worktree. После стандартного `node node_modules/next/dist/bin/next typegen` недостающие локальные Next declarations сгенерированы; повторный неизменённый `tsc --noEmit --incremental false`: PASS. Сервер не запускался, EvoLogo/tsconfig не изменены. Исходный failure сохранён здесь.
- `git diff --check`: PASS.

Dependencies reused only after exact package-lock SHA equality: `86fc8affba3bce2c732ea4e1c5b51b9f34601819b6ffab9eee6b950b7ec570e0`.

DB/Auth/Storage/provider/browser не вызывались. Это регрессия чистого parser, не приёмка сохранения платежа. Реальный UI/action/RPC путь проверяет root отдельно после окна KB32; production не проверен.
