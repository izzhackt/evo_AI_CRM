# EVO V3: короткий план запуска и холодная передача

Обновлено: 2026-09-08. Подходит любому следующему агенту или инженеру.
Цель первого запуска: один V3 app, private ClamAV и сохранённый private WAHA;
managed Supabase — единственный Auth/database/Storage. Providers выключены.

Новый самостоятельный запуск от 08.09: [кураторы и лёгкий UX/UI](curator-ux-run-plan.md).
Его approval, очередь и критерии приёмки ведутся отдельно от первого релиза.

## Исторический checkpoint первого запуска — не текущая очередь работ

Это checkpoint перед последним freeze, **не live dashboard**. Сначала прочитать
последние комментарии и состояние [#552](https://github.com/izzhackt/evo_AI_CRM/issues/552)
и [#553](https://github.com/izzhackt/evo_AI_CRM/issues/553): там записываются terminal
SHA/run/acceptance и retirement после этого commit. Если там уже приняты exact
current-main и финальный audit, **не запускать план повторно**. На VPS acceptance
подтверждают связанный hash `current-v3-accepted.json` и отсутствие pending pointer.

- Последний проверенный candidate: `3ab67a44df232994e274c08b437d2031d98e4661`
  (#683). Full CI [34163710618](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34163710618)
  прошёл. После merge image-store correction заморозить новый полный `origin/main`
  SHA: прежний CI не доказывает изменённый workflow.
- Код A, C, D1, D2, E0–E5, F и G0 уже в `main`. Их не переделывать.
- B/#552: доступ, host, Auth hook, private buckets и schema подготовлены. SSH
  empty-argument и preflight-cleanup исправления уже merged в #683.
  Release [34164160455](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34164160455)
  attempt 1 остановился после загрузки image: GitHub classic-store image ID
  отличается от OCI manifest ID на VPS Docker 29.4.0/containerd. App, ClamAV и
  pending/accepted pointers не создавались; WAHA не изменён. Arm=false подтверждён.
  Исправление выравнивает только ephemeral GitHub runners и отдельно проверяет
  config digest; controller guard и production Docker daemon не ослабляются.
  Failed transfer и два protected snapshots сохранить; новый attempt/revision
  должен иметь новый release ID, не перезаписывать старую evidence directory.
- Schema `apply` [34161431038](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34161431038)
  применил 117–128; [check 34163474083](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34163474083)
  подтвердил local 128 = managed 128, missing/extra пусты. Не повторять apply.
- V3 Compose установлен; reviewed bootstrap controller/validator находятся под
  `/opt/evo-crm/release-evidence/bootstrap-3ab67a44df232994e274c08b437d2031d98e4661/`.
  Перед следующим freeze сверить hashes, не копировать неизменный controller.
  Пока app отсутствует, rollback seed пустой; fake V1 seed запрещён.
- Missing canonical API-path guard из #678 уже установлен на live Caddy:
  validation, graceful reload и strict-TLS malformed-path 404 подтверждены.
  Все прежние маршруты сохранены; старый `evo-inbox` удалять только после acceptance.
  Original backup: `/opt/evo-retired/2026-09-07-v3-edge-3ab67/Caddyfile.before`.
- `EVO_GITHUB_VARIABLES_READ_TOKEN` уже существует. Чтение Variables этим token
  доказано встроенным pre-transfer guard run `34164160455`; acceptance guard
  ещё не выполнялся. Это не проверка минимальности PAT permissions. Требование остаётся:
  fine-grained PAT только для этого repo, `Variables: Read-only`; более широкий
  token не подставлять. Отдельный повторный API probe не нужен.
- С разрешения владельца пароль существующего smoke Admin сброшен;
  реальный login и `platform.current_actor_authority()` подтвердили active Admin.
  Обе smoke secrets сохранены 2026-09-07 20:56 UTC. Роль/пользователь не создавались;
  canonical Custom Access Token hook включён. Не сбрасывать пароль повторно.
- Fresh customer/workflow source пуст; шесть Storage buckets, 0 objects/bytes.
  Три canonical private buckets созданы с exact policy из `supabase/config.toml`.
  Принятый #551 proof и encrypted export hashes проверены; managed staging отсутствует.
  Последний source inventory: 228 tables, только 22 control/config tables непустые;
  customer/workflow rows и Storage objects отсутствуют. Изменение данных требует
  нового recovery решения, а не переноса старого empty-source вывода.
- Последний recovery `crm_primary`: `FAILED → STARTING → SCAN_QR_CODE`.
  Затем владелец сказал «QR не надо»: pairing и новые restart/relink остановлены.
  WhatsApp `WORKING` не доказан; первый app-only cutover этим не блокируется.

Подробности закрытых волн, D1 migrations 117–121, D2 UI, E portal и F cleanup
сохранены в [неизменяемой полной передаче](https://github.com/izzhackt/evo_AI_CRM/blob/6326146009f953d42e7cf6ee5cf2904a14a43ed1/docs/design/v3/run-plan.md).
Её статусы и старые блокеры исторические; текущий список действий — ниже.

| Уже закончено в репозитории | Evidence |
| --- | --- |
| A — исходный план; C — корректность UI/данных | [#655](https://github.com/izzhackt/evo_AI_CRM/pull/655), [#657](https://github.com/izzhackt/evo_AI_CRM/pull/657) |
| D1 — backend; D2 — UI | [#660](https://github.com/izzhackt/evo_AI_CRM/pull/660), [#673](https://github.com/izzhackt/evo_AI_CRM/pull/673) |
| E0–E5 — Student portal, без live SMTP/invite proof | [#669](https://github.com/izzhackt/evo_AI_CRM/pull/669), [#674](https://github.com/izzhackt/evo_AI_CRM/pull/674), [#675](https://github.com/izzhackt/evo_AI_CRM/pull/675), [#676](https://github.com/izzhackt/evo_AI_CRM/pull/676), [#677](https://github.com/izzhackt/evo_AI_CRM/pull/677), [#678](https://github.com/izzhackt/evo_AI_CRM/pull/678) |
| F — cleanup; G0 — безопасный amoCRM routing harness | [#679](https://github.com/izzhackt/evo_AI_CRM/pull/679), [#680](https://github.com/izzhackt/evo_AI_CRM/pull/680) |
| #551 — release/recovery machinery и принятая репетиция | [#551](https://github.com/izzhackt/evo_AI_CRM/issues/551) |

## Что читать и как продолжить

1. [AGENTS.md](../../../AGENTS.md), [CONTEXT.md](../../../CONTEXT.md) и применимые
   [ADR](../../adr/).
2. Последние решения в [PLAN_CHANGES.md](../../PLAN_CHANGES.md), этот файл и
   release contract в [EVO_LAUNCH_PLAN.md](../../EVO_LAUNCH_PLAN.md).
3. Перед B — [production runbook](../../../deploy/production-release.md).
   Перед изменением продукта — [product.md](product.md), `CLAUDE.md` и
   [frontend rules](frontend-rules.md), если затронут UI.

```bash
git fetch origin --prune
git status --short --branch
git rev-parse origin/main
git log --first-parent --oneline 6326146009f953d42e7cf6ee5cf2904a14a43ed1..origin/main
git diff --stat 6326146009f953d42e7cf6ee5cf2904a14a43ed1...origin/main
```

Не трогать чужой dirty worktree. Для изменений — отдельная ветка от актуального
`main`; для релиза — clean checkout exact current-main. Разобрать все новые
изменения после baseline; старый зелёный CI не доказывает новый SHA.
GitHub — источник общего состояния, не локальные worktree и не память агента.

## Первый запуск: историческая последовательность из трёх блоков

### 1. Закрыть входные условия и заморозить SHA

- [x] Получить доступ к **существующему** production Admin с известным password.
  Проверить active Admin authority реальным разрешённым способом, затем безопасно
  заполнить `EVO_PRODUCTION_SMOKE_ADMIN_EMAIL` и
  `EVO_PRODUCTION_SMOKE_ADMIN_PASSWORD`. Если выбранный существующий Auth user
  ещё не Admin, действующий Admin выполняет membership step через
  `provision_pilot_staff_member`. Нельзя выдавать роль через service-role/SQL,
  mint session или подменять smoke. Пароли и tokens не помещать в Git/логи/чат.
- [ ] После image-store/final-handover merge зафиксировать current-main SHA и остановить новые
  merge до окончания релиза. #552 production activation уже разрешён после
  named prerequisites; второе routine approval не требуется.
- [x] Проверить names/shape GitHub vars и secrets и **точное равенство**:
  `EVO_PRODUCTION_RELEASE_ACTOR_ID=72846050`,
  `EVO_SUPABASE_PROJECT_REF=iosckaqtovbbnssqcpde`. Другой actor/project = STOP,
  даже если формат корректный. Проверить host/env permissions, pinned digests, private network,
  RAM ≥ `4,194,304 KiB`, отсутствие staging и второго active runtime authority.
  `EVO_PRODUCTION_RELEASE_ARMED=false` до завершения подготовки.
- [x] Fresh customer rows/Storage inventory перед первой попыткой. При неизменном
  empty source и recovery contract использовать принятый #551 proof. При новых
  данных/objects или несовместимом recovery contract — STOP, реальный export и
  isolated restore/forward-migration/Auth/RLS/Storage/scanner rehearsal по
  runbook. Не повторять пустую репетицию только из-за нового docs SHA.

GitHub/host/source read-only проверки готовить параллельно с получением Admin
доступа. Schema ledger не читать ещё одним ad-hoc способом: первый формальный
`check` следующего блока закрывает эту часть preflight.

### 2. Подготовить host/schema и выполнить один релиз

Production mutations выполняет один оператор, последовательно.

1. One-time #552 preparation уже выполнена при `arm=false`; не повторять
   неизменные controller/Compose. При новом candidate проверить их exact hashes.
   Runbook требует:
   exact reviewed controller → rollback seed при необходимости → exact V3
   Compose. Fresh locked preflight должен различить absent app, утверждённый
   frozen V1 или accepted V3; unknown/pending state = STOP. Для absent app
   rollback seed пустой, synthetic V1 seed запрещён. Для frozen V1 сначала
   sealed seed mode 0600 с hashes/verification, затем Compose. WAHA session,
   config и volumes не менять. Не запускать приложение ручным Compose обходом.
2. Выполнить schema workflow на frozen current-main:

   ```bash
   gh run list --repo izzhackt/evo_AI_CRM --workflow evo-schema-ledger.yml --limit 10
   # Dispatch только если нет другого queued/in-progress ledger run.
   gh workflow run evo-schema-ledger.yml --repo izzhackt/evo_AI_CRM --ref main -f mode=check
   gh run list --repo izzhackt/evo_AI_CRM --workflow evo-schema-ledger.yml --event workflow_dispatch --limit 10
   gh run watch <CHECK_RUN_ID> --repo izzhackt/evo_AI_CRM --exit-status
   gh run view <CHECK_RUN_ID> --repo izzhackt/evo_AI_CRM --json headSha,event,status,conclusion,jobs,url
   gh run view <CHECK_RUN_ID> --repo izzhackt/evo_AI_CRM --log
   ```

   Записать exact run ID/actor/time; проверить SHA, mode и ledger output, не
   только зелёный conclusion. При concurrent чужом run не угадывать ID.
   Если version sets равны — `apply` и второй `check` не нужны. Если missing
   является **точным ordered suffix**, extra/gaps отсутствуют — dispatch
   `mode=apply`, дождаться и проверить exact run, затем отдельный `mode=check`
   до equality. Не dispatch следующего mode до проверки предыдущего.
   Не предполагать, что хвост всё ещё 117–128. Ledger проверяет версии, не SQL
   checksums; extra, неожиданный gap, известный partial/checksum mismatch = STOP.
   Schema recovery только forward-only.
3. После всех prerequisite gates выполнить arm/readback `true` **до** CI;
   actor и `EVO_PRODUCTION_RELEASE_ACTOR_ID` должны быть `72846050`. Запустить ровно
   один полный proof:

   ```bash
   FROZEN_MAIN="$(git rev-parse origin/main)"
   gh workflow run evo-platform-ci.yml --repo izzhackt/evo_AI_CRM --ref main \
     -f proof_revision="$FROZEN_MAIN"
   ```

   Записать и дождаться exact upstream run ID/SHA. Успех автоматически запускает
   `evo-fast-release.yml`: он строит sealed image artifact, проверяет ledger,
   PAT/arm/actor/current SHA и выполняет app-only release/acceptance. Следить за
   связанным downstream run, не повторять его build/deploy/smoke вручную.
   Первый public URL: `https://evo-crm.72.62.119.112.sslip.io`.

### 3. Принять результат, disarm и закрыть запуск

- [ ] Дождаться реального authenticated Admin browser smoke и named acceptance;
  сохранить redacted SHA/run-bound evidence и generated literal rollback command
  с hashes. Зелёного upstream CI или HTTP 200 недостаточно.
- [ ] При terminal success **или failure** выставить
  `EVO_PRODUCTION_RELEASE_ARMED=false` и прочитать значение обратно.
  Если upstream failed и downstream пропущен, arm также снять.
- [ ] При failure — только controller-defined recovery; runtime retirement не
  начинать. Если причина schema drift: disarm → ledger check/apply/check → fresh
  gates → arm → `Re-run all jobs` того же failed release run на том же frozen SHA
  → terminal disarm. При изменении candidate SHA нужен новый freeze/proof.
- [ ] Только после accepted V3 завершить scoped retirement в
  [#552](https://github.com/izzhackt/evo_AI_CRM/issues/552): из live Caddy убрать только
  `evo-inbox.72.62.119.112.sslip.io → evo-inbox-app:3000`; после свежего exact-ID,
  project-label и exited-state check удалить только stopped `evo-inbox-app-1`
  и `evo-inbox-waha` без force/volume removal. Сохранить оба WAHA volumes, images,
  `/opt/evo-inbox`, историю и активный bind-mounted edge file. Не трогать `inbox`,
  отдельный EVO Docs, OlympiadAI и другие проекты. Доказать live/source route
  agreement, no-fallback и один CRM runtime authority; record hashes в #552.
- [ ] После этого [#553](https://github.com/izzhackt/evo_AI_CRM/issues/553) —
  финальный exact-live authority audit и только затем safe stale refs/comments.
  #552 не закрывать до acceptance и retirement. #553 требует accepted deployed
  SHA = exact current `origin/main`; нового commit после freeze не делать.
  Terminal результат записать в issues, без рекурсивного docs-only redeploy.

## Какие тесты действительно запускать

| Изменение | Достаточная проверка |
| --- | --- |
| Только этот план/README/решения | Diff, ссылки, реальный range classifier, один независимый exact-head review и короткие protected `Changed range` + `Fast checks`; contract docs запускают `Release contracts` |
| Обычный code PR | Затронутые реальные тесты и существующие scoped PR checks; migration-boundary harness только при соответствующих SQL/migration изменениях |
| Замороженный релиз | Один manual `EVO platform CI`, затем автоматический release с реальным managed-production Admin smoke |

Полный CI уже параллелен: deduplicated Node suite + lint/build, единый local
Supabase/Auth/Storage/browser proof, dependency audit. Не добавлять отдельные
`test:unit`, `test:security`, `test:frontend`, `typecheck`, `build`, local
Supabase/Chromium или OrbStack поверх этого же proof. Нет обязательного push-CI
после merge или повторного полного прогона просто из-за прошедшего времени.

Fresh checks arm/actor/SHA/artifact/schema/host/Auth перед разными mutation
boundaries остаются: это не дубли тестов. Workflow/test files и protected checks
этот docs-only план не меняет. Не заменять реальный провал mock/skip/pass.

Цикл изменения: scoped diff → соответствующая проверка → независимый adversarial
review exact head → PR/короткие checks → merge. Findings исправлять по scope и
перепроверять; не запускать все suites после каждой правки текста. До freeze статус
держать здесь; после freeze — только sanitized checkpoints в #552/#553. Не дублировать полный
отчёт во всех документах после каждого шага.

## После первого запуска, не на его критическом пути

- **WhatsApp:** QR/relink/restart сейчас остановлены владельцем. Для продолжения
  нужно новое явное направление; сохранить `crm_primary` и volume. После accepted
  V3 отдельно согласовать webhook ownership и реальный provider proof. Старый
  webhook/legacy sender не возрождать; не заявлять connected status по container
  health. Сейчас никаких сообщений или тестов с отправкой.
- **Student portal:** для одного live invite нужны approved case/recipient,
  SMTP sender/domain, SPF/DKIM/DMARC, template/OTP и sslip callback settings,
  разрешение на конкретный invite. Repo-ready E не равно live SMTP/login proof.
- **amoCRM:** новый private integration token → read-only routing discovery →
  owner approval восьми sales/admissions routing values в отдельном mode-0600
  JSON → отдельное bounded live-write approval → credentialed 8/8 readback и
  idempotency proof. Точные команды/keys в
  [G handover](https://github.com/izzhackt/evo_AI_CRM/blob/6326146009f953d42e7cf6ee5cf2904a14a43ed1/docs/design/v3/run-plan.md#phase-1--read-only-discovery).
  Текущий harness требует `crm_primary=WORKING`; при отказе от QR нужен отдельно
  reviewed amoCRM-only harness, не обход существующего guard. Manual acceptance
  не доказывает background/two-way sync; такой режим — отдельное решение/работа.
- **Custom DNS:** `crm.evoadmissions.com` отложен; работающий sslip — достаточный
  URL для первого релиза, новый домен не prerequisite.

**От владельца прямо сейчас:** новых доступов не требуется. Существующий Admin
проверен, обе smoke secrets сохранены, Variables-read guard прошёл. Исправление
image-store parity и exact-main release выполняет агент. Нового Auth user, QR,
amoCRM token и SMTP для первого app-only запуска не требовать.
