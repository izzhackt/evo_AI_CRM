# A15 — время превью канала: source-проверка, 22.09.2026

База `d1568d5840cee85e62947a616bb00f0d2a2ac505`, принятый
[контракт](../EVO_TEAM_CHAT_CHANNEL_TIME_PLAN_2026-09-22.md) записан до кода
в `c72cbd1504c7c3727a16edee6d334f17960331c5`. ROOT зарезервировал239.
Этот первый блок готовит reader/DTO; интерфейс времени остаётся следующим.

## Изменение

Миграция239 заменяет только существующую `platform.team_chat_channels(uuid)`.
В тот же lateral latest SELECT добавлено `m.created_at`; внешний JSON получает
`latestPreviewCreatedAt`. После удаления этих двух projection additions и
вводных комментариев файл побайтно совпадает с237. Nested preview остаётся
семипольным; actor/org/Student guard, SECURITY DEFINER, search_path, STABLE,
channel permissions/order, unread/seen и preferences сохраняются. Grants,
таблицы, индексы и история сообщений не меняются.

DTO принимает отсутствующее поле как legacy unknown, оставляя его отсутствующим.
Present null допустим только у подтверждённо пустого канала. Непустое preview
требует timezone-bearing datetime; неверное поле делает весь read unavailable.
Нормализатор проверяет календарь/offset и выдаёт UTC с шестью дробными цифрами.
Микросекунды PostgreSQL сохраняются; эквивалентные offsets сравниваются как
один момент, а отличие в одну микросекунду остаётся различием.

Acceptor переносит preview и его время вместе. Устаревшие sequence/version
или null не стирают время удержанного preview; known→legacy сохраняет известное
время. Unknown→known дополняет тот же ID даже при сохранении более свежей
версии preview. Противоречивые известные времена одного ID отклоняют snapshot
до изменения watermark. Новый ID не наследует прежнее время; отозванные
каналы не возвращаются. Прежний request-ticket guard действует первым.

## Реально выполненные source-проверки

На Node22.23.1 установлены580 packages через `npm ci --ignore-scripts
--no-audit --no-fund`. Scoped ESLint трёх product-файлов и нового теста,
штатный `next typegen`, `tsc --noEmit --incremental false` и diff check прошли.
SQL только разобран локальным pglast; в базу не отправлялся.

Отдельный test-agent подготовил23 meaningful pure cases и выполнил их один раз:
23/23 PASS. Исполнитель выполнил20 неизменённых channel-preview tests:
20/20 PASS. Обе команды использовали `--conditions=react-server
--experimental-strip-types --test` и соответствующий отдельный файл.
Сохранён Node MODULE_TYPELESS_PACKAGE_JSON warning; package semantics не менялись.

Новые cases проверяют календарь/микросекунды/offset, missing против invalid,
null/tombstone, совместимость старого decoder, stale ticket/version/sequence,
same-ID known/unknown/conflict, revocation и отсутствие mutable aliases.
Source fixture старого decoder побайтно равен файлу изd1568d58:
`b4a3ba82230819f348755575e05aac65a915c9f28c08f7dc05766d2ecb2764f9`.
Тест исполняет этот код через настоящий stripTypeScriptTypes, меняя только
единственный относительный module import на абсолютный file URL; данные
продукта и Auth для этого не имитируются. Это pure protocol evidence.

Приватные квитанции: `/private/tmp/evo-a239-channel-time-source-20260922`.
`source-checks.json` связывает команды, exit codes, raw spans и шесть проверенных
source/test/fixture hashes: `110de1d7340d6c902c543a502f3ab2bcaceef5b938f64eaaf57d783c5bbe2489`.
`source-parity.json`: `eb6e1d26388b3156c420f0517c659e3e873c21d28e91faa13b88e9f02769cfbe`.
Из44 прежних связанных файлов изменились только DTO и channel-preview module;
остальные42, включая TeamChat, CSS, AppShell, commands и прежние SQL/tests,
точны исходной базе. Новый normalizer и migration239 входят в отдельные pins.
Migration239 SHA256: `8f75738a93bec90929fe9e6fbd7084c59d5f9d051110f02ea4ea93006ae6bc15`.

## Границы и следующий шаг

Независимое source review и защищённый CI ещё впереди. Миграция239 не применена;
реальные Auth/RPC timestamps, denied Student/anonymous/foreign-org и сохранность
данных в новой схеме ещё не проверены. Shared QA принадлежит ROOT16, затем
B native; отдельное окно для239 назначает ROOT после source-приёмки.
Никаких Docker/SQL/Auth/browser/server/provider операций этим блоком не было.
Нет UI времени, production/native/full item15 или business acceptance.
