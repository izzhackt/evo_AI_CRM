# A15 rail — actual incumbent, 22.09.2026

Одна согласованная local QA проверка существующего интерфейса, source
`c675d4b4d735ccbcc51dc162265e31d64e193990`, schema001–237. Это не проверка
будущего JSX на2c442162, не real-customer/native/provider/production acceptance.
ROOT просмотрел все три PNG и разрешил source-only продолжение. Независимое
actual closure review5113321d принято, normalized release5902ec18 передал
resource ROOT. Raw proof не меняется.

## Результат и смысл для следующей правки

- Один ordinary Admin login; viewport390 до входа и первого `/v3/team-chat`.
- Один batch390/320/1440, по одному PNG; General Enter/back один раз на320.
- Разрешённые каналы в прежнем порядке: Общий, Продажи, Поступление.
- В обоих mobile размерах виден nav без conversation; overflow отсутствует.
  Ссылки шириной366/296px, desktop263px; высота68–69.6px, больше44px.
- Desktop rail288px, selected preview13px; selected/аватары/цвета сохраняем.
- Preview присутствует только у «Общего»; у «Продаж» unread1 без preview;
  пустое «Поступление» без пояснения. Это обосновывает уже запланированный
  переход на latestPreview всех строк и явное пустое состояние.
- Unknown/deleted/forbidden/error/retry новой композиции этим не доказаны.

## Полнота и закрытие

Перед просмотром отдельно связаны52 eligible existing IDs как верхний предел
own/general seen tuples. Actual новых seen0. Все290 business tables и полный
catalog неизменны; snapshot включает33 Auth/Storage tables. Промежуточно ровно
своя session/refresh/AMR и login audit; итоговые224 sessions/239 refresh/224 AMR
побайтно равны исходным. Только свои обычные login/logout audits и sign-in/update
поля пользователя могли измениться. Общая Auth metadata equality не заявляется.

После batch chat штатно убран на about:blank; after-ui сравнение прошло. Own
local logout204, browser close, SIGTERM точно своего process group66648,
отсутствие группы и свободный33317 подтверждены. Launcher закончил без CtrlC.
Final strict сравнение прошло, свой cookie capture удалён. Ни retry, ни новых
аккаунтов/grants/messages/fixtures, ни source edit в incumbent не было.

## Сохранённые доказательства

Private directory:
`/private/tmp/evo-team-chat-channel-rail-incumbent-adapters-20260921/ui-proof`.
Идентификаторы строк, Auth-данные и содержимое сообщений не копируются в репозиторий.

| Артефакт | SHA256 |
|---|---|
| actual-incumbent-summary.json (23 proof pins) | `3db207bfd745437cac2e85f53a095bc7764f7e24478a36e71a8493e51eba7a53` |
| before.json | `26b816369702e0648b426a1aceb265a41f288296b8a3440f32b2db0f3c029add` |
| after-ui.json | `783f482f7fbba57ad4eb53c0356b8bcb5115bba2906beb4eac4ef54a69ed7058` |
| final.json | `2d7889b84e8a3f1857ddd9ed05eec003bd270ebc4554d4e0a3e4f43d63b82616` |
| final-verification.json | `6936f53d717618eded9d2698de7d085f9c6748ef69f7f1bfb7534be1905c7e81` |
| incumbent-ui-result.json | `fa371c937269a4dc881bbad523cd4f87eeb50aff195fe009f4e0190822b23175` |
| rail-incumbent-390.png | `1bebc3c5b0fd8b3e946fa3dad27b70b26dbcb610d10876e28f2c11e472db28d0` |
| rail-incumbent-320.png | `e355719c26c214ea0d0cbd22dd6c41c8e804c697b2d696a125350b3e19b71293` |
| rail-incumbent-1440.png | `407adfbc9c3b733847f932fa8619f49be0de732971baee778b19c6f3b9b95ac3` |

Полные cleanup hashes находятся в summary. Независимый actual review SHA256
`5113321d6b2948f460fa891169e325a9519c9ff55e7d51518a3bc1321092e096`.
Normalized `handoff-ROOT_COORDINATOR.json` SHA256
`5902ec18a1c7e0bc797275b25f8d899c6035b35adda8673d34038333904ed4fe`
имеет PASS/released true; raw verifier остаётся PASS_EFFECT_COMPARISON_ONLY.
Shared runtime теперь ROOT238. Incumbent acceptance не принимает новую rail UI.
