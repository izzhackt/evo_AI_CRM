# Пункты5/36 — production release 22 сентября 2026

## Исторический release — 22 сентября 2026,08:00UTC,24b46830

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


## Текущий release — 22 сентября 2026,08:44:10UTC

[#1029](https://github.com/izzhackt/evo_AI_CRM/pull/1029) смержен в
`8f9391ddc90b7746c0ee576f9beba76201970d8c` после exact-head297db review
`7ac8b9af35fd8d9411a19fbf610268cae9a8822e24068401fb615f23075aac30`
и [CI35704886141](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35704886141).
[Local dev actual](portal-assessment-retry-source-2026-09-22.md) на `ba9204ec`
подтвердил Start1, один accepted save r2, stale conflict, offline read failure,
cancel без POST и online read recovery; save2/read2 attempted, Complete0.
Independent actual/closure reviews `52aa4535`/`d3f129b8` приняты; особенности dev
routing, время окна, исходные STOP и непроверенный SaveAndExit остаются в квитанции.

App revision8f9391dd принят release `v3-r35705693269-a1-8f9391dd`:
[upstream35705663397](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35705663397)
и [release35705693269](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35705693269)
SUCCESS. Image `sha256:df85c92a2cfe38a23e12cd7f63fdf2d651594c58b6c55d18b8b2407461fa54e9`,
container `7937031d90479cf6bccb0b168d5e280ea428bd8247239ece4d43a78f39528267`:
healthy/restart0, accepted pointer/record совпали с exact revision, pending отсутствует.
CRM/app HTTP200 и armfalse зафиксированы ROOT отдельными окружающими командами,
а не самим server-readback.py. Независимое review проверило сохранённый readback
и GitHub metadata; verdict **APPROVED_SCOPED_RELEASE_EVIDENCE**.

Immutable build, ledger guards, read-only authenticated case/Student portal smoke,
final acceptance и transient cleanup прошли; rollback branches пропущены.
Production assessment retry в двух вкладках не выполнялся. Schema239 использует
прежнюю apply-квитанцию; migration files24b46830→8f9391dd неизменны. Нового SQL apply,
provider configuration activation и rollback не было. Этот release не превращает
local dev changed-path в production business acceptance.

| Доказательство | SHA-256 |
|---|---|
| Accepted readback08:44:10UTC | `02c00627cbabdae86867de163b1fe3aafa182e4c0056be2bbcbb1874e168199f` |
| Accepted pointer | `686f4b828bd3367dde1cc0349bbee462da02f2b65883f7b33b3b5ab6d184638e` |
| Acceptance record | `915ebc49a90c757ae91720eb686aa78c3a193e2c18592cbaf2008ae77f192f9c` |
| Browser receipt, ссылка accepted readback | `9174bd0e0b1c1c376d93e1e23776857d710863067dbd5fce279eb32b33e9fac0` |
| Независимое release review | `aa62f50ac6977249598cb13daf4b5c06cf29c88b94f9bc32114c51eefa029296` |

#1026/#980 остаются открытыми: native actual не выполнен. CUA-наблюдение B08:21
снова показало locked Mac; прежнее unlocked07:41 не является текущим состоянием.
Пользовательские входные данные для почты уточняются: invite alias вместо адреса
с подтверждённой Auth identity и доступ к business receiving Gmail ещё ожидаются;
личный signup-адрес свободен, собственный receiving Gmail доступен. Писем не было.
#980 activation packet reviewed INERT; live OTP8/local6 отмечены, конфигурация,
Invite/recovery и provider отправки не менялись. Полного завершения1–36 нет;
решения31, границы32 и отложенный scope сохранены. Эта запись — docs-only по
квитанциям, без повторных runtime/тестов; проверка diff и `git diff --check`.
