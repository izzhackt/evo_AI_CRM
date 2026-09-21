# B3f / 228 — проверка и оставшиеся шаги

Статус: исходники реализованы, независимое source review и интеграция продолжаются.
Миграция228 не применена; фактические Auth, DB, Storage, browser и iPhone UI
сценарии B3f ещё не исполнены. Production и внешние провайдеры не затронуты.
Основание — [контракт](b3f-program-document-submission-contract.md).

## Реализованное поведение

Сохранение нового файла не меняет общий current/status документа и не создаёт
отправку. Отдельное действие отправляет точную версию для конкретного требования
и программы. CRM показывает фактические непроверенные отправки, включая прежние
требования; решение и уведомление относятся к той же отправленной версии.

Веб и iPhone сохраняют полный pending intent до подтверждённого результата.
Повтор использует прежний request и те же bytes; изменение требований не
переназначает историческую загрузку/отправку. История сохраняет прежнее определение,
дедлайн, файл и решение. RU/KY и существующие EVO/Атлас/Golos сохранены.

Source review выявил и исправил отсутствовавшие точные proxy predicates,
неосвобождавшийся intent после доказанного отказа до admission, recovery уже
зарезервированной загрузки после смены требований и неполную историю на iPhone.
Также исправлены pending review recovery после исчезновения из очереди,
инвалидация истории при обновлении документов и порядок scan/organization locks,
согласованный с эффективными155/156. Ошибка локального хранения больше не
утверждает, что неизвестная операция не началась.
Legacy service metadata allocator использует MAX(version_no)+1 под прежним
slot lock, чтобы не конфликтовать с непубликуемыми draft-версиями.

## Офлайн-доказательство

- 42 scoped Node checks PASS: codecs/pending/actions, transport, SQL source
  transformations, route reachability, notification targets и RU/KY keys.
- 39 прежних transport checks PASS на неизменённых legacy implementations;
  это dependency-injected protocol evidence, не Auth/Storage acceptance.
- TypeScript `tsc --noEmit` PASS; scoped web/server ESLint PASS после последних
  исправлений. `git diff --check` PASS.
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
Ни один fixture/result из unit tests не выдаётся за реальную пользовательскую проверку.

## Предлагаемое локальное окно после ROOT991

Root обновил порядок: ROOT990 освобождает227 → ROOT991 read-only UI → B228 →
ROOT229.228 сохраняется за B;229 относится к отдельному receipt-пути.

Это перечень требуемых сценариев, а не разрешение на apply или записи. Root
передаёт эксклюзивное окно после своего final release. До исполнения отдельный
private packet связывает clean implementation HEAD, migration SHA, точные
helpers/commands, immutable local target и свежий baseline с допустимыми эффектами.
Авторизованные credentials используются только внутри процесса. Не менять роли,
пользователей или чужие записи ради получения удобного тестового состояния.

1. Read-only preflight: текущий ledger001–227, actual table inventory, полный
   baseline/old-row hashes и текущие QA case/program/slot/revision IDs. Старый
   B226 receipt не считается текущим freeze. При изменении исходных условий
   остановить зависимый шаг и пересобрать конкретный packet.
2. Применить228 один раз только после review/передачи окна. Четыре новые private
   таблицы пустые, у прежних reservations новый nullable context равен NULL;
   прежние columns/rows остальных таблиц неизменны. Проверить actual функции,
   ACL и clones по exact manifest. Обратное удаление append-only данных не cleanup.
3. На уже согласованных программах A/B одного технического QA-дела: сохранить
   реальный разрешённый PDF через обычный Student UI. Проверить сохранённую версию
   и чистый scan; submission/queue/global current/legacy review не появились.
   В B нет заимствованного статуса принятия A.
4. Отправить A отдельной кнопкой, повторить тот же request и конфликтный вариант
   в согласованном bounded protocol шаге. Создана одна immutable submission;
   потеря ответа не порождает новую отправку. Admin видит точные файл и программу.
5. Проверить отправку сотрудником, прочитать уведомление Student и перейти к
   exact review/version. Сохранить новую draft-версию: прежняя отправленная и
   проверенная версия остаётся видна, новая сама в review не попадает. Скачать
   обе разрешённые exact версии; чужой case/application и revoked grant запрещены.
6. Отдельный согласованный226 save меняет требование. История сохранит старые
   definition/deadline/file/review; editor и recovery работают. Повтор уже
   зарезервированной загрузки завершается на старом intent, новая reservation
   по устаревшему item не создаётся. Removed item остаётся в истории программы.
7. Проверить неизменённые legacy/manual/visa, approved-current replacement и ZIP
   guard на существующих допустимых данных. Если исходное состояние отсутствует,
   отметить непроверенную ветвь; не создавать произвольный бизнес-сценарий.
8. Web desktop/mobile и доступный iPhone changed path: обычные controls, реальные
   responses, download, понятные Save/Submit/Review состояния. До разблокировки
   Mac native UI не заявляется. Не более двух batched visual rounds Impeccable.

Каждая фактическая запись должна соответствовать frozen intent/receipt; сравниваем
все прежние строки и whole-table complement, исключая только доказанные новые IDs.
После работы закрываем только свои sessions/browser/Next и выдаём final RAW
receipt с ledger, исходниками, объектами/эффектами и непроверенными ветвями.

Полные пакеты B3g, широкая финальная E2E, контентная волна и App Store readiness
остаются отдельными последующими блоками по решению пользователя.
