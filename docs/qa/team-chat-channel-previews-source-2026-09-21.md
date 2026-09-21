# A237: source-проверка reader/DTO, 2026-09-21

Текущий статус: source и ограниченная локальная SQL/Auth/RPC-проверка приняты
независимым review. [Actual и закрытие сессий](team-chat-channel-previews-actual-2026-09-21.md)
относятся к `bb24f35f6d44ed227021368acbc41f9c0f8e7278`; final integration/CI/review
ещё впереди. Подключение UI остаётся отдельным следующим блоком.
Это первый блок [принятого плана](../EVO_TEAM_CHAT_CHANNEL_PREVIEWS_PLAN_2026-09-21.md).
Plan/journals commit `eac7a504` предшествует source commit
`8104e106ab4da839e99a49007f180cbdad83a9ed`, base main `24e78024`.

## Изменение

Существующий `team_chat_channels` получает nullable latestPreview для каждого
разрешённого канала: автор, ограниченный текст, id/sequence/version и tombstone.
Миграция237 использует нынешний индекс и один общий запрос; unread и actor/ACL
предикаты225 сохранены. SQL156 остаётся authority для custom staff scopes.

Repository вызывает единственный strict decoder: missing/invalid projection
даёт unavailable, подтверждённый null означает empty. Отдельный pure acceptance
helper проверяет порядок request tickets и sequence/version, исключение каналов
и противоречивые identities. Helper пока не подключён к UI; это контракт для
следующего rail блока. Активные компоненты, feed/seen/Composer и realtime не менялись.

## Выполненные проверки

Node22.23.1; существующие зависимости переиспользованы после совпадения
package.json/package-lock.json. Команды выполнялись в новом owned worktree.

| Проверка | Результат и предел |
|---|---|
| `node --conditions=react-server --experimental-strip-types --test tests/team-chat-channel-previews.test.mjs` |16/16 PASS; pure wire/order примеры, не DB/Auth/данные реальных каналов.|
| `npm run typecheck` |PASS; после добавления проверки cross-channel identity повторён `tsc --noEmit`, PASS.|
| ESLint для двух изменённых lib файлов, нового helper и test |PASS, 0 errors/0 warnings на финальном source.|
| Exact source extraction225→237 |Actor guard, оба unread subqueries и завершающий authorization/return блок побайтно совпадают. Это source-проверка, не выполнение SQL.|
| `git diff --check` |PASS.|

Protocol cases: mandatory nullable поле; malformed/extra preview; известные
уникальные каналы; глобальная уникальность message id/sequence; Unicode240/241;
BIGINT без потери точности; tombstone без body; поздний request не возвращает
исчезнувший канал; старый текст/version не заменяет подтверждённое удаление;
identity contradiction отклоняет update; входные объекты не мутируются.

Финальные локальные logs:

- `protocol-tests-final.log` SHA256 `7e745d3783f4cf50c91499f43465ae62d1f3027e9c01f5ec130ca218dcc03b70`.
- `typecheck-final.log` и `lint-final.log` — успешные команды без вывода,
  SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Source receipt SHA256 `006234230c29bc6b963c80a6d9c27acac6c3e99f9f3839d839612185946ee927`.
- Private local packet: `/private/tmp/evo-team-chat-channel-previews-source-20260921`.

Диагностика сохранена честно: первые15 cases прошли до дополнительного случая
cross-channel identity. Первый SQL-parity extractor выбрал раннюю seen function
из225; после ограничения extraction именно channels function проверка прошла
без правки SQL. Первоначальный lint warning unused test binding исправлен.
Попытка выгрузить старые context-firewall spans не сработала (`cfw shim: no stored
spans`); пустые attempted-export файлы не являются логами прогона. Финальные16
cases запущены после изменения decoder/test и записаны напрямую. Стандартное
Node MODULE_TYPELESS_PACKAGE_JSON warning осталось; проваленных tests нет.

## Исторический остаток на момент source8104e106

Ниже сохранено состояние до интеграции236 и последующей actual-проверки237.

ROOT236 / PR#1016 пока отсутствует в sourcebase main24e78024: в базе001–235,
наш237 не делает её непрерывной до237.236 не копировалась/не создавалась здесь.
До финального CI/actual237 требуется интеграция236 после её merge.

Shared QA остаётся ROOT236, затемB1015. Миграция237 не применялась, запросов
SQL/RPC/Auth, новых actors/fixtures/grants, browser/server/runtime действий не
было. Реальный допустимый набор, отрицательные permission cases и effects
связываются будущим отдельным принятым packet после передачи окна.
Нужны independent source review, actual RPC/ACL и closure evidence, protected
exact-head CI и финальное review до merge. UI второго блока начинается после
этого merge. Весь item15,1–36 и production этим source не закрыты.


## Более поздняя интеграция236 — 2026-09-21

Зависимость выше разрешена после source review: #1016 смержен в
`9f7dde1d8b040d555af647a2b89628d06d6b921f`, включён merge commit
`3e72c42736197929156288b4292e2d9e79767c2f`. Все пять проверенных A237
source/test/SQL файлов равны9fc0785c; импортированные product/tests/документы
ROOT236 равны main9f7. Две истории launch/PLAN_CHANGES сохранены как ordered
subsequences. Repo inventory001–237 непрерывен; это не применение237 к базе.

Изменились12 импортированных путей относительно9fc, включая отдельный staff
country reader/страницу каталога: полная продуктовая tree не объявляется прежней.
Чат/UI/feed/seen/Composer и A237 protocol assertions не менялись; локальные
product tests не повторялись. Diff/whitespace/parity проверены. Требуются fresh
protected CI и exact-head integration review; actual237 всё ещё ждёт B1015
release и принятого observer/apply/RPC packet. SOURCE_ONLY не означает merge GO.

## Последующая actual-проверка и текущий остаток

На неизменном sourcebb24f35f один локальный apply237 и четыре ordinary
Auth/PostgREST probes завершены. Независимые DDL reviewe133a066 и RPC/closure
review97acb1ae приняты. Исходные source-only ограничения выше являются историей,
а результаты и непокрытые варианты перечислены в отдельной actual-квитанции.
ROOT выпустил handoff07d28083 после полного final3610d43f; ресурс QA снова у
ROOT_COORDINATOR, повторных runtime-вызовов A не требуется и не планируется.

Нужно интегрировать актуальный main после #1015, сохранив пять A237 source/test/SQL
файлов, пройти protected CI и независимый final-head review. Старый CI35639431195
наbb24f35f успешен, но не подменяет проверку нового integration head. Следующий
rail UI блок начинается после merge #1017; весь item15/1–36 и production не закрыты.
