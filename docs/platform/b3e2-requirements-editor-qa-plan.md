# B3e-2 / 226 — локальный QA: план и результат

**Результат 2026-09-21:** разрешённые Q1–Q3 выполнены на `6cdacc76` через
обычный Admin UI; 14 read-проверок и Student UI пройдены. Подробности,
квитанции и непроверенные расширения — [фактический отчёт](b3e2-requirements-editor-qa.md).
Ниже сохранён исходный план до исполнения; его будущие формулировки описывают
историческую точку согласования, а не текущий статус.

Статус: план до execution. Основания — [контракт226](b3e2-requirements-editor-contract.md),
[wire226](b3e2-requirements-editor-wire.md), [фактический read224](b3e1-requirements-v2-read-qa.md).
Этот документ не разрешает apply, Auth, UI, создание записей или конкурентные
команды. Сейчас разрешена только подготовка исходников. Root отдельно принимает
exact-head review, конкретные scripts/effects packet и передаёт эксклюзивное окно
после A225 → root32 → ROOT09d. Root32 уже освободил001–225/282 tables, но сейчас
окно принадлежит ROOT09d; его будущий final release и fresh snapshot должны стать
baseline B. Прежний root32 release не freeze актуальных данных. Production и
managed Supabase сюда не входят.

## Цели и исходные записи

Проверить ordinary staff editor/save/readback и общий Student v2 на двух уже
существующих preparation одного локального технического дела. Использовать
существующих Admin и Student1 из B224. Не создавать пользователей, роли, дела,
заявки, публикации, manifest или файлы; не сбрасывать данные и не seed-ить фикстуры.

Приватные B224 `student-0-v2.json` и `student-1-v2.json` подтверждают на дату224:
разные application IDs одного дела, обе revision1/evo_starter, по два пункта,
одинаковая пара documentSlotIds, current file отсутствует. Ниже это **A** и **B**.
Это исторический выбор целей, а не свежая eligibility. ID, credentials, исходные
ответы и точные request IDs остаются в приватном packet, не в Git.

После ROOT09d final release требуется свежая инвентаризация: immutable local container
и Unix endpoint; ledger001–225; ожидаемые282 business tables; actual Auth counts;
active case/portal, preparation status и214 binding обоих targets; текущие
revisions, slots,113 links и полный inventory137/179. Сверить owner с ordinary
Student и scoped доступ Admin. Не предполагать прежние Auth8/8 или отсутствие
legacy sources по старому224. При drift — новый root review намерения, без
автоматического исправления данных или переключения на другое дело.

## Admission, preflight и apply один раз

1. Зафиксировать финальный clean source HEAD, SQL226 SHA, migration manifest,
   необходимые TS/SQL/protocol проверки и independent exact-head reviews.
   Привязать helpers к этим байтам и к свежему ROOT09d final release/snapshot SHA;
   immutable container ID, endpoint, project/ownership labels проверять целиком.
   Старые224 helper pins не являются разрешением или актуальным baseline.
2. Отдельно review будущих observer/apply/ordinary-session helpers. Observer —
   SELECT-only transaction, closed output, create-only private0600 receipts;
   credentials и session responses только в процессе. Не исполнять helper при
   review/import. Никакого provision/retry Auth или service-role business path.
3. До once-apply закрыть вопрос engine preflight. `pglast` разбирает синтаксис,
   но не доказывает существование runtime функций/колонок и выполнение лениво
   компилируемых PL/pgSQL branches. Сначала статическая сверка всех вызываемых
   signatures/relations с миграциями001–225 и, только в разрешённом окне,
   SELECT-каталогом точного baseline. Не объявлять её runtime proof.
4. Предлагаемый root-вариант — **явно rollback-only technical transaction**:
   exact reviewed226 DDL, editor read/context, transient full save двух starter
   материалов и одного QA-labelled optional custom, equal replay, full v2 и
   ожидаемый current-v1 error; затем гарантированный ROLLBACK в той же connection.
   Executor обязан явно обработать outer BEGIN/COMMIT миграции и проверить
   отсутствие другого commit/внешних эффектов; просто вложить226 в BEGIN нельзя.
   Фиксировать ровно один transient save intent; сохранить результат каждого
   probe, не подменяя университетские факты и не получая persistent ledger226.
   Identity claims для SQL probe можно брать только из успешного ordinary Auth
   существующих approved Admin/Student в выделенном GO, с проверкой identity по
   приватному packet. Никаких выдуманных actor IDs/roles; claims/tokens process-only.
   Установка verified claims в SQL session **не является** проверкой ordinary
   PostgREST authorization/path: это лишь object-resolution/transaction probe.
   После ROLLBACK полные282 table/schema/functions/ACL/ledger и catalog parity
   должны вернуться к fresh baseline; Auth counts сверяются отдельно от sessions.
   При разрыве connection/неясном rollback сначала новый observer, не apply.
   Альтернатива — отдельно одобренный disposable clone того же baseline. Оба
   варианта требуют отдельного exact script/actor/effects review и root GO;
   сейчас временный DDL, SQL claims, transient saves и clone не разрешены.
   Расширения/постоянные schema изменения ради preflight не устанавливать.
5. Если root решит обойтись без такого preflight, явно записать непроверенный
   риск разрешения имён до единственного transactional apply. Первый сбой
   сохраняется; не заменять helper names и не повторять apply без нового review.
   После потери ответа сначала определить ledger/schema состояние чтением.
6. Непосредственный before-apply snapshot, включая после разрешённого rollback
   preflight, должен совпасть с latest released baseline. Root — единственный
   executor226: затем один actual immutable CLI apply. После commit проверить exact DDL,
   ACL/FORCE RLS/guards и единственную запись226; прежний ledger неизменён.
   Новых business rows от apply быть не должно. Actual ordinary PostgREST/UI
   saves/read parity ниже обязательны после принятого after-apply receipt и
   отдельного frozen mutation packet; technical SQL probes их не заменяют.

## Parity с учётом расширения старых таблиц

До apply — полный snapshot282 tables, schema/functions/ACL/ledger, Auth user и
identity counts. Не сравнивать содержимое Auth sessions: ordinary login меняет
сессию, а равенство counts не доказывает полную неизменность Auth.

226 добавляет nullable columns в две существующие append-only таблицы. Поэтому
сырой `to_jsonb(row)` hash старых строк может измениться от одной новой формы
строки, без UPDATE. Проверка apply должна отдельно подтвердить:

- counts и **все прежние columns** revisions/items совпадают с before-apply;
- у всех прежних revisions `previous_revision_id`, `change_reason`,
  `source_snapshot` равны NULL; у прежних items `predecessor_item_id`,
  `material_snapshot`, `provenance`, `deadline`, `definition_impact` равны NULL;
- остальные280 table hashes совпадают без исключений; tables остаётся282;
- изменились только перечисленные в exact SQL manifest functions/constraints/
  triggers/ACL и ledger226. Не считать любые новые helpers разрешёнными по prefix.

После apply зафиксировать новый full-row baseline **до business saves**. Для
каждого save сохранять scoped graph и whole-table complement counts/SHA на том
же рецепте сортировки/JSONB/encoding, что baseline. Исключать только новые IDs,
доказанные конкретным request receipt, actor, org/case/application; не весь case,
не все строки с QA-префиксом и не весь изменившийся table. Старые строки,
receipt/audit,113 links,137 facts/exceptions,179 manifest,214 bindings,
catalog/import/publication, application versions, файлы/reviews неизменны.

## Предлагаемая минимальная серия: три успешных save

Все три — намеренно технические записи локального QA-дела, не подтверждение
требований реального университета. `changeReason`/basis содержат один принятый
root run tag и явное «локальная техническая проверка226; не требования вуза».
Новый optional item также имеет явную QA-подпись. Значения, source decisions,
expected tokens и возможные новые ID фиксируются в приватном intent packet.
Product-generated request/key UUID допускаются только после отдельного
разрешения такого способа генерации и сохраняются сразу; не подставлять UUID в
React/sessionStorage и не изготавливать payload через скрытую UI-инъекцию.

При подтверждённом fresh inventory без дополнительных legacy sources:

| Шаг | Явное ordinary действие | Ожидаемый результат и новые строки |
| --- | --- | --- |
| Q1 | Admin сохраняет A: переносит оба starter item с прежними keys/definitions/materials; явно включает каждый prior/link source. | A revision2, staff_confirmed/confirmed; revisions+1, items+2, audit+1; slots/links+0, versions двух старых slots прежние. |
| Q2 | После свежего editor read Admin сохраняет B: те же два фактических материала, отдельные source decisions B. | B revision2; revisions+1, items+2, audit+1; slots/links+0. Две full revisions используют те же материалы одного дела. |
| Q3 | Admin открывает свежую A, сохраняет новую revision с переносом обоих прежних items и одним явно optional QA-item, material=new custom. | A revision3; revisions+1, items+3, audit+1, slots+1,113 links+1. Новый slot пустой/status required; это не обязательность program item. |

Итог core series: **revisions+3, items+7, document_slots+1,
document_slot_case_links+1, audit_events+3**; только эти пять tables меняют rows.
Новый slot создаётся version1 и получает один114 link bump до version2;
старые slots не bump-ятся. Зафиксировать это против final SQL и actual receipt,
не исключать его UPDATE из проверки молча. Никаких document_version, binary,
review, task или notification. Новые rows связываются с ровно тремя save requests.

Все deadline остаются null: не выдумывать университетские сроки ради QA.
Optional item имеет новый product-generated `r.<UUID>`, старые keys сохраняются;
existing metadata и текст не переписываются. После каждого save — immutable
receipt, отдельный latest readback, graph/count/hash check. После Q3 одновременно
видны historical A revision2 и latest A revision3; полный Student/Admin v2
сопоставляется по фактическим raw responses и реальным decoders.

## Проверки без дополнительных успешных save

| Проверка | Конкретное выполнение после отдельного packet approval | Дельта |
| --- | --- | --- |
| Exact replay | Повторить Q1 с исходными requestUUID и payload **после Q3**, под тем же разрешённым actor. | Тот же historical receipt A2, latest остаётся A3;0 rows/versions/audit. |
| Request conflict | Один replay requestUUID с изменённым ordered items либо reason; остальные параметры валидны. | Exact request_conflict;0 изменений, исходный receipt неизменён. |
| Stale | Сохранить private editor context A2 до Q3; после Q3 отправить один новый intent с прежними tokens. | Exact stale_context;0 изменений. В UI текст остаётся, refresh показывает actual A2→A3 diff; tokens не обновляются молча. |
| Cross-case | Existing Admin вызывает editor/save с foreign existing case ID и application A из другого дела; только заранее закреплённая несовместимая пара. | Forbidden, без чужих полей и0 записей. Это tuple guard, не доказательство scoped non-admin доступа. |
| Student/anonymous denial | Ordinary Student не может staff editor/save; anonymous не может staff read/save. Минимальные заранее reviewed запросы. | Отказ,0 бизнес-изменений; никакой смены role/claims. |
| V1 на full | Current Student/Admin v1 читает A/B после full save. | client_update_required; не старый starter и не пустой успешный список. |
| Historical218 init replay | Найти исходный218 request/intent/receipt и actor приватным metadata read; ordinary exact replay после full. | Прежний218 receipt, latest full не меняется;0 effects. При отсутствии доказанного original intent — gap, не новый «исторический» запрос. |
| Read parity | Student/Admin actual v2 A/B, актуальный editor read; повторные чтения и refresh/reload. | Одна актуальная revision, совпадающие shared поля; full snapshot/complements без изменений. |

Cross-case/Student negatives не заменяют отдельную проверку staff assignment.
Один plain permission failure не доказывает tenant boundary, если actor ещё до
resource lookup не имел права на команду: в receipt различать эти проверки.

Unknown outcome/recovery требует отдельного reviewed способа потерять только
клиентский ответ одного уже разрешённого Q1–Q3, сохранив actual server evidence.
Не добавлять production test hook, не останавливать общий DB/Auth и не создавать
четвёртый save только ради демонстрации. После reload пользователь явно повторяет
тот же retained intent; receipt доказывает ровно один commit. Если безопасный
fault-injection способ не разрешён, отметить runtime gap; pure helper tests не UI.
Account switch проверить обычным выходом/входом существующих аккаунтов: чужой draft
скрыт, owner guard запрещает replay. Никаких Auth/role mutations для revocation.
Recovery после изменения lifecycle должен оставаться доступен через «Проверить
сохранение списка», если сохранён226 pending и есть доступ к чтению. Это не
разрешает новый save при `canSave=false`. Изменять lifecycle существующих targets
в core series нельзя; без отдельного согласованного сценария эта UI-ветвь имеет
только source review, а не actual runtime proof.

## Конкурентность — отдельные условные расширения

Не входят в три saves и их delta. Root заранее принимает actors, точные команды,
barrier/наблюдение, дополнительные IDs и максимальный delta; иначе gap.

- **Два save:** только при наличии уже существующих разрешённых actors. Два
  разных intents с одним fresh context: один commit, другой stale; проверить
  единственную новую revision и отсутствие частичных slot/link/audit effects.
  Две вкладки одного Admin отдельно проверяют client Web Lock/busy и общий pending;
  это не two-staff authority acceptance. Без второго staff не создавать роль.
- **Save vs slot:** выбрать только созданный Q3 QA custom slot; отдельная штатная
  metadata-команда108 может менять его техническую подпись, одновременно с
  reviewed save. Не трогать общие passport/photo, файлы или reviews. При победе
  slot command save должен увидеть stale; при победе save последующее изменение
  metadata должно дать masked mapping issue при read. Зафиксировать оба outcomes,
  actual lock/order и точные командные effects. Не считать гонкой последовательные
  вызовы без доказанного overlap и не обещать обе ветви по одному запуску.

## UI, сохранность доказательств и release

Проверить ordinary editor → review diff → save → receipt/readback → reload и
Student full list. Desktop и один mobile viewport одной batched visual round:
source rows не исчезают за фильтром, material не выбран автоматически, required
и file-review не смешаны, ошибки имеют focus, кнопки доступны, horizontal overflow
нет. До двух visual rounds по принятому Impeccable contract, без расширения scope.

После каждого отказа сохранять raw private response, исходный intent и observer
receipt; не повторять запрос с новым UUID для получения green. Apply/QA logs и
частичные результаты не перезаписывать. Сбой readback после valid save receipt —
known success плюс read failure, не повод создавать новую revision.

Final release receipt: final source/SQL/helpers SHA, исходный root window,
001–226 ledger, approved actual IDs/effects, old-row/complement parity, Auth counts
с оговоркой о sessions, результаты/пропуски каждой фазы. Закрыть только свою
вкладку/server/порт и передать окно root. QA append-only rows остаются; reset,
удаление новых записей или откат на старый v1 runtime не являются cleanup.

## Границы доказательств

- Existing Admin не доказывает non-admin scoped save; создать scope ради QA нельзя.
- В224 были starter-only цели. Actual137/179 adoption, omissions/mustRetain и
  malformed legacy конфигурации требуют уже существующих подходящих данных и
  отдельного frozen packet. Не включать playbook/manifest и не портить137 facts
  ради negative test; при отсутствии условий эти ветви остаются непроверенными.
- Здесь не проверяются реальные university facts, deadline, upload, unsafe-file
  обработка, reviewer acceptance, submission/package/provider или real-customer flow.
- TypeScript/Swift actual raw-response decode и native build не доказывают current
  iPhone UI. Native UI фиксировать только при доступном разрешённом runtime;
  старые224 screenshots не evidence нового editor/full backend.
- Этот proposed plan и protocol fixtures не означают выполненную миграцию226,
  engine preflight, production rollout или полную бизнес-приёмку.
