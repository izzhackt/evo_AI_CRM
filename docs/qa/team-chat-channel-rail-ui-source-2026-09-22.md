# A15 rail — UI source stage, 22.09.2026

После approved logic source2c442162 и independently accepted c675 incumbent
выполнено согласованное подключение отображения. Critique/план/журналы до UI
edit зафиксированы891653d4; Impeccable craft-floor перечитан, context не перезапускался.
Исходный c675 checkout/raw proof не менялись. Shared runtime принадлежит ROOT238.

## Изменение

- Каждая строка показывает strict server latestPreview через уже принятый
  plain-text formatter: live автор/«Вы», confirmed null «Пока нет сообщений»,
  tombstone «Сообщение удалено». Search/context/feed не являются источником preview.
- Unknown/отсутствующая metadata остаётся ошибкой decoder/acceptor; stale
  accepted preview не подменяется пустотой. Background ошибка и её прежний
  ручной retry теперь видны на mobile channel panel с тем же ticket/id/pending.
- Forbidden показывает закрытый доступ и обычный login; прежний terminal
  reducer очищает channels. Foreground ownership и conversation JSX неизменны.
- CSS скрывает новый feedback на desktop; на mobile скрыта противоположная
  панель. Поэтому одна ошибка не даёт две доступные alert-копии. Реальное AX
  поведение новой композиции остаётся предметом последующей UI-проверки.
- Удалены только presentation latestMessageId/state/setter/lookup. latestId ref,
  tailChanged, hydrate commitTail, watermark, feed/seen и Composer сохранены.
- EVO/Golos, аватары/selected/unread, порядок ссылок,288px rail,15/13px,
  ellipsis,44px controls и800px breakpoint остаются прежними. Нет новых SQL,
  таймеров, подписок, API, timestamps, фильтров или общей переделки.

## Проверки и пределы

Node22.23.1: новый `npm run typecheck` (typegen+tsc) и targeted eslint для
TeamChat.tsx завершились0. `git diff --check` чист.31/31 pure protocol cases
**переиспользованы** с exact2c442162, не объявляются новым прогоном: formatter,
decoder/acceptor, error reducer, обе test files и ещё прямые зависимости побайтно
не изменились. Parity покрывает12 файлов; весь conversation JSX suffix прежний,
CSS отличается только двумя channelFeedback правилами. Проверка новой DOM/UI,
mobile ошибки/retry/forbidden, concurrent delivery и real-role acceptance этим
не доказаны. Независимый source review и один общий final UI batch впереди.

Private evidence `/private/tmp/evo-team-chat-channel-rail-ui-source-20260922`:

| Артефакт | SHA256 |
|---|---|
| parity.json | `d87a903f7a365892d5d99a7d6fe5069164f6ba2aae02916aed2c0ed26c6385bc` |
| source-receipt.json | `4d381bbfb7085b28b437cb24cde04ec999eefbb2e80ba95050c1f0a686007290` |
| typecheck.log | `dd8145086836aaed592b736d5d2abf5e521cada876212e044f406db1756e9d5b` |
| lint.log (exit0, пустой) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

Product bytes для review:

- `src/components/v3/team-chat/TeamChat.tsx`: `0b476bda215f650322a0e44c3f8aa7f449474388425b31b139cdf8c6fde0e2bf`.
- `src/components/v3/team-chat/team-chat.module.css`: `2907f9dc96524b85ec85ad4c76c23e08a7a850bdab55a3e92c0b4c2194215a9a`.


## Последующее фактическое подтверждение

Описанная выше source-only стадия сохранена как историческое evidence.
На неизменном bab531ae затем выполнена [ограниченная actual UI-проверка](team-chat-channel-rail-actual-2026-09-22.md),
независимо принятая вместе с closure (2de97c08). Она отдельно перечисляет
reused partial proof, исходные STOP, последующее завершение и границы интеграции main.
