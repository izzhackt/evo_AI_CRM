# Приём заявок сайта: Чехия, Австрия и Кипр

Основание22сентября: владелец поручил задаче сайта добавить остальные действующие
вузы EVO. Задача сайта передала ROOT минимальную зависимость приёмника CRM.
Исходный main — b4fc3f91; последний принятый app0aceda06/schema239.

## Изменение

Добавить точные country values `Czechia`, `Austria`, `Cyprus` в HTTP validator
и `platform.receive_website_lead`; каждое относится к interest_direction `EU`.
Сохранить country и university slug/name в неизменяемой квитанции заявки.
Номер новой forward-миграции240 зарезервирован ROOT после сверки main239.

Не менять signature, служебную авторизацию, ограничение частоты, request-id replay,
consent, tenant/owner guards, существующие направления и данные. CREATE OR REPLACE
меняет только тело функции, сохраняет её ACL/owner. Подготовка документов остаётся
ограниченной шестью ранее согласованными странами; новый публичный lead не даёт
доступа к подготовке. Сайт публикуется своей задачей после accepted CRM receipt.

## Доставка и проверка

Исполнить contract parsing на реальных записях текущего каталога сайта; данные
университетов не подменять placeholders. Проверить forward SQL на существующем
локальном Postgres и точное изменение функции/ACL. Не отправлять тестовые заявки,
не создавать лидов, не вызывать почту или платные API: владелец проверит заявку сам.
Успешное выполнение формы/создание лида не заявляются по чтению контракта.

После независимого review и защищённого CI: один linked CLI dry-run с ожидаемой
миграцией240, один apply, перечитать ledger/function/ACL, затем штатный app release.
Сохранить исходный migration history, не использовать reset/repair/include-all.
ROOT — единственный координатор миграции, merge и релиза.

Актуальные официальные источники проверены22сентября:
[PostgreSQL CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html),
[Supabase db push](https://supabase.com/docs/reference/cli/supabase-db-push).

## Выполненная узкая проверка

Node22 исполнил общий HTTP/DTO contract parser на 36 замороженных реальных
request-context записях сайта: по9 Чехии,1 Австрии и8 Кипра для EN и RU.
Canonical country values и university slug/name прошли. Исходный JSON
`enquiry-countries-real.json` SHA-256
`8d95b4a6fc8de20a93e77617ac1eaf059e12b454b184c17084c85faeb61968f1`.
Первый probe по display-полю country в RU-каталоге закономерно отклонил
«Чехия»; окончательный probe использует реальные request values сайта.

На существующем локальном Postgres со schema239 выполнен настоящий CREATE OR
REPLACE из240 в транзакции с ROLLBACK вместо финального COMMIT. pg_get_functiondef
подтвердил ровно три добавления в allowlist и mapping. OID, signature, owner и
ACL `{postgres=X/postgres,service_role=X/postgres}` неизменны; после rollback
исходная функция восстановлена полностью. Лидов, receipt и business writes нет.
Сама форма и доставка заявки не прогонялись, такую приёмку эти проверки не дают.

Локальные квитанции `/private/tmp/evo-website-country240-20260922/`:

- `ddl-validation.json`: `487667889e0bb21b9cebf4cd9b6fdab092f0e2f7217ba35b1eff40fb72d0766f`.
- `catalog-contract.json`: `998ba0c61e3d841813dd5c2f8324ac029edd8c765c1d1ad85839eb32355bc874`.
- SQL240: `02799c85fc83555a87409c8afdb94b5856d3f24beef1db0e3f5d3a8e766ca131`.

Production240 применена один раз через linkedCLI; ordered ledger001–240,
function/ACL/OID перечитаны, временные CLI роли отозваны. App97b27d55 принят
release35740963950, healthy/restart0/pending absent/armfalse.
[Итоговая delivery-квитанция](qa/plan36-followup-review-delivery-2026-09-22.md)
сохраняет отсутствие lead POST и отдельную ответственность задачи сайта.
