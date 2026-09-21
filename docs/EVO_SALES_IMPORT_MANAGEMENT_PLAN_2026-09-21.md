# 7b — перенос существующего импорта: implementation design

Precode contract, 21 сентября 2026. Base main d68ce58711b413f8366c80615456cfbbf22a0772 после принятого #1004/235. Продуктовые файлы этого плана совпадают с исходной оценкой4d4a9820. Реализация следует этому коммиту плана. Прочитаны Impeccable Operate/Shape; context4.3.1 не повторялся. Scope уже подтверждён: редкое обслуживание убрать из ежедневного отчёта, EVO/Golos/обычные ссылки сохранить. Ни нового импорта, ни новой миграции.

## Доказанный доступ

- `src/app/(v3)/v3/main/page.tsx:30–36`: requireV3PageActor, затем report-entry `sales.report.read`; preview использует presentation-read. Import-mode проходит этот же gate, а внутри дополнительно235reader отклоняет preview и требует canonical sales.register.read (`src/lib/v3/sales-register-source.ts:11–20`). Settings не становится альтернативным authority path.
-235 возвращает canImport из существующего sales.register.import + organization/org scope. Вызывать с month=NULL; разрешает вход только ready+canImport. Не использовать systemRole/flat hint для включения формы.
- `/v3/settings` ограничен admin.preview (`platform-access.ts:66`); SettingsPart вычисляет обычный isAdmin (`settings/page.tsx:44–45`). `settings/Settings.tsx:74` фильтрует разделы, :139 рендерит PlatformSection. Нельзя поместить единственный путь сюда: custom staff с report-read+scoped import должен сохранить вход из отчёта.

## Минимальная маршрутизация

Добавить `mode?: string` в SalesReportQuery, один точный режим `/v3/main?view=sales&mode=import`. MainPart после существующего report gate и ДО SalesRegisterView направляет этот режим в маленький server `SalesRegisterImportView` (новый файл в components/v3). Unknown mode продолжает существующий отчёт; не трактовать его как import.

Конфликтные record/new/edit/saved вместе с mode=import не исполняют импортный режим: вернуть существующую record/editor/report ветку без mode. Дать record/editor precedence, не создавать иной выбор прав редактирования. Обычный import-link никогда не переносит эти четыре ключа. Это правило не требует дополнительного write-access RPC для import-view.

Import-view делает только235management-read(NULL); не читает workspace/v2, directions, cash, intake или write access. Отдельная ветка исключает скрытые expensive reads и двойной mount. Даты/параметры нужны лишь для безопасного возврата.

Небольшой pure helper оправдан только для общего report-context parsing/building: существующая проверка в `SalesRegisterView.tsx:27–39` и сериализация :76–88 нужны в двух views. Перенести эти выражения без изменения текущей нормализации в `src/lib/sales-register-navigation.ts`; принимать текущий period явно (ORG_TIMEZONE), без нового generic router. Возвращать valid и own report/import href. Существующие правила year1900–2100, month1–12/all, offset0–1000000, q parser, manager<=300, direction parser, review enum сохраняются. Array/nonstring query values отклонять до string operations.

Back URL строится только через URLSearchParams на константе `/v3/main`, `view=sales` и allowlist year/month/offset/q/manager/direction/review/archived. Никакого returnTo/url/host из входа. Сохранять значения фильтров в рамках действующей нормализации отчёта, выбранный период и offset; не выполнять обычный reset при переходе. mode/record/new/edit/saved исключены. Settings link без периода получает текущий Bishkek month/year один раз, затем явный Back.

При invalid report context import RPC/form не создавать. Показать короткую ошибку и собственную ссылку в отчёт для исправления с allowlisted string values (без mode); не выдавать молча исправленный фильтр за исходный. Можно отдельно предложить существующий базовый отчёт с текущим периодом. Нет внешнего redirect.

## UI и состояние

- В отчёте удалить только mount SalesRegisterImport и заменить его тихой ссылкой «Перенос данных» по ready.canImport; target details остаётся. Unknown показывает существующее сообщение недоступности, не активную import-ссылку. Denied скрывает вход.
- Import-view: тот же main max-width/spacing, h1 «Перенос данных отчёта», ссылка «Вернуться к отчёту», один прежний SalesRegisterImport. Без dashboard card-stack, нового modal, autosubmit или introductory tutorial. Existing form copy/limits/actions остаются byte-identical относительно235.
- Ready+true монтирует существующую форму с readUnavailable=false. Unavailable при прежнем flat import hint сохраняет тот же стабильный слот disabled (readUnavailable=true), сообщение и существующий refresh; hint не включает dispatch. Не key по rights/status/requestId/DTO; randomUUID начального request не пересоздаёт useActionState на refresh. Confirmed denied скрывает форму и показывает отсутствие доступа со ссылкой назад. Недоступность без hint всё равно получает явное сообщение; не притворяться denied.
- File/request/result остаются в текущем компоненте при router.refresh. Полная навигация назад/новый document remount не обещает сохранение выбранного файла: никакого localStorage/File persistence. Ни один скрытый второй mount не допустим. Существующий form уже блокирует dispatch при readUnavailable.

Settings: добавить маленький server-derived `salesImportHref?: string` prop через Settings → PlatformSection (`sections.tsx:403`). Только когда section=platform и обычный isAdmin выполнить тот же235reader(NULL); при ready.canImport показать «Перенос данных отчёта продаж». При unavailable можно дать компактное недоступное состояние, но не включать ссылку через Admin shortcut. Custom staff пользуется report link; не менять settings guards/sections. PlatformSection строку «Настройки — только для чтения» уточнить локально, если она начинает описывать весь раздел с новым действием; не пересматривать соседние settings.

## Границы и проверки

Owned будущие файлы: main/page, SalesRegisterView query/link, новый ImportView, небольшой navigation helper при указанном переносе, settings/page → Settings → sections prop; точечные pure tests. Не менять SalesRegisterForms.tsx, platform-sales-register-actions.ts,235SQL/reader/DTO, finance, existing v1/v2. Формат2…900000 bytes,250 sales/120 targets, SHA/request/replay/strict receipt/без overwrite сохраняется (`platform-sales-register-actions.ts:200–239`).

Проверки: pure URL/precedence/invalid-array/own-path/period-offset preservation; scoped lint/typecheck; source parity неизменных forms/actions. Actual local QA — существующий обычный Admin и доступный custom staff, если такой actor реально есть: Settings/report → import → Back, preview/denied/unavailable доступными реальными путями, refresh с выбранным существующим разрешённым файлом без submit и проверка сохранения File/request, один mount. Если подходящего файла/actor нет — explicit gap, не создавать фикстуру. Никакого import submit, receipt/audit или target write ради перемещения. Actual business/Storage unchanged, own Auth sessions учесть; desktop390/320/keyboard, максимум два visual batches. Старые233 captures — только incumbent. Нет нового permission question или runtime authority в этом плане.

## Actual local follow-up, 2026-09-21

The unchanged placement implementation was exercised on clean3035e912 with ordinary
Admin/custom staff Auth and1440/390/320 captures. Report/Settings entries, scoped
denial, safe Back and explicit record/editor precedence were confirmed. No import
was submitted. Strict final effect reconciliation passed after both own logouts.
See [actual acceptance](qa/crm-sales-import-placement-actual-2026-09-21.md) for preserved driver STOPs, the finite functional continuation and limits.
Final docs-head review/CI/merge remain; no production acceptance is implied.
