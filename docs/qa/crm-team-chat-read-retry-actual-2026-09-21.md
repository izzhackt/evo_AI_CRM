# A15g-1 / PR #1005 — фактическая проверка чтения и повтора

21 сентября2026. Ограниченный local235 actual и закрытие собственной сессии
независимо одобрены. Финальные docs-head review/CI/merge и ROOT-передача среды
остаются отдельными gates. Это не production и не завершение пункта15/всех1–36.

Контракт: [план](../EVO_TEAM_CHAT_READ_RETRY_PLAN_2026-09-21.md),
[исходники и29 целевых проверок](crm-team-chat-read-retry-source-2026-09-21.md).
Actual выполнен на чистом `7d70a71d8156c70195567d9ee8c44e7cc6c2d5ae` после
интеграции main `d68ce58711b413f8366c80615456cfbbf22a0772` (#1004).
Продуктовые файлы byte-identical независимо одобренному f882fedc; integration
review одобрен, CI35606202619 прошёл. Последующая дельта — только документация.

## Настоящий путь и результат

Обычный вход уже существующего сотрудника и `/v3/team-chat?channel=general`.
Это тот же scoped custom staff, что передал ROOT235: активные profile/membership,
без system-admin, с null legacy role/bundle. Конфигурационный alias `sales` не
означает фиксированную Sales-роль. Права/роль/аккаунт не изменялись. Использована
уже существующая техническая LOCAL-история, не переписка реальных клиентов.

| Проверка | Наблюдение |
|---|---|
| История | Первый проход загрузил64 строки после исходных50. Во втором уже64 и кнопки предыдущей страницы нет; нового pagination-доказательства ему не приписываем. |
| Поиск при потере сети | Настоящее offline вызвало ошибку чтения; прежние50 результатов и несохранённый composer draft остались. В поле поиска введено другое значение. |
| Точный повтор | После online и завершения pending клавиатурный retry повторил исходный LOCAL-запрос, сохранил50 результатов, новый несохранённый input и draft. |
| «Ещё результаты» | Offline сохранил старые50 результатов; повтор исходного term/cursor добавил страницу:61 уникальная строка. |
| Переход к сообщению | Offline context failure сохранил61 результат; повтор открыл исходное выбранное сообщение. «Назад» вернул61 результат. |
| Закрытие поиска | История64 и тот же draft восстановились; собственный несохранённый draft затем очищен обычным полем, без отправки. |
| Desktop/mobile | 1440/390/320: document scrollWidth равен viewport, один composer. Снимки подтверждают читаемую read-error copy, доступный повтор и сохранённые результаты/черновик в прежнем EVO/Golos. |

В окончательном проходе зафиксированы четыре реальные POST failures
`net::ERR_INTERNET_DISCONNECTED`. Ответы сервера не подменялись, успешные
результаты не имитировались. Source продукта между двумя проходами не менялся.

## Неуспешные попытки сохранены

1. Первый UI batch остановился на disabled «Ещё результаты»: драйвер считал
   исчезновение retry-кнопки завершением предыдущей попытки, хотя оно происходило
   уже в начале pending, и слишком рано включил offline. `finally` вернул online;
   разрешённый snapshot показал исходные результаты и enabled controls. Это
   STOP, а не PASS. Единственный подтверждающий batch в той же сессии исправил
   только ожидание `aria-busy=false` и проверку результата; он прошёл. Всего два
   visual passes, без третьей попытки или повторного входа.
2. Промежуточный `after-ui` verifier остановился на временной собственной строке
   `auth.mfa_amr_claims` активной сессии. Allowlist не расширяли. После обычного
   собственного logout и закрытия browser/server тот же strict final verifier
   прошёл. Промежуточный STOP не переименован в успех.

До входа также сохранены два metadata STOP из-за неверного ожидания legacy
role. Разрешённая read-only диагностика подтвердила прежний UID/custom membership;
guard привязали к этому факту без смены роли/пользователя. UI-admission review
обнаружил отсутствовавший UUID predicate в помощнике: он восстановлен до login.

## Полнота состояния и закрытие

Full snapshots: схема001–235,290 business tables и33 Auth/Storage tables.
Все290 business tables, catalog и конечные effects совпали с входом; messages,
memberships/read floor и seen совпали. Допустимый бюджет новых seen был0,
фактических новых seen также0. Не было message posts/edits/deletes, новых
actors/fixtures, миграций, provider/Storage actions или production-изменений.

31 из33 Auth/Storage table hashes совпали. Исключения точно ограничены одним
существующим Auth user: `last_sign_in_at`/`updated_at`, и двумя собственными
login/logout audit additions. Все8 пользователей и их стабильные поля сохранены,
прежние audit rows неизменны. Полные hashes исходных224 sessions,239 refresh rows
и224 mfa_amr rows восстановились после собственного logout204. Полную
неизменность Auth metadata не заявляем. Собственный browser закрыт, оба PID и
listener33242 отсутствуют, собственное token-state удалено; чужие сессии сохранены.

## Проверяемые квитанции

Частные raw snapshots/скриншоты остаются вне Git в
`/private/tmp/evo-team-chat1005-local-20260921`. Они содержат технические QA-данные;
публичная запись сохраняет только безопасные итоги и SHA-256.

| Артефакт | SHA-256 |
|---|---|
| `ui-proof/before.json` | `e74199fe70c6d2df3713240888d7f4ffdfffcfc249cfd42e67f29b0f51b36169` |
| Первый UI STOP, `ui-proof/cli-20260921T135151372547-sales.json` | `6b72f67649bd005c596cb81ffd3c8f27a807a4b5d872322bb51e82771496a731` |
| `ui-proof/confirmation-result.json` | `b8f08c758435fb231069619bc4908f7fe7e5a127e92229e42da8c613125825a3` |
| `ui-proof/after-ui.json` | `95244b50ffd930cb0a99fc9647b2e37838c4fe99b86637b2e29ccce0cecc326e` |
| `ui-proof/final.json` | `34cda7b3910e6736fbdf32d0061c5ed85aee6ceba7cc6116a995905671a7e642` |
| `ui-proof/final-verification.json` | `8ee15db77b55914151a0fadbf2e431a5018c357addca74599a0429fe17c71228` |
| `ui-proof/own-closure.json` | `40c07da144e54efc2ce0559d83801966cdd112e52bd576a8cbd231c37afdf86f` |
| `release-candidate.json`, ещё `released=false`, следующий B1006 | `a5e7567ce1f3d9eba1dc668766878c687375941592d9710635f88f19e4819480` |
| Independent actual/closure review, `/private/tmp/evo-team-chat1005-actual-closure-review.md` | `3796fde3f862b285a9798629d3b43dc48c646cb376fb3c6341697dcea6c703b9` |

Независимый reviewer проверил hashes и заново сравнил полные before/final,
Auth-исключения, сохранённые STOP и UI confirmation. Вердикт:
`APPROVED_BOUNDED_ACTUAL_QA_AND_CLOSURE` для source7d70a71d.

## Границы

Late forbidden и partial background hydration failure проверены регрессиями
кода, не принудительной live-revocation/fault injection. Недоступны отдельное
повторное history pagination во втором проходе, точный pixel-scroll/anchor,
другой заполненный канал, screen reader/VoiceOver и физический iPhone. Next dev
badge на локальных снимках — служебная панель разработки. Эта приёмка не закрывает
группировку/плотность/превью каналов, issue708 реальным сотрудником или production.
