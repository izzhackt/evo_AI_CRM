# D3: локальная проверка до передачи провайдеру

Дата: 2026-09-14. Точный source: `819268e91bd8148cad2f77c145ec6719ca5aba26`.
Статус: технический predispatch-сценарий пройден; D3 целиком не завершён.

## Что действительно выполнено

Изолированная Supabase/Auth/ClamAV/Storage среда, настоящий Admin bootstrap и
Chromium1440×1000. Синтетический студент, публичный EVO logo37344bytes — не
клиентский паспорт. Provider keys отсутствуют и запрещены сценарием.

- Вход → начало анкеты → подтверждённое пустое поле.
- Реальная загрузка → ClamAV → приватное скачивание с равными байтами.
- UI enqueue202 → повтор той же команды202 без второго задания.
- Холодная перезагрузка → один обычный клик → открытая история с queued.
- Настоящий Linux inspector → source receipt/fingerprint → отмена до provider.
- История показывает отмену и отсутствие передачи; подтверждённое поле неизменно.
- БД подтверждает1job,1source-access event,0provider intents/files/proposals,
  освобождённую reservation. Финальный receipt создан только после cleanup.

Команда: `bash scripts/test-postgres-v2-foundation.sh --document-recognition-only`
с точными image IDs ниже; Node22.23.1, OrbStack/nativearm64. Exit0:
`01a09cc401f670b194bceb636acb67f3`. В proof4 browser warnings и0errors;
предупреждения не классифицированы и не объявлены отсутствующими.

## Привязка доказательств

- Production image: `sha256:61a96ba96958066181f967486b24c5c547905968863920ab4f741bc17f8d7c37`.
- Derived acceptance image: `sha256:1c59441224b98a93ceaff194c16607d5f2d2116d7f76e4c5296b3121c34012e4`.
- Build production/Next/TypeScript: `01a09cc0974e78a19c39bbcd439bbf2e`.
- Acceptance build: `01a09cc18fc27b31a973cec33194e048`.
- Receipt: `output/document-recognition/819268e91bd8148cad2f77c145ec6719ca5aba26/foundation-22096-13501/acceptance.json`.
- Receipt SHA256: `266e6ee21863188121bb7e18a73848ec63f90ff9b8185719aed54a754aeacf83`.
- Screenshot рядом: `recognition-predispatch.png`; просмотрен root, история открыта.

Первый1b699587 прогон исправил nullable RPC, но упал на cold history.
Диагностическийfb9d3949 повтор упал именно на COLD_HISTORY_EXPANDED
(`01a09cbdaf0a70508bd715ca638ada66`). Старый SSR-button был enabled до подключения
обработчика; новый regression сначала RED6/1, затем GREEN10/10. Исправление
повторяет StaffDisclosure readiness; исходный browser-сценарий не ослаблен.
Независимый review точного diff0b9c2ddc4caa3b7c73d5b7c61715a06e265d28a08d7a12cf91e847b2ea952a68
разрешил commit/rebuild/repeat, не полную приёмку D3.

## Что этот результат не доказывает

Web UI проверен штатным локальным Next development harness, не production web
процессом из image. Native inspector действительно исполнялся из image с
проверенными runtime/module hashes. Нет live Gemini upload/generation/cleanup,
полного worker, реального клиента, mobile/screen-reader или production release.
Accepted production05585020 и постоянная managed база не изменены.
