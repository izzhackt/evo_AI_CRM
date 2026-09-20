# CRM-03 — единая очередь заявок: текущие доказательства

Контракт до кода:68474063, принят root и независимым review. После #962 runtime
начат на integration e789ffd7/main23036454. Очередь первоначально получила220; после выявленного реальной219 QA дефекта
прежнего184 helper root перенёс её на221. Forward220 принадлежит исправлению
этого helper,221 ожидает220 и собственное GO. Этот документ не утверждает применение221.

Новая scoped read-проекция объединяет существующие lead, application,
consultation с независимыми прежними authority. PERFORM existing
private.staff_sales_lead_page(1) реально выполняет полный111 integrity guard;
его ограниченный результат не используется. Unexpected23514 не подавляется.
Filter/count/page работают в одном STABLE snapshot; DTO формируется только для
выбранной страницы. Порядок created_at/submitted_at DESC, kind C DESC, UUID DESC.
Microseconds не округляются в cursor. Default applications=pending,
consultations=all; приложение не обещает snapshot между изменяющимися чтениями.

Сохранены approval/rejection/handled commands, optimistic guards и preview.
Страница показывает вид/источник, статусы и точный охват счётчиков. Недоступный
kind имеет null count; общий технический отказ не становится пустой очередью.
Validated returnTo сохраняет source/status/limit/cursor при переходе в карточку
и между её вкладками. Только внутренний /v3/requests; внешние/двусмысленные
адреса отклоняются. Retry сохраняет context; смена фильтра очищает cursor.

## Проверено до локального применения

- Node22.23.1, npm ci --ignore-scripts.
- Typecheck, scoped ESLint, git diff --check: PASS.
- 15 tests:8 новых strict selection/cursor/DTO/return tests и7 прежних
  consultation tests: PASS. Это unit/source evidence, не реальные RPC.
- pglast:5 SQL statements,1 PL/pgSQL definition разобраны. Это syntax evidence;
  разрешение SQL-имён и выполнение функции ещё не проверены.
- Перед UI-правками открыта настоящая существующая Admissions-сессия текущей
  /v3/requests, просмотрены DOM и screenshot. Она одновременно показывала
  «Заявок пока нет» и «Анкеты платформы недоступны вашей роли». Собственная
  вкладка закрыта и сервер33229 остановлен. Это incumbent, не новый221 UI proof.

Во время разработки parser поймал отсутствующие скобки вокруг CASE в guard
cursor-kind, исправлено до DDL. Один unit assertion использовал одинаковые UUID
вместо разных; проверочное значение исправлено, все15 прошли. Старое Node
MODULE_TYPELESS_PACKAGE_JSON warning сохраняется; package.json не менялся.

## Ещё не выполнено

Independent exact-head source/SQL reviews, локальная221, обычные Auth RPC,
новый фактический UI desktop/390/320 и protectedCI. Нужны фактические страницы
по существующим approved applications с applications=all/limit1, next/back,
возврат из карточки, сохранение filter/retry, доступность действий/preview,
Student/anonymous/tenant denials и неизменность business/Auth/functions/ledger.

По исходной разрешённой read-only инвентаризации есть3 approved applications,
но нет pending applications, website/WhatsApp leads или consultations. Значит,
положительный one-kind read/cursor возможен с существующим авторизованным
актером; three-kind, pending actions и >100/source distribution остаются без
подходящих данных. Никаких fixtures/entities, новых Auth/ролей или изменения
business facts для демонстрации не разрешено. Managed DB и production release
не выполнялись. CRM-03 полностью принят только в пределах фактических доказательств.

## Замечание независимого review до применения221

На7b4e6cd7 один reviewer одобрил source/SQL, второй указал на native selects
с defaultValue: после URL Back/Forward прежний DOM мог сохранить выбранный
статус при уже обновлённом серверном списке. Форма получила identity key из
source/applicationStatus/consultationStatus/limit. Смена серверных фильтров
теперь пересоздаёт её DOM с актуальными значениями. Команды и SQL не менялись.
Actual Back/Forward и повторный submit с совпадением URL/полей/списка добавлены
в ожидающий UI-проход после221. Новый exact-head review ещё требуется.

## Изменение номера миграции до применения

Root перенёс requests queue220→221 после фактического отказа независимой219 QA
в existing184 helper (unsupported PostgreSQL regex repetition count). Применённая
219 и её failed receipt сохраняются; root владеет новым forward220 исправлением.
Файл очереди переименован в221_platform_requests_queue.sql без изменения SQL
байтов. Auth/RPC/body/UI claims остаются pending; старые review heads относятся
к прежнему имени файла. Нужны exact-head reviews нового кандидата221.
