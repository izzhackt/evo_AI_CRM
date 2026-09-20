# Полоса A: CRM сотрудников и техническая основа

Дата: 20 сентября 2026. База: `3ac6f326c`. Исполнитель A работает отдельно от
полосы B; общий main, миграции и release координирует root. Это план выполнения,
не утверждение готовности. Пункты 37–50 не запускаются.

## Первый срез A-1 — пункты 4 и 34

PR #847 меняет AnyIO lockfile; текущий classifier считает его unknown и блокирует
Fast checks. Добавить узкую классификацию только `evo-lead-agent/pyproject.toml`
и `evo-lead-agent/uv.lock`, самостоятельную locked-install проверку и реальный
локальный HTTP smoke приложения на Python 3.13. Проверять health, request-id,
ошибку неизвестного route и frozen webhook через HTTPX/AnyIO/Uvicorn/FastAPI.
Worker выключен, dotenv запрещён, SQLite временная, starter knowledge выключена;
никаких provider calls или клиентских записей. Не открывать весь Python source
как автоматически проверенный scope. Unknown/mixed/rename остаются fail-closed.
Изменение CI отдельно от dependency PR; #847 проверяется дополнительно на своём
lockfile. Без merge/deploy до координации и независимого exact-head review.

Официальный контракт uv: `sync --locked` отклоняет устаревший lockfile вместо
перезаписи; https://docs.astral.sh/uv/concepts/projects/sync/ (проверено 20.09).

Код A-1 и локальные проверки подготовлены; точные результаты и ограничения —
в [квитанции](qa/lead-agent-dependency-ci-2026-09-20.md). GitHub CI, независимое
exact-head review и координируемый merge остаются отдельными шагами.

## Очередь независимых срезов

| Пункты | Срез и приёмка | Зависимость / граница |
|---|---|---|
| 3 | #905: сверить три теста с текущим runtime, выполнить изменённые проверки | Старый отчёт 2179 не считать новым прогоном |
| 1 | #935: актуализировать SalesManager, seller и месяц по sale date | Root координирует conflict и migration 208; shared QA ещё не разрешена |
| 6, 10 | Текущая воронка и мобильное управление | Реальная staff UI, сохранение stage/ownership |
| 7 | Продажи: server search/filter, валюты, readonly detail и back | Не суммировать разные валюты; права и реальный UI |
| 8 | Заявки: фильтр до limit, pagination и полный «Все» | Проверка server query и списка |
| 9, 11 | Inbox и Student messages: честные состояния, очереди, поиск без гонки | Не отправлять сообщения; прочитать реальные разрешённые данные |
| 12, 30 | Договор, сумма, транши, платежи/чеки/остаток; save отдельных блоков | Согласовать profile-source/Profile и общие actions с B |
| 14 | Staff-каталог: поиск, фильтры, дедлайны, управление | Program IDs/schema принадлежат B |
| 15 | Team chat: хронология, цитаты, поиск, composer, unread | История/read model до UI; не отправлять сообщения |
| 16 | Личный календарь: назначенные мне задачи, явный case | Server scope до композиции |
| 22 | CRM shell, типографика, навигация | Impeccable вместе с функциональной проверкой; EVO сохраняется |
| 29 | Legacy China/Malaysia optional fields | Проверить валидатор на текущем контракте, сохранить данные |
| 33 | #687: причина изменения срока/приоритета Admin | Аудит/права обязательны, schema через root |
| 35 | #42: форматирование Inbox | Только заданный legacy scope; без revival/deploy |
| 5, 36 | Актуальные docs и подготовка доставки merged исправлений | Exact main/image/smoke/rollback; production release отдельно |

Каждый срез: живой source → минимальный diff → точечная реальная проверка →
отдельный PR → независимое exact-head review. Не запускать общий финальный E2E,
контентную волну или App Store. Сохранять историю, tenant/Student boundaries,
пользовательский checkout и работу B. Миграции только после выделения номера root.
