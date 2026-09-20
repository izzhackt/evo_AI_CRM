# CRM-03 — единая очередь заявок: текущие доказательства

Контракт до кода:68474063, принят root и независимым review. После #962 runtime
начат на integration e789ffd7/main23036454. Очередь первоначально получила220; после выявленного реальной219 QA дефекта
прежнего184 helper root перенёс её на221. Forward220 принадлежит исправлению
этого helper. После forward220 и отдельного GO очередь221 применена только в
согласованной локальной QA. Доказательства ниже относятся к exact583bd631;
фактический новый UI, итоговая интеграция и production остаются отдельными шагами.

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

## Локальная схема и обычные Auth-проверки

Оба независимых source/SQL review одобрили583bd63182250ff689ce17703a8af2ba6d6928ac.
SQL221 SHA256:8f603de89b188071c9cdaa74df4fa2a0c0a34276c61572c2269fd2ea24d3c216.
После root220 UI-release и отдельного GO:

- Локальная схема001–221, одна новая STABLE SECURITY DEFINER функция с пустым
  search_path. EXECUTE только authenticated; PUBLIC/anon/service_role и
  supabase_auth_admin не получили доступ.
- Предыдущий ledger001–220 и все прежние функции остались точными. Все281
  business tables, Auth counts, таблицы/колонки/индексы/ограничения/RLS/triggers
  сохранились относительно переданной координатором базы после его220 save.
  Не сбрасывали его фактическую нормализацию полей или audit.
- 35 реальных проверок: существующие Sales/Admissions/Admin, default/all и
  четыре источника, статусы консультаций; три существующие approved анкеты,
  три страницы limit1, переходы вперёд и назад. Payload анкет совпал с прежним
  canonical reader. Неверные cursor/source/limit, чужая организация, Student и
  anonymous получили ожидаемый отказ.
- После чтений снова совпали все281 таблица, Auth counts, schema metadata,
  функции и ledger. Команды изменения business facts не вызывались.

Приватные receipts:local221-receipt.json, a221-auth-read-result.json,
a221-after-auth-parity.json; сырые ответы сохранены отдельно, не в Git.
Первый запуск applier остановился до обращения к БД: поле schema в release
receipt содержало тире вместо дефиса. Исправлен только разбор этого текстового
ярлыка; числовая схема, hashes и весь ledger проверены без ослабления. Первый
отказ сохранён, SQL запущен ровно один раз после исправления.

## Ещё не выполнено

Новый фактический UI desktop/390/320, итоговые exact-head reviews после
интеграции и protectedCI. Нужны возврат из карточки, сохранение filter/retry,
Back/Forward полей и списка, доступность действий/preview. Положительные
страницы и next/back уже проверены настоящим RPC, но это не UI acceptance.
Для queue→card UI требуется вошедшее в main исправление profile loader,
которое координатор проверяет и доставляет отдельным блоком.

Фактическими Auth-чтениями подтверждены3 approved applications,
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
в ожидающий UI-проход после221. Исправление вошло в оба одобренных review583bd631.

## Изменение номера миграции до применения

Root перенёс requests queue220→221 после фактического отказа независимой219 QA
в existing184 helper (unsupported PostgreSQL regex repetition count). Применённая
219 и её failed receipt сохраняются; root владеет новым forward220 исправлением.
Файл очереди переименован в221_platform_requests_queue.sql без изменения SQL
байтов. Последующие reviews583bd631, локальное применение и Auth-проверки
описаны выше; UI остаётся pending. Старые review heads относятся к прежнему
имени файла и не заменяют новые reviews.

## Impeccable: рекомендация → решение → проверка

Использован режим Operate/refinement: знакомый EVO/Golos, обычные native controls,
ясный рабочий контекст. Источник отделён от статуса конкретного вида обращения;
controls имеют44px высоту и полноширинные поля на узком экране. Неизвестные и
недоступные данные не изображаются нулём, подписи счётчиков называют их охват.
Validated returnTo и identity формы сохраняют контекст работы при навигации.

До правок просмотрены incumbent DOM и screenshot. Детерминированный Impeccable
detect точного requests/page.tsx на583bd631:exit0, findings[]. Это проверка
исходника, не подтверждение визуального результата и не отдельный независимый
Impeccable reviewer. Следующий UI-проход должен одним пакетом проверить desktop,
390 и320, реальные анкеты/навигацию/фильтры; результат будет записан после него.

## Дополнительная проверка существующего source inventory

При подготовке следующего chat-блока на583bd631 один раз выполнен существующий
v3-supabase-integration.test.mjs:8PASS/2FAIL. В expected file lists отсутствовали
наш новый requests-queue-source.ts и прежний knowledge-library-source.ts из#906.
Второй отказ — прежние knowledge-page assertions
v3-knowledge-student-documents-limited/studentDocuments.complete после#906.

В этом блоке добавлены только два expected-file entries нашей новой queue
проекции. Неизменённые knowledge failures зарегистрированы отдельно; повтор
ради зелёного результата или расширение scope на Knowledge не выполнялись.
Эти source tests не являются реальной Auth/UI-проверкой.

## Реальный UI нашёл ошибку server/client boundary

После интеграции main44092c57/#966 (b3b04d95) typecheck и15 scoped tests снова
прошли. Но обычный Local Admin на фактическом populated requests UI получил
error boundary: серверная страница вызвала submittedDate из use-client
StudentApplications.tsx. Это реальный отказ до исправления, сохранён отдельно
в a221-first-ui-failure.json; успешные RPC не заменяют этот UI-путь.

Неизменённые submittedDate и STATUS_LABELS перенесены в уже существующий чистый
student-application-presentation.ts; серверная страница и клиентские consumers
импортируют их напрямую. Locale ru-RU, UTC, формат даты, тексты статусов и
команды сохранены. Граница подтверждена официальными
[Next.js use client](https://nextjs.org/docs/app/api-reference/directives/use-client)
и [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components).
Это scoped runtime correction; после неё lint четырёх затронутых файлов и tsc
прошли. Фактический положительный UI/навигационный проход выполняется заново
на исправленном коде; окончательный результат будет записан отдельно.
