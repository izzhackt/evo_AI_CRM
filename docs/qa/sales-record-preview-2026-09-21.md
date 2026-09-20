# Просмотр продажи перед исправлением — 2026-09-21

Runtime `9d6d228ab2a22c030614079b1632fe3aea08947c`, base main
`fe26526c547ef2579f6c324da0edd8f8e024d57b`. Pre-code contract A:
`79ce94d756ca1bf35335ee989b25bfa0d27d3f5f`. Независимое source review
этого runtime: APPROVED, замечаний нет. Это часть пункта 7 / CRM-02;
поиск до пагинации, вся компоновка отчёта и весь пункт 7 не завершены.

## Изменение

- `?record` открывает доступную запись для чтения. Отдельное действие
  «Исправить запись» добавляет `edit=true`; прежняя форма появляется только
  при прежнем серверном `canManage`. Прямой edit URL не расширяет права.
- Просмотр использует проверенный report DTO: продавец, телефон, исторические
  дата и месяц, стоимость/оплата с валютами, заполненные сведения программы,
  договора, статуса, примечание и понятное происхождение. Пустые optional поля
  не занимают строки; неизвестная сумма явно отличается от нуля. Неразобранное
  raw значение суммы показывается как значение источника. Разные валюты не
  складываются. Нового расчёта остатка или audit reader здесь нет.
- Year/month/archive/manager/direction/review/offset сохраняются в ссылках
  списка, просмотра, исправления и возврата. Возврат указывает на строку
  отчёта через anchor. Форма фильтров по-прежнему начинает выдачу с начала.
- Report RPC, actions, форма исправления, причина изменения, optimistic
  version/request ID, archive controls и создание продажи не изменены.
  Снимок продажи не заменяется текущими условиями карточки клиента.

## Реальная проверка root: Sales Manager

Существующая ordinary local QA учётная запись Sales; owned local Supabase,
Next `http://localhost:33224`. Ни одного save/create/archive submit.

1. Baseline на предыдущем runtime: обычное «Открыть» сразу показывало
   editable форму и «Сохранить продажу» без отдельного намерения исправлять.
2. Новый просмотр той же существующей сентябрьской записи: USD 1000,
   оплата «Не уточнено», продавец Local QA sales, дата 14.09.2026,
   месяц сентябрь. Form count = 0; данные соответствуют тому же read DTO.
3. «Исправить запись» открывает прежнюю форму с `edit=true`; отмена
   возвращает к отчёту и видимой исходной строке. Поля не менялись.
4. Весь 2026 год + менеджер Local QA sales: три реальные строки. Отдельно
   заданный `offset=1` возвращает две. Row → preview → edit → cancel сохраняет
   `year=2026`, `month=all`, manager и offset=1. Августовская запись показывает
   свою дату 14.08.2026 и месяц август, а не текущий месяц и не «весь год».
5. Desktop и actual 390 CSS px: суммы, текст и действия читаются;
   `innerWidth = clientWidth = scrollWidth = 390`. На телефоне после отмены
   выбранная строка находилась на y=558…648 при viewport height=844.
   Device override снят. Это возврат к строке, не точная pixel/scroll restoration.
6. Несуществующий корректно сформированный record ID дал честное unavailable,
   form count = 0, ссылки исправления нет; другая запись не подставлялась.
7. «Добавить продажу» открывает существующий выбор лида и куратора; форма
   закрыта через «Отмена» без выбора/отправки. Успех создания не проверялся.

## Admin: чтение без права исправления

A проверил тот же runtime на отдельном `http://127.0.0.1:33224`.
Обычный существующий Admin имеет report read и coarse manage permission,
но реальный `sales_register_write_access=false`. Новые роли/права не выдавались.

Фактически подтверждено: выбранная доступная продажа читается в preview;
USD 1000 / неизвестная оплата / 14.09.2026 совпадают. Нет correction/archive/save
controls. Прямой `edit=true` оставляет preview с сообщением о правах Sales Manager,
sale form count = 0 (единственная форма страницы — «Выйти»).
Год 2026 / весь год / менеджер Local QA sales / review=true / offset=1:
preview → «К отчёту» сохранил все параметры, диапазон 2–3 из 3 и anchor записи.
Строка целиком видна на y=430.75…520.25 при viewport height=805. Непустой
direction не проверен положительно: название программы не совпало с отдельным
полем направления и дало ноль строк, что не засчитывается как нужный сценарий.
Проверка завершена в `2026-09-20T21:04:44Z`; приватная квитанция
`/private/tmp/evo-sales-preview-admin-ui.md`. Сессии localhost Sales и
существующего B Student не менялись; временные A-вкладки закрыты.

## Проверки и границы

- ESLint обоих изменённых TSX, typecheck и diff-check: PASS.
- `platform-sales-register`, `sales-finance-entry`, `v3-brand-design`: 21/21 PASS
  на финальном runtime. Это scoped regression, не выполнение business commands.
- Impeccable final detector каждого TSX: exit 0, findings не выведены.
- Реальных записей меньше 50: offset=1 не доказывает заполненную вторую
  страницу 50+. Unknown/raw/zero варианты вне доступных данных, archived
  preview, write-access transport failure и успешные save/archive не выдаются
  за проверенные. Их сохранность оценена только по source/direct dependencies.
- Не было новых records/fixtures, смены ролей/Auth identities, управляемой DB,
  provider actions, release или production acceptance.

Локальные логи: `/tmp/evo-sales-record-preview-{types,tests,dev}.log`,
`/tmp/evo-sales-record-preview-{view,detail}-impeccable.json`.
Private Admin SDK readiness: `/private/tmp/evo-sales-readonly-readiness.json`.
