# Student Portal — завершение функций и публикация

Дата: 2026-09-11. Согласованный объём [плана](../student-portal-workflow-completion-plan.md)
реализован, проверен изолированно и опубликован. Настоящая Student-приёмка
остаётся отдельным открытым чек-листом; production fixtures не создавались.

## Функциональный итог

- [x] Компактный desktop и мобильный кабинет: план, следующий шаг и куратор.
- [x] Проверка документов в карточке сотрудника: принятие проверенной текущей
  версии, исправление/отклонение с обязательной причиной, защита от устаревшей
  версии и безопасный повтор команды.
- [x] Личное уведомление об ответе куратора, переход к конкретному ответу,
  отсутствие дублей и сохранение прочтения.
- [x] Обновление открытых рабочих страниц без потери черновика.
- [x] Изолированные проверки настоящих Auth/PostgreSQL/application runtimes,
  мобильных форм 320/393 px и существующих тестов студента завершены.
- [ ] Полный рабочий цикл на выбранном настоящем деле: реальный сканированный
  документ, исправление, замена, принятие и скачивание; реальные обращения,
  изменения заявки/визы и финансовые события.

Email editing и forgotten-password исключены владельцем. Новое хранение
исходных паролей не добавлено; доступы остаются процессом команды EVO.

## Проверенная версия и проверки

- [PR #736](https://github.com/izzhackt/evo_AI_CRM/pull/736): функции, migration153,
  SQL/Auth/browser проверки. Проверенный head `bc530f10208e3bb3c0b82f6a6ee36e98d28500b1`;
  merge `350e54a7fd41922eb5b2d8e6483e737fbe526609` с идентичным деревом.
- E4: 16 passed, 28 ожидаемых skips по browser-профилям. Настоящие локальные
  Auth/PostgreSQL, production build, 320/393 px. Решение по документу выполнено
  через staff UI; ответ — через авторизованный staff RPC, затем проверены
  Student UI, автообновление, черновик, точный ответ и прочтение. Unscanned
  технический документ нельзя принять; настоящие bytes/scan proof не подставлялись.
- [Schema check34589868873](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34589868873)
  и [apply34589939376](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34589939376)
  успешны: managed ledger 001–153. SHA-256 migration153:
  `324e695ffd42ef469f352e277e7675a7bf3cdf8ea7004fe32089485136283394`.
- Первая [CI 34590084096](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34590084096)
  завершилась ошибкой старого неоднозначного `summary`-локатора; следующий
  D2-сценарий не получил результат первого. Release 34590614200 был пропущен,
  прежнее приложение 268bbdbc сохранено, arm возвращён в false.
- [PR #738](https://github.com/izzhackt/evo_AI_CRM/pull/738) уточнил только
  локаторы checklist edit; Storage/Auth/P4 assertions сохранены.
  Независимо проверенный head `d13bec168673a9f74c928d56b1668e17aedbbc44`;
  [PR checks34590914206](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34590914206)
  успешны; merge `4e35b896e16449a63bd11bffd457ddf4acac6c62` с идентичным деревом.
- [Полный CI34591103747](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34591103747):
  все 5 jobs успешны, 1303 Node tests, сборка/PostgreSQL/browser proof. Основной
  staff browser suite: 17 passed, 2 ожидаемых skips, включая исправленные сценарии.

## Принятый выпуск и независимое подтверждение

[Release34591693323](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34591693323)
успешен, attempt 1. Принят `v3-r34591693323-a1-4e35b896`:

- Revision: `4e35b896e16449a63bd11bffd457ddf4acac6c62`.
- Acceptance SHA-256: `60b90d84f57961492ebf7bc3db3780e0476a03f8080cc2cdc980e06c84ec93b4`.
- Image: `sha256:4d3aa5ff7dc241b62b123cfee6a5c77784cb7ac3b2aa39698018340937a5e94c`.
- Browser receipt SHA-256: `9d4a69b4d528c3b144d2600ead3292e818a800c86f025f6a6a4ac00d17694110`.

Независимый reviewer подтвердил совпадение current/immutable acceptance и
browser receipt hashes, OCI revision, healthy app с 0 рестартов, отсутствие
pending. WAHA/ClamAV IDs и images сохранены; healthy/0. Сеть и alias сохранены.
Публичный HTTPS `/api/health`: 200/live; анонимные `/portal`, `/portal/documents`,
`/portal/notifications`, `/v3/profile`: 307 к `/login`. Финальный arm=false
подтверждён отдельно.

После выпуска координатор обновил существующую Admin-вкладку
`http://localhost:3000/preview/student` через действующий туннель к Hermes.
Настоящий desktop показывает sidebar, бордовый блок и колонку куратора.
На фактических 320 CSS px clientWidth=scrollWidth=310 (обычный scrollbar),
горизонтального переполнения нет. Escape закрывает меню и возвращает фокус
на «Меню». Временный размер сброшен; главная вкладка оставлена открытой.
Admin preview не загружает личное дело и не доказывает настоящую Student-сессию.

Рабочие адреса: [Student Portal](https://evo-crm.72.62.119.112.sslip.io/portal)
и [Admin preview](https://evo-crm.72.62.119.112.sslip.io/preview/student).
Требуется действующий вход соответствующей роли. Тестовые desktop/mobile
скриншоты сохранены локально в ignored `output/portal-workflow`; приватные
Auth traces и сырые журналы не публикуются.
