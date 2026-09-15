# EVO Docs: выпуск приложения и остаток переноса

Текущий выпуск: `r66.1-5bc5df73`, PDF/ZIP выложены и проверены 2026-09-15.
См. [итоговую квитанцию](#pdf-and-zip-production-release) и приоритеты
пилота в launch-plan. Старый standalone Docs убран; D5 отменён владельцем.
Gemini, USTC и приёмка выбранного клиентского сценария остаются отдельно.

Ниже сохранены исторические этапы начиная с выпуска `a358a3e3`.
Его независимая серверная сверка: 2026-09-14,22:10:21–22:11:02 UTC.
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

Туннель открывает тот же сервер, не отдельную локальную копию. После первоначального
`/login?error=session_invalid` владелец сам вошёл в Chrome. Обычная Admin-сессия
проверена в реальном UI; smoke-учётная запись для операций не использовалась.
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

## Продолжение в обычной Admin-сессии

Владелец вошёл сам; проверка в Chrome через тот же localhost:3000-туннель,
без role preview, нового деплоя или изменения авторизации. Каталог и бланки
открываются. В рабочем списке Admissions при всех направлениях/статусах —
ноль доступных дел. Это наблюдение этой сессии, не доказательство отсутствия
всех клиентов в базе. Дела и данные заявителей не создавались и не изменялись.

INTI перенесён из разрешённого архива через обычные create/upload/mapping UI:

- canonical university `14422182-fc89-4680-9922-932b5f7ce98c`;
- source legacy template `105945a1-d0d1-48fa-a556-495768883cee`, 238417B,
  6 страниц; прежний allowlist SHA256
  `144441b3107ed0f0e2ccbbba8eee439c0ca5f4b36aa739148a894457630953f7`;
- target template `f83934c8-6e15-4209-b0f2-dff481fbf49e`, version
  `ad7e7b98-47a4-4df0-8ac9-0a87cc96fd1c`, mapping
  `00b8e8fa-7038-48bd-b6b3-301b3b0c9963`;
- один upload, «Файл проверен», исходная страница отрисована в редакторе;
- выделение области, body move, corner resize и две отмены проверены на
  реальном пустом PDF; затем введены точные координаты исходного preset;
- все 13 полей страницы 1 перенесены, визуально сверены и сохранены. После
  нового открытия каждое поле прочитано: источник, обязательность, координаты,
  число клеток и DD/MM/YYYY совпадают с preset;
- review сохранён с явным комментарием «Сверка агентом», без утверждения
  о проверке заполненной анкеты. После publication и нового открытия:
  «Доступен для заполнения», история показывает эту же проверенную настройку.

Дата получения2026-09-15 означает перенос из архива в Platform; source reference
прямо сохраняет неизвестность первоначальной даты, legacy ID и URL из preset.
Это не новая проверка актуальности удалённого университетского файла или новое
независимое сравнение SHA. Оригинал не редактировался. Настройка покрывает только
личные сведения страницы1; адреса, программа, финансы, подписи, согласия и
приложения заполняются отдельно. Готового студенческого экспорта ещё нет.
Рабочая запись без секретов: `/tmp/evo-real-ui-transfer.0RWD1S/README.md`.

Все девять разрешённых PDF загружены, каждый подтверждён своим обычным UI
«Файл проверен». Восемь бланков опубликованы: 94 поля сохранены, перечитаны после
нового открытия и визуально сверены; review явно выполнен агентом. USTC остаётся
черновиком без mapping. Это фактические записи managed Platform, не локальные fixtures.
У City PreU после reservation потребовалось продолжить upload той же версии;
новая версия или дубликат не создавались. Для каждого оригинала сохранена одна версия.
Ссылки ниже требуют обычного входа и действующего localhost-туннеля.

| Бланк / сохранённая версия | Mapping / статус |
|---|---|
| [INTI](http://localhost:3000/v3/universities/14422182-fc89-4680-9922-932b5f7ce98c/forms?template=f83934c8-6e15-4209-b0f2-dff481fbf49e&version=ad7e7b98-47a4-4df0-8ac9-0a87cc96fd1c) | `00b8e8fa-7038-48bd-b6b3-301b3b0c9963`, 13 полей, опубликован |
| [GDUT Degree](http://localhost:3000/v3/universities/35597246-430f-4385-90cf-5f3c77af93fb/forms?template=e2edf66e-99f4-4e2a-bd20-29844fbec9d4&version=8210a0d6-47f2-45e1-8d5d-df6efec4baf1) | `601476e3-e6c7-4556-a99e-c30dc158259b`, 13 полей, опубликован |
| [GDUT Language](http://localhost:3000/v3/universities/35597246-430f-4385-90cf-5f3c77af93fb/forms?template=51d5ded4-3620-4b30-924e-e3eeaae1ea5d&version=55edc40d-2edb-421c-be92-a9e64778fc27) | `5f9ab273-2cc3-436d-a71f-e6308bdb0a61`, 13 полей, опубликован |
| [UCSI Undergraduate](http://localhost:3000/v3/universities/8f8c1b0f-f4e3-48ca-8058-bf5280685968/forms?template=3b3f60b3-30f3-44a8-906e-57a72009335e&version=ba763304-1959-4c70-9692-35d563244eba) | `df02b7fb-58e2-43e6-95b8-cd5003167964`, 11 полей, опубликован |
| [Tongmyong Korean](http://localhost:3000/v3/universities/ce8cdafa-869b-4a10-a86c-c17b98f5a863/forms?template=c998fe36-1d65-4be0-9926-a161cdcd016c&version=8dfc1e37-22cc-4c7e-a93f-1fcf39e22aa7) | `8a1dbca2-e44a-4bc1-903c-b44ecf093bb1`, 20 полей, опубликован |
| [City PreU / Undergraduate](http://localhost:3000/v3/universities/bfdcf2e9-1f52-4af0-a1ae-9ed6f6a2d94b/forms?template=ad4e9111-6ae1-4ffc-a323-7d37055eb1e9&version=466df957-6199-44cb-9b7e-860b616dd56e) | `247d8b0c-aaaa-46d7-9fb0-7fae2953c3cd`, 9 полей, опубликован; точность нормализована |
| [City Postgraduate](http://localhost:3000/v3/universities/bfdcf2e9-1f52-4af0-a1ae-9ed6f6a2d94b/forms?template=7076a83e-a8d4-4498-8a73-ea7fc5b41345&version=e1d8c89e-1d01-4654-bb09-3a8e5cf3b8fe) | `3ccad4a3-d89f-4891-8d84-d0d45d36587b`, 7 полей, опубликован; точность нормализована |
| [City Language Centre](http://localhost:3000/v3/universities/bfdcf2e9-1f52-4af0-a1ae-9ed6f6a2d94b/forms?template=75307a01-8f05-4885-acdf-4d93d2fdd31b&version=c16b6ef8-72bc-4bb1-b27d-585aa0f656b8) | `ce005870-a000-44e3-9575-711cfe4bde8d`, 8 полей, опубликован |
| [USTC Undergraduate](http://localhost:3000/v3/universities/0ee6ae58-4066-4776-b94f-c6175a41e9d8/forms?template=459a24ea-8ca8-4c8d-a24a-f3a900ac051a&version=20cdd8b4-38c8-4de4-b94c-f0b76ac0fbf1) | Файл проверен, черновик без mapping/publication; принятие DOC→PDF университетом не подтверждено |

При продолжении использовать эти template/version IDs, не повторять import.
Опубликованный mapping не означает, что университет принял форму или проверено
заполнение данными клиента. USTC не разрешён к заполнению до решения о формате.

Ограничения фактического прогона:

- City Language и City Postgraduate по одному разу показали «Не удалось открыть
  фрагменты. Настройка остаётся на экране; попробуйте ещё раз». В обоих случаях
  одно штатное «Повторить открытие» восстановило ту же страницу; следующий
  render прошёл на экране публикации, перед подтверждением публикации.
  Финальная загрузка изображения после публикации отдельно не проверялась.
- GDUT Degree после быстрого переключения page1→2→1 показал broken-image.
  Перезагрузка восстановила оригинал; обе страницы повторно визуально сверены
  перед публикацией. Сохранённый mapping не менялся.
- В ограниченном captured error/warn output были только ошибки расширения Chrome,
  app-origin ошибок не найдено. Это не доказывает причину сбоев или их исправление.
  Надёжность preview остаётся отдельным follow-up; прогон не был безошибочным.

У City PreU/Postgraduate исходные координаты имеют три десятичных знака,
а HTML-input допускает шаг0.01: ширина399.387 не сохранялась. Координирующий
агент (root) выбрал и сообщил владельцу ограниченное приведение x/y/width/height к ближайшим0.01 PDF
point, максимальное отклонение0.005 point. Это рекомендация реализации внутри
разрешённого переноса, не отдельное подтверждение владельца. Сохранённые значения
перечитаны и визуально сверены; native validation не обходилась, исходные PDF
не менялись. Для этих двух форм заявлять нормализованную точность, не точное
числовое совпадение старых координат.

Receipt нормализации: массивы `[x,y,width,height]`, PDF points. Порядок полей
соответствует source preset, не лексикографической сортировке списка редактора.
Источники, required, формат дат и число клеток остались прежними; review также
сохраняет before/after. Это не проверка заполненных студентом значений.

| Бланк / поле / страница | Source → сохранено |
|---|---|
| PreU 1 / p2 | `[157.709,29.247,399.507,12.939]` → `[157.71,29.25,399.51,12.94]` |
| PreU 2 / p2 | `[157.709,45.625,197.468,12.939]` → `[157.71,45.63,197.47,12.94]` |
| PreU 3 / p2 | `[157.709,78.027,28.918,12.939]` → `[157.71,78.03,28.92,12.94]` |
| PreU 4 / p2 | `[207.709,78.027,28.918,12.939]` → `[207.71,78.03,28.92,12.94]` |
| PreU 5 / p2 | `[257.709,78.027,57.847,12.939]` → `[257.71,78.03,57.85,12.94]` |
| PreU 6 / p2 | `[157.709,94.074,197.468,13.939]` → `[157.71,94.07,197.47,13.94]` |
| PreU 7 / p2 | `[426.096,94.523,131.117,13.939]` → `[426.1,94.52,131.12,13.94]` |
| PreU 8 / p2 | `[426.097,111.131,131.117,13.939]` → `[426.1,111.13,131.12,13.94]` |
| PreU 9 / p2 | `[157.71,320.5,399.387,12.939]` → `[157.71,320.5,399.39,12.94]` |
| Postgraduate 1 / p1 | `[158.14,579.048,399.507,12.939]` → `[158.14,579.05,399.51,12.94]` |
| Postgraduate 2 / p1 | `[158.14,611.45,221.996,12.938]` → `[158.14,611.45,222,12.94]` |
| Postgraduate 3 / p1 | `[158.14,627.946,221.996,12.938]` → `[158.14,627.95,222,12.94]` |
| Postgraduate 4 / p1 | `[158.14,643.875,221.996,13.939]` → `[158.14,643.88,222,13.94]` |
| Postgraduate 5 / p1 | `[449.037,661.253,108.607,12.939]` → `[449.04,661.25,108.61,12.94]` |
| Postgraduate 6 / p1 | `[449.037,710.765,108.607,12.939]` → `[449.04,710.77,108.61,12.94]` |
| Postgraduate 7 / p2 | `[157.891,53.726,399.147,12.939]` → `[157.89,53.73,399.15,12.94]` |

## Что продолжить — без повторения завершённых проверок

**Исторический список до решения владельца и выпуска PDF/ZIP. Не выполнять
его как текущий план:** актуальный остаток указан в итоговой квитанции ниже.

1. Не повторять девять завершённых uploads и восемь опубликованных mappings.
   Для USTC отдельно решить допустимость DOC→PDF, затем настройку и публикацию.
   На согласованном реальном деле проверить формирование → сохранение → история
   → скачивание после нового входа. PDF move/resize/undo и INTI mapping уже
   проверены отдельно; это не закрывает приёмку заполненных форм.
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
5. Воспроизвести и устранить наблюдённые сбои PDF preview на тех же сохранённых
   версиях, без повторной загрузки оригиналов или изменения полей.
6. Только после D5/D6 заново сверить точные retirement targets и убрать старый
   runtime/config по плану. Старый `evo-student-docs-app` **не остановлен и не удалён**.
   Пустая серверная SQLite не отменяет неперенесённые локальные данные.

Новый backup не создан по решению владельца. Существующие backups,
`/opt/evo-student-docs/data`, локальный runtime, оригиналы, шаблоны, история,
`.env`, Git history и provider secrets сохранены. Shared edge/network,
CRM/Inbox/WAHA/ClamAV и их volumes не входят в удаление.

## Standalone retirement after owner test-data waiver

2026-09-15: the owner explicitly confirmed that the five legacy students were
tests, cancelled history transfer/filled-old-document acceptance and requested
old Docs deletion. This supersedes the historical D5/retirement prerequisites
above; it does not prove ZIP, Gemini or real-client document acceptance.

Before removal, exact container/project/mounts/network/image consumers and active
Caddy routes were checked. No active edge route, other-container mount, service,
cron, local listener or active Platform import depended on old Docs. The clean
old checkout and GitHub main both resolve to
`6e7cf741aa9c1005021860e509fb7b1294f94e00`; reusable ZIP inputs remain in Git.

| Removed active resource | Verified identity |
|---|---|
| Container `evo-student-docs-app` | `a7c1f33bc9f009159964a66e4b7fb9a1f14c8514809c14ae3f69a7df5e92d872` |
| Private network `evo_student_docs_private` | `809258ed10bf6073a0e232896d908629adaf98743702a834c053ba8abf0326fb` |
| Image `evo-student-docs:eadbef1` | `sha256:d02bf43c4720188f5cdbd209e0ad4ced6b4520b6356c212f0b812d51515e2a30` |

Exact stop/remove operations completed without force, volume deletion or pruning;
absence was checked afterwards. Shared `evo_public_web` remains attached to
`evo-edge-caddy`, `evo-crm-app-1` and `olympiadai-lms`. Main app/scanner/WAHA/edge
IDs and image hashes are unchanged across retirement, all running with0 restarts.
No Caddy configuration or provider setting was modified.

Recoverable file moves, not new backups:

- Local checkout moved from
  `/Users/iskhak.tazhibaev/Documents/01_Projects/evo_student_document_system`
  to `/Users/iskhak.tazhibaev/.Trash/evo_student_document_system-retired-20260915`.
  Old path is absent; Git HEAD in Trash still equals the verified source SHA.
- VPS `/opt/evo-student-docs/source` and `/opt/evo-student-docs/data` moved to
  `/opt/evo-retired/evo-student-docs-20260915/source` and `data`; destination parent
  mode0700. Old paths are absent and both destinations exist.
- Existing `/opt/evo-student-docs/backups` (145 files), `secrets` (two credential
  files), historical `caddy` material and GitHub repository remain untouched.
  Source/data can be moved back deliberately; the removed image would need a
  rebuild/reload. No new copy, fresh backup, credential rotation or revocation.

Post-retirement tunnel `/login` returned200. Ordinary public-domain health could
not be verified: `crm.evoadmissions.com` fails DNS resolution from both Mac and
VPS; a Mac request pinned to the known server IP also encountered TLS reset.
Do not label those requests healthy or infer causation from retirement. The
configured release-health origin is checked separately by the managed release.

Follow-up: this is the existing September6 owner decision, not a retirement
regression. `evo-crm.72.62.119.112.sslip.io` remains the sole configured production
hostname (CONTEXT/launch-plan); active Caddy has that host → `evo-crm-app:3000`
and no custom CRM host. VPS sslip login returned200 with TLS verification0.
Both VPS DNS and Google DNS from Mac returned NXDOMAIN for the deferred custom
domain. Mac sslip curl separately failed local issuer trust (verification20).
No DNS, Caddy or certificate-trust setting was changed.

## PDF and ZIP production release

2026-09-15: PDF preview repair and persisted ZIP up to50MiB are released together.
PR784–786 are merged. Managed schema34969326250 had already applied169 and
verified001–169. The existing private export bucket was read back at50MiB with
DOCX/PDF/ZIP allowed; global capacity and tariff were unchanged. These writes
and standalone retirement must not be repeated.

| Release proof | Verified result |
|---|---|
| Revision / version | `5bc5df73a03825d9b5dba4ad4b8bdf65d0a8f809` / `r66.1-5bc5df73` |
| Exact-main CI | [34972050911 attempt2](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34972050911), SUCCESS |
| Automatic managed release | [34973968977 attempt1](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34973968977), SUCCESS |
| Accepted identity | `v3-r34973968977-a1-5bc5df73` |
| App image | `sha256:50bd91337c05f592a796f622f49777b40c61026288c528bcd536bfcee3aa65f3` |
| App container | `e8424e503bb83107c569db05daa1e8f83ccb33b35685eb93dd319949a2085291` |
| Pointer SHA256 | `6fb53744604389da5d5682d4e20c58be09e5557d82ff60a3e3092f15216257ff` |
| Acceptance record SHA256 | `816a71a74b78e862d99e0207778731f045cfa4a38ab432ee496e8106fe817ddc` |
| Release browser receipt SHA256 | `d172435846bcacca33b067d8a5eef8350059caccf9f1dc1438ba4085a5a5c02d` |
| Independent readback | 13:22:18–13:23:22 UTC; pointer→record→browser and image/revision/version match |
| Runtime | App healthy,0 restarts; pending-current absent including symlink test |
| HTTPS | Configured sslip production `/api/health`200, TLS verify0 from VPS |
| Release arm | Explicitly disabled by operator after release; independently read back `false` |

Protected WAHA and ClamAV full IDs/images match their recorded baselines; both
are healthy with0 restarts. Caddy image matches its baseline and it has run since
September6 with0 restarts; no unsupported comparison to a missing prior full
container ID is made. Shared `evo_public_web` remains present. No provider call,
QR, customer mutation, DNS or proxy edit was part of this release.

Server receipts: chunks `f49ec7`, `a4dd63`, `0eb1af`; independent arm receipt
`01a0a53c534b7be282d8429d139421e8`; operator disarm/readback
`01a0a53c07407aa0832c54c8f48ec26c`.

Post-release Chrome used the owner's ordinary Admin session through the existing
`http://localhost:3000` SSH tunnel, not role preview. GDUT Degree's unchanged
saved template/version/mapping displayed both pages at1190×1683 decoded pixels.
Three rapid page-return cycles recovered page1; a cold reload again decoded
page1 correctly and the actual screenshot showed the PDF with saved fields.
The browser tool had selector/deadline delays after reload; a fresh DOM snapshot
and read-only `document.images` check confirmed the loaded image. This is not
reported as an application failure or hidden as an uninterrupted tool run.
No template/source upload or mapping mutation was repeated. The tab was left
open for the owner. The tunnel is the same production, not a second database.

The original isolated profile/ZIP proof also passed private Storage and entry
byte verification:2 profile artifacts and1 ZIP (12004 bytes), SHA256
`07b0683c81a0b69e69f6f6b8b3cf43a6dba69e30e4b2ce730a616304347a1d85`.
Profile files were reread after cold opening; ZIP was downloaded byte-identically
after a fresh login. Downloads created no artifacts; owned cleanup was verified.
CI attempt2 passed staff onboarding,28 browser tests and the profile/ZIP gate;
Node/static recorded2051 passes,1 existing skip,0 failures. These authorized
isolated checks do not constitute a real chosen-client or Gemini acceptance.

### Remaining pilot follow-ups

The owner prioritizes accessible prod and small parallel releases without
staging. Employee first-login/role acceptance and one chosen client document
flow are separate P1 work. Real Gemini recognition/human review/provider cleanup,
USTC DOC→PDF format/mapping/publication and optional UI polish are P2 and do not
hold this released slice. Eight of nine imported blank templates are published;
USTC remains draft. D5 test-history migration is cancelled, not completed.
Existing backups/secrets/history remain preserved as recorded above.
