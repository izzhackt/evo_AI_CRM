# CRM-09d — календарная дата платежа

Основание: precode `550d546e`, 2026-09-21. Исправление даты и ограниченная локальная проверка CRM → Student выполнены; production не обновлялся.

`recordCasePaymentAction` передавал в DATE `occurred_on` первые десять символов UTC ISO. Для введённого времени Бишкека 00:00–05:59 это предыдущая дата. Новый `financeLocalDate` использует существующую полную валидацию `financeDateTime`, но возвращает календарную дату исходного ввода. Сам `financeDateTime` и timestamp-потребители не изменены. Права, суммы, валюта, requestId и RPC-параметры сохранены.

Проверки Node 22.23.1:

- `node --experimental-strip-types --test tests/sales-finance-entry.test.mjs`: 12/12 PASS. Покрыты 00:00, 05:59, 06:00, 23:59, границы месяца/года, високосный февраль; отдельно отклоняются неверные даты/время, неполные и расширенные форматы. Для валидных случаев также проверён прежний UTC timestamp.
- Scoped ESLint двух изменённых TS-файлов: PASS.
- `tsc --noEmit --incremental false`: BLOCKED единственным TS2307 в неизменённом `src/components/platform/brand/EvoLogo.tsx:2`: декларация PNG-импорта отсутствует в свежем worktree. После стандартного `node node_modules/next/dist/bin/next typegen` недостающие локальные Next declarations сгенерированы; повторный неизменённый `tsc --noEmit --incremental false`: PASS. Сервер не запускался, EvoLogo/tsconfig не изменены. Исходный failure сохранён здесь.
- `git diff --check`: PASS.

Dependencies reused only after exact package-lock SHA equality: `86fc8affba3bce2c732ea4e1c5b51b9f34601819b6ffab9eee6b950b7ec570e0`.

Эти проверки выполнены первоначально на source `72d43646aa730e94ee2d4725016920b2ec0f9dd9` без DB/Auth/Storage/provider/browser. Они остаются регрессией parser; следующая отдельная проверка использовала настоящий локальный UI/action/RPC путь.

## Фактическая локальная проверка CRM → Student

После освобождения KB32 проверен frozen source `2c0755c1dcb17e5c6eb62c6a36c9cc04fc9d174e`, включающий main `d02d15b7` (#985). Два финансовых runtime-файла побайтно равны независимо reviewed `72d43646`; схема остаётся 001–225. Использованы существующие Local Admin и QA B209 Student 1, без новых identities, ролей или изменения условий дела. Разрешённая fictional local QA не означает реальные деньги или клиентскую приёмку.

1. Обычный Admin UI сохранил один помеченный транш `LOCAL CRM-09d QA — date and Student balance`: 1,00 KGS (100 minor), без срока. После фактического readback создана одна оплата 0,50 KGS через «Добавить оплату»; чек не загружался.
2. Настоящее hidden `at` формы — `2026-09-21T09:40`; request ID и время не подменялись. У формы нет видимого редактора note: её пустое hidden значение сохранено, вместо предположенного планом комментария QA-маркер остаётся в названии транша. Объём записи и суммы не изменены.
3. Сохранённый event имеет `occurred_at = 2026-09-20T18:00:00Z`, то есть 21 сентября 00:00 в Бишкеке — ожидаемую SQL-проекцию местного DATE. CRM показывает 21.09.2026 и 0,50 KGS; история дела показывает «Платёж записан» с переходом в оплату.
4. После обычного Admin logout и входа тем же Student кабинет `/portal/payments` показывает уникальный QA-транш: начислено 1,00 KGS, оплачено 0,50, осталось 0,50, «оплачено частично». При отсутствии срока просрочка не заявлена. Student DTO не содержит дату payment event: дату подтверждают CRM и event, кабинет — суммы и собственный доступ.

Результат: +1 obligation, +1 payment event, +1 evidence и +2 audit. Обновлён только новый obligation (`total_paid_minor` 0 → 50 и timestamp). Все прежние 194 audit сохранены; остальные 278 из 282 таблиц, схема, Storage и Auth users/identities 8/8 неизменны. Финальный бизнес-снимок совпадает с after-payment. Auth sessions учитываются отдельно: обычный выход завершил прежнюю Admin-сессию, новая Student-сессия также завершена; blanket Auth-row equality не заявляется. QA-строки сохранены, refund/archive/delete для очистки не выполнялись. Свой Next на 33238 остановлен, вкладка закрыта; окно передано B226.

Actual UI был выполнен в 09:40, поэтому это не фактическое воспроизведение ночной границы. 00:00–05:59 и переход месяца/года покрыты указанными выше pure tests. Refunds, загрузка чека, native UI, production и весь пункт 12 этим ограниченным проходом не закрываются. Новых изменений дизайна здесь нет.

Приватные доказательства (не содержимое для Git): `/private/tmp/evo-crm09d-payment-20260921`, сохранённые DOM/screenshots и exact intents, before/after/final snapshots. Final SHA256 `a2df3c2f0d1d5f6920ccfc5f8c4e37ee6bc5df7517981e3dc872041855f09c96`; independent effects/UI review `a0747bd3aabac708e55f06161e843ccd5ccd47737ca4c886c74ad1bad0f93d6f` — APPROVED; effect checksum `b98a7679e7113443d03131c482fb055408dac49ac1e4ff371d84a053c9a68a86`; release receipt `cce0f2730144ad85ec8a68ff7c3d1cbe90dde76257e3a699c6fdea202ccda644`.

Ошибки вспомогательной подготовки сохранены: начальный Python SQL-string syntax error до исполнения; initial readiness сравнивал BIGINT JSON с числом, хотя текущий RPC возвращает TEXT — после исправления проверки на точные строки `"100"`/`"0"` readiness PASS. Это ошибки QA-helper, не дефекты продукта. Две попытки найти HTML summary по роли button не дали совпадений; последующая навигация использовала фактический DOM, повторных бизнес-submit не было.
