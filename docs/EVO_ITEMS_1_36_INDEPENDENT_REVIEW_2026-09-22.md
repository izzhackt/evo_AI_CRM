# EVO 1–36 — независимое ревью 22 сентября 2026

## Ревизия и границы

Проверяемый main: `6515e695bf19940fe723cab7b026c2e191a24b6f`.
Отдельная ветка `izzhackt/evo-independent-review-1-36-20260922`;
канонический dirty checkout не менялся. ROOT, A и B подтвердили владение
работами и общей QA. A завершил свои PR; B сохраняет открытые [#1026](https://github.com/izzhackt/evo_AI_CRM/pull/1026)/[#980](https://github.com/izzhackt/evo_AI_CRM/pull/980).
ROOT остаётся координатором merge, миграций и release.

Основание: [ведомость 1–36](EVO_ITEMS_1_36_STATUS_2026-09-21.md),
[функциональный план](EVO_CRM_UX_AND_ADMISSIONS_PLAN_2026-09-20.md),
[исполнение](EVO_CRM_UX_AND_ADMISSIONS_EXECUTION_2026-09-20.md),
[UX-план](EVO_UX_REFINEMENT_PLAN_2026-09-20.md),
[KB-исполнение](EVO_CRM_KNOWLEDGE_BASE_EXECUTION_2026-09-20.md),
[launch](EVO_LAUNCH_PLAN.md) и [решения](PLAN_CHANGES.md).
Исходный локальный план сопоставлен с принятой редакцией; более поздние решения
о немедленной подготовке и шести странах сохранены.

Это независимый разбор требований, активных путей кода, GitHub и квитанций.
Он не является новым полным E2E или доказательством всех состояний продукта.
Старые проверки ниже имеют свои ревизии и ограничения. Если путь после квитанции
менялся, старая проверка не переносится автоматически на весь нынешний экран.

## Результат и незавершённые работы

В просмотренных путях новый подтверждённый дефект вне уже открытых исправлений не установлен.
Недоступный сценарий или отсутствующая запись в QA не объявляются дефектом.
Известное глобальное завершение iPhone-сессий исправляется в [#1026](https://github.com/izzhackt/evo_AI_CRM/pull/1026); дублировать
его отдельным PR не требуется. Подтверждение email остаётся интеграцией [#980](https://github.com/izzhackt/evo_AI_CRM/pull/980).
Ни один из этих draft PR не считается частью main или production.

- [#1026](https://github.com/izzhackt/evo_AI_CRM/pull/1026): `af28b0cec70678f9d12b0a542568968e61f61fb3`, CI35708579134 успешен;
  обычный native login → local logout → relaunch с сохранением другого сеанса
  ещё не выполнен. Ошибка `try?` в SessionRouter остаётся пределом UI-сигнала:
  экран выхода сам по себе не доказывает серверный logout.
- [#980](https://github.com/izzhackt/evo_AI_CRM/pull/980): `cc57c61084b8821262d86030df3c42cd654770d9`, CI35708360791 успешен;
  native confirmation/resend/browser-return/login и реальная почта не приняты.
  Activation packet INERT; live OTP8 и local6 не смешиваются.
- Последнее переданное ROOT production-доказательство — app `8f9391dd`,
  schema239, release35705693269, accepted/healthy, pending absent, armfalse,
  08:44 UTC. В этом ревью production повторно не выпускался и не проверялся.
- KB159 остаётся pending: нового ответа владельца нет.141 применён по решению,
  144 KEEP,145 следующий рабочий день без новой 24-часовой SLA.
- Пункт32 ограничен двумя согласованными текстами/TXT. Их серверные байты
  доставлены; `ERR_BLOCKED_BY_CLIENT` не превращается в browser acceptance.

## Проверка 36 пунктов

«Реализовано» ниже означает наличие активного пути в main и указанной истории
приёмки, а не исполнение каждой комбинации данных. «Охват» отмечает оставшиеся
проверки существующей реализации; «интеграция» — открытый PR; «зависимость» —
недостающий доступ, внешний сервис или решение.

| № | Требование и проверенный код | Вывод, PR и реальные доказательства |
|---|---|---|
| 1 | Продавец/дата/месяц: `platform-sales-register-actions.ts`, SQL208/215 | Реализовано [#935](https://github.com/izzhackt/evo_AI_CRM/pull/935)/[#960](https://github.com/izzhackt/evo_AI_CRM/pull/960): продавец из owner лида, месяц из signing date, серверные права. Локальная приёмка в исходных квитанциях; новую продажу этот audit не создаёт. |
| 2 | Новизна каталога: `recent-universities-source.ts`, SQL207 | Реализовано [#929](https://github.com/izzhackt/evo_AI_CRM/pull/929): минимум даты опубликованных неизменяемых ревизий, окно30 дней; не дата последней правки. Student readback исторический. |
| 3 | Три устаревших теста | [#905](https://github.com/izzhackt/evo_AI_CRM/pull/905) merged. Исторические50 проверок относятся к тому срезу; один файл позже менялся, результат не переименован в новый прогон. |
| 4 | AnyIO/CI: `evo-lead-agent/uv.lock`, `smoke-lead-agent-dependencies.py` | [#938](https://github.com/izzhackt/evo_AI_CRM/pull/938)/[#847](https://github.com/izzhackt/evo_AI_CRM/pull/847) merged; lock AnyIO4.14.2 и реальный HTTP smoke в scoped CI. По инвентаризации ROOT работающего lead-agent нет; новый запуск не требуется и не выполнен. |
| 5 | Поставка: release workflows и квитанция | Accepted8f9391dd/schema239 по [release receipt](qa/plan36-production-release-2026-09-22.md). Не означает native/mail/production two-tab acceptance. SQL/release не повторялись. |
| 6 | Текущая воронка: `current-sales-funnel-source.ts`, SQL210/212 | [#943](https://github.com/izzhackt/evo_AI_CRM/pull/943)/[#945](https://github.com/izzhackt/evo_AI_CRM/pull/945): counts текущих стадий, сумма сверяется с total; preview/отказ не дают ложный ноль. Когортная конверсия не заявляется. |
| 7 | Отчёт: `SalesRegisterForms/View`, SQL216/233/235 | [#962](https://github.com/izzhackt/evo_AI_CRM/pull/962)/[#991](https://github.com/izzhackt/evo_AI_CRM/pull/991)/[#995](https://github.com/izzhackt/evo_AI_CRM/pull/995)/[#1001](https://github.com/izzhackt/evo_AI_CRM/pull/1001)/[#1004](https://github.com/izzhackt/evo_AI_CRM/pull/1004)/[#1007](https://github.com/izzhackt/evo_AI_CRM/pull/1007): поиск до страниц, раздельные валюты, scoped target, импорт в Settings. [#1022](https://github.com/izzhackt/evo_AI_CRM/pull/1022) уже архивировал одну служебную запись с историей; повтор исключён. Заполненный target/direction и refresh выбранного файла остаются прежними gaps. |
| 8 | Заявки: реальный page использует `requests-queue-source.ts`, SQL221 | [#968](https://github.com/izzhackt/evo_AI_CRM/pull/968): фильтры до cursor/page, доступность разных источников показана отдельно. Старый `loadRequestsQueue` не используется страницей и не является доказательством лимита100 в новом UI. Исторические35 Auth reads и UI1280/390/320 — ограниченный набор. |
| 9 | Inbox: `Inbox.tsx`, `inbox-source.ts` | [#952](https://github.com/izzhackt/evo_AI_CRM/pull/952): пустая очередь отделена от выбора диалога/недоступности канала. Код после merge неизменён. Provider/история настоящего диалога не испытаны этим audit. |
| 10 | Mobile pipeline: `PipelineStageViewport.tsx`, `Pipeline.tsx` | [#945](https://github.com/izzhackt/evo_AI_CRM/pull/945)/[#953](https://github.com/izzhackt/evo_AI_CRM/pull/953)/[#959](https://github.com/izzhackt/evo_AI_CRM/pull/959): смена стадии сохраняет mounted forms и draft; handoff отличается от существования case. Историческая локальная проверка не охватывает все сделки. |
| 11 | Очереди сообщений: `case-chat-source.ts`, SQL234 | [#1002](https://github.com/izzhackt/evo_AI_CRM/pull/1002): await-state и поиск до лимита200, unread отдельно, контекст/черновик сохранены. Actual37f3d9860: staff, Back/Forward,1440/390/320. Новые realtime-сообщения этим не подтверждены. |
| 12 | Договор/оплаты: `CaseAgreementBlock`, `FinanceEntryWorkspace`, receipt handlers | [#971](https://github.com/izzhackt/evo_AI_CRM/pull/971)/[#973](https://github.com/izzhackt/evo_AI_CRM/pull/973)/[#984](https://github.com/izzhackt/evo_AI_CRM/pull/984)/[#990](https://github.com/izzhackt/evo_AI_CRM/pull/990): единый workflow, Bishkek DATE, receipt существующей оплаты; server authority повторяется при download. Приняты только описанные локальные операции; refund/mixed currencies/all contracts не заявляются. |
| 13 | EVO Docs: preparations route и document reader | [#967](https://github.com/izzhackt/evo_AI_CRM/pull/967)/[#993](https://github.com/izzhackt/evo_AI_CRM/pull/993)/[#1000](https://github.com/izzhackt/evo_AI_CRM/pull/1000): документы привязаны к case/application, формы/OCR/export не заменены. Web/CRM local принят; native путь не исполнен. Отменённый перенос legacy Docs не возобновляется. |
| 14 | Staff каталог: `UniversityCatalogue`, `university-staff-deadline.ts`, SQL236/238 | [#1008](https://github.com/izzhackt/evo_AI_CRM/pull/1008)/[#1011](https://github.com/izzhackt/evo_AI_CRM/pull/1011)/[#1019](https://github.com/izzhackt/evo_AI_CRM/pull/1019): компактный список, шесть стран, только sourced deadline, отдельный manage search. Actual b8497ad4 и manage receipt; positive Next/deadline/draft отсутствовали. |
| 15 | Чат: `TeamChat`, composer, seen/read-error helpers, SQL223/225/227/237/239 | [#992](https://github.com/izzhackt/evo_AI_CRM/pull/992)/[#1005](https://github.com/izzhackt/evo_AI_CRM/pull/1005)/[#1020](https://github.com/izzhackt/evo_AI_CRM/pull/1020)/[#1024](https://github.com/izzhackt/evo_AI_CRM/pull/1024)/[#1030](https://github.com/izzhackt/evo_AI_CRM/pull/1030)/[#1032](https://github.com/izzhackt/evo_AI_CRM/pull/1032): одна лента, sparse seen, адресные retry, точное время. [#1032](https://github.com/izzhackt/evo_AI_CRM/pull/1032) positive compact root0 отсутствует; отрицательные варианты приняты. Issue708 остаётся для разных реальных сотрудников. |
| 16 | Календарь: `personal-calendar-contract.ts`, SQL217, Calendar/TaskControls/grids | [#954](https://github.com/izzhackt/evo_AI_CRM/pull/954)/[#963](https://github.com/izzhackt/evo_AI_CRM/pull/963)/[#1025](https://github.com/izzhackt/evo_AI_CRM/pull/1025)/[#1028](https://github.com/izzhackt/evo_AI_CRM/pull/1028)/[#1031](https://github.com/izzhackt/evo_AI_CRM/pull/1031): assignee до pagination, явный case, persistent dialog/draft, native Escape. Actual0fa4f787 включил один разрешённый create; повторять не нужно. Unknown/reload/cross-identity остаются непроверенными вариантами. |
| 17 | Выбор: `catalog-preparations-actions.ts`, SQL214, `ProgramPreparationModel.swift` | [#967](https://github.com/izzhackt/evo_AI_CRM/pull/967): сразу preparation, уникальная привязка case/program/intake, frozen request ID. CN/MY/AE/TR/IT/CZ проверены в SQL; активный Student должен владеть case. Local Student принят; native нет. |
| 18 | Требования: SQL218/224/226, requirements UI | Неизменяемые ревизии, starter Фото/Паспорт не отменяет полный список. Три ревизии сохранены локально; полный контент каждой программы и native не подтверждены. |
| 19 | Файл/отправка: SQL228, `application-documents-source.ts`, controls/pending | [#993](https://github.com/izzhackt/evo_AI_CRM/pull/993): сохранённый файл и отправленная версия разделены, scan/authority обязательны. Принят local document workflow; чужой case не раскрывается reader. Native acceptance отсутствует. |
| 20 | Комплект: SQL232, `application-packages-actions.ts`, pending | [#999](https://github.com/izzhackt/evo_AI_CRM/pull/999)/[#1000](https://github.com/izzhackt/evo_AI_CRM/pull/1000): immutable состав/версии/requirements revision, recovery с прежним request ID, повтор не копирует файлы. Local Student→staff correction/approval принят. Технический PDF не является фотографией клиента. |
| 21 | CRM/web/iPhone: package contracts, Swift service/model/views | [#1000](https://github.com/izzhackt/evo_AI_CRM/pull/1000): общий сервер, scoped identity/generation, исходная причина notification отделена от текущего решения. Web/CRM доказаны в доступных состояниях; Swift source/build не заменяет iPhone/VoiceOver. |
| 22 | Shell: `navigation.ts`, `AppShell.tsx` | [#1010](https://github.com/izzhackt/evo_AI_CRM/pull/1010)/[#1021](https://github.com/izzhackt/evo_AI_CRM/pull/1021): section state и header spacing, расположение summary/search/Students сохранено. Actual f5f8fef2/e999d8c0 и1440/390/320; text zoom и другие роли не заявляются. |
| 23 | Mobile portal: `portal.css`, preparation/document screens | Реализованные пути имеют scoped receipts [#967](https://github.com/izzhackt/evo_AI_CRM/pull/967)/224/228. Это карта охвата, не новый обязательный редизайн всех экранов или общий E2E. |
| 24 | Learning/profile/notifications: LessonRunner/AssessmentRunner, request feedback | [#1006](https://github.com/izzhackt/evo_AI_CRM/pull/1006)/[#1015](https://github.com/izzhackt/evo_AI_CRM/pull/1015): конкретные offline failures; [#1018](https://github.com/izzhackt/evo_AI_CRM/pull/1018) c59e93cf: stale→offline→read retry; [#1029](https://github.com/izzhackt/evo_AI_CRM/pull/1029) ba9204ec: Start1/save1/r2/read2 attempted/Complete0. SaveAndExit напрямую не проверен. Native logout — открытый [#1026](https://github.com/izzhackt/evo_AI_CRM/pull/1026). |
| 25 | Клавиатура/RU/KY: exercise controls, LanguageForm, route metadata | [#896](https://github.com/izzhackt/evo_AI_CRM/pull/896)/[#1003](https://github.com/izzhackt/evo_AI_CRM/pull/1003): сохраняемый pending focus, live feedback и9 titles. Исторический Student RU/KY Enter/Space1440/320. Screen-reader/VoiceOver и полный no-JS путь не проверены. |
| 26 | Фото/DTO: `university-photo-url.ts`, photo components, closed catalog DTO | [#937](https://github.com/izzhackt/evo_AI_CRM/pull/937)/[#939](https://github.com/izzhackt/evo_AI_CRM/pull/939): key-bound flat managed path, server-only manifest, public data projection. Массовая фотозагрузка не входит; код не выдаёт неизвестный путь за проверенный объект. |
| 27 | Email confirmation | [#978](https://github.com/izzhackt/evo_AI_CRM/pull/978) inactive primitives в main; [#980](https://github.com/izzhackt/evo_AI_CRM/pull/980) OPEN/DRAFT. Реальные local web/API/Mailpit доказательства и native build отдельно от невыполненного native journey/managed activation. |
| 28 | Реальная почта | Внешняя зависимость: invite-адрес уже подтверждён; замена alias и business Gmail access ожидаются. Получение/ответ не проверены, писем0. Адреса/секреты здесь не публикуются. |
| 29 | Optional CN/MY: SQL219/220, profile-source | [#966](https://github.com/izzhackt/evo_AI_CRM/pull/966): forward validator допускает optional empty и сохраняет HTTPS guards. Исходный STOP219 не стёрт; успех относится к локальному220. |
| 30 | Сохранения карточки: SQL213, LeadCardFieldsForm/LeadSaleConditions | [#948](https://github.com/izzhackt/evo_AI_CRM/pull/948): allowlist группы, merge только её полей, expected revision/request replay. Два сохранения/соседний draft/conflict приняты локально; данные не пересохранялись в audit. |
| 31 | KB: карта31 dispositions и решения владельца | [Квитанция](qa/knowledge-source-reconciliation-2026-09-21.md): bounded review завершён с адресными исключениями.16/15/0 — группы работы, не approval.159 pending; никакой новой клиентской публикации. |
| 32 | Материалы компании: FileManager/knowledge library | Ровно2 текста/TXT: оба local downloads приняты; [production bytes/scan receipt](qa/company-material-production-delivery-2026-09-22.md). Production browser blocked/unverified; новые материалы/RAG не добавляются. |
| 33 | Причина срока/приоритета: SQL222 | [#969](https://github.com/izzhackt/evo_AI_CRM/pull/969): guard распространяется на каждого authorized actor, включая Admin. UI empty reason blocked по квитанции; новые task mutations не выполнялись. |
| 34 | CI: fast PR/main admission/classifier | [#938](https://github.com/izzhackt/evo_AI_CRM/pull/938)/[#1034](https://github.com/izzhackt/evo_AI_CRM/pull/1034): отдельный lead dependency smoke, merge-base классификация, exact-main admission. Prebuild failure сохранён. Success scoped CI не является whole-product acceptance. |
| 35 | Старый Inbox formatting | [#950](https://github.com/izzhackt/evo_AI_CRM/pull/950) merged, issue42 CLOSED. Исторические842 теста не запускались заново; frozen service не возвращён в runtime. |
| 36 | Статусы/квитанции | Эта независимая ведомость отделяет source, прежний actual, незавершённую интеграцию и внешние зависимости. Весь1–36 не закрыт из-за конкретных native/mail путей;37–50 отложены. |

## Метод и официальные источники

Проверены актуальные GitHub состояния PR и issues708/693/42. История merged PR
сопоставлена с текущими файлами; изменения после ранних merge учтены отдельно.
Изучены UI/action/source/SQL boundaries перечисленных функций; runtime-проверки
не заменяются grep или тестами, повторяющими реализацию. Полный тяжёлый набор
не запускался. Impeccable context/audit применён с сохранением EVO и границ задач.

[Supabase signOut](https://supabase.com/docs/reference/javascript/auth-signout)
описывает различие global/local scope; этим подтверждается необходимость [#1026](https://github.com/izzhackt/evo_AI_CRM/pull/1026),
но не его фактическая приёмка. [Next.js forms](https://nextjs.org/docs/app/guides/forms)
использован при проверке server actions/pending/валидации; UI-квитанции остаются
отдельным источником фактического поведения.

## Новое окно UI — выполнено 22 сентября,09:55–10:03 UTC

Один выделенный ROOT/B local QA window; обычный Next dev `--webpack`, source
`6515e695`, Node22.23.1, существующая Supabase schema239. Production-конфигурация
не изменялась, build production и native не запускались. Использованы только
ранее разрешённые существующие QA Admin/Student; новые записи не создавались.
Это техническая QA-проверка на сохранённых QA-данных, не real-customer acceptance.

| Путь | Реально исполнено | Предел |
|---|---|---|
| Отчёт продаж | Две существующие записи;1440/390/320; поиск реального имени Enter → preview → «К отчёту» сохраняет query; валюты KGS/USD раздельны | Никакого сохранения/архива/импорта; plan и directions пустые |
| Заявки | 1440/320; «Сайт» → Back возвращает «Все»; настоящая существующая анкета отображается | Approval не нажат; другие источники/Next positive не покрыты |
| Календарь Admin | 1440/390/320; явное пустое личное расписание; открытие формы показывает «Выберите дело», Create disabled; Escape закрывает и возвращает focus; Week→Month подтверждён URL/aria-current | Задача не создавалась, assignee positive этим окном не доказан |
| Каталог | 1440/320; поиск существующего Guangdong через Enter дал одну карточку; actual фильтр стран содержит CN | Остальных стран нет в данных; код допускает согласованные6, их положительный UI не заявляется. Все внешние фото не проверялись |
| Подготовка Student | 1440/390/320; существующая программа, требования/версии/проверенный комплект; Enter раскрывает inline комплект, Space сворачивает | Нет upload/download/submit/review; native и чужие роли не проверялись |

Во всех записанных измерениях `documentElement.scrollWidth === innerWidth`;
новых `pageerror` не зарегистрировано. Снимки desktop/mobile осмотрены.
Два обычных UI login — единственные Auth-входы. Кроме них приложение вызвало
только `loadStudentPortalNotificationState` и `readApplicationPackageDetailAction`;
это чтения. Непрочитанное/seen и другие бизнес-данные не менялись.

Сохранены ошибки самого runner: ESM-import Playwright не запустил браузер,
после чего использован установленный CommonJS entrypoint; первый capture helper
ссылался на уже закрытую Admin page, исправлен явной передачей текущей page;
ожидание dialog у комплекта завершилось timeout — фактический контрол является
inline disclosure, проверен по `aria-expanded`/Enter/Space. Эти ошибки не
выдаются за баги приложения или успешные первоначальные попытки. Промежуточный
calendar capture сделан до завершения перехода; Month подтверждён отдельно после
ожидания точного URL. Launcher завершён собственным SIGTERM/`OWNED_STOP`; exit1
означает это прерывание, а закрытие group/listener подтверждено отдельно.

Свежие before/after READ ONLY снимки охватывают290 бизнес-таблиц и33 Auth/Storage
таблицы. Все290 business, schema/catalog, Storage и входящие sessions/refresh/AMR
совпадают. Из33 только `auth.users` и `auth.audit_log_entries` изменились:
login timestamps двух собственных акторов и ровно2 login/2 logout. Stable hashes
всех users совпадают. Оба собственных local logout вернули204; собственных sessions
в final нет, cookies0, browser закрыт, server process group/listener отсутствуют.
Никакого восстановления БД или удаления исторических Auth-строк не выполнялось.

Raw screenshots, snapshot projections и Auth IDs хранятся приватно вне публичного
репозитория. Проверяемые hashes:

| Артефакт | SHA-256 |
|---|---|

| `before.json` | `8004d6f28e5102594b3692ede4d2119c3a159de6f439d2f2f54ecce2b599074c` |
| `after.json` | `1fea9ba77816add9ba4a74cacd4c3d89ee5f841bd89e363ea7a4ee79da99cbf7` |
| `admin-ui.json` | `844864b68dc868f4d05482923064a2bc9ce3c041fc04b3a6a40f89d4d7bb15d7` |
| `student-ui.json` | `c310f652acdfe44ada34e1f2b9e2e7b4a8ed04b9232c8c66fa85db1f321c2784` |
| `ui.json` | `66121602959811d27c5f5d7ec8e808f9cd95391536faaf7ec079c10a048c18d3` |
| `browser-closed.json` | `b0315b602c72bc641d144c8aab137f58897d82edee8380beceb085cedb5fa5c1` |
| `closed.json` | `a02f08a0921958a89bb099b8a7ecd9adfa8c8e17dd01b7f66390f29083863a53` |
| `closure.json` | `a0fbdfc72e1ab0597c6696cadb09723717b6dc65681580a1cce15f6e3d393387` |
| `source-parity.json` | `51e2d6695a162d682c9b7e5ae52ebf75a4bc7e96e26eb4d37acc57fcb543c7d9` |

## Дальнейшее завершение

B продолжает1026/980 после доступности Mac; ROOT координирует реальную почту
после получения правильного owned invite alias/business Gmail и любые отдельно
разрешённые production-действия. В этом audit нет нового code fix, миграции,
рассылки, provider activation или release. Документационный PR сохраняет отдельный
результат независимого ревью, ссылки и точные ограничения; обязательные exact-head
review/CI остаются перед merge. Не требуется повторно архивировать служебную
продажу, повторять207–239, изменять KB159 или запускать отложенные37–50.
