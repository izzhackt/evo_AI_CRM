# B3e-2 / 226 — фактическая локальная проверка редактора

2026-09-21. Реальный локальный путь на source
`6cdacc7685267540d1fc1772962451bbdbeea1f4`: обычный Admin → редактор CRM →
server action → RPC → immutable revision → кабинет существующего Student.
Это ограниченная техническая QA, не приёмка университетом или production release.
Контракт: [226](b3e2-requirements-editor-contract.md),
[wire](b3e2-requirements-editor-wire.md), [исходный QA-план](b3e2-requirements-editor-qa-plan.md).

## Что выполнено

После принятого ROOT09d baseline локальная миграция226 применена один раз.
SQL SHA256 `99f3a1955e9acbe26ff30e452256c81a4a820a6e7c513aa62b5f9570d3181398`.
До apply выполнен rollback-only probe: временный full save, exact replay,
Student/Admin v2 и ожидаемый отказ v1; подтверждён полный rollback.
После apply проверены точные функции, ACL, восемь nullable columns, constraints,
ledger001–226 и неизменность прежних business rows.

| Обычное действие в CRM | Фактический результат |
| --- | --- |
| Q1: подтвердить два прежних пункта программы A, включив четыре prior/link source | A1→A2; прежние определения и оба материала сохранены |
| Q2: подтвердить программу B с теми же материалами | B1→B2; новые документы и связи не созданы |
| Q3: добавить в A один явно необязательный QA-пункт с новым пустым материалом | A2→A3; два прежних пункта сохранены, новый пункт optional, без файла и срока |

Ровно три успешных UI-save. Итог: **+3 revisions, +7 items, +1 document slot,
+1 application link, +3 audit events**. После каждого save отдельный observer
сопоставил actual immutable intent/receipt и actor с точной дельтой пяти таблиц.
Все прежние строки этих таблиц, остальные277 business tables, существующие slot
versions и прежние projections сохранены. Новый slot получил version2 после
одного link bump. Данные ROOT09d, KB и параллельной ветки не сбрасывались.

**14 ordinary HTTP read-проверок:** четыре v2 ответа Student/Admin для A/B
полностью совпадают между ролями; четыре v1 запроса возвращают PT409
`application_requirements_client_update_required`; два staff editor read
возвращают ту же актуальную revision; четыре отрицательных запроса запрещают
Student/anonymous editor, Admin cross-case tuple и Student foreign-case read.
До/после — одинаковые business state и catalog. Новых business commands нет.

## Реальный интерфейс и Impeccable

Использованы существующие EVO-компоненты, шрифты и цвета. В двух ограниченных
визуальных партиях проверены desktop1440×1000 и mobile390×844: поля редактора,
решения по источникам, confirmation, success/readback и Student A/B.
Изменение ширины не потеряло введённый Q3 и optional flag; ширина документа
на mobile равна390 без горизонтального overflow. В Student видны три пункта A,
два B, общие document links и отдельная отметка «Необязательно». Состав требований
не выдаётся за одобрение файла; все материалы остаются без загруженного файла.

Сохранения выполнены только кнопкой «Сохранить список». Ни UUID, ни React state,
ни hidden inputs не подменялись. Для Q2 использован прямой переход между URL с
разными hash; после save экран вернулся к hash A и прежний locator закрытия B
истёк. Повторного save не было: Q2 receipt/observer уже подтвердили B2, затем
обычной кнопкой подготовки B повторно прочитан правильный список. Поведение
восстановления hash не заявляется исправленным или отдельно проверенным.

## Квитанции и завершение runtime

Private directory: `/private/tmp/evo-b226-write-qa` (0700, receipts0600).
Полные IDs, raw responses, audit intents и скриншоты остаются там; credentials
и bearer/session values не записаны в отчёт/Git. Снимки UI — `ui/`.

| Квитанция | SHA256 |
| --- | --- |
| `preflight-attempt-2/preflight-receipt.json` | `d7dcdaa56eb4ef8f0a6e1a720dd93ad927c7777d033fcf6c04ee36e5bddcd1ec` |
| `apply-receipt.json` | `c40e3f3be7fcb60fe49c61a70c53368a3b85a86cc1a6e313dc66c62edb7d15ad` |
| `after-qone.json` | `00ff623667b156f9e95ae832746cd2d038f471e7e764a2597812434ac5e24bd5` |
| `after-qtwo.json` | `72d4558462fb65a8139aa633c0145d149592dc5b18783977ce7f8d5b7cb6db19` |
| `after-qthree.json` | `81037b0198326b3f3387ce61903041d42cf26aaf45c9205a3a073fb4ea33358d` |
| `after-core.json` | `78093f3f51957fbbab5ec91d11d86ca756d18ad6ed81548af4f13af92403bc9f` |
| `read-receipt.json` | `a385ef93820f02d828ea3a11cb8bbd663596e34c5a109d4eaabc5c2c215f126c` |
| `final-runtime-snapshot.json` | `060c610ec5ad97a188f61742f86d564195adaf5ff98fe3299c0e0379e92ef5d5` |
| `ui-auth-cleanup.json` | `880c82e8889fb487223521d5d885b5a334d1c10b8d1cb9e7313a72cbea84615b` |

Обе собственные browser-сессии и обе read-helper-сессии завершены через
`logout?scope=local` с204; пользовательские сессии не закрывались. Собственный
Next33236 остановлен, listener отсутствует. Final282 state совпал с after-read;
Storage object hashes и Auth user/identity counts совпали с ROOT09d.
Auth sessions целиком равными не объявляются: обычные login/logout их меняют.

Ошибки инструментов сохранены, а не заменены зелёным результатом: первый probe
остановился на недоступном локальному postgres logging SET до DDL; CLI apply
успешен с первого раза, но verifier потребовал корректировки PG17 default
`attstattarget=NULL` и нормализованного CHECK. Исправленные проверки независимо
одобрены; повторного apply не было. Первый after-core input пропустил три pins:
FAIL сохранён как `after-core-attempt-1-failed.json`, исправленный input прошёл
тот же read-only observer. Первый final Storage comparison сопоставлял raw rows
с hashes; raw сохранён, исходная hash/query форма подтвердила равенство.

## Пределы доказательства

- 246 focused tests, TypeScript и scoped lint ранее пройдены на этих source
  bytes; повторное исполнение при последующем docs/main merge не заявляется.
- Exact replay исполнен в rollback probe. Replay после Q3, request-conflict,
  stale/rebase, unknown-result recovery, lifecycle/account-switch recovery и
  concurrency не исполнялись в этой bounded UI-серии; pure tests не заменяют их.
- Actual legacy137/179 adoption, non-admin assignment scope, native iPhone,
  реальные файлы/reviews, provider и customer acceptance не проверены здесь.
- Ни production apply, ни deploy, ни полное завершение пунктов1–36 не заявлены.
