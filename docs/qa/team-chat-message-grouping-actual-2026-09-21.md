# A15g-2 / PR1012 — compact message sequences, actual local QA

Статус: один ordinary staff UI-проход PASS; собственные ресурсы закрыты,
полная final-сверка PASS. Независимое actual/closure review и окончательные
head review/CI/merge ещё впереди. Production не обновлялся, весь item15 не закрыт.

Проверенный source: `6e401f9c31def66963ca63c4bc5e89900e23e627`, product
`05705f7ab5aa3a907b9fbfb997ce4440aa636065`. Source-only review
`1652463677c191b39162a83244581f28128d60c1bb49cb390f4054b4e5c1131e`
одобрено; CI35624660692:5 PASS,3 ожидаемых SKIP.
Контракт: [A15g-2](../EVO_TEAM_CHAT_MESSAGE_GROUPING_PLAN_2026-09-21.md);
[исходные проверки](team-chat-message-grouping-source-2026-09-21.md) сохраняют
39/39 tests, lint/typecheck и первоначальную TS2737.

## Привязка и реальные данные

ROOT22F передал sole QA через release11e05efb. Observer/binding прошли
независимое review5940e984; свежий BEFORE b2530480 совпал с переданными
state/catalog/effects/290business/33AuthStorage. Dynamic Docker/Kong/network/
config pins перечитаны; старые сессии и Auth tokens не переиспользовались.
UI binding8fa48fe0/script a9300dcb/admission4c80b311 прошли review96e74ed6.

Обычный существующий staff аккаунт имеет scoped grants, `current_role=null`,
`is_system_admin=false`. Доступ к чату подтверждён реальным login/UI,
не выведен из предположения о coarse Sales role или Admin preview.
В general64существующих сообщений, все принадлежат этому membership.
Пара с сохранёнными QA ordinal15/16 имеет sequence15→16, одного автора,
нет deleted, timestamps01:21:17.406797→01:21:17.415939 UTC в один день Bishkek.
Это ранее сохранённая техническая QA-переписка, не реальные разговоры клиента.
Новых сообщений/аккаунтов/fixtures не создавали; allowedSeenIds=0.

## Что выполнено

Свежие login/chat DOM snapshots подтвердили реальные элементы перед запуском.
Единственный фиксированный batch завершился с PASS; повторных визуальных
проходов/коррекций не было.

- Первая загруженная строка сохраняет автора. Соседняя реплика пары скрывает
  повтор только визуально; имя остаётся в accessibility tree, время видимо.
  Три существующих deleted rows сохраняют полный авторский header.
- «Ответить» открывает цитату в composer; удаление этой цитаты сохраняет
  несохранённый текст. Настоящие Tab/Enter достигают menu и permalink.
  На desktop1440 измерены reply88.25×44, menu44×44, link55.72×44. Edit/delete/send не запускались.
- Поиск → context → Back → исходная лента сохраняет диапазон, черновик и
  прежний anchor: offset−87.703125px до/после. Highlighted target показывает
  автора. Реальный переход по permalink выполнен последним и прошёл.
- Одна догрузка предыдущей страницы сохраняет anchor:111.390625→111.484375px
  (разница0.094px, в пределах2px).
- 1440/390/320: один composer, текст16px, время видно, document overflow нет;
  draft переживает resize и восстановлен до собственного исходного пустого
  значения. Три снимка просмотрены одним batch, дополнительных правок нет.

| Ширина × высота | Высота каждой строки выбранной пары | Полностью видимых строк |
|---|---:|---:|
|1440×1000|112.1875px|6|
|390×1000|136.984375px|4|
|320×1000|161.78125px|4|

Это текущие измерения одного сохранённого участка, не процент улучшения.
Старые A1005 снимки показывают повторные author headers и качественно
подтверждают исходную проблему; у них нет сохранённых pixel-anchor метрик,
поэтому численное old/new сравнение не заявляется. Верхний край кадров
обрезает предыдущую строку вследствие выбранной позиции scroll; правило
полного автора относится к первой строке fetched range, не каждой видимой
после прокрутки. Не выдавать это за проверку sticky author или нового scroll UI.

## Закрытие и полная сверка

После UI сохранён полный AFTER RAW без intermediate Auth PASS. Это заранее
согласованный порядок: старый A1005 verifier отмечал собственный живой AMR
как отличие; разрешённые Authdiffs не расширяли и известный STOP не повторяли.
Затем own scope=local logout204, own browser close, остановка только
launcher30464/listener30480/process-group30448 и порта33256. Пользовательский
33216 продолжает слушать, чужие процессы не останавливались. PTY завершился
с exit1 после явного Ctrl-C; этот факт не представлен как exit0.

Свежий FINAL5f59a5dc и неизменный strict verifier9a2e964c: все290business
таблиц/каталог/effects сохранены, zero new seen/Storage writes. Все33
AuthStorage сверены; inherited sessions/refresh/AMR восстановлены точно.
Разрешённые отличия: только собственные Auth sign-in metadata и2собственных
login/logout audit. Остальные Auth поля/пользователи не менялись. Captured
собственный Auth файл удалён только после logout/browser close/final proof.

Release27b0b2d2 сообщает released=true,nextOwner=B1006, но следующее выполнение
требует отдельного admission ROOT. Product acceptance в immutable release
остаётся pending-independent-review; восстановление среды не равно merge.

## Ограничения

- В текущем own-message наборе не представлены чужой avatar/новые foreign
  seen и firstUnread. Их actual поведение не подтверждается; pure tests
  покрывают соответствующие алгоритмические границы.
- Existing edited/mentions/quoted-message варианты отдельно не проверены;
  выполнен именно reply composer quote/remove.
- Channel previews, issue708 подтверждение сотрудником, native/VoiceOver,
  весь item15/1–36 и production остаются отдельными работами.

## Локальная доказательная ведомость

Пакет `/private/tmp/evo-team-chat1012-local-20260921`; файлы ниже в `ui-proof/`.

| Файл | SHA-256 |
|---|---|
| before.json | b2530480ba4cfe2c12a217f15826287b4221a82ea9b7c95d9d7f7f96268e9202 |
| after-ui.json | 10a73c9b89b58d0326c93368c2bd4cabb44b5e69af208e0afa5491bda096443e |
| final.json | 5f59a5dcdfe07ca7cb4e72040eb81cf0c1cb4010f42fa2ff83939f730d4d84ac |
| final-verification.json | 9a2e964c2ee1242ba1040f2e7ba4c6bb57e5719085b04bbaba7b8b06bc7541c5 |
| batch-result.json | c27160e74dacf972f4b74cb5a3416716b4950fcf239b161ab61a53f5ec315ea9 |
| server-closure.json | 5945296b1576227bcd337c78e66640c7ac3e5352ccb1a429a0be7bd272a1e89b |
| sales-logout.json | 99ba842a8e40b75fbe9acb7b775a68b85263f576507203c805fca05f2fcadaae |
| grouping-1440.png | 6f362a97581e5132474ddf750302183fe7e9ee2c181af9bd5ff57f417284ecd0 |
| grouping-390.png | 6782baeefad4f7b91b30751d23b6974ba9a25939a3bf6a630c27e978377c25b5 |
| grouping-320.png | 22d96a834f9396d99421c0883780a71b6918fa943b0c164fe7269318b1556b0f |

`release-receipt.json`: `27b0b2d29886b7b46f3f41b1a8951607b350f88be18de426174b9878c9a183a0`.

Интеграция mainc42f3963/#1013 затрагивает только документы: сохранены B32
acceptance, KB execution и обе append-only истории в исходном порядке.
Продуктовые файлы совпадают с actual6e401f9c. Повтор продуктовых тестов для
этой документационной интеграции не требуется; diff-check обязателен.
