# Поиск переписок со студентами — 2026-09-21

Source `7c8118a9b8a6094c44ed682f801a7532fb581a04`, base main
`aa663b3d151462e6a7bac6249c459b7ef4e8899e`. Pre-code contract authored
by A: `a58a245ef2193301d674d3753edfd02462f9d2cb`.
Только надёжность поиска списка из пункта 11; остальные очереди и весь
пункт 11 этим изменением не завершены. Production не обновлялся.

## Поведение

- Новое значение поиска сразу делает ответы старого запроса неактуальными,
  включая время ожидания debounce. Success, typed failure, rejection и
  завершение loading проверяют тот же sequence. Unmount отменяет timer
  и лишает старые callbacks права менять состояние.
- Loading скрывает прежние строки, ошибка не подменяется пустым результатом.
  Повтор использует текущий запрос. Пустой поиск с фильтром объясняет отсутствие
  совпадений и даёт сброс; подсказка выбрать переписку появляется только когда
  реально есть строки для выбора.
- Серверный action/RPC, tenant/permission checks, SSR initial data, URL строк,
  ограничения выдачи, badges и selected conversation component не изменены.
  Draft/reply/attachment и открытие переписки не затронуты.

## Реальный read-only UI

Существующий ordinary Local QA Sales, owned local Supabase; отдельный Next
на `http://localhost:33223`, `/v3/messages` **без case**. Ни одна строка
переписки не открывалась: её открытие автоматически вызывает mark-read.
Новые пользователи, роли, дела, сообщения и fixtures не создавались.

1. Baseline на предыдущем source (33222): четыре доступных QA дела;
   `zz-no-matching-student` оставляет прежние строки без loading, затем
   ошибочно говорит «Переписок пока нет» и предлагает выбрать переписку.
2. После изменения: начальные четыре строки; `Local QA sale current` →
   видимое «Ищем переписки…» без старых строк → ровно нужное существующее дело.
3. No-match → «По вашему запросу переписок не найдено», кнопка сброса,
   без подсказки выбрать отсутствующую строку. Сброс клавишей Enter возвращает
   четыре существующих дела и пустую строку поиска.
4. Временный CDP offline только этой вкладки: настоящий search transport
   завершился ошибкой. Alert и «Повторить поиск» видимы, старые строки скрыты.
   После восстановления сети Enter на повторе вернул одно правильное дело;
   запрос не потерялся. Ответы сервера не подменялись. Это транспортная
   проверка, не доказательство typed RPC forbidden/unavailable.
5. CDP latency 1200 ms: первый no-match POST действительно начал выполнение
   до ввода второго запроса; UI оставался в loading, последняя выдача — только
   `Local QA sale current`. Произвольная перестановка ответов не воспроизведена.
6. Desktop и actual 390 CSS px: error/retry и filtered-empty/reset визуально
   проверены. `innerWidth = clientWidth = scrollWidth = 390`; кнопка сброса
   высотой 44 px. Поле, текст ошибки, действие и focus помещаются.
   Временные offline/latency/device overrides возвращены в исходное состояние.

## Scope checks и пределы доказательства

- ESLint изменённого TSX, `npm run typecheck`, `git diff --check`: PASS.
- `tests/v3-case-chat.test.mjs` и `tests/portal-messages.test.mjs`: 30/30 PASS.
  Существующие contract tests не считаются исполнением бизнес-команд.
- Impeccable final detector на изменённом TSX: exit 0, findings не выведены.
- Сохранение selected conversation/draft при поиске, arbitrary out-of-order
  success/error, typed permission failure и late callback after unmount
  проверены только по коду; UI этих состояний не заявляется проверенным.
- Unfiltered zero rows отсутствует у доступного QA actor; данные ради него
  не удалялись. Не было message send, mark-read, Auth/role/business writes,
  managed DB, provider calls или release. Общая приёмка продукта не заявляется.

Локальные логи: `/tmp/evo-case-chat-search-types.log`,
`/tmp/evo-case-chat-search-tests.log`, `/tmp/evo-case-chat-search-dev.log`,
`/tmp/evo-case-chat-search-impeccable.json`. Они не содержат credentials.
