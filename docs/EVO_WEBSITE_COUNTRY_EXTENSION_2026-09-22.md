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
