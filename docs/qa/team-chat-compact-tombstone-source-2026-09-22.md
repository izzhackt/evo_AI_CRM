# A15 — compact root tombstone: source и узкая UI-проверка

22 сентября 2026. Реализация `af47d719adbf55eec8153679aceafcc2c3afdf21`
на main `0926399b04898c919a65d2b5ff5b87adfe2d1d00`.
Ниже сохранена проверка исходников и добавлен результат обычного UI-прогона
на `00cba9739d95a95dd9d681b1ced094fdccd202de`. Отрицательные варианты проверены;
новый compact root0 в работающем приложении не представлен и остаётся NOT PROVEN.

## Что изменилось

По [precode-контракту](../EVO_TEAM_CHAT_COMPACT_TOMBSTONE_PLAN_2026-09-22.md)
один класс добавляется только при `Boolean(deletedAt)`, explicit parent null,
replyCount0 и quote null. Неизвестные metadata не становятся нулём; reply с
legacy count0 не считается leaf. SQL141/227, reader/DTO и схема не изменены.

У подходящего article padding-block4px; bubble margin-top2px, padding0,
transparent background, border-radius0; у placeholder margin0. Scoped selectors
перекрывают own/mobile bubble без изменения highlighted outline. Автор/аватар,
метка удаления, time/title, прежние Reply/menu/Link и44px controls остаются.
Весь остальной DOM/handlers/ID/sequence/grouping/search/quotes/seen/tail неизменен.
Не обещается определённое число сэкономленных пикселей или полный охват всех
удалённых reply без ответов: компактность ограничена достоверными root tombstones.

Два product-файла и SHA-256:

- `TeamChatMessageRow.tsx`: `5ac312ae3b73ca4dc738fb5d96aa8078973cae79b22cdbf962870f2e7df73d0d`.
- `team-chat.module.css`: `295fce406317a6d15a5186923d340d4b7f4a329066ecf1d42afc0938514099ab`.

## Проверки до и после реализации

Precode записан в плане и обоих журналах коммитом `37aaf4cebd9628af9193660e4eb72e4a66125c75`.
Impeccable context переиспользован; независимые Assessment A/B выполнены до кода,
A завершилась до чтения detector output. A APPROVED_PRECODE, reportSHA
`6f700a055ac844407f45f8a38846516c00c9b42877f12d33ce89679f20996bdf`;
B detector exit0/`[]`, reportSHA
`ceedb1c9f86895a805613070e994458dfce3c10a80830d2c949a1b27a917cbba`.
Один P2 — лишний фон/padding;22/32 — эвристическая оценка source/historical target,
не новая UI-приёмка. Сохранённые service-row PNG1440/390/320 не показывают tombstone.

A прочитала core-planSHA `d011849c243c46cb136ba7e92c6aca543e6579b7bff67be3e50d70db1b54f3a8`.
До freeze добавлены только шесть строк saved-eligibility evidence: final precode
planSHA `70427b30982decc441fdfe915a7be9c267ee1258cf9ecb4048ba9c4479bc1c15`.
Побайтно проверено: удаление этого evidence-абзаца даёт reviewed hash; guard,
treatment и checks неизменны. Craft-floor прочитан непосредственно перед UI-edit.

Node22.23.1: scoped ESLint для изменённого TSX, `next typegen`, `tsc --noEmit`
и `git diff --check` PASS, по одному запуску. Lockfile и package побайтно равны
принятому donor worktree, права владельца проверены; использованы существующие
dependencies без установки. Полный build и unchanged suites не запускались;
зеркальные tests для CSS-класса не добавлялись. CSS/render geometry требуют actual.

Логи:
- ESLint: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- typegen/TypeScript: `adba4af9194e10e47dda75ff0fd0f8c2b756474896d0eba5612799c527ff372a`.

## Наличие данных до разрешённого UI-окна

Saved-only eligibility reportSHA
`339a70ae34ff6e975c9d3b0a2d4bcf0d455b4c1ada24e67f46c4452178bd511b`
на сохранённом A1030/c1fc: три foreign General tombstones, два в latest50.
Сопоставление прошлых DTO показывает root count1 и два reply с входящими цитатами.
Точный положительный root0 не доказан; A1030 metadata не содержит parent/count.
Это не свежий zero-eligible query и не разрешение использовать старые ID сейчас.

Будущий ordinary UI после отдельного окна ROOT: существующие records как negative
controls, и positive root0 только если он реально доступен и подтверждён normal DTO.
Нельзя создавать/удалять сообщения или пользователей ради варианта. Обычный показ
соседних тел может дать seen; нужны отдельный допуск на эти эффекты и own closure.
В этом source-срезе runtime/Auth/DB/browser не запускались, shared QA остаётся B.
Actual compact geometry, полный screen reader, другие роли, native/production,
issue708 и весь item15 не приняты. Приватные snapshots/IDs/тексты в Git не добавлены.

## Обычный UI и закрытие локальной QA — 22 сентября

После передачи QA от B и отдельного допуска ROOT использован существующий Admin,
обычный login и `/v3/team-chat?channel=general` в headless Chromium. Source guard
сохранил точный `00cba9739d95a95dd9d681b1ced094fdccd202de`; два product-файла выше
не менялись. Независимое source review APPROVED_SOURCE, reportSHA
`bb286466c17a29cbd0cb2c299c3d6a9588029e23fcfe811ea3edaf943927c50a`;
[protected CI 35681958190](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35681958190)
SUCCESS: пять проверок прошли, три пропущены по scope.

Свежий BEFORE подтвердил General64, три удалённых сообщения: root с одним ответом
и два reply с цитатами. Подходящих root0 нет. Допуск на обычные собственные отметки
прочтения вычислен заново для конечного набора51; фактически новых отметок0.
Сообщения, пользователи, grants и fixtures ради варианта не создавались и не менялись.

Один UI-прогон PASS: удалённый reply показан на390/320/1440px, затем все три
существующих tombstone открыты обычными permalink на1440px. Шесть наблюдений
подтвердили отсутствие compact-класса у исключённых вариантов, прежний bubble,
автора, время/title, метку удаления, отсутствие удалённого body и сохранение цитат.
Reply/menu имеют цели не меньше44px; горизонтального переполнения нет.
Три permalink сохранили highlight; Reply принимает фокус, меню открывается Enter,
«Ссылка» сохранена, edit/delete/moderation отсутствуют. Reply только фокусировался:
draft не создавался. Три screenshots просмотрены; это отрицательные контроли,
а не изображения нового compact root0. Полного экранного диктора не проверяли.

После завершения запросов чат размонтирован. AFTER-UI и FINAL прошли независимую
от UI сверку290 business-таблиц,33 Auth/Storage, схемы001–239, catalog/effects
и канонических unread. Business-state после UI не менялся; прежние Auth-строки
сохранены, новая собственная сессия закрыта обычным local logout204. Остались
два ожидаемых собственных Auth audit события login/logout; полное побайтное
равенство всей БД до/после не заявляется. Браузер закрыт, собственная process group
остановлена и собрана launcher, порт отказал в соединении. Собственный файл
Auth cookies удалён после строгой финальной сверки.

До запуска server/Auth parent-команда остановилась с `ModuleNotFoundError: observe`.
Причина — путь импорта inline Python; добавлен каталог уже проверенного helper.
Исходный failure сохранён. Helpers/source не менялись, actual не повторялся.

Приватные квитанции и SHA-256 (содержимое переписки и идентификаторы остаются вне Git):

| Квитанция | SHA-256 |
| --- | --- |
| BEFORE | `077bf63dbbaab9e65f4426fac0ed488e9f051e3574a215ea5ebe9423f5dc54db` |
| UI result | `d36d504894f12a8193aec37c7cde79b7875b99d5be979702cf6c8f0f5d8c8e60` |
| AFTER-UI | `ab909200a02482c368f91d758628fba7f51ccefdbe776ba62c56f7d052767ccd` |
| FINAL | `f2b8f31bd0bfa69b3dc33cf2d169d17662b3704fd861b16146cabf5065202439` |
| Final effect verification | `1183fbd8faf7f74872a95e4d82bff9f59615d163ddb1cbbb19f575518cd7d2bd` |
| PNG390 | `e8abd66ac8a1b6c8f677a8d1ae7b3fbccd9b43cb9d042af8b3a6123be4eda414` |
| PNG320 | `7a616c74e4a673f17b52dd9c57ac01db083de2302be101d714d775909be73b6f` |
| PNG1440 | `c78570349525ce9de2b5c78976d5777f302c92b6f87934b5c7a717a1b941b7b7` |

Граница приёмки: source и обычные UI negative controls. **Положительная compact
геометрия root0 — NOT PROVEN**, подходящего существующего сообщения нет.
Другие роли, native, production, issue708 и весь item15 этим PR не закрыты.
Независимое actual/closure review: **APPROVED_ACTUAL_NEGATIVE_CONTROLS_AND_CLOSURE**,
без blockers; reportSHA `a11b941a05f00ce4f632530924b310b62e4a07a2e01964b5b9191fb093e4a812`.
Review самостоятельно сверило raw snapshots/Auth, все PNG и handoff. A вернула
ресурс ROOT для следующего окна B; released handoffSHA
`4ba7644b1983c520e898c9023acb556cc2d1e49fd4f77a1079b47e2c3127e215`.

После закрытия runtime интегрирован docs-only main
`eed088a0539b8eca35115676a4860ff759a4c512` (#1033). Оба append-журнала сохраняют
полный main-префикс и две исторические записи A15 побайтно. Общая ведомость/KB
сохранены из main; два product-файла совпадают с проверенными hashes выше.
Новый runtime для интеграции документов не запускался: actual остаётся на `00cba973`.
Итоговое exact-head review и protected CI выполняются на head PR отдельно.
