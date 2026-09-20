# CRM-02b — поиск в отчёте продаж

Контракт до кода3afb4bb2, исходный main011c0e49 (#948). Worktree
`evo-sales-register-search`, Node22.23.1. Номер216 выделен root;215 уже применена
только в собственном local QA. Этот документ пока не утверждает выполнение216.

Добавлены отдельный read_sales_register_v2 и поле поиска по имени, телефону или
договору. Query ограничен, символы%/_ буквальные; digits matcher телефона работает
только для телефонного запроса. Scoped filter применяется до count/валютных totals/
LIMIT50/OFFSET. Существующая v1, row DTO и write-пути не изменены. В строгом v2 DTO
добавлен ровно query echo; серверный источник сверяет его с исходным запросом.
Поиск сохраняется в URL/navigation/preview/edit/back; submit снимает offset,
reset сохраняет период и снимает фильтры. Остальная компоновка/фасет направлений
остаются отдельной очередью CRM-02, существующая серверная фильтрация не объявляется
новым исправлением.

Выполнено до применения216:
- `npm ci --ignore-scripts`, штатный typecheck: PASS.
- Scoped ESLint изменённых TS/TSX/tests: PASS.
- Новые4 scalar/strict decoder tests и прежние6 sales boundary/source guards:
  10/10 PASS. Это unit/source proof, не успешный бизнес RPC.
- pglast:6 SQL statements и2 function definitions разобраны. Syntax proof,
  не выполнение PL/pgSQL и не применение миграции.
- `git diff --check`: PASS; прежние migration files/v1 decoder без изменения.

До UI-правки открыта реальная existing Sales-сессия localhost33229; просмотрены
DOM и screenshot исходного отчёта. После согласованной B215 QA-передачи отображаются
5 настоящих local QA sales:4USD и1KGS. Это исходный v1, не новый поиск. Реальный
server-source snapshot ранее прочитан readonly наpg17.6, SHA256
cb0ea74933ca57685096602683527c1cc152a8b6419671eb07f5ff75b86d27aa.

Ещё не выполнено: independent exact-head source/SQL review, local216 apply,
ordinary Auth v1/v2 parity/name-query/count/totals/denials и actual UI поиск/reset/
back desktop390. Поиск phone/contract и >50rows не имеет подходящих положительных
данных: существующие записи не содержат phone/contract, не создавать фиктивные
записи или менять факты ради демонстрации. Отсутствующее доказательство останется
явной границей. Managed DB и production release не выполнялись.

Node сообщил существующее MODULE_TYPELESS_PACKAGE_JSON предупреждение при прямом
TS import; package.json ради него не менялся, тесты завершились0. Собственный
dev-server остановлен перед typecheck, чужие процессы не тронуты.

Основание: [PostgreSQL17 strings](https://www.postgresql.org/docs/17/functions-string.html),
[function security](https://www.postgresql.org/docs/17/sql-createfunction.html).
