# D3: локальная проверка до передачи провайдеру

Дата: 2026-09-14. Первоначальный source: `819268e91bd8148cad2f77c145ec6719ca5aba26`.
Статус: технический predispatch-сценарий пройден; D3 целиком не завершён.
Последний объединённый source — `ef279986`, отдельное доказательство ниже.

## Combined checkpoint ef279986

Exact source `ef279986124c7b1f8298994d152ee134aced655c`, clean at start/end.
Both real local workflows passed after the reviewed D3/D4 merge, not by reusing
parent receipts. Native production build/Next/TypeScript passed
`01a09cd18f4c7ba1bab46882a74aacae`; acceptance build passed
`01a09cd3403a7852bff2cc432e011fd7`. Both images are Linux/arm64:

- Production `sha256:75bca775dc4b0902538376554dc56e0123daa06c7eeaf245612f4a59e0712e96`.
- Acceptance `sha256:b273e7c3308368dbc673865bfb7dbe606db1fb4a5207338aa04360098665e01d`.
- Same `--document-recognition-only` command and exact image environment contract
  as the [D3 run instructions](../evo-docs-recognition-contract.md); Node22.23.1,
  OrbStack Running/contextorbstack, provider key variables unset. Exit0:
  `01a09cd7591574129ecd9de38db97a97`.
- Receipt `output/document-recognition/ef279986124c7b1f8298994d152ee134aced655c/foundation-21138-38911/acceptance.json`.
- Receipt SHA256 `ddae947295883e5f5d1a46e7c65711715004a9c6352e0775da37535427cfb80f`.
- Actual Auth/UI enqueue/replay/cold history, ClamAV, exact private Storage bytes
  and image-bound native preflight passed. One job/access event, zero provider
  intents/files/proposals; cancelled before provider, reservation released,
  confirmed-empty value unchanged. `cleanupVerified:true`; owned resources absent.
- Browser errors0, warnings3 unclassified. Root viewed the adjacent
  `recognition-predispatch.png`: opened history shows cancellation/no transfer.
- [Persisted profile flow](2026-09-14-persisted-profile-export-proof.md#combined-checkpoint-ef279986)
  also passed on this exact source. Contiguous001–164 SQL ran both rollback-only
  fixtures in one owned database, exit0 `01a09ccd4f207630b777750f7a4fc9f9`.

This is local synthetic predispatch acceptance, not Gemini/full-worker/business
acceptance. Web UI used the Next development harness, not production-optimized
web serving. No managed164 bucket/schema or deployment was performed. Fresh
server readback still shows05585020 running/healthy/restarts0
(`01a09cda646075a181e8da103dd79969`).

## Historical source 819268e9

### Что действительно выполнено

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

### Привязка доказательств

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
