# A15d /225: предложение ограниченной локальной QA

Статус: **предложение, не запуск**. Runtime `fb12146e5fdd3470c061ac7c321ddeadb7cc7e53`,
source PR#983 `63dfdb008df928c72653ca391c4d013d2b0f2c3c` независимо одобрен;
CI35552439001 прошёл, включая Migration boundary.225 ещё не установлена локально.
ROOT выполняет другой сценарий на общем стенде. Этот пакет не даёт права занять
его окно или применить225 перед зарезервированной B миграцией224.

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

Пункты1–5 пока не завершены. Отсутствующие hashes в example manifest намеренны:
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
