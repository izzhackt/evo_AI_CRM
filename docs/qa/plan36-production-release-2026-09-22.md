# Пункты5/36 — production release 22 сентября 2026

На08:00:06UTC принят app source `24b468306740f1b6fd90e8064f5ab2b6b80425f6`,
release `v3-r35701685557-a1-24b46830`, image
`sha256:a802bcce6a96f1701da54e25cd892f0d815254afda6e4ec097fe93c606a2c67b`.
Контейнер healthy/restart0; публичные CRM и portal health ответили200.
Accepted pointer/record записаны, pending отсутствует, release-arm=false.
[Release35701685557](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35701685557)
и его [upstream CI35701652318](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35701652318)
завершились SUCCESS. Это scoped delivery, не проверка каждого business-сценария.

## Schema и очистка оператора

Из frozen source `eed088a0539b8eca35115676a4860ff759a4c512` применены ровно33
forward migrations207–239. Dry-run и один push используют одинаковый список;
SQL `schema_migrations` и Management migrations views сверены оператором до001–239.
Raw ledger arrays отдельно не сохранены: это attestation проверенного оператора,
а независимое review выполнено по квитанциям, без повторного запроса БД.
Все migration bytes EED и accepted24b46830 одинаковы.

Apply APPLIED; собственный CLI process закрыт, временная CLI login role DELETED,
собственные link metadata REMOVED. Независимое review приняло scoped schema
поставку. Полная сверка бизнес-данных, исторических stored SQL statements и
обратимый DDL rollback этим не заявляются. Отдельные прежние PREPARE STOP
(urllib CA и generic CLI failure) сохранены; их причины не объявляются доказанными
лишь из-за последующего успеха. Auth email/provider операции этот оператор не выполнял.

## Сохранённая история и пределы

[Prebuild35700914430](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35700914430)
остановился на тестовом ожидании release-классификатора до deploy. [#1034](https://github.com/izzhackt/evo_AI_CRM/pull/1034)
исправил только `tests/p6d-release-candidate.test.mjs` (source ef5e, independent
review55198); [CI35701386374](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35701386374)
прошёл, merge —24b46830. Это не неудачный deploy и не выполненный rollback.
Продуктовый код/SQL этой тестовой поправкой не менялся.

После release readback сначала остановился на сравнении short/full container ID.
Идентификатор затем разрешён однозначно через inspect; исходный диагностический
STOP сохранён. Это ограничение readback-проверки, не доказанный дефект продукта.

Откат app не отменяет208 write-права. После публикации intake ID по211 старый
parser b759 может отвергать такие карточки; сам DDL211 их не публикует.
Нельзя удалять опубликованные ID или расширять grants ради отката: нужен
совместимый rollback image либо отсутствие таких публикаций в обратимом окне.
Rollback в этом проходе не выполнялся.

#1032 входит в release: приняты три отрицательных UI-варианта и closure,
[положительный compact root0 отсутствует](team-chat-compact-tombstone-source-2026-09-22.md).
Открытые1029/1026/980 не объявляются вошедшими в release или прошедшими actual.
Mac уже доступен, но native-проверки ещё не выполнены; внешняя почта не отправлена.
Пункт4 завершён в source/CI: работающего lead-agent нет, новый запуск frozen
сервиса не нужен и provider functionality не заявляется.

[KB31 dispositions](knowledge-source-reconciliation-2026-09-21.md) и решения
141/144/145/pending159 сохраняются. [Два материала32](company-material-production-delivery-2026-09-22.md)
доставлены с подтверждёнными серверными байтами, но production browser downloads
остаются заблокированными/непроверенными в указанном объёме. Весь план1–36,
native, real-employee issue708 и внешние провайдеры этим release не принимаются.
37–50, общий финальный E2E, контентная волна и App Store остаются отложенными.

## Квитанции

| Доказательство | SHA-256 |
|---|---|
| Apply207–239 | `9d85e2f6ce5ed01fe078ee7a0b883f3baa6f68b18806fd83a05d4427e36bf0cc` |
| CLI/role/link cleanup | `15747d9550cea968cff4b6f847f9f812e22c1c2cb8c2e2823cff31cb19255e83` |
| Независимое schema review | `f8cecf202ba6fa512001f27725323c55781380daf5b9a880257a1e7f964f1b3f` |
| Accepted readback08:00UTC | `72b9f89c30da9379fd57fd2a87413e4d32a9fee1ca4b51054064680f0829077f` |
| Accepted pointer | `8d8d242c6acc305583cda2b21fe09560d241fd831a96936fc9afb283a0bbe151` |
| Acceptance record | `da04fcb78d2b022b1449c8b51f981d81549dd04f488d07aa6b737c9d133c51e1` |
| Browser receipt, ссылка accepted readback | `9562f1591bde05f305cea02a3a3728bdbbe92aeddf5dff185f80da6de0caea9f` |

Документационный checkpoint составлен по сохранённым квитанциям и source diff.
Новый runtime/SQL/Auth/UI прогон не выполнялся; browser receipt hash здесь не
подменяет отдельное описание непроверенных пользовательских сценариев.
Проверки документации: review diff и `git diff --check`, без продуктовых тестов.
