# A15 rail — первый logic-only этап

Статус: source реализован и локальные целевые проверки прошли; независимый
source review ещё впереди. [Precode](../EVO_TEAM_CHAT_CHANNEL_RAIL_PLAN_2026-09-21.md)
9eb9f51f принят review430b613f; ROOT дал отдельный source-only GO. Уточнение
плана/журналов7cf4639b предшествует этому коду. Base mainc675d4b4 (#1017).

## Что изменено

- Обе реальные channels-bearing операции, refresh (включая каждую catch-up
  итерацию) и search/append/retry, выделяют ticket из одного component-local
  counter непосредственно перед existing action. V2 reads не менялись.
- Общий commit вызывает принятый acceptor после alive/revoked/foreground guards.
  Устаревшая metadata сохраняет ref/state, но не отменяет допустимый feed/search
  результат. Невозможный snapshot возвращает unavailable прежнему owner до
  participants/feed/watermark. Forbidden очищает channels ref и state.
- Добавлен pure formatter null/own/other/tombstone; текст сохраняется буквально,
  UUID автора сравнивается без учёта регистра. Formatter пока не вызывается в JSX.

Весь JSX от workspace return и SearchText побайтно прежний, CSS тоже. Старый
выбранный preview/presentation state остаётся до визуального этапа. Prefix
модуля decoder/acceptor побайтно прежний; formatter только дописан. Hydration,
latestId/tail, feed/seen/Composer/MessageRow/actions/source/SQL не менялись.
Это не завершённое отображение preview всех каналов или mobile feedback.

## Проверки и доказательства

Node22.23.1, существующие locked dependencies переиспользованы после точного
сравнения package.json/package-lock.json. Все команды выполнены один раз:

| Проверка | Результат |
|---|---|
| Node preview/order/formatter и read-error/hydration tests |31/31 PASS,20 preview cases +11 read-error cases. Только чистые контракты, не real UI/races.|
| `npm run typecheck` |PASS, включает route typegen и tsc.|
| Targeted ESLint для трёх изменённых файлов |PASS,0 errors/0 warnings.|
| Diff/whitespace и markup/protected source parity |PASS; отдельная сверка, не новые runtime доказательства.|

Private packet: `/private/tmp/evo-team-chat-channel-rail-logic-source-20260921`.

| Файл | SHA256 |
|---|---|
| `protocol.log` |`e79224657719915abc23290889304ed8ca2da3249dccbcf99a5f67758553bfd1`|
| `typecheck.log` |`dd8145086836aaed592b736d5d2abf5e521cada876212e044f406db1756e9d5b`|
| `lint.log` |`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`|
| `parity.json` |`9173d669cd34f5b5aa1c774ea2b70e020d4d7a0cb74a3bfedc800d9a157bb44c`|

Каждый check receipt сохраняет команду и exit0; пустой lint log сам по себе
не является доказательством успеха. Node MODULE_TYPELESS_PACKAGE_JSON warning
сохранён без изменения package ради тишины. Ошибок/повторных прогонов не было.

Нет нового SQL/Auth/RPC/browser/server/visual batch. Shared QA у ROOT; следующий
incumbent rail packet готовится отдельно без исполнения. Мобильные1014 PNG по-
прежнему показывают conversation, не rail. Actual/UI, protected final CI/review/
merge, whole15/1–36 и production не заявляются выполненными этим этапом.
