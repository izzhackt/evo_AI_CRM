# B3g / 232 — отправка и проверка комплекта программы

Precode 21.09.2026, main `7aad173f83ec612854e3b5553225611ea4811127`.
Основание — §11 принятого [плана](../EVO_CRM_UX_AND_ADMISSIONS_PLAN_2026-09-20.md),
[контракт B3f](b3f-program-document-submission-contract.md) и его
[принятая локальная QA](b3f-program-document-submission-qa.md).
ROOT принял функциональное направление и резервирует 232 для B3g.1; 231 — website.
Миграция 230 зарезервирована ROOT для исправления записи аудита платёжного чека.
До реализации нужен независимый exact-head review. Runtime/DDL/Auth/Storage
принадлежат отдельному будущему окну ROOT; этот precode разрешает только offline работу.

## Результат и сохранённые правила

Студент собирает в существующей подготовке214 полный состав, видит выбранные
версии и недостающие пункты, затем явно отправляет комплект EVO. Сотрудник проверяет
его документы и отдельно подтверждает состав. Исправление создаёт следующий
комплект, сохраняя прежние файлы и решения. CRM, веб и iPhone используют одну запись.

- Подготовка сразу открывается после выбора программы. Новых условий оплаты,
  договора или одобрения самого выбора нет; прежний assisted/ownership доступ сохранён.
- Отправка отдельного файла228 остаётся доступной независимо от полноты комплекта.
- Первая отправка комплекта требует все обязательные материалы и техническую
  доступность выбранных версий, без предварительного одобрения файлов сотрудником.
- Отправляется непустой состав. Необязательный материал можно исключить до отправки;
  исключённый optional не блокирует готовность. Включённый optional является частью
  зафиксированного состава и виден сотруднику для проверки.
- `evo_starter/needs_confirmation` допускается при той же readiness. Явная подпись
  «Стартовый комплект EVO» сохраняется в отправке и истории; его проверка не означает
  полный перечень университета. Новый confirmed-only gate не вводится.
- «Пакет проверен» — отдельное действие сотрудника после проверки обязательных
  материалов и состава. Оно не меняет university application stage/status и не
  означает отправку в университет. «Проверяется» без отдельного реального действия
  не показывать; достаточно подготовка / отправлен / нужны исправления / проверен.

## Источник истины и существующие ограничения

`214` хранит immutable org/case/application/institution/publication/program/intake
binding; оба существующих входа Student и staff используют эту подготовку.
`226` даёт exact revision, определения, required, сроки, material/slot и predecessor.
Каждое сохранение создаёт новые item IDs. Пункты файловые, от 1 до 100; новый тип
текстового ответа, галочки или анкеты в этот блок не входит. Эссе сохраняется файлом.

`228` даёт scan/finalization/Storage-backed версии, immutable individual submissions,
их reviews, reusable files, историю и exact download. Readiness комплекта нельзя
считать по legacy `currentVersionId`: contextual draft его специально не меняет.
`canSubmit` — право на операцию, а не готовность выбранного файла.

Один файл в разных программах использует одни bytes, но разные submissions/reviews.
В одной программе tuple `(revision,item,version)` переиспользует existing submission.
Пакет должен ссылаться на неё; загрузка и проверка не дублируются ради нового состава.

## Три новые private границы

RLS и отсутствие прямого client DML, tenant/case composite FKs, append-only guards.
Actor определяется текущим Auth на сервере. Клиент не задаёт доверенные snapshots,
права, timestamps, решение по чужому документу или подтверждённую готовность.

| Ресурс | Что фиксируется |
| --- | --- |
| `application_package_submissions` | org/case/application/binding214, revision226, versionNo, predecessor package, ordered composition hash, actor/time, exact request/intent/receipt; immutable заголовок отправки |
| `application_package_items` | package + current requirement item, frozen definition/material/deadline/required, slot/version, exact individual submission и происхождение выбранного файла; без бинарных копий |
| `application_package_reviews` | package, staff actor/time, approved/correction_required, reason и связанные пункты, exact current document review IDs и отдельно доказанные reuse references, immutable intent/receipt |

Снимок программы берётся из immutable binding/publication; требования — из exact
revision. Нельзя принимать присланные клиентом названия/сроки за снимок сервера.
Проверки прежних файлов фиксируются конкретными ID. Динамический helper228,
возвращающий последнюю review, не является неизменяемым доказательством пакета.

## Команды и чтение

Предполагаемые имена — новая namespace `application_package_*_v1`; существующие
individual RPC228 и восемь полей notification feed сохраняют wire-совместимость.

| Операция | Intent и результат |
| --- | --- |
| Preparation/readiness | case/application; current revision, latest package/result, selectable exact versions, selected composition и конкретные missing/unavailable причины. Server preview принимает явный список selections и ничего не записывает. |
| Submit | case/application, expected revision, ordered item selections, expected previous individual submission IDs, expected previous package ID, request ID. Одна атомарная операция создаёт/переиспользует individual submissions и фиксирует весь комплект. |
| Package review | package ID, expected previous package review ID, approved/correction_required, reason/affected item IDs и exact expected document review vector. Server повторно проверяет authority, доступность и применимость доказательств. |
| History/detail | exact package ID либо scoped keyset `(submittedAt,id)`, default20/max50; exact definitions/files/reviews и актуальные access/availability без изменения истории. |
| Staff queue | действующая case scope/permissions, реальные ожидающие комплекты, Student/program/deadline, состав и непринятые материалы. Уполномоченная очередь видит нераспределённые дела; auto-assignment отсутствует. |
| Student notification detail | own notification ID → exact package/review и связанные файлы; deep link на программу и конкретное исправление. |

Точный JSON codec и ошибки одинаковы в TypeScript/Swift и фиксируются до UI:
UUID, положительные bigint versions как decimal strings, server timestamps,
полный набор полей; unknown enum/shape не становится success. Client хранит frozen
pending intent по org/membership/case/application и повторяет тот же request.

Восстановление отправки и проверки комплекта доступно отдельно от текущей формы
и строк очереди. После перезагрузки, исчезновения проверенного пакета из очереди
или смены редакции требований UI показывает сохранённый точный состав/решение
только текущего владельца и повторяет исходный request. Новая форма не заменяет
неподтверждённую операцию. Очистка допустима лишь после валидного receipt либо
серверного доказательства `not_written`; отзыв доступа сохраняет privacy boundary
и не превращается в разрешение повторить действие от другого пользователя.

## Атомарность, повтор и устаревший контекст

- Перед записью проверить current revision и каждый mapped slot/link/material,
  все required item IDs, отсутствие дублирующихся/чужих items, выбранные versions,
  их actual finalization/integrity/scan/Storage availability. Отсутствующее/неизвестное
  состояние не означает готовность. Весь submit откатывается при ошибке одного пункта.
- Один request с тем же canonical intent возвращает receipt после актуальной
  авторизации. Другой intent с тем же request — конфликт. Unknown result сохраняет
  frozen intent; новый request не создаётся ради сетевого повтора.
- Повтор той же revision/composition у последнего пакета возвращает его с признаком
  reuse. Изменённый состав требует expected previous package; чужое обновление
  возвращает stale с предложением перечитать состояние, сохраняя локальный выбор.
- Preview не является authority: submit заново разрешает всё под locks. При новой
  редакции требований не переназначать item IDs молча и не отправлять старый состав
  как текущий. Exact idempotent replay прежней успешной команды сохраняет её receipt.
- Lock order: все package и заранее выведенные child request IDs → actor/org/
  membership → case → application → sorted slots → sorted versions/submissions.
  Все request locks получить до organization lock; простого цикла публичных228
  команд под уже взятым org lock быть не должно. Допустим один DB batch adapter,
  вызывающий228 только после полного детерминированного prelock набора; доказать,
  что он не вводит новых request locks внутри цикла. Никакого цикла HTTP mutations.
- Доступ переопределяется после locks. Для package approval latest review vector
  должен совпасть с просмотренным expected vector; concurrent negative decision
  не может пройти незаметно. Повтор не создаёт лишний audit/notification.

## Проверка и повторное использование

Обязательные включённые материалы должны иметь подходящее approved доказательство.
Для optional, включённых в отправленный состав, финальная проверка также требует
approved доказательство сотрудника; файл с known correction/rejection или технической
недоступностью нельзя молча включить в approved комплект. UI перечисляет эти
причины рядом с финальным действием. Требование предыдущего одобрения не применяется
к Student submit, только к итоговой staff-проверке.

В той же revision пригодная accepted exact version переиспользует её submission/
review. После226 новая item identity автоматически ничего не наследует. Reuse
старого approved возможен только при сервером доказанной predecessor-цепочке
в той же программе и неизменных definition/material/slot/exact version. Staff
явно подтверждает применимость прежней проверки при проверке нового состава;
фиксируются исходный review и новое current-context подтверждение. Existing228
очередь не должна продолжать показывать такой подтверждённый документ как никогда
не проверенный. Никаких fabricated reviews от имени студента или переноса A → B.
Changed/uncertain definition требует новой проверки; прошлое свидетельство видно.

Механизм явного reuse: package review intent содержит отдельный список
`reuseApprovals` с current item/submission, expected current review, source
submission/review. Staff preview показывает каждую такую связь. Сервер доказывает
полную цепочку и равенство определения, слота и файла, проверяет, что source review
остаётся последним approved, а current submission ещё не получила отрицательную
проверку. Старым approval нельзя перекрыть новый correction/rejection.
При ещё не проверенной current submission staff-команда атомарно вызывает
existing228 review(approved) с заранее выведенным child request ID; результат
действительно записывается от действующего сотрудника. Package review сохраняет
оба точных ID: новый current review и `reusedFromReviewId`. Individual receipt и
его audit остаются228-формата, происхождение reuse хранится в package intent,
evidence vector и его audit. Нет изменения старого review или специальной фиктивной
записи, которую обычная очередь не понимает. Если current review уже approved,
он используется без дополнительной записи. Все child request IDs известны и
блокируются до org lock; ошибка доказательства откатывает и reviews, и решение
пакета. SQL review должен проверить этот единый путь до кода.

Исторический пакет сохраняет результат и review IDs. Более поздняя отрицательная
review файла показывается отдельным актуальным предупреждением; она не переписывает
прежнее решение и не позволяет переиспользовать утратившее применимость approval
в новом пакете. Возврат пакета требует конкретное замечание; affected items обязаны
принадлежать его составу, общее замечание к составу тоже допустимо.

## UI и Impeccable Operate

Сохранить EVO/Атлас/Golos, текущие ProgramDocument controls и native navigation.
Web: компактный блок «Комплект» в существующей preparation, список выбранных
версий и missing items, один основной CTA. До отправки человек видит exact состав;
новый draft не заменяет выбранный принятый файл молча. Optional явно включается.
Результат отправки показывает server time и link в историю. Не рисовать процент
готовности по числу файлов без проверки обязательных материалов.

CRM: дополнить существующее admissions-пространство переключением документов/
комплектов и detail конкретного пакета; сохранить все individual actions и права.
Проверка файла использует existing228 action; подтверждение комплекта отдельное.
Case link, unassigned visibility и замечание к точному файлу остаются доступны.

iPhone: тот же состав/операции в ProgramPreparation, системный navigation stack
и sheet для preview, safe areas, Dynamic Type, штатные кнопки44pt и RU/KY. На mobile
web — одна колонка и прокрутка без перекрытия CTA нижней навигацией; действия
доступны клавиатурой/касанием. Ошибка хранения pending не обещает сохранение запроса.
Плановые visual passes — desktop/mobile одной партией, затем не более одной
партии подтверждения исправлений. Native screenshots только из настоящего
Simulator/устройства при доступе; compile/Swift checks не native UI acceptance.

## Совместимость и границы поставки

Не менять global document slot current/status, legacy document reviews, application
стадию, approved ZIP guards169 или Storage/scanner/upload/download протокол.
ZIP169 читает global current+legacy approved; новый пакет не объявляется доступным
для такого экспорта автоматически. Внешняя отправка университету не входит в B3g.

B3g.1 /232: server/resource/readers + общий wire/codec/pending, scoped SQL/TS/Swift
проверки, independent review. B3g.2: CRM/web/iPhone UI и notification detail по
зафиксированному wire. B3g.3: согласованный actual changed-path packet после
передачи локального окна; это части одного результата, не три заявления «всё готово».
Каждый кодовый diff сохраняет launch-control и coordinated main/schema ownership.

Нужный actual QA: incomplete → конкретная причина; ready без staff approval →
submit; явные file/package decisions; одно исправление → новая версия с reuse;
историческое notification/download; same-request replay/conflict, stale revision,
чужой case/program и подтверждение unassigned queue по допустимой роли. Отдельно
проверить reviewed-file race и неизменённые global/legacy effects в затронутом пути.
Включить потерянный ответ после успешной записи → reload: staff recovery остаётся
доступным после ухода пакета из очереди, Student recovery — после смены revision.
Показанный состав/решение и повторяемый request должны совпадать с исходными;
ни исчезновение строки, ни новая форма не очищают неизвестный результат.
Базовые rows сохраняются; новые эффекты считаются по exact receipts. Native UI
только при реальном доступе. Broad final E2E/content/App Store и весь1–36 не закрываются.

Архитектурные источники проверены21.09.2026: [PostgreSQL17 locks](https://www.postgresql.org/docs/17/explicit-locking.html)
и [isolation](https://www.postgresql.org/docs/17/transaction-iso.html) обосновывают
атомарную запись и единый порядок блокировок; [Supabase functions](https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker)
— явные EXECUTE grants/revokes и фиксированный search_path для definer. Это
основание проектирования, не свидетельство исполненной B3g runtime-проверки.
