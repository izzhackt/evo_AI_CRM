# B3a — intake identity source/read и локальная UI/RPC квитанция, 2026-09-20

## Статус и точная область

Source slice: optional intake UUID в TS/Swift/SQL; сохранение ID в редакторе;
защищённая техническая публикация, доказывающая добавление только ID; отдельная
честная проверка Admin. Base main `6da4f354d1a7af88bfbb19b11c3e2546606ae114`.
Спецификация до runtime: `5e179d1a`; shared contract принят в `8bd96f2d`.
211 зарезервирована B, 210 принадлежит A/PR943; очередность интеграции — 210 → 211.

**Текущий результат: local211 применена; одна существующая локальная карточка
прошла ID-only Admin stage/review/publish, replay и Student readback.** Подробности
ниже. Это не готовность всего B3 и не managed publication. Selection/documents,
country allowlist, degree adapter и клиентский выбор здесь не меняются.
Продакшен/симулятор не обновлялись. Новых QA identities/datasets/кейсов нет;
единственные новые бизнес-записи — разрешённая publication и2 request receipts.
Старые local207–209 receipts не переименованы в новый прогон.

## Реальный read-only baseline

2026-09-20 **18:16:10.777 UTC**: обычный password sign-in уже существующего
managed Student QA; user binding проверен; настоящий
`platform.student_university_catalog` без admin preview/service role.
Учётная запись/роль/tenant не изменены, credentials/JWT не сохранялись в outputs.

Полная пагинация: offsets из фактического nextOffset, последняя страница null;
5 страниц: 30+30+30+30+23 = **143 вуза**, **251 программа**, **145 наборов**.
ID есть у **0**, legacy **145**. Дубли institution IDs и немонотонная пагинация
проверены; это последовательный read snapshot, не транзакционный export. Перед
записью обязательна повторная проверка baseVersion/immutable base сервером.

CN/MY/AE/TR/IT/CZ: **116 вузов**, **131 набор**, все без ID. Наборы есть у
**65** из этих вузов; оставшиеся **51** не содержат intake. Exact set этих65
совпадает с manifest: пропусков0, дубликатов вузов/ID0, изменённых фактов0.
Вузы без наборов технически публиковать не требуется; selectable они не становятся.
Переход выполнен: **0**. Legacy остаётся: **131**. Все131 ожидают разрешённой
технической публикации после211; stale/error на write path не проверялись.

Raw public catalogue DTO snapshots: `/private/tmp/evo-b3-catalog-hDk89f/page-N.json`.
Это фактически возвращённые публичные сведения, без Student данных/credentials.
SHA-256 исходных файлов:

| Страница | Вузов | SHA-256 |
|---|---:|---|
| 1 | 30 | `726441ee0e238254344f8d1665ead2ad8844f74fbd11ef2dbac78d92e3e6a978` |
| 2 | 30 | `9c6ef7c3de7dd3137b3ec2b37c819c108eff2af0e02c7e7faa9d74e4232412d8` |
| 3 | 30 | `56e9d0ed475842d313281a18b7e6e05b08e9f18676128ff2b35d4071a365dc7c` |
| 4 | 30 | `07cb5c8df56b831b73929435c13b3f396678918155481cf7b24f9e195fa325f6` |
| 5 | 23 | `6a85be12b61cdcaa0cbdd86901d9e277870b53006e9a5162ae2341cd7abfffe2` |

## Source/read checkpoint до локальной записи

- TS parser до/после изменения читает все пять настоящих страниц:143/251/145.
- Изменённый Swift decoder читает те же страницы:143/251/145, без intake IDs.
  Это совместимость с legacy; получение опубликованных новых IDs не доказано.
- На тех же реальных сведениях подготовлен **неопубликованный** manifest:
  65 вузов/131 новых ID, без изменения названий/дат/источников/порядка массивов.
  Повторный вызов helper на подготовленном content сохранил все ID и не создавал
  новых. Кандидат прошёл TS parser. Это подготовка конкретной записи, не DB proof.
- `next typegen`, TypeScript, scoped ESLint и production `npm run build` — PASS.
- Swift macOS typecheck (включая прежние constructor calls) и iOS Simulator
  arm64 source typecheck — PASS; приложение не переустанавливалось.
- SQL/PLpgSQL parser:16 top-level statements/9 функций/DO/expanded validator PASS.
  Это синтаксическая проверка, не применение/исполнение PostgreSQL.
- `git diff --check` PASS. Impeccable detector один проход по двум UI-файлам:
  findings0. Визуальная проверка новых Admin screens **не выполнена**: нет
  разрешённой действующей Admin-сессии в новом runtime; одних статических
  проверок недостаточно для visual/runtime acceptance.

Manifest: `/private/tmp/evo-b3-catalog-hDk89f/supported-intake-id-manifest.json`.
SHA-256 `a1eb5a403753ea39226b1ff2fcb430a94b98e352e2271e5b309249209faa38dc`.
В нём сохранены request IDs и конкретные intake IDs для безопасного повторения.
`baseContentJsonSha256` — hash JSON.stringify, **не** PostgreSQL JSONB hash.
Сервер211 сам привязывает baseVersion к immutable publication UUID + своему hash;
клиентский hash не принимается за authority. Manifest не исполнен; его сохранение
не является разрешением публикации. Перед использованием перечитать actual base.

## Совместимость и safeguards

- Старые snapshots не переписываются. Optional ID отсутствует только у legacy;
  присутствующий ID: canonical lowercase UUID36, null/type/дубли отвергаются.
- SQL history check не даёт переместить ID к другому вузу/программе, в том числе
  после удаления из latest; tenant identity lock предшествует institution lock.
  После первой identified публикации нельзя вернуть ID-less writer.
- Existing normal stage/review signatures и hashes сохранены. Technical digest
  включает режим; ordinary replay не переопределён задним числом.
- Техническая версия сохраняет original reviewed source_registry_id и verifiedOn.
  Reject не отвергает исходный source. Publish повторяет exact-base/ID-only proof.
- Legacy Admin RPC сохраняет exact DTO и видит только content drafts. Новый
  guarded RPC возвращает обязательный reviewKind; fallback/default отсутствуют.
  PGRST202 может означать stale schema cache, поэтому скрывать ошибку нельзя.
- Technical checkbox прямо говорит об отсутствии новой проверки источников.
  Режим review берётся из server-stored immutable draft, не checkbox/формы.

## Следующий managed rollout — по-прежнему требует отдельной authority

1. Root подтверждает интеграцию210 и exact reviewed211; сверяет live ledger/hash.
   Установка211 отдельно от публикаций, published content сама не меняет. Сначала
   совместимый новый runtime, затем отдельно разрешённые ID-publications. Старый
   strict web parser отвергает intake.id, поэтому после них rollback к старому
   image несовместим: заранее нужен проверенный совместимый rollback image либо
   forward recovery. Immutable snapshots не переписывать.
2. Разрешённая обычная действующая Admin-сессия в runtime с этим кодом; права не
   создавать/расширять, cookies с production не извлекать для переноса.
3. Выбрать существующий опубликованный вуз из сохранённого manifest и перечитать
   его actual base. При отличии версии остановить этот intent и подготовить новый
   candidate с явным разбором изменений; не сопоставлять наборы по имени/дате/index.
4. Открыть обычную карточку → «Предложить обновление» → «закрепить наборы без
   изменения карточки». Проверить реальные поля/desktop/mobile/keyboard и
   frozen retry; получить validated saved receipt, затем technical review.
5. После отдельно разрешённого publish обычным Student RPC перечитать тот же вуз;
   сверить неизменность facts/verifiedOn/first publication и exact persisted IDs.
   Затем web/iPhone actual readback; capture viewport и состояние, без подставных данных.
6. Доступные реальные stale/replay/parent-conflict/role-denial пути проверить в
   согласованном scope. Нельзя создавать искусственные бизнес-записи для покрытия;
   недоступные сценарии перечислить как unverified. Concurrency/SQL semantics ещё
   не проверены исполнением. Отказные сценарии не считать PASS по чтению кода.
7. Только после успешной ограниченной проверки отдельным решением разрешить
   остальные технические редакции (максимум64 после первого из65 publish).
   Итог: supported/already identified/transitioned/still legacy/blocked counts.

Для managed rollout не хватает authority на211/technical writes и проверки
в соответствующем runtime. Локальная authority и результат следующего раздела
на managed manifest65/131 не распространяются. Управляемый релиз и финальный
продуктовый E2E не входят в этот пакет.

## Дополнительная проверка подготовленного manifest и batch-классификации

Swift `UniversityContent` напрямую декодировал `manifest.entries[].content`:
65 редакций /131 набор /131 уникальный ID. RPC-ответ не фабриковался. Это чтение
реально подготовленных кандидатов, отдельно от подтверждённых legacy RPC reads.

Independent standards review head `1dde2aa7` обнаружил P2: batch видел ID-only
разницу как update и отправлял ID-less template, который SQL211 отвергает.
Исправлено: facts-only equality исключительно для read-only классификации даёт
`current`; при реальном изменении identified content — `editor_required`, отдельный
счётчик и ссылка на actual institution editor, без включения в legacy batch.
Пустой latest + добавляемые template intakes также требует редактора: прежняя
identified history может существовать. SQL211 остаётся authority при race;
дополнительного pre-read перед frozen request нет, replay/digest не менялись.

Проверка на actual snapshots + том же неопубликованном manifest:

- Все65 same-facts кандидатов классифицируются current.
- Все143 repository templates совпадают с actual baseline по фактам; states:
  current143, new/update/identity_conflict/editor_required0.
- С наложением подготовленных IDs states остаются current143; исходные content,
  template hashes и неизменность входных структур подтверждены.
- Другие ветки не упражнялись новыми искусственными данными. Их source review не
  заменяет выполнение. UI batch не выполнен; ограниченный SQL write proof
  technical-path приведён в следующем разделе.
- После UI исправления production build прошёл; после финального уточнения
  facts-only classification TypeScript, scoped ESLint и фактическая проверка выше
  прошли. Build не переименован в новый runtime/write proof.

## Разрешённая локальная проверка211 — завершена

Владелец через root подтвердил конкретный пакет210→211 словами «continue ur
work, complete the plans». Область: существующие local Admin/Student, одна
карточка Guangdong University of Technology (CN), одна программа и один набор;
без новых identities/ролей/кейсов/fixtures и без managed/provider операций.

Main210 `1795bf2380344bdca059868aba57d033fa13a259` интегрирован один раз в
`21eb53b39391d65182008d6aeac36936c1a691bb`; оба независимых delta review approved.
SQL211 SHA256 неизменён: `0f6eea6c28ed9d29424b31a36c8d3f84bd151c8d73e4d380b11ddf66b9c60675`.
CI35531268701 полностью green; typegen/tsc passed. Эти source checks повторно
не запускались как якобы новое runtime-доказательство.

A — единственный schema applier — применил211 после210 к owned local project
`evo-local-0fd3559d0240c989`, API `127.0.0.1:57495`. На checkpoint проверки211
подтверждён ledger001–211 (это не утверждение о последующих миграциях A);
применение схемы не изменило content/историю/счётчики. Старые A readers33215/33217
остановлены до публикации. B33216 заменён на совместимый runtime21eb53b3,
cwd проверен; Student session сохранена. Существующий Admin вошёл отдельно на
localhost33216, Student остался на127.0.0.1:33216.

Реальный путь:

1. Admin открыл существующую карточку → «Предложить обновление» → «закрепить
   наборы без изменения карточки» → «Сохранить техническую версию» клавиатурой.
   UI подтвердил один draft. Сравнение persisted content с baseline после удаления
   только нового UUID: exact equality; программа/источники/verifiedOn неизменны.
2. CUA не раскрывает hidden form values. Для replay использованы actual persisted
   request ID/content/reason/baseVersion из read-only локального DB packet A,
   после реальной UI-команды. Ordinary authenticated Admin RPC вернул exact тот
   же receipt/draft; новые request IDs или подставные ответы не создавались.
3. Admin открыл technical review с отдельным текстом об отсутствии повторной
   проверки источников. До checkbox publish disabled; после подтверждения
   «Подтвердить решение» перенаправило в действительную опубликованную карточку.
   Snapshot v2 содержит ровно1 intake ID. Повтор publish с actual persisted
   args/request ID тем же Admin вернул идентичную квитанцию.
4. Существующий Student обычными Auth/RPC прочитал v2/1program/1intake/1ID;
   content совпал с staged draft. В19:18:25.422Z отдельный
   `student_recent_universities_v1` подтвердил неизменный firstPublishedAt.
   Actual Student UI открыл эту карточку из Home. Действующие TS parser и уже
   собранный Swift decoder прочитали этот настоящий RPC JSON:1/1/1 identified.
   Swift suite не пересобиралась; это не новый iPhone UI/Simulator прогон.

В первом private readback helper ошибочно проверялся firstPublishedAt внутри
catalog DTO. Assertion failed; helper исправлен на отдельный207 RPC по его
реальному контракту. Product-код из-за этого не менялся; исправленный реальный
readback завершился успешно. UI uncertain-transport retry не вызывался искусственно:
доказан persisted same-request RPC replay, UI frozen intent остаётся source proof.

Финальный read-only DB snapshot A независимо сверен B:

| Показатель | До | После |
|---|---:|---:|
| Все historical publications / published | 6 / 6 | 7 / 7 |
| Request receipts | 12 | 14 |
| Drafts | 0 | 0 |
| Sources / institutions | 6 / 5 | 6 / 5 |
| Auth users / leads / cases / sales | 6 / 7 / 7 / 4 | 6 / 7 / 7 / 4 |

Original v1 id/status/version/reviewed_at/content_hash/source_registry_id совпали
с baseline, firstPublishedAt сохранён. Ordinary login sessions допустимы и не
выдаются за отсутствие Auth-событий. Остальные mutations не выполнялись.

Impeccable: один объединённый проход формы/technical review и одна поправка
текста «1 наборам» → «1 набору» (также корректен singular21/31…); runtime21eb53b3
с этой единственной copy-правкой. Сохранение/SQL/Swift/права не менялись.
Для финальной copy-правки scoped ESLint и `git diff --check` пройдены;
build/SQL/Swift проверки без изменений соответствующего кода не повторялись.
Desktop stage и actual technical review на390×640/320×640: без горизонтального
overflow, select/button44px, checkbox label96/144px, видимый keyboard focus,
disabled→enabled перед публикацией. Для скрытой IAB вкладки общий viewport
первоначально действовал на другую вкладку; промежуточные captures не используются
как доказательство. Итоговые размеры проверены в нужной вкладке; override сброшен.

Пригодные визуальные артефакты (ignored `.next/b211-proof/`):
`stage-desktop-copy-confirmed.jpg`, `review-mobile-390x640.png`,
`review-mobile-320.png`, `review-natural-width.jpg`, `student-published-card.jpg`.
Private mode600 JSON receipts находятся в `/private/tmp/evo-database-foundation.WhSt8z/`:
`local211-receipt.json`, `b211-db-baseline.json`, `b211-actual-stage-replay.json`,
`b211-stage-replay-result.json`, `b211-actual-publish-replay.json`,
`b211-publish-replay-result.json`, `b211-student-published-page.json`,
`b211-student-recent-page.json`, `b211-student-readback-result.json`,
`b211-final-db-receipt.json`. Credentials/JWT в квитанции/репозиторий не включены.

Открытые границы: managed211/65-card rollout, реальный iPhone UI, concurrent
writers, parent-conflict/stale/deny execution, upload/selection/requirements и
пакеты не проверены этим локальным срезом. Отдельный read-only обход3 существующих
local Student credentials нашёл0 active+activated cases: original Student видит0,
двое B209 — по1pending activated case. Для следующего positive selection proof
нужен реальный подходящий разрешённый вход; никто не активирован/создан ради теста.
