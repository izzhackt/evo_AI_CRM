# B3a — intake identity source/read receipt, 2026-09-20

## Статус и точная область

Source slice: optional intake UUID в TS/Swift/SQL; сохранение ID в редакторе;
защищённая техническая публикация, доказывающая добавление только ID; отдельная
честная проверка Admin. Base main `6da4f354d1a7af88bfbb19b11c3e2546606ae114`.
Спецификация до runtime: `5e179d1a`; shared contract принят в `8bd96f2d`.
211 зарезервирована B, 210 принадлежит A/PR943; очередность интеграции — 210 → 211.

**Это не готовность всего B3, не применение211 и не публикация данных.**
Selection/documents, country allowlist, degree adapter и клиентский выбор здесь
не меняются. Продакшен/симулятор не обновлялись. Новых QA identities, datasets,
моков или бизнес-записей не создавалось. Старые local207–209 receipts не повторялись.

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

## Выполненные проверки

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

## Конкретный пакет следующей реальной проверки — требует authority

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

Не хватает: authority на211 и technical writes, действующего Admin login в новом
runtime, реального stage/review/retry/readback и визуальной проверки. Управляемый
релиз и финальный продуктовый E2E не входят в этот пакет. Согласованные обычные
Auth/read-only вызовы выполнены; разрешение на них не расширялось до write authority.

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
  заменяет выполнение. UI batch и SQL write proof по-прежнему не выполнены.
- После UI исправления production build прошёл; после финального уточнения
  facts-only classification TypeScript, scoped ESLint и фактическая проверка выше
  прошли. Build не переименован в новый runtime/write proof.
