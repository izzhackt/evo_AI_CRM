# A15d /225: предложение ограниченной локальной QA

Статус: **однократный local apply225 и scoped API QA выполнены** на
`3fc9ef3435882cb431fbe291e9582474f59666cc`; окно передано ROOT32.
[Фактические результаты, остановка harness и ограниченное продолжение](crm-team-chat-sparse-seen-225-2026-09-21.md).
Ниже сохранена история подготовки пакета, включая прежние pending steps;
они не являются текущим статусом. Production/UI-cutover не заявляются.

## Последовательность допуска

1. Дождаться принятой224 и её настоящего local release receipt. Интегрировать
   её source в ветку225 с сохранением runtime-хешей A15d и отдельным review.
2. Зафиксировать свежую полную baseline после освобождения общего стенда.
   Старый A223/A15d UI snapshot не считать текущей baseline после работы ROOT/B.
3. Подготовить/проверить отдельный225 apply driver по этой baseline. Он должен
   подтвердить точный локальный контейнер, историю001–224 без пропусков,
   отсутствие225, соответствие миграций source и отсутствие чужого writer.
   Применить только225 через штатный migration CLI, ровно один раз.
4. Apply receipt проверяет все старые rows/metadata и допускает только новую
   seen table/PK/FK/RLS, mark_seen function, утверждённую замену channels body и
   ledger225. Старые grants/commands/223 и данные сохраняются. Snapshot после
   apply расширяется новой seen table: всего282 business tables, seen пустая.
5. Независимо проверить QA executable и окончательный manifest, привязанный
   к exact source head, apply/release receipts и их SHA256. Получить ROOT GO
   для обычного Auth и **только** перечисленных ниже QA-записей.

Применение225 и QA пока не выполнены. Отсутствующие hashes в example manifest намеренны:
он прекращает работу до Docker/SQL/Auth. Нельзя подставлять старую baseline,
ослаблять guard или создавать новую identity ради прохождения проверки.

## Предложенные существующие участники

- Reader: существующий `identities.admin` из защищённого local QA config.
  Обычный password login, actual Auth user ID → current_actor_authority →
  staff_access_snapshot должны совпасть по user/profile/membership/org.
  Принадлежность к Admin сама по себе не доказывает доступ: обычный channels
  RPC и положительное чтение general/sales проверяют фактическую authority.
- Author/control: существующий `identities.sales`, positively matched к автору
  сохранённых A223 сообщений; channels должны подтвердить general/sales.
- Negative control: существующий `identities.student`, положительный Student
  actor и отсутствие staff snapshot. Это не подставной JWT.

`salesOther` не используется. Нет provisioning, смены паролей, роли, JWT claims,
service-role клиентского обхода или новых сообщений. Если обычный вход/права
не подтвердились, выполнение останавливается до позитивных записей и сохраняет
точную причину; никакой автоматической замены аккаунта.

## Данные и точный объём

Используется только сохранённая разрешённая LOCAL A15c QA история:
55 сообщений general и1 sales; все исходные ID принадлежат прежнему автору,
позиция3 general — удалённое сообщение. Проверяются provenance A223 receipt,
фактические ID/автор/организация и маркировка технической истории.
Позиции ниже — порядок настоящих сообщений по sequence, не новые номера/ID.

До первых записей требуется actual Admin unread54 в general и1 в sales,
нулевой прежний read_sequence и пустая новая seen table. Скрипт ничего не
сбрасывает, если фактическое состояние другое.

| Шаг | Разрешённое действие и ожидаемый эффект |
|---|---|
| Отрицательные проверки |15 mark_seen вызовов: anon/Student/неразрешённый Sales-канал, NULL/неизвестный канал, NULL/пустой/дублированный/вложенный/слишком большой batch, NULL/невалидный/отсутствующий ID, mixed missing/cross-channel. Ноль записей. Если существует другая настоящая организация, ещё один отказ по её ID; иначе tenant coverage не заявлять |
| Собственные/удалённые | Sales отмечает позиции1/3; Admin отмечает удалённую3. Успешные no-op, состояние не меняется |
| Историческая граница | Одна старая command `read` от Admin для позиции1 и один точный replay с тем же request ID/input. Одна receipt и только Admin/general preference до sequence позиции1; при существующей preference все остальные поля неизменны |
| Покрыто прежней границей | Admin mark_seen позиции1 — no-op; unread53, первый2 |
| Разрыв | Admin mark_seen позиций2/55 — две seen rows; unread51, первый4; позиции между ними остаются непрочитанными |
| Повторы | Тот же batch, обратный порядок55/2 и subset2 — без новых rows |
| Пересечение | Batch2/4 — добавляется только4; unread50, первый5 |
| Конкуренция | Два настоящих одновременных HTTP-вызова4/5 и5/6. Добавляются только5/6, без дубля5; итог unread48, первый7 |
| Чтение после изменений | Старые search/thread и новый context не добавляют seen и не двигают floor. Автор/Sales и другой канал неизменны |

Всего10 положительных mark_seen acknowledgements, ровно5 сохранённых seen rows
Admin/general: позиции2/4/5/6/55. Один эффективный legacy read и один replay.
Команды post/edit/delete/moderate не вызываются; нет упоминаний/уведомлений/
сообщений провайдеру/очистки истории. Эти QA-отметки остаются как явно описанный
технический результат; удаление/восстановление после проверки не предусмотрено.

## Доказательство результата

- Каждый реальный RPC response записывается приватно до проверки HTTP/SQLSTATE.
  Auth success token/password не записываются. Ошибка входа сохраняет только
  HTTP status и безопасный error code. Токены используются в памяти процесса.
- Все10 настоящих acknowledgements проходят именно product decoder.
  Чистые tests из PR не заменяют этот шаг.
- Полный282-table observer использует прежний проверенный SQL плюс seen table
  в той же read-only query.279 остальных business hashes, schema/ledger/Auth
  user/identity counts и все исходные чужие preferences/receipts сохранены.
  В трёх затронутых таблицах проверяются точные разрешённые rows/deltas.
  Ordinary Auth sessions меняются и не объявляются неизменными.
- Read-only EXPLAIN ANALYZE двух unread predicates сохраняет реальные планы.
  Маленькая QA история не доказывает производительность на большой переписке.
- Ошибка останавливает запуск, сохраняет текущую фазу и доступный after-state.
  Нельзя повторно запускать весь сценарий или «чистить» последствия автоматически.
  До нового решения ROOT сверяет фактические effects и неизменяемые receipts.

UI/новый server-action через реальную страницу ещё не вызываются, поскольку
они не подключены к текущему экрану. Приёмка общей ленты остаётся будущим блоком.

## Offline executable, ещё не исполненный

Приватный каталог `/private/tmp/evo-a225-qa-packet-20260921`:

- `qa.py` — QA-only, без apply path. SHA256
  `cf82809e651b6e8f15b7eea14ad26f3a1984c2641084d6b0e0e6264d5e08aa53`.
- `decode.mjs` — decoder настоящих RPC ответов. SHA256
  `98ae752c6cb7488c725efcaed0a34d376c23c6209658fd75bc8d5d6f2f1422ac`.
- `manifest.example.json` — незаполненные future apply/release bindings;
  не является разрешением. Runtime hashes уже привязаны к принятому source.

Выполнены только `python3 -m py_compile` и `node --check`. Никаких API/DB/Auth
вызовов этим executable пока не было. Apply driver и окончательный manifest
замораживаются после реального224 release и проверяются отдельно. Локальный
output предусмотрен в новом `/private/tmp/evo-a225-local-qa-20260921`; повторный
старт при существующем output запрещён. Никаких новых runtime dependencies
или приватных файлов для CI/clone этот документ не вводит.

## Узкая коррекция transport guard после offline review

Независимый review предложенного QA executable нашёл один P2: HTTP путь
нужно связать с проверяемым локальным проектом до передачи credentials.
В новой версии отключены ambient proxies (`ProxyHandler({})`). Перед каждым
API-запросом через явно заданный Docker Unix socket повторно проверяются
DB/Kong ID и running state, Kong image, project/workdir labels, общий точный
network ID и публикация Kong8000 на57495 с IPv4-доступом к127.0.0.1.
Ожидаемые значения взяты из сохранённого ROOT27c plan, не из нового live inspect.
Redirects по-прежнему запрещены.

Прежний executable сохранён как `qa-v1.py`; исходный review не переписан.
Повторена только проверка синтаксиса Python; Docker/SQL/Auth/API не запускались.
Decoder, бизнес-последовательность и runtime source не изменены. Финальный
manifest/apply packet по-прежнему ожидают224, свежую baseline и отдельное review.

## Actual224 release и свежая baseline перед225

B release `a6e53f58da9b204d4658e8be80468aecbc37de857845d99ab3b38498c6754224`
подтверждает local001–224; SQL224
`99f0a1567b9e51786a26ed728fb69a321252ddf92e7c9cc2bc208bb601c2917a`,
исходники B `1fa3ef0e92477090d06f3a49db72708674d149f6`. Его принятие в main
и интеграция source в225 проверяются отдельно от факта local apply.

A действительно снял новый READ ONLY snapshot после передачи окна. Все281
business tables, ledger001–224 и Auth user/identity counts8/8 совпали с final
B release, включая сохранённые данные ROOT27c. Sessions не сравнивались.
Приватный `fresh-baseline-224.json` в
`/private/tmp/evo-a225-apply-packet-20260921` имеет SHA256
`3c224eb87648c980b7896b20badcc1fabef6ccc36a2f0b78423a6202a74723ef`.
Там же `baseline-validation.json` сохраняет hashes всех224 локальных SQL.

Подготовленный apply driver пока **не исполнялся**. Он повторно сверяет эту
baseline непосредственно перед штатным однократным local migration CLI.
После225 проверяет все281 старые таблицы и metadata/ACL, точные тела двух
функций и SQL statements ledger. Разрешённые новые объекты: private RLS
seen table,4 её столбца, PK index с4 catalog columns,3 constraints и8 внутренних
FK triggers; новый mark_seen RPC и изменение только body прежнего channels.
Новая seen table должна остаться пустой. Права старых функций сохраняются,
прямой доступ к seen разрешён только владельцу таблицы, RPC — authenticated.

Config переходит224→225 только после проверки. Любая ошибка сохраняет
результат и запрещает автоматический повтор/cleanup. Финальный apply receipt
содержит полный282 after_state и точный SELECT SQL для следующего координатора.
Окончательный QA manifest привязывается к реальным будущим apply/release
receipts; несуществующие hashes не подставляются. Текущий approved QA helper
`cf82809e…` и его business scope не изменены.

## Окончательная интеграция source224 и review apply driver

PR#982 вошёл в main `2b23285d5127b2e8d633c733bf102c25b093baa6` и интегрирован
в ветку225. Все пять runtime hashes A15d сохранены; SQL224 совпадает с реально
проверенным B source `1fa3ef0e…`. Общие журналы объединены с сохранением обеих
веток. CI35553683632 ранее прошёл на `81348bdc`; новый интеграционный head
требует собственных protected checks.

Независимое offline review apply driver — **APPROVED**, без разрешения считать
миграцию применённой. Приватный отчёт `independent-driver-review.md` имеет
SHA256 `8b227644d8cca6e7318c1bfea9c6b1d850ae0efdb3b512ec1b03aa2956f863b9`.
Принятые файлы пакета:

- `apply.py`: `f68bc2bb00fb398302f8b898057d8cab19c351f5aa402032343a91120ea799df`.
- `observe.py`: `ea5a52df8e12c357a68c36c7f4b900c35ed6b9c5c073df230bf1180953122c54`.
- `catalog.sql`: `2520542a025be9607eebaf745d8b21a99ff50a59fe4e59ff9154634349e4f685`.

Окончательный apply manifest фиксирует точный integration head и эти hashes.
Его короткое независимое review precedes once apply. QA manifest получает
только фактические будущие225 apply/release bindings после успешного применения.

## Выполненный пакет и продолжение после harness stop

Final apply manifest `b539db76e312b757978741807fdd28613462b15cbd2f0d70f22bfbf5f94ce98f`
привязан к source3fc9ef34; independent final binding review
`7ae19ba0e99369fc92cf2b095b1e3e4496e31d2de4c3ebc58ea6d135a24055cd` принят до ROOT GO.
Apply225 выполнен один раз. Initial QA manifest
`242f1c2024eb62a4e810ef684c55e61204f91c99ff9f57314d7bfd3084ac56a4` использовал actual
apply receipt и явно ограниченный переход apply→QA в том же A окне.

Исходный cf828 helper сохранён: он остановился на SQL NULL preference после15
negatives и2 no-op, до intent/legacy read. Fresh282 reconciliation
`52d9a1827ff4561330471d698b9def8610a4b620a89d90d6e17429b036b27b51` подтвердил0 writes.
Отдельный `continue.py`
`bf22734e549c31792c16d94e0c888cb14a3309b6bc38a431807156a5107c3d0c` и его manifest
`dad92fabfb5ef1848d99f60c6f1e94e889795ef562c0e64baec00f2bd23961ee` получили independent
APPROVED (`645edcb16a47e01bad0d8e3ee4ae187cdc1c86b59097f3c62ef46b1c40a13512`) до GO.

Continuation сохранил31 исходный файл по hashes, переиспользовал17 completed
proofs и исполнил только8 remaining mark_seen и ранее не начатый legacy read/replay.
Исправлен только nullable SELECT через COALESCE; runtime не менялся. Actual
full282 release `2d7c943d…` с точным SQL передан ROOT32; результат и пределы
доказательства перечислены в [QA отчёте](crm-team-chat-sparse-seen-225-2026-09-21.md).
