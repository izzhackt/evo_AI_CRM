# Item7a — атомарное чтение прав управления и месячного плана

Принятый пункт7 / CRM-02f. 21 сентября2026; current main
`ce0ef573ed3e4765b78bf580c5302b7454c75ef0` после #1001. Его дерево идентично
независимо проверенному56419d15, на котором подготовлен этот дизайн.
ROOT резервирует forward-миграцию235; A владеет234 и общей QA-средой.
Порядок локальной проверки: A234 → B1003 → ROOT235. Сейчас только исходники.

Независимый precode review APPROVED: `/private/tmp/evo-sales-management-precode-review-20260921.md`,
SHA256 `ed9a5f93f69e0bd5899c5c6a3feb3f3a9bc19b0eb72aa9328fc0def1fe081862`.
Выбранная рамка — существующие EVO controls/типографика, честное различение
отказа, ошибки и отсутствия плана, сохранение пользовательского черновика.
Нового решения владельца не требуется: выполняется уже принятый функциональный
план `docs/EVO_CRM_UX_AND_ADMISSIONS_PLAN_2026-09-20.md`, разделCRM-02.

## Граница и причина

Исправить подтверждённую неоднозначность: `SalesRegisterView.tsx:47,168–174` связывает target с финансовым правом, а актуальный `216_platform_sales_register_search.sql:63–68` возвращает targets только по `sales.register.target.manage + organization`; withheld `[]` становится «Не задан» (`View:83,171`). Import/target UI hints (`View:45–46`) также не доказывают scope. Cash reader уже проверяет собственное scoped право; его не менять.

7a не переносит импорт, не меняет v1/v2 workspace DTO, команды, финансовые права, реестр ролей, RLS, targets-таблицу или мобильную компоновку. 7b с переносом формы остаётся следующим отдельным блоком.

## Один новый read-only RPC

Сигнатура миграции235: `platform.read_sales_register_management_v1(p_organization_id UUID, p_report_month DATE DEFAULT NULL) RETURNS JSONB`; внутренний одноимённый `private` reader. Private reader — `LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''`, public wrapper — `LANGUAGE SQL STABLE SECURITY INVOKER SET search_path=''`. Это текущий паттерн `233_platform_sales_register_directions.sql:5–13,46–55`.

1. Сначала получить actor через **существующий** `platform_private.sales_register_actor(p_organization_id)` (`156_platform_scoped_staff_consumers.sql:762–776`), без literal Admin/Sales и без нового resolver. Он опирается на `platform.current_actor_authority()` (`155_platform_scoped_staff_roles.sql:358–369`): Auth user + JWT org/membership; активные staff membership/profile/org и исключение Student — `155:300–312`. Custom staff с `platform_role=NULL` остаётся допустимым. Не принимать actor/membership от клиента.
   **Дополнительный gate нового reader:** после actor требовать `platform_private.staff_has_permission(org,membership,'sales.register.read')`, иначе42501. Это перенос нынешнего UI/TS report-entry условия (`sales-register-source.ts:47`, `app/(v3)/v3/main/page.tsx:33–36`) в новый endpoint, а не утверждение, что такой global guard уже стоит в SQL216. В216:19,33–39,61 фактически actor-any + row scopes; target имеет отдельный org gate:63–68. Target-only/import-only principal может достигать старого SQL reader, но 7a не открывает ему новый UI или новый management endpoint. Старые v1/v2 не ограничивать и не менять. Не заменять этот gate на `sales.register.read + organization`: это неверный resource kind, здесь read проверяется как наличие canonical permission, а target/import — точные org pairs.
2. Затем проверить nullable month: если задан — конечная дата первого числа в `1900-01-01…2100-12-01`; иной допустимый PostgreSQL DATE → `22023`. Не использовать `STRICT`: SQL NULL здесь означает «месячный план не запрошен». Неверный org/actor сначала даёт `42501`, не данные/псевдопустой ответ.
3. Вычислить две пары через **существующий** `platform_private.staff_can_access(org,actor.membership_id,permission,'organization',org)` для `sales.register.target.manage` и `sales.register.import`. Authority chain — `155:794–798 → 772–783 → 746–770`; permission/scope должны принадлежать одной активной assignment, не объединяться из разных grants. Эти права custom-assignable org-only (`155:157–164`); не создавать grants или system-Admin shortcuts.
4. Только при `can_manage_target=true` и ненулевом month прочитать один department target: exact org/month, `manager_label IS NULL`. Уникальность гарантирует `134_platform_sales_register.sql:34–43`. Не брать manager-specific target, totals, число строк, источник импорта или другую историю. При отсутствии строки target=NULL; это единственный случай месячного «Не задан».
5. Всё вычисляется внутри одного STABLE RPC/snapshot; отдельный вызов permission hint, затем старый workspace.targets запрещён для вывода отсутствия. Никаких advisory/row locks для чтения. Snapshot не обещает право на будущую запись: существующие команды повторно проверяют authority под lock (`156:1681–1687`). PostgreSQL17 подтверждает одинаковый snapshot для SELECT внутри STABLE: https://www.postgresql.org/docs/17/xfunc-volatility.html . SECURITY DEFINER/ACL: https://www.postgresql.org/docs/17/sql-createfunction.html . Оба официальных источника прочитаны при подготовке.
6. В одной транзакции revoke default EXECUTE с обеих новых функций у PUBLIC/anon/authenticated/service_role/supabase_auth_admin и grant только authenticated для private-reader + invoker-wrapper, как существующий паттерн. Это две узкие новые EXECUTE, а не расширение существующих table/schema grants. Private функция тоже проверяет actor. FORCE RLS/закрытые таблицы `134:50–57` не менять; не добавлять browser direct SELECT.

### Exact wire DTO и состояния

Exact шесть ключей:
`{schema_version:1, organization_id:UUID, report_month:DATE|null, can_manage_target:boolean, can_import:boolean, target:Target|null}`.

`Target` имеет ровно существующие пять wire-полей `{id,version,report_month,manager_label,target_count}`: UUID; version — положительная десятичная строка BIGINT ≤ Number.MAX_SAFE_INTEGER; exact запрошенный месяц; manager_label строго null; count — integer 0…1000000. DTO нормализуется в существующий `SalesRegisterTarget`, не меняя старые workspace parsers. Проверить exact org/month echoes, неизвестные/отсутствующие keys, строгие bool, безопасную version. Если month=null или can_manage_target=false, target обязан быть null; иначе непустой target не допускается. `true + month + null` — разрешённое отсутствие, `true + null + null` — не запрашивали месяц. Отдельный manager-target decoder здесь не нужен.

Server result — discriminated `ready(data) | denied | unavailable`. SQL42501 → denied; сеть/5xx/неверный DTO/неожиданный SQL error → unavailable, без fallback к workspace или flat hint. Успешные false flags остаются ready, это отказ только соответствующей операции, а не ошибка. Preview → denied без RPC. Текущий report-entry TS gate также сохраняется. Новый reader в `src/lib/v3/sales-register-source.ts`; pure DTO/coordinator можно выделить в `src/lib/sales-register-management.ts`. Использовать текущий default POST `.rpc()`; null-month можно опустить из args, не отправлять literal GET "null". Объект query/request ID читателю не нужен.

## Когда читать и что показывать

| Контекст страницы | Вызов и поведение |
|---|---|
| Валидный обычный месячный отчёт | Один management-read с выбранным годом/месяцем; можно параллельно с workspace. Target summary и редактирование — только по can_manage_target, независимо от finance. Число0 показывать как0. |
| Весь год | Вызов с month отсутствующим/NULL только для прав, особенно can_import. Target summary/form отсутствуют. Не использовать текущий fallback `View:81` на сегодняшний месяц для этого RPC. |
| Архив | Аналогично rights-only month=NULL; target скрыт как сейчас, import сохраняет доступность по своему праву. |
| Невалидный report query | Новый RPC не вызывать; никаких target/import действий рядом с invalid report. Существующее сообщение ошибки отчёта сохраняется. |
| Просмотр записи / реально открытый editor | Новый RPC не вызывать. Guard совпадает с реально отображаемой веткой: `!viewingRecord && !(editing && canManage)` (`View:105–111`). Если edit запрещён и страница показывает отчёт, применить обычные правила отчёта. |
| Preview | Новый RPC не вызывать, управление скрыто. |
| Workspace failed, management ready | Не подменять ошибку отчёта успешным target summary; прежнее место summary внутри успешного workspace. Target form может сохраняться, но отправка блокируется также `!workspace`, как сейчас. |

Ready+false или denied скрывают соответствующие действия; unavailable — сообщение «Не удалось проверить права управления отчётом. Обновите страницу» без «Не задан», нуля или кнопки отправки. Cash/список/filters могут продолжать работать независимо от management-read. Target в выбранном месяце не зависит от q/manager/direction/archive-filtered sales counts.

## Сохранение target draft и readonly поведения

Критический риск: нельзя заменять gate на `canTarget = ready && allowed` с безусловным unmount при unavailable. Сейчас `SalesTargetForm` хранит `lastRead/base/count/reason` и pending/request state, а `readUnavailable=true` блокирует отправку и не заменяет draft (`SalesRegisterForms.tsx:280–303`).

Минимально: подтверждённый allowed рендерит форму; при unavailable сохранять тот же слот и `key={reportMonth}` для actor с прежней flat target hint, но **только disabled/unknown представление**. Hint никогда не разрешает отправку и не выдаёт null за отсутствие. Подтверждённый denied скрывает форму. Не key по DTO/version/status/requestId, не сбрасывать base/count/reason эффектом, не авто-загружать свежую версию. Props: target только из нового ready/read; `readUnavailable = !workspace || management.status !== 'ready'`; старый lastRead защищает transient failure. В состоянии unknown не показывать «Текущий план: не задан»; существующий guard уже это обеспечивает. При первой unavailable-загрузке отправка блокирована, отсутствие исходного target не считается доказанным пустым планом.

Сохраняются current-vs-base version comparison, явное «Загрузить актуальное значение вместо моего ввода», reason, stale/PT409, request identity и save action без изменений. После reload новой версии человек явно принимает базу; неизвестное право никогда не даёт create с version0. Confirmed revoke скрывает editor; последующая запись даже из устаревшей вкладки всё равно проверяется старой SQL-командой.

Import пока остаётся на нынешнем месте, но его enabled gate получает can_import из того же DTO. Для transient unavailable не терять выбранный File/request state: сохранять mounted form по аналогичному безопасному hint, Добавить минимальный optional `readUnavailable` presentation prop: блокировать file picker и submit, показать короткую ошибку и кнопку `router.refresh()`; либо эквивалентный disabled fieldset. Уже выбранный File, request ID и result state сохранять; не очищать input и не перемонтировать компонент. При unknown не отправлять клиентский dispatch. Confirmed denied скрывает форму. Не менять import action/JSON payload и не запускать его при render/refresh. Это маленькая адаптация существующей формы, не новый management framework.

## Минимальные проверки и реальные ограничения

- Pure contract tests проверяют смысл, а не строковый SQL/CSS: denied ≠ unavailable ≠ allowed-empty; zero count; nullable month; противоречивый DTO (target при denied/no-month), иной org/month, unsafe version/нечисловой count/unknown key. Coordinator: preview/invalid/skip contexts не вызывают RPC; 42501 отдельно от transport/malformed. Эти проверки не выдавать за Auth/RLS acceptance.
- Actual local reader после отдельного reviewed apply: существующие ordinary Admin/Sales, Student/anon, другой org, отсутствие report-read при наличии только target/import (если такой существующий actor имеется); target/import permissions только из реальных grants. Сравнить target с уже существующей записью и с реально пустым месяцем. Если нет actor с target-only/finance-only/import-only или заполненного target — честно указать отсутствующую ветку; роли/фикстуры не создавать ради матрицы. SQL callable surface/ACL, DTO через настоящий PostgREST, business/schema parity до/после.
- Actual UI: выбранный месяц, all-year, архив, invalid, preview/record/editor; проверка независимости target от фильтров; ordinary target draft → refresh без submit → поля и base сохранены. Transient failure/revoke не объявлять проверенными, если не был выполнен отдельный ограниченный реальный сценарий. Не менять target и не импортировать файл для проверки чтения. Не добавлять CSS-снимковые тесты.
- Использовать сохранённую 233 UI-proof только как incumbent: `ui-proof/final.json` имеет historical head `1b903e2391fc9ce70819f497d3ff774987733200`, не новый прогон на56419. Новая UI-проверка в согласованном окне; максимум2 batched visual rounds1440/390/320. Родитель уже подтвердил знакомую EVO компоновку; Impeccable Shape/Operate здесь уточняет честные states и сохранение draft, не редизайн и не повторный context.

Ожидаемый небольшой diff: новая миграция235, management contract+reader, точечный View gate и только необходимые disabled props существующих forms, meaningful pure tests, precode/QA docs. `platform-sales-register-actions.ts`, исторические миграции, v1/v2, finance reader и маршрутизация без изменений. Нового решения владельца не требуется.
