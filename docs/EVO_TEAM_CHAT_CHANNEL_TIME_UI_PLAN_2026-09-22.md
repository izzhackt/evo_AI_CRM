# A15 — время последнего сообщения в списке каналов

Статус: конкретный план до изменения UI; независимое precode review ожидается.
Основа — main `2a04610f8a52c4c187c162dc687fddc643344b22`, принятый PR #1027
и [общий timestamp-контракт](EVO_TEAM_CHAT_CHANNEL_TIME_PLAN_2026-09-22.md).
Reader239/DTO уже приняты локально; новая миграция не требуется.

## Задача и визуальная основа

Сотрудник просматривает существующие каналы и видит, когда в каждом появилось
последнее сообщение. Режим Impeccable — Operate: сохраняем EVO, Golos,
rail288px, аватары, названия, preview, unread, выбранный канал и ссылки.
Новая информация — второстепенные метаданные внутри существующей строки.

Impeccable4.3.1 context уже загружен в этой сессии, повторный запуск не нужен.
Прочитаны PRODUCT.md, DESIGN.md, brief командного чата и правила shape;
пользовательские решения и утверждённый контракт уже задают направление.
Новое подтверждение визуального направления не требуется. Craft-floor будет
прочитан непосредственно перед UI-правкой после принятия этого плана.

Просмотрены сохранённые actual-снимки1440/320 из rail #1020. Их происхождение
и ограничения остаются в [квитанции](qa/team-chat-channel-rail-actual-2026-09-22.md).
От source `bab531ae` до текущего main побайтно совпадают scoped CSS и весь
`channels.map` до конца nav; снимки пригодны как incumbent этой композиции.
CSS SHA256 `2907f9dc96524b85ec85ad4c76c23e08a7a850bdab55a3e92c0b4c2194215a9a`.
1440 PNG `b390d718f54a681e8447827c60e38489a50d43e2ad07b1f0e5df795406e78c81`,
320 PNG `acd8593262918fe213fb4184b9b69b233a33a70072aa70732d6d9e56276a68fc`.
Это исторический визуальный материал, а не новый запуск приложения или приёмка
будущего времени. Приватные изображения не копируются в Git.

## Формат и состояния

- Видимая подпись — `dd.MM HH:mm`, всегда в `PLATFORM_ORGANIZATION_TIMEZONE`
  (`Asia/Bishkek`). Локаль `ru-RU`, календарь gregory, цифры latn и hourCycle h23
  задаются явно. Нет «сегодня/вчера», зависимости от часов устройства или таймеров.
- Pure formatter использует принятый strict normalizer239. `dateTime` сохраняет
  весь канонический UTC timestamp с шестью дробными цифрами. Для минутного
  отображения Date получает только whole-second UTC часть; микросекунды не
  округляются в соседнюю минуту и не теряются в machine-readable значении.
- `Intl.DateTimeFormat.formatToParts()` формирует фиксированный порядок и
  разделители видимого текста. Полный текст содержит дату с годом, время и
  полученный через `timeZoneName: longOffset` offset зоны организации.
  Например: «Последнее сообщение: 01.01.2027 00:00 (GMT+06:00)».
- `<time dateTime>` получает этот полный текст в `title`; видимая короткая
  подпись скрыта от screen reader, рядом внутри time — существующий `srOnly`
  с полным текстом. Подсказка hover не является единственным доступным источником.
- Empty/null и legacy-unknown/отсутствующее поле не создают time или placeholder.
  Invalid input formatter отклоняет; строгий wire decoder продолжает отклонять
  malformed read до рендера. Preview и его timestamp уже принимаются вместе
  действующим acceptor, его правила не меняются.
- Tombstone, если он есть в данных, сохраняет время создания сообщения, а не
  удаления. Этот UI не читает body или дату удаления заново и не меняет сортировку.

Первичные справочники проверены22.09:
[HTML time](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/time),
[formatToParts](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/formatToParts),
[DateTimeFormat options](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat).

## Компоновка и границы

Название и time — одна flex-строка внутри нынешнего channelCopy, время справа,
выравнивание по baseline. Название min-width0/ellipsis, время не сжимается и
не переносится. Метаданные13px, обычный вес, текущий `--text-3`, tabular-nums;
preview13px остаётся второй строкой. Unread остаётся отдельным соседним badge,
не сжимается и не перекрывается временем. Ссылка целиком сохраняет цель≥44px.
Не меняем ширину rail, аватары, порядок каналов, active/focus, URL/onClick,
composer/drafts, search/context, handlers, transport/error/retry или Auth/seen.

На текущих снимках короткие Общий/Продажи оставляют место в существующей строке;
пустое Поступление time не получает. Для длинного названия с временем действует
ellipsis, полный текст остаётся в DOM и доступном имени ссылки. Изменение
формата, перенос time в отдельную строку или расширение rail — новая корректировка
плана, если фактический320px покажет необходимость; заранее это не внедряется.

Разрешённые implementation-файлы: `src/components/v3/team-chat/TeamChat.tsx`,
`team-chat.module.css`, новый pure `src/lib/team-chat-channel-time-label.ts`,
адресный `tests/team-chat-channel-time-label.test.mjs`, документы этого среза.
Reader239, DTO/acceptor, normalizer, migrations, message actions и другие
модули остаются неизменными.

## Проверки и порядок

1. Независимое precode review и запись в launch/PLAN_CHANGES до кода.
2. Pure tests реального formatter: переход UTC→Bishkek через день/год, midnight
   `00:00`, одинаковый результат при разных timezone процесса, equivalent input
   offsets, полная UTC6 точность `dateTime`, отсутствие подписи для null/legacy/
   invalid. Это контрактные примеры, не подмена runtime-данных.
3. Scoped ESLint и TypeScript, diff check, независимое source review и protected
   short CI. Reuse node_modules только при точном package/lockfile совпадении
   и безопасном существующем каталоге; без новой установки или тяжёлой сборки
   при текущем ограничении диска. Не повторять неизменённые43 reader tests.
4. Actual UI только после отдельного окна ROOT; текущая очередь ROOT16b → B1029
   → A. До него никаких Auth/SQL/server/browser/shared-QA операций.
   Подготовка source не выдаётся за живую UI-проверку.
5. Один согласованный batch1440/390/320 на существующих каналах: видимое время
   и `dateTime` против canonical, полный title/доступный текст, geometry без
   overlap/page overflow, keyboard activation и Back, прежний preview/unread,
   unsent draft/search/context в непосредственно затронутой глубине.
   Seen — только заранее ограниченные existing IDs/собственная membership;
   полный снимок и закрытие собственных ресурсов обязательны.
6. При выявленных визуальных дефектах одна общая правка и не более одного
   подтверждающего batch. Не создавать сообщения ради дат/вариантов. Отсутствующие
   old-year/tombstone/другие роли — честные gaps; правило форматирования покрыто
   pure tests. Final exact-head review, CI и protected merge выполняются отдельно.

Production, native, общий E2E, полный пункт15 и проверка issue708 сотрудником
этим срезом не заявляются. Доставку и shared-QA продолжает координировать ROOT.
