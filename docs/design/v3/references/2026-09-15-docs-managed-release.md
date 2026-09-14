# EVO Docs: выпуск приложения и остаток переноса

Дата: 2026-09-15 Asia/Dubai. Независимая серверная сверка: 2026-09-14,
22:10:21–22:11:02 UTC. Приложение выложено; полное объединение Docs не закончено.
Порядок работы: [launch-plan](../../../EVO_LAUNCH_PLAN.md) →
[план объединения](../evo-docs-unification-run-plan.md). Эта заметка заменяет
активные шаги подготовки из [предварительной сверки](2026-09-15-docs-cutover-preflight.md),
но сохраняет её инвентаризацию данных и границы удаления.

## Выпуск подтверждён

| Проверка | Результат |
|---|---|
| Код | `a358a3e3767264bd3c77c4afc0e50af2c11b3eba`, accepted `r63.1-a358a3e3` |
| Полный CI | [34901397830](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34901397830), SUCCESS |
| Управляемый выпуск | [34902113327](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34902113327), SUCCESS, завершён 22:08:09 UTC |
| Вход и принятие | `Authenticated read-only V3 browser smoke` и `Accept exact V3 candidate` SUCCESS; оба rollback шага SKIPPED |
| Image | `sha256:667b945197fa24d51e1940e1483ae3b8f45774841b9506443d5ae144fa65bfc7` |
| App container | `9c8dd2c8393c484147e83e0a9a1cdd942802f1cf2b279a5533fbcb2c30e6262a` |
| Accepted pointer SHA256 | `efa1cdefad59e4aae1c14ea06d176e1d550604f8f9634d06fafc98db98f57b51` |
| Acceptance record SHA256 | `4cd4b85be3ce168608c1dccf7c48505b27feccc6e3845e7cb8f18ab851e50c5d` |
| Независимая сверка | pointer/record/image/container/revision/version совпадают; pending отсутствует |
| Сервисы | App, private ClamAV и WAHA healthy, 0 restarts; scanner/WAHA identities не изменились |
| Защита выпуска | `EVO_PRODUCTION_RELEASE_ARMED=false` после завершения, подтверждено повторным чтением |
| HTTPS с сервера | fallback `/api/health`: 200, TLS verify=0 |
| Туннель | `http://localhost:3000`, health=200; прежний SSH forward на app `172.16.1.4:3000`, IP не изменился |

Туннель открывает тот же сервер, не отдельную локальную копию. Обычная Admin
сессия в пользовательской вкладке истекла: `/login?error=session_invalid`.
Повторный вход уже запрошен; пустые поля не заполнялись smoke-учётной записью.
Автоматический release smoke проверяет вход и чтение, не операции с делом.
Локальная ошибка доверия TLS не обходилась; публичный HTTPS подтверждён с VPS.

Readback receipts: `01a0a1f8a4327ec0a8297f2c88c470a8`,
`01a0a1f9067d7b50b5f81d339717f2fd`, output chunk `2a2c7b`;
arm `01a0a1f8bd837bf1aaf8fd26170de82b`, tunnel
`01a0a1f942a27b229b926100406c5208`.

Сохранённая команда отката именно этого выпуска, **не выполнялась**:

```sh
sudo -- /opt/evo-crm/release-evidence/v3-r34902113327-a1-a358a3e3/rollback-command.sh
```

Хеши wrapper/controller и release/revision/image bindings в state сверены;
предыдущий05585020 image сохранён. Отдельный хеш state-файла не заявляется.
Откат допустим только по действующему runbook после свежей сверки состояния.

## Схема, Storage и проверки

- [PR778](https://github.com/izzhackt/evo_AI_CRM/pull/778), merge `934228ed`,
  прошёл review и required checks. [Managed apply34897249592](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34897249592)
  применил и сверил001–168. Не повторять apply.
- 168 временно сохраняет только `service_role EXECUTE` двух неизменных export
  RPC из161 для retained rollback05585020. Новый app использует164/167.
  Legacy `generated` не становится stored-artifact `ready`. Удалять совместимость
  только после перехода и retained rollback app на persisted exports.
- `platform-document-templates` и `platform-document-exports`: private,
  20MiB, только PDF/DOCX, независимо прочитаны как ready. Receipts:
  `01a0a1c5321979b3876fd61591aa4814`, `01a0a1c541447a72abcedd8ca9090286`.
  Не повторять создание; объектные файлы при provisioning не загружались.
- [Capacity34896848333](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34896848333):
  реальный global `fileSizeLimit=52428800` (50MiB), повторно подтверждён apply.
  Формы20MiB помещаются; исходные ZIP260MiB — нет. Тариф/лимит не менялись.
- PR779–781 исправили только устаревшие тестовые ожидания: список адаптеров,
  загрузку настоящего дочернего компонента и строгий v2 cold-history URL/DTO.
  Product, schema и права этими исправлениями не менялись.
- Полный CI: Node2029 PASS/1 существующий SKIP/0 FAIL; lint/build/types PASS;
  production dependency audit0 vulnerabilities. Это не утверждение об отсутствии
  всех возможных проблем или всех GitHub Dependabot alerts.
- Database/Auth/browser gates прошли: 28 Playwright PASS/4 mode-skips,
  Student Profile browser proof и три deferred-negative сценария PASS.
  CI использовал временные проверочные данные, не клиентские документы.

Узкий локальный proof на reviewed `23c58780`: два сохранённых артефакта,
история после нового открытия, те же скачанные bytes/SHA, replay без дублирования
и cleanup PASS. Evidence в активном worktree:
`output/student-profile-fields/23c58780712a52b43347f06ea4e6d8e3d138a50b/foundation-28670-22791/acceptance.json`;
SHA256 `0338652c41fc4ff1760f81ae9d3dd9bc3b85b6ed0249dbc102503a9a3be6a0bd`.
`synthetic=true`, `businessAcceptance=false`; отсутствие собственных временных
контейнеров/сетей/volumes проверено. Это не real D3/D4/D5 acceptance.

## Что продолжить — без повторения завершённых проверок

1. После обычного Admin login: проверить реальные PDF move/resize и
   формирование → сохранение → история → скачивание после повторного входа.
   Перенести девять разрешённых пустых PDF-шаблонов через165/166 ingress,
   точную привязку к каталогу и review; сами шаблоны пока не импортированы.
2. Закончить подключение существующего ZIP builder к persisted API/UI.
   Владельцу уже задан вопрос: временный предел50MiB либо сохранение исходных
   260MiB. Ответа нет. Не уменьшать возможности молча и не менять тариф/limit.
3. D5: получить явное source-record → canonical-case/create/archive решение для
   пяти записей; реализовать идемпотентный перенос12 доменов, сверить identities,
   counts,43 файла/bytes/SHA, provenance, decisions и историю. Не угадывать
   принадлежность по имени, не объявлять эти записи синтетическими.
4. Провести реальное распознавание разрешённого документа через Gemini с
   подтверждением человеком и сквозную приёмку D6. Release не активировал Gemini,
   WhatsApp или другой провайдер и не является доказательством их работы.
5. Только после D5/D6 заново сверить точные retirement targets и убрать старый
   runtime/config по плану. Старый `evo-student-docs-app` **не остановлен и не удалён**.
   Пустая серверная SQLite не отменяет неперенесённые локальные данные.

Новый backup не создан по решению владельца. Существующие backups,
`/opt/evo-student-docs/data`, локальный runtime, оригиналы, шаблоны, история,
`.env`, Git history и provider secrets сохранены. Shared edge/network,
CRM/Inbox/WAHA/ClamAV и их volumes не входят в удаление.
