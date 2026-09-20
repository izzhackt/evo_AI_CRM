# B218 — проверка требований выбранной программы

21 сентября 2026. Результат: локальные SQL/RPC и реальные TS/Swift DTO проверены.
Новый пользовательский экран этим срезом не реализован и не принят.
Контракт: [B3c](b3c-application-requirements-contract.md).

## Проверенная реализация

- Source HEAD: `bf52b38a9bb2367a45b442ab4bdebfeaacd9ddcd`.
- SQL218 SHA256: `b20efabd60b0dbe8efc6c3d07522a07b4de014b9ba9b7bbea8b9d03eafb18f9d`.
- Два независимых source review одобрили этот HEAD до применения SQL.
- На предыдущем `5c03aa52` ревью нашло отсутствие обязательного context из114
  при увеличении версии связи. Эта версия не применялась. Исправление повторяет
  действующий set/context → version CAS → check → clear; старый guard не менялся.
- Интеграция `086f00887e2c63263daf65415583016b7cc7922e` включает main
  `401069a4a7aa15a3420b0685ba28fb7fb373c956`. Все семь файлов реализации B218
  байтово равны проверенному `bf52b38a`; прежняя runtime-проверка не переименована
  в новый запуск. Полные main-appendices и B218-appendices сохранены.

## Среда и пределы разрешённого сценария

Изолированная локальная Supabase, схема001–218. Только прежние QA-аккаунты,
то же активное дело и существующая подготовка214. Команды выполнялись через
обычный Auth Student/Admissions; service-role и прямой SQL для бизнес-изменений
не использовались. Новых пользователей, ролей, дел, программ, файлов, загрузок,
платежей и действий внешних провайдеров не было.

Координатор выделил отдельные окна: сначала A применил точный218, затем B
выполнил13 фаз как единственный бизнес-writer. Каждая фаза запускалась один раз;
после неё независимый по реализации observer проверял read-only снимок. Ни
автоматических повторов, ни очистки данных, ни скрытого продолжения после ошибки.
Окно B освобождено после завершения проверки.

Применение218: PASS. До/после совпали прежние бизнес-данные, Auth count, записи
001–217 и определения существующих функций. Две новые private-таблицы пусты,
FORCE RLS/ACL/append-only triggers проверены; добавлены только новые функции.
Это отдельное доказательство применения схемы, не приёмка RPC/UI.

## Фактически выполненные фазы

| Фаза | Наблюдаемый результат |
| --- | --- |
| Исходное чтение Student/Admissions | Оба возвращают `uninitialized`; чтение не пишет данные. |
| Student initialize | Одна редакция, два immutable пункта, два пустых custom slot, две связи с прежней программой и одна audit receipt. |
| Exact Student replay | Исходная receipt; весь наблюдаемый бизнес-снимок неизменен. |
| Новый Student request | Те же revision/item/slot IDs; добавилась только одна audit receipt с новым request ID. |
| Staff initialize существующей редакции | Те же immutable факты; только одна новая audit receipt. |
| Exact staff replay | Исходная staff receipt; нулевой бизнес-эффект. |
| Конфликт и чужое дело | Staff с Student request получает22023; Student2 read/write чужого дела получают42501. Частичных записей нет. |
| Metadata change | Через действующий108 изменено только название нового Фото; оба пункта сохранены, Фото недоступно, `needs_configuration`. |
| Replay после metadata change | Исходная receipt; название не исправляется автоматически, снимок неизменен. |
| Metadata restore | Через108 явно восстановлены исходные label/group при точной ожидаемой версии и QA-marker; reader снова `initialized`. |
| Unlink | Через действующий113 API/114 implementation удалена только связь нового Фото с той же программой; пункт остаётся недоступным. |
| Replay после unlink | Исходная receipt; связь не восстанавливается автоматически, снимок неизменен. |
| Relink | Явно восстановлена логическая связь slot→application при точной версии. Создана новая строка связи с новым UUID/временем/сотрудником. |

Все13 executor results и все14 observer checkpoints, включая baseline: PASS.
Итог: одна редакция, два пункта, два slot, две связи, семь новых audit-записей.
Версия Фото прошла `2→3→4→5→6`; версия Загранпаспорта осталась2. Relink не
объявляется восстановлением прежней физической строки или удалением истории.

После изменения metadata/связи reader сохранял immutable IDs, обязательность и
исходные названия пунктов; текущие slot/file/review поля проблемной ассоциации
были скрыты. После явного восстановления оба пункта вновь имели `file_missing`,
а не ложное состояние готовности. Старт остаётся `evo_starter` /
`needs_confirmation`: полный перечень университета ещё не подтверждён.

Observer сверял агрегаты281 таблицы в product schemas и отдельные target/other
строки разрешённых изменений. Старые audit, прочие slot/links/files/reviews,
дело, lead, условия продажи, preparation/binding214, membership/profile/scopes,
Auth user/identity counts, схема и определения функций не изменились в фазах
кроме точно перечисленных новых данных218 и действий над новым Фото.

## Реальные модели веба и iPhone

Executor импортировал настоящие TS-парсеры из проверенного source и декодировал
неизменённые ответы RPC на каждой фазе: receipt и Student/staff current reader.
Оба reader совпали. Подмена ответов fixtures/mocks не использовалась.

Скомпилированный Swift driver с настоящим `ApplicationRequirementsModels.swift`
прочитал52 фактических reader-ответа (до/после, Student/staff) и7 фактических
receipt. Все59 payloads прошли строгий decode и корреляцию case/application/request.
Driver не вызывал RPC и не создавал ответов. Это проверка DTO, не запуск iPhone UI.

Source checks: pglast —27 statements,8 PL/pgSQL и2 SQL bodies; Next typegen и
repo TypeScript `--noEmit --incremental false`; scoped ESLint; iOS Services
Swift typecheck, `plutil`, сборка Swift decoder; `git diff --check` — PASS.
Единственное Swift warning — прежний `SessionRouter.swift:90` для
`mfaChallengeVerified`; прямой импорт TS в Node выводил известный
`MODULE_TYPELESS_PACKAGE_JSON` warning. Они не заменены фиктивным зелёным результатом.

## Evidence и воспроизводимость

Оригинальные ответы, команды, снимки и QA identifiers сохранены локально в
private-файлах0600 и не включены в репозиторий. Create-only receipts не
перезаписывались. Для сверки без раскрытия данных:

| Артефакт | SHA256 |
| --- | --- |
| Frozen QA plan | `cdb6d82498c39870f468a3013c98b10b5cd889ac9601bcd534643122f7b860c0` |
| Successful local218 apply receipt | `1df68214325d5a33391dae40be2ca0c9d45254146573c3e944ee9d8f4bd9865b` |
| Runtime guard | `a7d54aa464325b3a5c79847ce6b1da27c031c75040713802572a999a88ac7141` |
| Reviewed executor | `815b26d26a34b0f229b44ab1e4fb606c4727e99d8191a3d1dea231857e9ed08f` |
| Reviewed read-only observer | `9a95b81d549b53c249f720ee0937a4b56d00b0383c9842808da5dd76fba5615e` |

## Что не доказано этим прогоном

- Новые web/native UI, server-action/browser journey, upload/draft/submit,
  пакеты и очередь review: отдельные следующие срезы.
- Первая инициализация именно сотрудником: проверена staff-команда на уже
  существующей редакции; новый staff-created starter отдельно не создавался.
- Положительный reuse между двумя программами, одновременные competing calls,
  legacy checklist/configuration блокировки, soft removal, последующее закрытие
  дела/смена статуса и отзыв authority: source review, не отдельный live-сценарий.
- Технически доступный загруженный файл и реальные review/scanner states:
  файлов в разрешённом сценарии нет, поэтому доказано только `file_missing`.
- Managed/production/provider acceptance и полный E2E не выполнялись.

Явное принятие полного прежнего перечня сотрудником и смысловое сопоставление
старых файлов остаются обязательными частями принятого общего плана. B218 не
заменяет их двумя стартовыми пунктами и не закрывает весь admissions-путь.
