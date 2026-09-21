# B3d — проверка интерфейса подготовки

Статус: первый обычный Student web-выбор214 → подготовка218 проверен локально
21.09 на `284eeb31`; повторное открытие и ссылки на документы не создают дублей.
Это стартовые фото/паспорт, не полный перечень требований университета.
Локальные intake IDs211 дополнены: все6 известных наборов имеют ID.
Последние результаты — в разделах «Первый Student UI-выбор» и «Интеграция main
после973». Native и визуальное завершение Impeccable остаются открытыми.
Исходные наблюдения сохранены как история, не приёмка новых экранов.
Контракт: [B3d](b3d-program-preparation-ui-contract.md).

## Исходный web-интерфейс, 2026-09-21

Source `f2b3461e4f9eaa35c3a0aa58d373da390f49fb44` включает main `fe5c1b92`
и независимое одобрение pre-code двумя reviewers. На момент исходной проверки
новый UI ещё не был написан.
Отдельный local Next33232, Node22, реальные существующие Student/Admin сессии
и прежняя локальная Supabase. Вход сохранился; новых identities/Auth-настроек нет.

- Student `/portal` открыл настоящую следующую задачу и куратора.
- `/portal/documents` показал настоящие Фото и Загранпаспорт218, оба без файла.
  Якоря существующих строк доступны. Кнопки обозначены только «Загрузить» —
  новый переход должен прямо объяснять текущую отправку на проверку.
- Реальный каталог → Xi’an Jiaotong-Liverpool University → программа и набор
  проверен на1365×900 и390×844. Действия214 ещё нет: подготовка из карточки
  недоступна в исходном UI. Названия, фотографии, атрибуция и официальные ссылки
  сохранены как визуальная основа, не заменяются новым дизайном.
- Staff каталог открылся обычному Admin. QA-дело вернуло штатную ошибку экрана;
  root уже владеет исправлением `profile-source.ts` (отсутствующий optional
  handoff ошибочно считается конфликтом canonical link). B не меняет guard.

Приватные изображения/receipt: `/private/tmp/evo-b3d-ui-baseline/`, файлы0600.
Идентификаторы дела/учётных записей и credentials не публикуются. Screenshots
являются baseline текущих данных и не подтверждают selection/init нового UI.
Просмотр не отправлял консультации, документы, заявки или mark-read команды.
Автоматическое чтение счётчика уведомлений — existing UI, не business mutation.

Impeccable shape/operate применены к выбору конкретного набора и единственному
следующему действию; existing EVO/Атлас сохраняется. Реальные снимки подтверждают
места подключения. Полный scored critique или завершённый accessibility audit
не заявляются. После изменений остаётся один совместный desktop/mobile/native
проход и максимум одна подтверждающая проверка после исправлений.

## Ограничение среды и native baseline

Новая отдельная QA-сборка iPhone завершилась BUILD FAILED/ENOSPC до установки
приложения и входа. Это ошибка заполненного диска, не доказательство дефекта
исходников. Проверка Auth/RPC/экранов новой сборки НЕ выполнена. Логи, команды,
приватная local-конфигурация и cleanup receipt сохранены в
`/private/tmp/evo-b3d-native-tvuusy69/`; значения ключей не публикуются.

Root координировал очистку только воспроизводимых результатов собственных
сборок. B остановил Next33232, закрыл свои проверочные вкладки, удалил только
свои .next317MiB, новый DerivedData77.6MiB и новый пустой выключенный QA simulator,
в котором не было приложения/Auth/пользовательских данных. Пользовательский EVO
simulator сохранён. После очистки зафиксировано7.64GiB свободно; это снимок,
не обещание доступной памяти на будущий запуск. Native rebuild пока отложен.

Readonly baseline существующего EVO simulator выполнен без установки, входа/выхода
и business mutations: каталог → APU → программы/наборы, «Моё поступление» →
«Документы». Видны старый принятый файл и полный текущий список; файл не открывался
и не скачивался. Приложение возвращено на Home. Пять изображений и metadata0600
сохранены в `incumbent-baseline/` указанного private-каталога. Установленный SHA
и backend неизвестны; это визуальная основа incumbent, не проверка candidate.
После освобождения диска локальный Docker API стал недоступен; root восстанавливает
имеющуюся среду без сброса БД. Новые Auth/UI/database проверки и крупные сборки
приостановлены до восстановления, исходники продолжают разрабатываться.

## Узкие проверки кода

Новая bounded Student preparation route: существующий
`tests/fixed-role-route-contract.test.mjs` с проверкой нового пути —26/26 PASS
на Node22. Это unit-проверка маршрутизации; она не доказывает серверные права,
реальный переход или сохранение выбора. Существующее предупреждение Node о
MODULE_TYPELESS_PACKAGE_JSON не менялось.

## Незавершённое на момент исходной проверки

- Завершить независимое exact-head review исходников и реальную UI-проверку.
- Подключить root guard fix перед staff UI проверкой.
- В согласованном окне проверить настоящий выбор, partial/replay, открытие
  сохранённой программы,218 states и переход к same-case Docs.
- Собрать/проверить отдельный native candidate без изменения пользовательского
  EVO/Auth; first selection и edge cases подтвердить реальными доступными данными
  или явно записать непроверенными. Не создавать fake cases/ответы ради PASS.
- Независимое exact-head review и required CI перед root merge.

Миграции/production/provider operations в B3d не выполнялись. Полный редактор
требований, mapping старых материалов, upload≠submit/versioned packages/review
и итоговый E2E остаются следующими блоками; весь admissions-план не завершён.

## Реализация и предварительное review

Student web, staff CRM и native исходники реализованы. Shared TypeScript
`--noEmit --incremental false` и scoped ESLint PASS. Native whole-source
lightweight swiftc PASS; единственное предупреждение — существующее
`SessionRouter.swift:90`. Это не Xcode build и не проверка новой установленной
версии. `plutil` и `git diff --check` PASS;59 новых native строк имеют RU/KY.

При предварительном review исправлены: свежая проверка уже выбранной программы
перед native214, вывод сохранённого срока на web, привязка клиентского состояния
к actor/case/application, очистка старой file/review projection после failed read.
Client CTA блокирует только явно закрытый набор; точную просрочку проверяет214.

Scoped catalog+i18n run:23/25 PASS, включая новые проверки неопределённых сроков.
Два непрошедших существующих теста записаны отдельно: draft fixture не передаёт
обязательный `reviewKind`; SSR harness staff-каталога импортирует `server-only`
в обычном Node процессе. Parser и этот renderer в B3d не менялись; эти проверки
не объявляются зелёными и не заменяют проверку настоящего браузерного пути.

Root восстановил локальную среду и разрешил read-only validation. B Next33232
возобновлён; обычная существующая Student-сессия открывает список сохранённых
программ и214/218 detail. Пока без selection/init/upload/save; screenshots и
полная визуальная проверка candidate ещё выполняются. Staff ждёт интеграции
исправления profile-source из root PR #966.

## Candidate 2516de2d — 2026-09-21

Source `2516de2db21007cdf230f061125ee600fdb9e2c9` получил два независимых
APPROVED по исходникам: web/CRM и native/cross-surface. Это не runtime acceptance.
Включён main `44092c575c0bd02b16f46b83795e475ece30cf08` с PR #966: исправление
canonical profile и SQL219/220 сохранены без изменений. В конфликтующих журналах
сохранены обе документальные истории. B3d не добавляет миграций.

Нормализация отображения срока согласована между клиентами: неоднозначная `CET`
остаётся неопределённой, граница точной минуты одинакова. Новая точечная проверка
сроков —3/3 PASS. Native whole-source swiftc после этого изменения —PASS,
только прежнее предупреждение `SessionRouter.swift:90`.

### Реальные чтения и переходы

- Обычный существующий Student: портал → сохранённая программа GDUT → подготовка
  → «Загранпаспорт» → соответствующая строка прежнего same-case Docs. Показаны
  два стартовых пункта, отсутствие файлов/проверки и пояснение о неполном перечне.
- Обычный существующий Admin: профиль → «Вузы и программы» (`tab=route`) →
  сохранённая подготовка; поиск Guangdong → программа/набор → «Открыть подготовку»
  ведёт к той же заявке. Переход к паспорту открывает документы того же дела.
  Ручное добавление вуза, статусы заявки и partner packets остаются доступны.
- Измерение DOM на ширине390px не выявило горизонтального переполнения. Это
  проверка размеров, а не завершённое визуальное или accessibility acceptance.
- Опубликованный XJTLU / BEng Computer Science / September2027 не имеет
  постоянного ID набора: новый выбор штатно недоступен. Это подтверждённое
  ограничение одного набора; полнота идентификаторов остального каталога ещё
  не проверена. Данные не исправлялись и не подменялись ради проверки.

Selection/init/upload/save/mark-read команды B3d через UI ещё не выполнялись.
Сохранённый GDUT проверяет открытие существующего выбора, не создание нового.
До отдельного окна root нужны read-only inventory и конкретный допустимый target;
если его нет, first-selection acceptance остаётся непроверенным.

### Native и визуальная проверка

Полная Xcode-сборка исходников `3d84e176435a20f2c645bbb1b3cb1414eb280410`
завершилась BUILD SUCCEEDED после восстановления диска. Она установлена и
запущена в отдельном QA simulator с отдельным bundle ID. Встроенные Supabase
и portal origins проверены как локальные; пользовательский simulator и его
Auth не менялись. Изменение срока `2516de2d` прошло swiftc и отдельную incremental
Xcode build —BUILD SUCCEEDED (`build-result-04.json`, exit0, минимум8.64GiB
свободного места); новая сборка пока не установлена и не запущена. Работа с native
UI остановилась на заблокированном
Mac; вход и candidate UI-переходы не подтверждены. Запрос разблокировки ожидает
ответа пользователя. Логи и receipts — в прежнем private native-каталоге.

Impeccable detector выполнен один раз: четыре предупреждения относятся к прежним
строкам `portal.css`, за пределами добавленных стилей. Независимый finish review
использует эквивалент `reference/degraded/finish-reviewer.md`, поскольку preset
не доступен. Web desktop/staff mobile снимки просмотрены; общий verdict —
`recapture`: Student mobile PNG обрезает нижнее действие и содержит постороннюю
полосу, несмотря на корректные DOM-размеры. Причина расхождения не установлена;
оно не объявляется дефектом CSS. Визуальный PASS не заявляется. Повторные попытки
того же capture остановлены; временные viewport overrides сброшены. Native
candidate снимков пока нет. Private evidence: `/private/tmp/evo-b3d-ui-candidate/`.

### Текущие ограничения

На время согласованного изменения локальной БД222 собственные QA-вкладки B
закрыты и Next33232 остановлен, чтобы исключить фоновые чтения. Возобновление
чтений и отдельное окно business-команд координирует root. Production, внешние
сервисы, новые Auth identities/cases/publications в этой проверке не менялись.

До merge остаются: доступный настоящий target и UI selection/init/reopen со
сверкой изменений, новая native UI-проверка, валидный mobile capture и finish
review, required CI и независимое exact-head review итоговых артефактов.
Полный admissions-план, требования/сопоставление документов, versioned packages
и итоговый E2E этим PR не закрываются.

## Покрытие каталога: разрешённая metadata inventory после222

Выполнен один SELECT-only inventory существующей локальной организации Student1
на ledger001–222 (`2026-09-20T23:46:47Z`). Observer сверил Unix Docker endpoint,
контейнер/project/workdir с exact release receipt222; app server, Auth, UI,
baseline freeze и business writes не запускались. Inventory advisory: это не
разрешение на последующий выбор и не runtime acceptance.

В latest published карточках **с наборами** найдено5 вузов,5 программ,6 наборов:

| Карточка | Наборы | С постоянным ID | Новый выбор для этого дела |
| --- | ---: | ---: | --- |
| Guangdong University of Technology | 1 | 1 | Уже сохранён; доступно открытие |
| South China University of Technology | 1 | 0 | Недоступен без технической публикации |
| University of Nottingham Ningbo China | 1 | 0 | Недоступен без технической публикации |
| Xi’an Jiaotong-Liverpool University | 1 | 0 | Недоступен без технической публикации |
| Zhejiang University of Technology | 2 | 0 | Недоступен без технической публикации |

UUID проверены отдельно по строгому214 format (lowercase, version1–8,
variant8/9/a/b), поскольку predictor observer допускает более широкий UUID.
Дело active/portal activated, без country checklist;218 material blockers не
найдены. Но допустимых ещё не выбранных tuple здесь **нет**. Existing Student2
может рассматриваться только после отдельной проверки его текущих прав/дела и
согласования exact target; автоматического переключения нет.

Это продуктовый пробел покрытия, а не только ограничение QA. Продолжение уже
описано в [контракте B3a](../design/portal/intake-identities-slice-2026-09-20.md):
отдельно согласованные technical `intake_ids` stage/review/publication211,
привязанные к exact текущей редакции. Сохраняются все факты, порядок, старые ID,
verifiedOn и immutable history; меняются только отсутствовавшие идентификаторы.
После публикации нужны обычные Student web/iPhone readback и итоговые counts
identified/legacy/blocked. Новый writer/backfill механизма для B3d не добавляется.
Никакие публикации не выполнялись ради успешного теста.

Эти числа относятся только к названной локальной организации и карточкам,
имеющим наборы. Они не описывают managed/production каталог, пустые карточки или
исторический managed manifest65/131. По одному GDUT весь каталог готовым не
объявляется. Private inventory SHA256:
`4d924934c6d40cfd9e00d1b1e3e60779122a3361dc0c5b66efd46ab2c973b767`;
артефакты `/private/tmp/evo-b3d-ui-observer/`, без публикации identity/credentials.

## Проверка второго существующего дела

После окончательного освобождения root222 business window выполнен отдельно
разрешённый SELECT-only metadata inventory существующего Student2. Exact observer
`d161a05277c7c76036ef2d0000703437fed99a124e4d459d64861343919f9f19` привязан к final
root222 release receipt, использует строгий214 UUID и не имеет capture/write CLI.

Владелец canonical case совпадает с прежним account receipt; profile, organization
и membership активны, роль Student, portal activation есть. Но само дело имеет
состояние **pending**, пригодных active cases у этого владельца —0. Metadata gate
не пройден: дальнейший catalog/target inventory не запускался. Это чтение метаданных,
не проверка авторизации токена/RLS (`auth_acceptance=false`).

Дело не активировалось, другой account автоматически не выбирался, вход/сервер/UI
не запускались; данные/права/публикации не менялись. Таким образом, ни первый, ни
второй проверенный сценарий сейчас не дают допустимый новый выбор. First-selection
UI acceptance остаётся заблокированным реальными исходными данными. Это не
доказательство наличия или отсутствия других подходящих дел во всей организации.

Private receipt `student2/inventory.json` SHA256
`c5ff7c99e869a0e9cc21afc79498ea81ff96ef03d0792f1ff9688e826c458929`.
Новые записи214/218, UI replay и native candidate UI по-прежнему не подтверждены.


## Локальное дополнение покрытия211 — 2026-09-21

По отдельному согласованному окну выполнен существующий технический workflow211
для четырёх ранее опубликованных карточек: SCUT v1→v2, UNNC v2→v3,
XJTLU v1→v2, Zhejiang v1→v2. Это разрешённое завершение покрытия каталога,
описанного в B3a; новых миграций, Auth identities или дел не создавали.
Runtime `2516de2d`, наблюдавшийся repo HEAD `8e8c81e1` (последующие изменения —
только документация). Сохранён обычный локальный QA Admin вход без login/logout.

Для каждой карточки фактическая форма открыта через published card → предложить
обновление → закрепить наборы. Четыре stage-запроса зафиксированы до записи и
независимо одобрены; после каждого сохранения проверены receipt, draft, base,
источник и exact candidate. Publish request зафиксирован из настоящей review
формы; техническое подтверждение и публикация выполнены обычным UI. Каждый
запрос выполнен один раз, без regeneration и retry. Все восемь receipts принадлежат
одному обычному Admin actor. Исходные данные и даты источников не перепроверялись
и не менялись; история сохранена. Добавлены только5 отсутствовавших intake IDs.

| Область | До | После |
| --- | ---: | ---: |
| Все local publications | 7 | 11 |
| Все local catalog request receipts | 14 | 22 |
| Publications четырёх карточек | 5 | 9 |
| Receipts четырёх карточек | 10 | 18 |
| Известные local наборы с ID | 1 из6 | 6 из6 |
| Незавершённые drafts четырёх карточек | 0 | 0 |

После каждой карточки выполнена сверка whole-table hashes и точных новых
publications/receipts. Дополнительный SELECT сравнил прежние строки целиком,
исключив только новые exact publication/actor/request tuples: их hashes равны
исходному baseline. Остальные279 business tables, источники, import records,
institutions, audits, schema/functions и ledger001–222 не менялись. Audit delta0.
Auth подтверждён только неизменными counts users/identities; это не проверка
всех Auth rows, сессий или RLS. Offline verifier независимо одобрен на exact SHA.

Обычный Student1 web-вход прочитал все5 карточек с наборами: четыре карточки
показывают доступное «Выбрать и начать подготовку»; в Zhejiang набор2026 остаётся
закрыт, следующий набор — с честным предупреждением об уточнении условий.
GDUT сохраняет ссылку на прежнюю подготовку. Ни выбор214, ни инициализация218,
ни загрузка, консультация или изменение избранного не запускались.

Ограничение наблюдения: первоначальный soft-переход по SCUT остался на списке;
прямой переход по фактическому href открыл карточку. Причина не установлена,
soft-navigation PASS не заявляется. Первые captures с loading-текстом сохранены
как неполные; итоговый readback использует5 загрузившихся карточек. Native
readback, mobile recapture/finish review и первый UI selection/init остаются
незавершёнными. Отсутствие intake IDs больше не блокирует эту локальную
организацию; exact ещё не выбранный target нужно свежо проверить отдельно.
Managed/production покрытие и весь admissions-план этим не принимаются.

Собственные IAB QA-вкладки9–13 закрыты, Next33232 остановлен (отсутствие listener
проверено); после Student readback финальная сверка сохранила тот же результат.
Окно базы освобождено root. Private receipts0600:
`/private/tmp/evo-b3a-local-coverage/`, без credentials в repo.

- Release receipt SHA256 `44c0f7fa938a96dc489d8693cbc50ab6fa78e2f951030f330639f0fc1e8a4c41`.
- Before snapshot SHA256 `7cc60af5c78dd3874dadcf4eaa03d681cc1cc4e600387e8ab8df9a02ef801208`.
- Released snapshot SHA256 `05a082df0b1fd753bca8cb0d97c1048aaaaaa28fda299e376b4c511b0e5b0b42`.
- Offline verifier SHA256 `9b123f27c593aafe63319e9f5873567d5a846831881211a8ac03546e61de2b36`.


## Интеграция main после972

В ветку B3d объединён `origin/main` `ea3cb758` с уже принятыми CRM requests,
team chat, task reasons и finance hierarchy. Конфликтов не было. Root-owned
`Profile.tsx`, `tabs.tsx` и profile page совпадают с main; B3d workspace подготовки,
SelectionAction/server UI actions и native исходники не изменились относительно
`2516de2d`. Прежние доказательства относятся к своим указанным ревизиям; новый
runtime/UI запуск после интеграции пока не выполнялся.

TypeScript `--noEmit --incremental false` PASS. Узкие проверки маршрутов,
agreement и requests queue —72/72 PASS на Node22.23.1; `git diff --check` PASS.
Это проверка композиции кода, без новых DB/Auth/UI/provider действий.

## Первый Student UI-выбор, 2026-09-21

Source `284eeb31c982d35ffeafbe4e761edd35a7c96e06`, отдельный Next33232,
существующая обычная Student1-сессия IAB на127.0.0.1, local ledger001–222.
Root отдельно согласовал READ ONLY observer и один обычный клик по фактической
XJTLU version2 / BEng Computer Science / «Сентябрь2027». Target взят из настоящей
211-публикации. UUID запросов создало приложение; nonce/storage/ответы не
подставлялись. Нового входа, другого дела или активации Student2 не было.

Первый observer остановился до SQL: его сборка metadata пропускала третий
Docker label `com.docker.compose.project`, поэтому строгая проверка не совпала
с сохранённым контейнером. Container ID, endpoint и остальные metadata совпадали.
Исправление добавило чтение и проверку этого label, сохранив полное равенство;
новый source и новый GO независимо одобрены. Старый отказ и receipt сохранены.

Fresh baseline подтвердил canonical active owner/case, отсутствие выбранной
tuple, неизменную публикацию и два совместимых existing typed материала.
Обычная загрузка карточки не изменила full281/scope; действующая Student UI
сессия показала один доступный выбор, без pending/retry/error. Это отдельно
от metadata SELECT, который сам по себе не доказывает Student authorization.

Один «Выбрать и начать подготовку» выполнил214, затем218 и открыл сохранённую
подготовку с Фото/Загранпаспортом. Не было второго клика, retry или partial repair.
Подтверждённые эффекты:

| Таблица | До → после | Проверка |
| --- | --- | --- |
| university_applications / catalog_preparation_bindings / university_application_events | каждая1 →2 | Одна exact программа/набор/дело; preparation, не primary; deadlineNULL |
| application_requirement_revisions | 1 →2 | evo_starter, needs_confirmation, revision1 |
| application_requirement_items / document_slot_case_links | каждая2 →4 | Два требования связаны с прежними Фото/Паспортом |
| document_slots | 2 →2 | Только version+1/updated_at у двух frozen slots, без новых slots |
| audit_events | 124 →126 | Две actions, разные actual request UUID; exact actor/intent/receipt |

Whole hashes остальных273 business tables и exact complements прежних строк
совпали. Schema/functions/ledger не менялись; каталог211 и его receipts неизменны.
Auth users/identities — только равенство counts, без утверждения о всех Auth rows.

Реальный UI-путь после сохранения: refresh → «Моё поступление» с прежним GDUT
и новым XJTLU → открыть XJTLU → обе ссылки на same-case Фото/Паспорт → исходная
карточка с «Открыть подготовку» вместо выбора → та же подготовка. Все переходы
сохранили полное равенство after-selection snapshot; новых audit/command effects
нет. Это отсутствие дублей при открытии, не exact-request RPC replay.

Desktop capture просмотрен. При390px DOM scrollWidth=clientWidth=390; мобильный
full-page capture снова имеет несогласованную правую полосу/геометрию. Это не
доказанный CSS-дефект и не visual PASS: Impeccable disposition остаётся **recapture**.
Временный viewport сброшен, собственная вкладка14 закрыта, Next33232 остановлен,
отсутствие listener проверено. Финальная parity равна after-selection; окно
освобождено root. Нативная сборка по-прежнему ожидает доступного Mac.

Private0600 evidence: `/private/tmp/evo-b3d-first-selection/`; credentials и
идентификаторы QA-учётных записей/дел в repo не добавляются.

- Release receipt SHA256 `337b730ff14b6edc3e214f4014c9fedfaaf7f612ebb74e824d04dae0d41580ed`.
- Baseline SHA256 `789a39d266f60bbd5e14f6f420bc5cf33d26abb91605ac3bf3ca1de6ae023a39`.
- After-selection SHA256 `55de9560342f3f8748e3d90ecbb329f321a05ee11dc640584a04d0c301d7fe33`.
- Released parity SHA256 `dc816076309b1f107e4b60abd658b2a9d148accbe8a81ab751952e76a1a2d73c`.
- Reviewed observer SHA256 `4bdcdc18e5970a8dac3a0280bafb36204d03e3bd9aefd835201dfe844f63ad43`.

Не выполнялись upload/download/review/package, consultation/favorite, native,
provider, managed или production actions. Полный university checklist, отправка
пакета и весь admissions-план этой проверкой не закрываются.

## Интеграция main после973

После закрытия QA-окна source284 в ветку объединён main
`925cf1996e0b2c08e968d513da149793f9c774be`: root объединяет договор и оплату,
а composer чата растёт с текстом. Конфликтов не было; изменения root в Profile,
tabs, profile page и contract workspace сохранены. Исходники выбора/подготовки
B3d и native не изменились.
Проверка Student UI выше относится к284; повторной runtime-приёмки нового merge
нет. Узкие результаты композиции кода фиксируются отдельно от неё.

TypeScript `--noEmit --incremental false` и `git diff --check` PASS.
Первый запуск четырёх scoped файлов (route, agreement, profile contract,
contract workflow) дал91/92 PASS: `v3-profile-contract.test.mjs:31` ожидает
прежнее `link && data.handoff?.leadId`, хотя принятый adapter проверяет
`link && data.handoff && data.handoff.leadId`. И тест, и adapter совпадают
с main925; это отдельное устаревшее source assertion. Runtime guard не менялся.

CI на284, [run35547698931](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35547698931):
Build/Lint PASS; Release contracts FAIL на
`tests/v3-managed-supabase-export.test.mjs:1325` —
`Storage downloader permits progressive streams longer than the idle window`,
`storage_object_download_timed_out`. Fast checks наследует этот отказ. Тест и
exporter совпадали с main `ea3cb758`, вне B3d diff; причина таймаута не объявляется
доказанной. Unchanged run не перезапускался ради green. Следующий CI относится
к реальному обновлению QA-документа и интеграции main, а не стирает этот отказ.
