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
одобрен только как проверка исходника; сам runner ещё не исполнялся.

## Что ещё требуется

Независимые exact-head SQL reviews, затем A применяет215 только в своей local
QA после root GO с проверкой прежнего ledger и business parity. После этого:
ограниченные rollback-only SQL проверки guard и исходный обычный Auth handoff;
положительный214 selection/readback/replay/denials; декодирование фактического
результата существующими TS/Swift моделями.

SQL probes являются техническим доказательством guard, а не ordinary Auth
acceptance. Нынешнее QA дело имеет NULL прежнего seller и не доказывает
non-NULL reassignment. Новые сущности, роли, фикстуры или чужие дела для такого
доказательства не создаются. Непроверенные варианты остаются явно указанными.

Это не завершение полного UI/iPhone пути, требований к документам, загрузки,
отправки/проверки пакетов, managed rollout или production release.
