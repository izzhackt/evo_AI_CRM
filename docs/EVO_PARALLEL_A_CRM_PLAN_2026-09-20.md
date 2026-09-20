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

A-1 принят в main через #938 (`7b0cfc7e`) после независимого exact-head review
и GitHub CI. Локальные результаты и ограничения — в
[квитанции](qa/lead-agent-dependency-ci-2026-09-20.md).

Следом принят #847 (`d2452b68`): AnyIO 4.14.2, locked install, pip check и
настоящий изолированный HTTP smoke прошли локально и в новой обязательной
CI-проверке; независимое review одобрено. GitHub отметил alerts 15/16/17
как `fixed` 20.09.2026 в 16:40:17Z. Это обновление исходников, не сервера.

Пункт 3 / #905 принят в main (`b38c6f16`): три изменённых тестовых файла
прошли 50/50 проверок на HEAD `6d4c0210`, scoped ESLint, CI и независимое
review одобрены. Это unit/source/harness-проверки; полного Node suite и
живого бизнес-пути в этом срезе не запускали. Старые 2179 не новое доказательство.

## Очередь независимых срезов

| Пункты | Срез и приёмка | Зависимость / граница |
|---|---|---|
| 3 | #905 MERGED; три тестовых файла сверены, 50/50 scoped checks | Старый отчёт 2179 не новый прогон; business acceptance не заявляется |
| 1 | #935 MERGED `f5198c37`: Sales Manager, seller и месяц по sale date; reviewed local acceptance сохранена | Managed SQL/release не выполнены; локальная квитанция относится к 001–208 |
| 6, 10 | CRM-01 MERGED #943 `1795bf23`: текущая воронка, actual local001–210 RPC/UI. 212/CRM-05: PR #945, source review и actual local RPC/UI пройдены, final delta review/CI/merge pending | Canonical funnel и terminal board — разные группировки; case presence не равен handoff |
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

## Уточнённая очередь после #943

Сначала212/CRM-05 (контракт выше в общих launch/decisions), затем пункт30:
проверить и устранить перезапись уже сохранённых соседних блоков условий продажи.
Root подтвердил на main1795bf23: LeadCardFieldsForm обновляет revision, но hidden
sibling values остаются из старого SSR; action отправляет все26 полей, SQL181
заменяет fields целиком. #852 сохраняет несохранённые sibling drafts, но не
доказывает защиту от этого overwrite. Следующий срез требует отдельного контракта
server-authoritative partial update/replay до кода и отдельно разрешённого
existing QA write-пути. CRM-02b следует за сохранностью данных, не перед ней.

Для дальнейших пунктов: #687 уже не включает повторное удаление portal-v1
(оно сделано152); остаётся Admin deadline/priority reason exception с сохранением
11-arg API/coverage locks. #42 — только formatting legacy Inbox. В29 проверить
legacy CN/MY schema137 против четырёх новых snake_case partner fields184, не
ослабляя общий validator. #777/#693 не закрывать по одному техническому deployment:
исторические owner-acceptance исключения остаются. Это выравнивание очереди,
не реализация перечисленных срезов и не разрешение на managed/prod mutations.

### CRM-05 / 212 — локальные доказательства, PR #945

Runtime55581820 независимо одобрен дважды; после интеграции944 UI проверен
на91e30f51. Полная квитанция: `docs/qa/crm-05-operational-handoff-2026-09-20.md`.
Это подготовленный к финальному review срез, не production release. Следующий
пункт30 остаётся первым после merge212. Миграция213 зарезервирована root для A;
B3b получил214, main/local порядок212→213→214.

Отдельная находка для будущего блока фильтров: «Сбросить всё» снимает owner из
URL и результата, но uncontrolled select продолжает показывать старый option
до reload (`pipeline/page.tsx:193`). Не исправлялось в212 и не скрывается общим
утверждением «все фильтры готовы».
