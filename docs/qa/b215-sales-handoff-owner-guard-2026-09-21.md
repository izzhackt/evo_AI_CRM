# B215 — seller sync при оформлении продажи

Контракт до кода: `3c7d61052ce9e5246552b9d2f79b09e963af06fb`.
Это зависимость положительной приёмки B214. Production не изменён.

## Воспроизведённая ошибка

В локальной схеме001–214 выполнен согласованный сценарий с существующими QA
аккаунтами и одним существующим делом. Обычными Auth/RPC подтверждены:

- Назначение существующего Sales владельцем lead.
- Сохранение девяти полей продажи через213, revision0→1;17 соседних полей
  неизменны. Exact replay возвращает исходный результат; изменение intent при
  том же request ID и stale revision отклоняются без записи.
- Следующий обычный208 handoff завершился HTTP500,
  `40001 portal_identity_conflict`. Продажа не создана, дело осталось pending.
  Повтор с новым request ID или ручной ремонт данных не выполнялись.

A сверил before/after: полностью совпадают20 проверяемых таблиц и относящиеся
к делу строки, scopes/events/access versions, schema functions и число Auth
users. Успешные прежние owner assignment и conditions revision1 сохранились.
Живые `pg_get_functiondef` и включённый trigger подтвердили причину:208 меняет
seller pending-дела, а126 запрещает любое такое изменение.

Приватные квитанции сохранены вне Git: `b214-approved-handoff-response.json`,
`a-b214-observer-before_handoff.json`, `a-b214-observer-after_handoff.json`,
`b214-live-case-identity-guard.json`. Личные данные и credentials не публикуются.

## Изменение

215 добавляет закрытое разрешение на один owner-sync, связанное с текущей
транзакцией, актором, организацией, request, делом, canonical lead, прежним и
новым seller и scope. GUC служит только указателем; guard проверяет приватный
receipt, текущую authority и неизменность всех остальных полей. Deferred FK
позволяет сохранить receipt только вместе с завершённым handoff.

Исходный Student-binding guard сохранён. Public API/grants, curator helper и
исторические миграции неизменны. При non-NULL прежнем seller отдельно отзывается
его старый scope и обновляется access version, без повторного bump того же profile.

Первый org lock становится FOR UPDATE. Это сериализует handoff внутри одной
организации; позднего upgrade и нового порядка предварительных profile locks
нет. Независимый source trace подтверждает org-before-profile для legacy
handoff156/174, обычного curator assignment156/155, case response182/156 и
E1 finalization185. Это не доказательство отсутствия всех возможных deadlocks
между разными организациями и не новый concurrency run.

## Проверено до исполнения

- pglast7.7 разобрал10 statements и2 PL/pgSQL function bodies.
- Исходный guard126 после нового узкого исключения сохранён без изменений.
- Две существующие функции заменяются; новых публичных grants нет.
- `git diff --check` проходит.

SQL SHA256:
`8b6a97eb416f11fb177014bd1d0786a3e3c23f4f34f6b481a4139acbce518d66`.

Подготовлен отдельный create-only continuation runner. Он требует reviewed215,
квитанцию фактического применения A и согласованное окно; использует прежний
frozen packet и буквально тот же failed handoff request/payload. Первая ошибка
не перезаписывается, следующий этап автоматически не запускается. Независимый
review runner SHA `6763b0b4c23e8a449175864b9b4e8e3f4559d05ec4aad6f077392c769db9d49f`
одобрен как проверка исходника до исполнения. Последующее исполнение описано ниже.

## Реальное локальное исполнение — 20 сентября UTC / 21 сентября локально

Два независимых review одобрили exact `0e0f87db0493855f5ad4a208204531872391c5cd`.
A как единственный schema applier после root GO применил указанный SQL только
в `evo-local-0fd3559d0240c989`, `21:42:50Z` (`local215-receipt.json`).
Ledger и SQL001–214 неизменны; схема001–215 последовательна. Все20 существующих
business hashes/counts и число Auth users прежние; новый context table пуст.
Проверены FORCE RLS, закрытые ACL, два immutable trigger и deferred parent FK.
OID/ACL/прочие pg_proc metadata двух заменённых функций сохранились.

Перед Auth выполнены6 rollback-only SQL probes: отсутствие/неверный формат/
невыданный receipt pointer и попытки совместно поменять Student, state или
source. Каждый получил40001 `portal_identity_conflict`. A fresh snapshot после
probes полностью совпал с21-table baseline после215, включая functions и ledger.

После этого ровно один обычный Sales Auth retry использовал буквально тот же
request/payload, что первый неуспешный208 вызов. Он прошёл:

- Существующее дело pending→active; seller — текущий владелец lead, curator —
  согласованный существующий сотрудник, scope1→2 с деактивацией старого scope.
- Ровно одна продажа, один final handoff receipt и один owner-sync receipt.
  Условия1KGS / paid0 и месяц2026-09 соответствуют согласованному QA packet.
- Три затронутых profile получили access_version+1. Delta: audit+3,
  scope events+3, assignment+1 и lifecycle event+1.
- Lead, conditions, memberships, прочие записи и старые append-only строки,
  functions/ledger/Auth count неизменны. Это подтверждено отдельным A observer.

Затем исходный214 Student selection создал одну preparation/version1 с одним
binding/event/audit. Exact replay не меняет состояние; тот же выбор с новым
согласованным request добавляет только command audit. Changed-version conflict
и чужой Student read отклонены без записей. Actual Student/Admissions responses
прошли существующие TS и Swift модели с проверкой pinned publication/intent.

После Auth-сценария5 SQL probes подтвердили запрет смены seller уже активного
дела, в том числе с прежним actual receipt pointer, и запрет UPDATE приватной
квитанции55000. Outer rollback выполнен; финальный A snapshot полностью совпал
с предыдущим состоянием после denials. После этого B освободил writer window.

Приватные доказательства вне Git: `b215-retry-*-result.json`,
`b215-guard-probes-*-result.json`, `a-b215-handoff-parity-result.json`,
`a-b215-selection-parity-result.json`, `a-b215-replay-parity-result.json`,
`a-b215-duplicate-parity-result.json`, `a-b215-denials-parity-result.json`,
`a-b215-final-parity-result.json`, `b214-actual-swift-decode-result.json`.

## Границы и оставшаяся интеграция

SQL probes являются техническим доказательством guard, а не ordinary Auth
acceptance. Нынешнее QA дело имеет NULL прежнего seller и не доказывает
non-NULL reassignment. Новые сущности, роли, фикстуры или чужие дела для такого
доказательства не создаются. Непроверенные варианты остаются явно указанными.
Active-case отказ не изолирует stale-xid predicate; deferred FK проверен по
живому catalog, но orphan commit не исполнялся. Валидный receipt с неверной
authority и отдельный downstream failure уже внутри215 не воспроизводились.
Первый полный rollback относился к исходной ошибке208 до исправления215.

Порядок интеграции остаётся948→946→этот stacked PR; после retarget на main
нужны окончательные exact-head review и CI. Предыдущие review и local receipts
сохраняют свои точные revisions и не объявляются новым прогоном после rebase.

Это не завершение полного UI/iPhone пути, требований к документам, загрузки,
отправки/проверки пакетов, managed rollout или production release.
