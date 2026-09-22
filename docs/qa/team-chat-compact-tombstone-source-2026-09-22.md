# A15 — compact root tombstone: source evidence

22 сентября 2026. Реализация `af47d719adbf55eec8153679aceafcc2c3afdf21`
на main `0926399b04898c919a65d2b5ff5b87adfe2d1d00`.
Это проверка исходников; новый compact UI в работающем приложении не проверен.
Независимое exact-head source review и protected short CI выполняются отдельно.

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

## Наличие данных и границы

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
