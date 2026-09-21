# Очереди сообщений студентам — ограниченная локальная проверка

PR [#1002](https://github.com/izzhackt/evo_AI_CRM/pull/1002),
[контракт](../EVO_CASE_CHAT_QUEUE_PLAN_2026-09-21.md). Миграция234 применена один
раз на `999040d09e810110a930ab9e55e0705916f5a13e`; первый реальный UI-проход
нашёл ошибки истории и320px. Одна партия исправлений подтверждена на
`37f3d9860101e6e339b97a052e0a17e5179d67f3`. Это локальная QA, не production
или приёмка реальным сотрудником/клиентом. Независимая actual/closure сверка одобрена; final-head admission и merge — отдельный gate.

## Что проверено

- Единственный apply добавил v2 reader и запись234; после него все290 business
  tables,33 Auth/Storage tables, прежние функции/ACL/catalog совпали с входящим
  срезом233. Исторические миграции/v1/команды не менялись.
- Обычный существующий custom admissions staff, без fixed role, получил те же
  пять видимых дел через v1 и v2-all. Проверены literal name-search, фильтры,
  некорректный enum и query201chars. Существующий Student получил403/42501 и
  завершил собственную сессию local logout204.
- В существующем деле без сообщений выполнено ровно три обычных UI-действия:
  `needs_reply → awaiting_student → none`. API подтвердил нужное дело в каждой
  соответствующей очереди, его уход из предыдущей и пустые очереди после none.
- Дело оставалось открытым вне выбранной очереди. Имя, черновик и карточка
  существующего документа сохранялись при смене очереди, reload, встроенном
  возврате и browser Back/Forward. Файл не открывали и не загружали, сообщение
  не отправляли. В финале свой черновик/карточку убрали через обычный UI.
- Подтверждены текущие q/queue/case и перечитанный none после native history;
  ввод символов без потерь, быстрые изменения поиска/очереди, реальная ошибка
  при offline browser context и повтор того же запроса после восстановления
  сети. Ни ответы сервера, ни сетевые данные не подменялись.
- Один первоначальный desktop/390/320 pass, одна коррекция и один confirmation
  batch. Финальные body/root widths1440/390/320 совпали с viewport; выбранный
  чат больше не выходит за край320px. Кнопки очередей высотой44px, видимый
  keyboard outline2px. Сохранены EVO/Golos и доступные действия; общий overflow
  не скрывался. Четыре финальных скриншота просмотрены.

Первый screenshot-pass выявил реальные дефекты: cached q/queue и await-state
после browser navigation; body347–360px при viewport320. Коррекция читает
фильтры из текущего URL, изменяет URL явным действием, перечитывает обычные
авторизованные данные истории и разрешает сжатие textarea/контейнеров. Мобильный
заголовок имеет две строки. Предыдущие доказательства не переименованы в успех.
Один harness ReferenceError (`URL` отсутствует в CLI Node realm) исправлен
только чтением уже открытого URL внутри browser realm; business command не
повторялся. Это не дефект приложения.

## Сверка и закрытие

Финальный read-only observer и чистый verifier подтвердили:

- Все исходные строки290 business tables сохранены. Допустимое дополнение:
  один thread для указанного дела, три await receipts и три соответствующих
  audit_events. Итог none; ноль messages/read positions/read receipts.
- Все другие эффекты, catalog/ACL/functions, Storage, identities и входящие
 224 sessions/239 refresh rows сохранены. Own staff/Student завершены local
  logout204. Auth users изменили только разрешённые last_sign_in_at/updated_at;
  добавились ровно четыре собственных login/logout audit events. Полная
  неизменность всех Auth metadata не заявляется.
- Свой browser `case-chat234` закрыт, свой server33242 остановлен, listener и
  parent отсутствуют. Два private Auth state files удалены. Общие runtime и
  чужие sessions/processes не очищались. SQL234 повторно не применялась.

После коррекции34 профильных теста, `tsc --noEmit --incremental false`, scoped
ESLint и `git diff --check` прошли. Старый SQL/parser/source-report остаётся
[исторической source-проверкой](case-chat-queues-source-2026-09-21.md).

## Доказательства и границы

Private packet: `/private/tmp/evo-case-chat234-local-20260921` (без секретов в Git).

| Артефакт | SHA-256 |
|---|---|
| apply-output/apply-receipt.json | `57812385f4301f03fb5e0cefb59a4dcf106ffe165adbfa4dcc9ddcedcb9dc032` |
| ui-proof/before.json | `b916449c475b8163c4cf8bb1885a463dda33f3107c9142a9e22acd285824990a` |
| ui-proof/confirmation-result.json | `9d5426b73f526079944b4a136d5bd5eb028222b82113fbc38e3eb33bf926a856` |
| ui-proof/final.json | `9aaaf11feaad4aa395fcb0f4065dba5a2f5595f3fdd0331d82810ac8817eb05f` |
| ui-proof/verification.json | `06824435a4f4abc6219f07d6d88e133d3a1fa84377d29f82db6f2d865efc515c` |
| closure-receipt.json | `cb30378a16c0aeb80006590473054c950c0c6da2906b12a126aa639598f4966b` |

Source/runtime correction и actual/closure независимо одобрены для exact37f3.
Actual review `/private/tmp/evo-case-chat234-actual-review-37f3d9860.md`, SHA
`b3b3b7084238eae98936b098e22d286f0dbdb5c29e89f3b3a24376c71ae4cc83`.
`release-receipt.json` SHA
`bb97645c266ea2fedcfb8ce97d28560313bdf74ff324989421953b1d4050bf90`:
released=true, nextOwner=B1003, полные finalstate/catalog/effects/AuthStorage и
snapshotSQL/runtimepins. B интегрирует #1002 после его merge; затем окно ROOT235.
Свежий config001–234 SHA
`2a4ded35f25edcdbb01ea02d43c347f568b5085b5416bcfb7823283513867864`.
Дальнейший docs-only HEAD не является новой UI/DB-проверкой.

Dataset содержит пять видимых дел и ноль сообщений: положительная проверка
truncation>200, цитат, unread/read receipts и сохранения реального разговора
не заявляется. Быстрые изменения не заменяют отдельное детерминированное
испытание всех delayed/realtime/permission races. Финальная320/390 проверка
выполнена в Chromium viewport с none, не на физических телефонах и без
четвёртой await-команды. Общий E2E/App Store/контент остаются отложенными.
