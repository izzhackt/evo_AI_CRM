# CRM-02b — поиск в отчёте продаж

Контракт до кода3afb4bb2, исходный main011c0e49 (#948). Worktree
`evo-sales-register-search`, Node22.23.1. Номер216 выделен root;215 уже применена
только в собственном local QA. Выполнение216 и новые доказательства описаны ниже.

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

Изначально до применения были pending independent review, local216 apply и
Auth/UI proof; ниже зафиксирован выполненный проход. Поиск phone/contract и
>50rows по-прежнему не имеет подходящих положительных данных: существующие записи не содержат phone/contract, не создавать фиктивные
записи или менять факты ради демонстрации. Отсутствующее доказательство останется
явной границей. Managed DB и production release не выполнялись.

Node сообщил существующее MODULE_TYPELESS_PACKAGE_JSON предупреждение при прямом
TS import; package.json ради него не менялся, тесты завершились0. Собственный
dev-server остановлен перед typecheck, чужие процессы не тронуты.

Основание: [PostgreSQL17 strings](https://www.postgresql.org/docs/17/functions-string.html),
[function security](https://www.postgresql.org/docs/17/sql-createfunction.html).

## Выполненный проход216 — 2026-09-20 UTC / 21 сентября локально

Два независимых source/SQL review одобрили точный
`7017758771563cb51cb10792567f592fc1c4ce95`; root дал GO на локальную216 с SQL SHA256
`237927d7314d2ef90001a2765714681690751fb1dfee56a5390b48acea4ecb81`.
Единственный schema applier A применил её в прежнем owned QA project, после215.
Ledger001–215,22 существующие бизнес-таблицы, число Auth users и полные pg_proc
всех существующих функций private/platform/platform_private не изменились.
Добавлены только две функции v2 с ожидаемыми STABLE/security/ACL/search_path.

Обычные существующие Sales и Admin выполнили24 проверки реальных RPC:
- no-query и archive parity v1/v2, пробельный запрос;
- имя целиком, часть имени в другом регистре, буквальные% и_;
- точные найденные rows/counts, валютные totals и unresolved counts;
- offset1 сохраняет общие count/totals, выбранная запись читается независимо
  от query, пересечение query с manager возвращает ожидаемые записи.
Все реальные ответы v2 прошли продуктовый строгий decoder.

Затем дополнительный существующий salesOther не прошёл login
`invalid_credentials`. Попытка и первые24 успешные проверки сохранены; вход
не повторялся, Auth и роли не менялись. Это недостающее подтверждение отдельного
сотрудника. Новый запуск выполнил только ещё не проверенные5 отказов: запрос
длиннее200 и newline —22023, другая организация, обычный Student и anonymous —
42501, во всех случаях data=NULL. Всего29 RPC-проверок PASS; весь запуск не
объявляется безусловно зелёным из-за отдельного login-blocker.

Через настоящий UI в существующей Sales-сессии localhost33229:
- поиск имени уменьшил5 записей до1 и USD4000 до1000;
- открытие preview, переход в редактор и Отмена сохранили query и строку;
- буквальный% дал пустой результат; Сбросить фильтры убрал query, сохранил
  year2026/monthall и вернул5 записей;
- на точной ширине390 CSS px запрос `current` отправлен Enter и вернул1 запись;
  input44px высотой,324px шириной, document width=scrollWidth=390.

Impeccable visual pass: desktop и мобильный поиск сохраняют EVO/Golos, поле
доступно целиком, фильтры переносятся без переполнения страницы. Старые широкие
таблицы сохраняют собственную горизонтальную прокрутку. Первый viewport override
390 дал520 CSS px из-за существующего zoom; эта картинка не выдана за390.
Точный390 установлен временной mobile-emulation. Locator click в этой эмуляции
попал на соседний select; обычная отправка Enter завершила UI-путь. Все overrides
сброшены. Это browser emulation, не physical iPhone/touch acceptance.

Финальный readonly observer подтвердил неизменность всех22 business tables,
Auth count, прежних функций и ledger001–215 после RPC/UI. Первый запуск observer
под системным Python остановился доDB чтения из-за отсутствия pglast; повторён
только readonly observer в уже установленном parser environment.

Приватные create-only receipts и SHA256:

| Receipt | SHA256 |
|---|---|
| local216-receipt.json | fc6560a5124873e805da284c1f380663fc2abdf1cf348eb6486e96cae1a9f36b |
| a216-auth-read-failure.json | cf1ea257b122e8cd3f6baf7d5dab7316e7a48cb2a30df856613dd172a8db8052 |
| a216-auth-denial-result.json | 9cc0b8b5da6bff67065073188b067b332d0d647852ca3bc02f2a4f27d375bc75 |
| a216-auth-read-summary.json | 052eace568593b9d104e1684b51bdab5ee4eaac91ce014783115ec4d9fd25612 |
| a216-after-read-only-qa.json | aed62f3acdf803cd43e43cc6cde311f6f6acc3cac955d32a3cfad266515975da |
| a216-ui-proof.json | e97a6c1da9b0f4e9f440df48027f0b4a10b14bc2b84b6d8a940d39aaf776ab86 |
| a216-ui-desktop.png | 2483f4cf6a462fa141d1709d2618337abca086848d623e4989bee42c2af6e9bd |
| a216-ui-390.png | b59d0ee88f0508935b2f7c1bb33810022edc96f5cc1240d33bb9a54820be0a98 |

Phone/contract positive data, >50 boundary и salesOther authority остаются
непроверенными. Нет новых фиктивных записей, identities, ролей, managed writes
или production release. Predecessor #946/214 и #960/215 теперь merged; интеграция
в свежийmain и оставшийся320px проход описаны ниже.

## Интеграция main и проверка320 CSS px

После merge #946/#960 подтянут main
`8aa7192ce42844d6d1c2ded3c824700e1b7fe025`; integration commit
`52a56668c7a424847f09510a95277f52108449ab`. Конфликтовали только два append-only
плана: весь canonical main и216 контракт сохранены. Все шесть runtime/test/SQL
файлов поиска byte-identical reviewed70177587; package/lock не изменились.
Повторные узкие checks после интеграции: typecheck,10 tests, scopedESLint PASS.
29 прежнихRPC assertions не запускались повторно и не выдаются за новый прогон.

На существующей Sales-сессии и local001–217 выполнен ранее отсутствовавший
320CSS reflow: actualviewport=pageScrollWidth=320, searchinput254×44px. По Enter
запросcurrent вернул1 запись и USD1000. Снимок просмотрен, новое поле и controls
помещаются; существующие широкие таблицы сохраняют внутреннийscroll. Никаких
правок runtime для320 не потребовалось. Временнаяemulation сброшена, ownChrome
tab закрыт, ownNext33229 остановлен. Next сообщил прежнее предупреждениеLCP
логотипа; оно не мешало этому пути и не исправлялось в данном срезе.

After-readonly parity: все24 business tables, Auth count, всеfunctions и весь
ledger001–217 совпали сpost217baseline. Миграция216 повторно не применялась.

| Новый receipt | SHA256 |
|---|---|
| a216-integration-320-ui.json | e17e08179c328751e6748ef2f729713192c00f796bcef5fcdb02ab8c5a44cb81 |
| a216-integration-320.png | 2629dea20d06393e396cb06b4dfefa89485350a6466a171a25cb48fa2a13f500 |
| a216-after-integration-320-parity.json | 44726ae43510ad752c053b341db6b0aead30f5f0bfedb9e82697761ed8b3b7db |

Окончательные exact-head review и protectedCI относятся к кандидату после этого
QA appendix. Managed/prod delivery остаётся отдельным невыполненным действием.
