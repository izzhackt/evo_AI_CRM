# B3f / 228 — ограниченная локальная QA и оставшиеся проверки

Статус на 21.09.2026: миграция 228 применена локально, основной путь Student/Admin
проверен через обычный браузерный UI на неизменяемом source
`571d65a8645b518c3513d8a9eebe36410f929e8e`. Сверены точные эффекты и сохранность
прежних строк всех 287 business-таблиц. Это техническая локальная QA по
[контракту](b3f-program-document-submission-contract.md), не production или
реальная клиентская приёмка. Native iPhone UI не проверен; весь объём 13/17–21
и B3g не закрыт. [PR #993](https://github.com/izzhackt/evo_AI_CRM/pull/993)
влит 21.09.2026 в 07:42:59 UTC, merge SHA
`f712db2f2b0cdb623f82ea8f5fe048cda7e0d2ee`. ROOT принял ограниченную локальную QA
и RAW release; эта приёмка не расширяет фактически проверенный объём.

## Выполненный Student/Admin путь

Применение 228 завершилось PASS: ledger 001–228, 283 прежние business-таблицы
сохранены, четыре новые таблицы пусты после apply. Перед Auth/UI получен свежий
full 287 baseline. Использован согласованный Student1 из B209. Первый вход под
старой legacy QA-учёткой завершён выходом до бизнес-действий; отдельная сверка
всех 287 таблиц до целевого пути подтвердила равенство baseline. Роли и чужие
бизнес-записи для сценария не менялись.

1. Student сохраняет реальный разрешённый PDF V1 в программе A. Файл проходит
   scanner/Storage путь; draft ещё не является отправкой или работой для review.
2. Student явно отправляет V1 в A. Admin открывает фактическую очередь и принимает
   эту exact отправку. Student скачивает V1 — D1.
3. Student сохраняет V2 в A. UI одновременно показывает V2 как сохранённый draft
   и принятую V1; новая версия автоматически не отправляется.
4. В программе B Student явно выбирает уже сохранённую V1 и отправляет её.
   B не наследует принятие A. Admin возвращает отправку B на исправление
   с замечанием; Student видит правильный русский текст.
5. Прежнее уведомление A после V2 и решения B по-прежнему открывает принятую V1.
   Из него выполнено скачивание D2 V1; из draft A — D3 V2.

Итого фактически исполнены 2 uploads, 2 submissions, 2 reviews и 3 downloads.
Обе программы используют каноническую V1 без копирования файла ради B.
Полная прежняя legacy slot-запись, включая current/status, не изменилась.
Валидация exact effects подтвердила 52 новые строки в 17 из 287 business-таблиц,
из них 16 audit-записей; созданы ровно 2 Storage-объекта. Все прежние business-строки
сохранены. SQL/HTTP/receipt сверка и UI review — отдельные доказательства;
офлайн-validator сам runtime не исполнял.

## UI, наблюдатель и Auth

ROOT Impeccable review — APPROVED для наблюдавшегося локального web-среза:
раздельные saved/submitted/reviewed состояния, независимость A/B, историческое
уведомление, desktop и узкий mobile. Сохранены EVO/Атлас/Golos и привычные controls.
Две согласованные batched visual rounds завершены, дополнительного polish-цикла
не было. Первый снимок уведомления показывал loading и не принят как доказательство;
в финальном batch есть ready/visible witnesses. Высокие mobile element captures
пересекают fixed navigation и не доказывают одновременную видимость всех подписей;
обычный прокрученный viewport отдельно подтверждает доступность принятой V1.
Это не проверка native iPhone, VoiceOver или всех 320/RU/KY вариантов.

Сохранённый observer capture RSC `response.text` для review B содержит mojibake
и оставлен без исправления; состояние исходных wire bytes этим не установлено.
Независимый observer review `64db1d87…` подтвердил совпадение исходного request, DB receipt,
audit/notification и обычного Student DOM по правильному кириллическому замечанию.
Наблюдаемая строка обратимо соответствует UTF-8, прочитанному как Windows1252;
точный этап wire/CDP/Playwright-преобразования не локализован. Это расхождение
наблюдения, не повреждение сохранённого решения или UI; продуктовый patch,
повтор review и изменение исходного raw-доказательства не выполнялись.

Все три собственные Auth sessions и связанные refresh tokens отсутствуют после
обычного logout. Финальные `auth.sessions` 223 и `auth.refresh_tokens` 238 вернулись
к исходным count/SHA; buckets также совпали. Число Auth users/identities осталось
8/8. Полное построчное равенство `auth.users` не заявляется: обычный вход меняет
Auth metadata. Собственный browser закрыт, scanner остановлен; отсутствие
собственных Next-процессов и закрытие порта 33248 проверены отдельно. PTY supervisor
завершился с кодом 1, exit code дочернего Next неизвестен: успешный exit 0
не заявляется. DB/Kong и чужой runtime сохранены. Разрешённые QA-строки и два
PDF оставлены как доказательство, удаления не выполнялись. ROOT принял
RAW release `f3753713…`; следующий владелец окна — ROOT990.

## Точные приватные доказательства

В репозиторий внесены только пути и SHA-256; исходные rows, выбранные HTTP
payloads, скриншоты и выбранные session/actor IDs остаются в private receipts.
Значения credentials, JWT и cookies в доказательства не включены; credentials
использовались только в процессе из существующего ignored QA config.

| Доказательство | Приватный путь | SHA-256 |
| --- | --- | --- |
| Apply 228 | `/private/tmp/evo-b228-preflight/apply.json` | `defe8638be88de2ae010aafe280080086609cba512bfb9f5b53274e589fd3c5f` |
| Свежий full 287 baseline | `/private/tmp/evo-b228-core-ui/baseline287.json` | `a949c30971aa03723cdaeec171d7ae088dd6de00e6b3d1bd44ae052e75789778` |
| Exact core effects | `/private/tmp/evo-b228-core-check/final-effects-validation.json` | `72d19741efbbc37028ce0e5cb76fa19356e6867349da410207065c6ce82654df` |
| Manifest входов, SQL и whole-table complements | `/private/tmp/evo-b228-core-check/actual-final-inputs.json` | `3bfb5c117a4916a5be0c972a902699b09cf4d8bed87103c5a9af4f943b0fe4e7` |
| Actual command/download receipts | `/private/tmp/evo-b228-core-check/actual-receipts.json` | `2e05256c9d87241d6b96651115faa6dd24708ea84af4b1f6a0cd83a01a75b488` |
| ROOT UI review и hashes кадров | `/private/tmp/evo-b228-final-ui-root-review.md` | `9cbc635b6954515bdc218c8473376d817cc7dd00b201f3013ee5ff6027116c16` |
| Независимый RSC observer review | `/private/tmp/evo-b228-rsc-observer-review.md` | `64db1d87fa36c4a59476cf4fa41b52dc44bf3699b8eaff785ec987acfb9b3ac8` |
| Финальная Auth-сверка | `/private/tmp/evo-b228-browser/auth-final-comparison.json` | `4f91aad36c30e70aa39449289420f76eb71dee49b3e3d68a85eb74e682cf68a7` |
| Принятый RAW release и cleanup | `/private/tmp/evo-b228-core-ui/release-receipt.json` | `f375371369becc30f1f873badb6a45d182580813ad9829f6e017042fdff39b6a` |
| CI source 571d | `/private/tmp/evo-b3f-ci-571d65a8-final.json` | `019dec8ccc312209c8d6a8f02bcbc1e722b1161d18e3154aae8ece0ed21aaaf4` |

## Сохранённое офлайн-доказательство

Эти результаты переиспользованы для указанного source; при обновлении этого
QA-документа проверки не запускались повторно. Они не заменяют описанный выше actual путь.

- 43 scoped Node checks PASS: codecs/pending/actions, transport, SQL source
  transformations, route reachability, notification targets и RU/KY keys;
  новый regression следует истории CREATE/DROP/SET SCHEMA/RENAME 001–227
  и проверяет все 16 inherited function identities из 228.
- 39 прежних transport checks PASS на неизменённых legacy implementations;
  это dependency-injected protocol evidence, не Auth/Storage acceptance.
- TypeScript `tsc --noEmit` PASS; scoped web/server ESLint PASS после последних
  исправлений. TypeScript повторён после интеграции ROOT991; `git diff --check` PASS.
- Swift: 59 protocol/persistence checks PASS, cached-dependency iOS typecheck
  PASS; единственное предупреждение — прежнее `SessionRouter.swift:90`.
- SQL parse: 166 statements, 34 PL/pgSQL/DO bodies и четыре наследуемых
  helper body. Разрешение DB объектов/колонок и actual locks этим не доказаны.

Дополнительный ограниченный portal run: 34 PASS / 3 FAIL. Три оставшиеся source
assertions в `tests/v3-student-portal-ui.test.mjs` уже расходятся с исходным HEAD
`b81c338c`: ожидают прежние props Shell, прежний Promise.all overview и удалённый
каталог `src/components/v3/portal/`. Затрагиваемые layout/overview файлы не менялись
в B3f. Их исправление не включено. Инвентарь маршрутов обновлён для нового detail
и существующего preparation route; эта проверка теперь проходит.

Приватные логи: `/private/tmp/evo-b3f-scoped-implementation-final.log`,
`evo-b3f-implementation-tsc.log`, `evo-b3f-implementation-eslint.log`,
`evo-b3f-portal-tests-final.log`;
Swift commands/logs/source hashes — `/private/tmp/evo-b3f-swift-zpr6abmx/`.
Последний scoped run с обязательным `--conditions=react-server` —
`/private/tmp/evo-b3f-corrected-scoped-react-server.log` (43/43). Предыдущий
вызов без этого флага остановился на `server-only` import: это ошибка запуска,
не продуктовая проверка. TypeScript после ROOT991 —
`/private/tmp/evo-b3f-root991-integration-tsc.log`.
Ни один fixture/result из unit tests не выдаётся за реальную пользовательскую проверку.

## CI и сохранённая история ошибок

[CI 35567860470](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35567860470)
на exact source 571d завершён успешно: 6 jobs PASS, 2 dependency-maintenance jobs
SKIPPED. Это отдельное доказательство от локальных Auth/Storage/UI действий.

Прежние три source reviews на `9b66b27c` были APPROVED, но
[CI 35566781600](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35566781600)
обнаружил ошибку применения 228. Build/lint/release contracts прошли;
migration boundary остановился на ссылке
`platform.reserve_document_upload(uuid,uuid,text,text,bigint,text,uuid)`,
удалённой 116. Исправление убрало только отсутствующий predecessor;
действующий `reserve_document_upload_after_ingress_scan` защищён отдельно.
Прежние static parse/source reviews эту ошибку пропустили и не считаются
доказательством успешного DDL. Исправленный source 571d прошёл CI и actual local apply.

ROOT991 MERGED `82260fdc`; исходное освобождение окна имело ledger 227 и 283
business tables. Старые B226 receipts и reviews 9b66 не переименованы в новые
проверки 571d. Офлайн-доказательство, ошибка запуска без `--conditions=react-server`
и три неизменённых portal source assertions выше остаются в истории.

## Что actual QA ещё не доказывает

- Concurrency, same-request replay, duplicate/conflict и потеря ответа при
  upload/submit/review; одно успешное действие не заменяет эти варианты.
- Смена revision/definition, removed item, завершение ранее зарезервированной
  исторической загрузки и recovery после такой смены; review старой отправки
  после нового upload как отдельная последовательность.
- Revocation, чужой case/application, expired/dirty grants и заражённый либо
  недоступный объект. Независимость A/B на разрешённых данных не доказывает
  все отрицательные ветви доступа.
- Legacy/manual/visa, замена global approved-current и approved ZIP guard
  в отдельных реальных сценариях. Неизменность прежней legacy slot-записи
  в выполненном пути подтверждена, но не равна исполнению всех legacy вариантов.
- Native iPhone UI, широкий E2E и полный набор mobile/локалей/accessibility.

Полные пакеты B3g, завершение всех 13/17–21, контентная волна и App Store readiness
остаются последующими блоками. Production и внешние провайдеры не затронуты.
