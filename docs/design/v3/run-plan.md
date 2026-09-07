# EVO V3: план прогона и холодная передача

Последнее фактическое обновление: 2026-09-07.

Этот файл — не backlog и не личные заметки одного исполнителя. Это
agent-agnostic handover: Codex, Sol, Astra или новый инженер должны суметь
продолжить прогон с нулевым контекстом, не восстанавливая историю по старым
worktree и не повторяя уже принятую работу.

## Коротко: где мы сейчас

- Последний замороженный **кодовый** `origin/main` перед этим docs-only
  handover: `fb170b6169a2859d8bd271cd78d61739589ffcd1`, squash G0 safety PR #680.
- После merge этого документа `origin/main` закономерно будет новее. Новый
  исполнитель должен убедиться, что изменения после `fb170b61…` — только
  handover/docs. Если там есть другой код, сначала разобрать его.
- В репозитории закончены A, C, D1, D2, E0–E5, F и G0.
- B выполнен частично: release/schema/recovery механика есть, но текущий
  frozen main ещё не прошёл managed schema apply и один финальный production
  release proof.
- G0 закрыл небезопасный auto-routing path в PR #680. Live G всё ещё ждёт
  новый amoCRM token, owner-approved routing artifact, разрешение на live write,
  восстановленный `crm_primary` или отдельный reviewed amoCRM-only harness и
  выбор manual против background/two-way режима.
- D1 больше **не in flight**. Он слит в PR #660. Его миграции 117–121 пока
  являются repo-ready, а не live-managed proof; их production apply входит в B.
- Не заявлять production, SMTP, invite, Student login, amoCRM, WhatsApp или
  provider success без реального credentialed доказательства.

## Как возобновить прогон с нуля

### 1. Читать в этом порядке

1. Корневой `AGENTS.md`.
2. `CONTEXT.md` и применимые ADR, прежде всего
   `docs/adr/0027-promote-v3-to-the-single-product-surface-on-managed-supabase.md`.
3. Последние релевантные блоки append-only `docs/PLAN_CHANGES.md`.
4. `docs/design/v3/product.md`.
5. Этот файл.
6. Release/recovery contracts в `docs/EVO_LAUNCH_PLAN.md`.
7. Перед любым B/VPS действием — канонический runbook
   `deploy/production-release.md`, особенно one-time #552 preparation.
8. `CLAUDE.md`; для UI также `docs/design/v3/frontend-rules.md`.

Старые SHA и статусы в append-only документах — исторические evidence records,
а не current state. Более поздний подтверждённый merge всегда сильнее раннего
`candidate` или `review pending`.

### 2. Проверить durable state до любых правок

```bash
set -Eeuo pipefail

git fetch origin --prune
git rev-parse origin/main
git log --first-parent --oneline fb170b61..origin/main
git merge-base --is-ancestor \
  fb170b6169a2859d8bd271cd78d61739589ffcd1 origin/main \
  || { printf '%s\n' 'STOP: frozen code baseline is not an ancestor of origin/main' >&2; exit 1; }
changed_paths="$(
  git diff --name-only \
    fb170b6169a2859d8bd271cd78d61739589ffcd1...origin/main
)"
printf '%s\n' "$changed_paths"
unexpected_paths="$(
  printf '%s\n' "$changed_paths" \
    | awk 'NF && $0 !~ /^(docs\/PLAN_CHANGES.md|docs\/design\/v3\/product.md|docs\/design\/v3\/run-plan.md)$/ { print }'
)"
test -z "$unexpected_paths" \
  || { printf 'STOP: unexpected post-baseline paths:\n%s\n' "$unexpected_paths" >&2; exit 1; }

git ls-tree -r --name-only origin/main -- supabase/migrations \
  | rg '/(117|118|119|120|121|122|123|124|125|126|127|128)_'

for pr in 655 656 657 660 664 665 666 667 668 669 670 671 672 673 674 675 676 677 678 679 680; do
  gh pr view "$pr" --repo izzhackt/evo_AI_CRM \
    --json number,state,headRefOid,mergeCommit,url
done

gh issue view 551 --repo izzhackt/evo_AI_CRM --json state,url
gh issue view 552 --repo izzhackt/evo_AI_CRM --json state,url
gh issue view 553 --repo izzhackt/evo_AI_CRM --json state,url
gh pr list --repo izzhackt/evo_AI_CRM --state open
```

Ожидается:

- миграции 117–128 присутствуют;
- PR из списка выше, включая G0 #680, слиты;
- #551 закрыта, #552 и #553 открыты до настоящего cutover/audit;
- кодовый baseline `fb170b61…` достижим из current `origin/main`.

До первого handover merge diff после baseline может быть пуст. После него
разрешён только exact set или его подмножество:

```text
docs/PLAN_CHANGES.md
docs/design/v3/product.md
docs/design/v3/run-plan.md
```

Любой другой путь означает, что frozen code изменился: сначала исследовать и
обновить handover/proof SHA, а не продолжать по старому baseline.

Если ожидание не совпало, остановиться и исследовать. Не восстанавливать D/E/F
из старых локальных веток и не создавать заменяющую реализацию.

## Дисциплина каждой оставшейся волны

1. Создать чистый worktree/ветку от проверенного exact `origin/main`.
2. Делать минимальную связную пачку. Не смешивать provider/deploy/cleanup/UI,
   если между ними нет обязательной зависимости.
3. Схему менять только новой immutable миграцией `NNN_*.sql`; слитые миграции
   не редактировать.
4. Использовать Node `22.23.1`. Для свежего worktree:
   `npm ci --ignore-scripts`, если package scripts не требуют иного.
5. Всегда выполнить `git diff --check` и scoped проверку изменённого контракта.
   Для product/TypeScript changes добавить только применимые typecheck, ESLint
   и production build по changed-range contract; не повторять тот же gate без
   нового изменения. Docs-only пачка проверяет ссылки, SHA, команды,
   внутреннюю согласованность и protected short checks, но не гоняет product
   build/typecheck «для галочки». Build никогда не передавать в `head`, чтобы
   SIGPIPE не маскировал незавершённый прогон.
6. Добавлять ровно risk-matched доказательства:
   - SQL/RLS/lock change → disposable Postgres authorization/concurrency;
   - Auth/Storage/browser boundary → local Supabase/Chromium;
   - Caddy/route boundary → runtime HTTP/Caddy test;
   - docs-only → links, SHA, commands and internal consistency.
7. Отдать exact head независимому adversarial reviewer с задачей сломать
   решение. P0–P2 исправить; затем один подтверждающий exact-head re-review.
8. Push → PR → protected short checks → повторная сверка head/base →
   squash-merge с `--match-head-commit` → fetch и проверка нового `main`.
9. Полный ручной `EVO platform CI` не запускать на routine PR. Он выполняется
   **один раз** после окончательной заморозки main перед B/#552.

## Что считается доказательством

### Repo-ready

Merged code, immutable migrations, локальные SQL/Node/browser tests,
independent review и зелёные PR checks доказывают состояние репозитория.

### Live-proven

Только реальные provider/managed/VPS действия с exact SHA доказывают:

- применение миграций в managed Supabase;
- managed Auth Site URL, redirect allowlist и SMTP;
- доставку/принятие invite и live Student login;
- production deploy и authenticated smoke;
- amoCRM/WhatsApp/provider read или write;
- backup/restore применительно к текущим реальным данным.

Новый read-only managed ledger check run `34124147750` успешно завершился на
exact code baseline `fb170b61…`: local 128, managed 116, missing exact ordered
suffix 117–128, extra set пуст. Это live read proof, но не schema apply.
Последний успешный полный `EVO platform CI` относился к `f3c591…` 2026-09-05
и не является exact-current-main release proof.

## Карта этапов

| Этап | Статус | Durable result | Что дальше |
|---|---|---|---|
| A | Сделано | PR #655, docs/intake contract | Не повторять |
| B | Частично | #551 закрыта; ledger check run 34124147750: exact tail 117–128 | Freeze → apply/check → one full proof → #552/#553 |
| C | Сделано | PR #657 | Не повторять |
| D1 | Сделано в repo | PR #660, migrations 117–121 | Managed apply только через B |
| D2 | Сделано в repo | PR #673 closure, migrations 122–125 | Managed apply только через B |
| E0–E5 | Сделано в repo | PR #669, #674–#678, migrations 126–128 | Live portal proof только после B inputs |
| F | Сделано | PR #679, main `52c2a2c6…` | Не удалять больше без нового inventory |
| G0 | Сделано в repo | PR #680, two-phase owner-routing gate | Не повторять/не обходить |
| G live | Ждёт владельца | Manual outbound code есть, flags off | Token + route artifact + WAHA gate + write approval + mode decision |

## A — документы и приём: сделано

PR #655 закрепил product words, общий план и архитектурный контекст. Более
поздние docs/contract PR #658, #659 и E0 #669 уточнили порядок. Не откатывать
их ранними локальными копиями документа.

## B — один живой production authority: частично

### Что уже готово

- `EVO schema ledger` из PR #656 умеет отдельные ручные `check` и `apply`.
- #551 закрыла isolated recovery/release-readiness для прежнего empty-source
  состояния. Это не production deploy и не proof для нового customer data.
- Release controller, immutable image, candidate smoke, atomic acceptance и
  application rollback находятся в repo.
- `EVO_PRODUCTION_RELEASE_ARMED` записан как `false` на последней read-only
  сверке.
- На последней сверке GitHub имел `SUPABASE_ACCESS_TOKEN`, SSH key и
  known-hosts, но не имел `EVO_GITHUB_VARIABLES_READ_TOKEN` и двух smoke Admin
  secrets. Перед действием проверить ещё раз: secret inventory изменчив.
- Owner actor, допускаемый release contract: `72846050`.
- Managed project ref: `iosckaqtovbbnssqcpde`.
- Read-only ledger run `34124147750` на `fb170b61…` доказал: local 128,
  managed 116, missing только ordered suffix 117–128, extra пуст. `apply` не
  запускался и остаётся частью единой #552 цепочки после docs freeze и готовых
  PAT/smoke prerequisites.

### Read-only snapshot 2026-09-07 12:25 UTC

Это ускоряющая предварительная сверка, не freeze-time proof; перед мутацией
повторить.

- GitHub arm = `false`. Secret names: `SUPABASE_ACCESS_TOKEN`, deploy SSH key
  и known-hosts присутствуют; PAT и обе smoke Admin secrets отсутствуют. Все
  13 required non-secret variables присутствуют и проходят shape checks;
  optional rollback seed отсутствует, что допустимо только при доказанном
  absent app. Branch protection требует strict `Changed range` + `Fast checks`.
- Hermes capacity проходит: `MemAvailable` около 11.2M KiB, свободный диск
  около 120.9M KiB; `.env.production` и `.env.waha` — regular root-owned mode
  0600. Набор env key names совпадает с current example, значения read-only
  audit не раскрывал и не подтверждал.
- `/opt/evo-crm/evo-fast-release.sh` отсутствует: one-time exact controller
  preparation ещё не выполнена. `release-evidence` существует mode 0700,
  пуст; pending/current-V3 pointers отсутствуют. При повторном подтверждении
  это absent-app first-cutover branch с пустым rollback seed.
- Установленный `/opt/evo-crm/docker-compose.prod.yml` остаётся прежней
  V1-формы `app/waha/lead-agent`; из `evo-crm` сейчас работает только private
  healthy WAHA container. Authenticated read-only session probe при этом дал
  `crm_primary.status=FAILED`, не `WORKING`. Target `evo-crm-app` и ClamAV
  отсутствуют. Сессию и volume сохранить; не restart/relink/QR без отдельного
  provider authority. FAILED session не блокирует app-only #552 при
  выключенных providers, но WhatsApp readiness остаётся unproved.
- `evo-edge-caddy` единолично владеет 80/443 и направляет sslip CRM route на
  `evo-crm-app:3000`. Origin certificate — valid Let's Encrypt для sslip;
  `/`, `/api/health` и `/api/version` возвращают 502, потому что app alias
  отсутствует. ClamAV image/container также отсутствует и должен появиться
  только через pinned release controller.
- Legacy app/lead-agent отсутствуют, Inbox остановлен; active worker/ingress
  guards не показали параллельного successor authority. Это повторить сразу
  перед cutover.
- `evo-student-docs` — известный отдельный non-target service из repo audit.
  Он подключён к `evo_public_web`, но не является Caddy upstream. Не делать его
  successor dependency и не удалять в #552 без отдельного scope.
- `crm.evoadmissions.com` не резолвится и остаётся deferred; первый sslip
  release этим не блокируется.

### Оптимизированный порядок B

Все read-only пункты можно готовить параллельно. Production mutations идут
строго последовательно.

1. **Freeze.** После merge этого handover получить полный current
   `origin/main` SHA и не принимать новые code PR до конца proof.
2. **Read-only preflight, параллельно:**
   - GitHub vars/secrets names и owner actor;
   - exact managed Supabase project и migration ledger;
   - current live app: допустимы только `absent`, подтверждённый frozen V1 или
     уже принятый V3; ambiguity = stop;
   - `/opt/evo-crm`, env permissions, immutable WAHA/ClamAV digests;
   - `crm_primary` volume/session не трогать;
   - available RAM не меньше `4,194,304 KiB`;
   - отсутствие staging route/container/Compose/network/volume/root,
     GitHub Environment и managed staging ref.
3. **Source-data boundary.** Снова прочитать managed customer rows и Storage
   inventory непосредственно перед cutover.
   - Если всё ещё zero rows/objects, можно использовать принятый #551
     empty-source proof первого cutover.
   - Если появились rows/objects, STOP: нужен non-empty export с counts,
     sizes/checksums и isolated restore + forward migration + Auth/RLS/Storage/
     scanner rehearsal.
4. **Host prep при arm=false.** Выполнить one-time #552 sequence строго по
   `deploy/production-release.md`: exact reviewed controller → rollback seed →
   exact V3 Compose. Если live app absent, rollback seed оставить пустым;
   synthetic V1 seed запрещён. Если активен подтверждённый frozen V1, сначала
   sealed seed mode 0600 + hashes и его verification, и только после успеха
   установить exact V3 Compose при `arm=false`. Unknown = stop.
5. **Schema ledger на frozen main, строго синхронно:**

   ```bash
   # До dispatch не должно быть другого queued/in-progress ledger run.
   gh run list --workflow evo-schema-ledger.yml --limit 10

   gh workflow run evo-schema-ledger.yml --ref main -f mode=check
   gh run list --workflow evo-schema-ledger.yml \
     --event workflow_dispatch --limit 10
   gh run watch <CHECK_RUN_ID> --exit-status
   gh run view <CHECK_RUN_ID> --json headSha,event,status,conclusion,jobs,url
   gh run view <CHECK_RUN_ID> --log
   ```

   `gh workflow run` только ставит run в очередь. Сразу записать URL/ID нового
   run и сверить start time/actor. Не dispatch-ить следующий mode, пока exact
   run-id предыдущего не завершился успешно и его SHA, mode и ledger output не
   проверены вручную. Если одновременно появился чужой run, не угадывать ID:
   дождаться/согласовать одного оператора.

   - Если local и managed version sets уже exact-equal, `apply` пропустить:
     первый `check` является финальным.
   - Если missing — только точный упорядоченный suffix local migrations, а
     extra и неожиданные gaps отсутствуют, использовать уже записанную #552
     owner authorization и выполнить ровно один `apply`; второе approval не
     спрашивать. Дождаться exact apply run через `gh run watch`, проверить его
     SHA/mode/log, затем отдельно dispatch/check/watch финальный `check` до
     version-set equality.
   - Workflow сравнивает версии, а не checksum/SQL body. Не называть его
     checksum proof. Extra, не-suffix gap либо отдельно обнаруженный
     checksum/partial mismatch = STOP.

   На baseline до managed действий вероятный хвост — 117–128, но это не
   предположение для resume: фактический первый `check` всегда сильнее.
   Schema rollback запрещён; исправлять только новой forward migration.
6. **Arm snapshot.** После всех preflight gates установить
   `EVO_PRODUCTION_RELEASE_ARMED=true` **до** запуска CI. Downstream release
   проверяет значение при старте upstream run.
7. **Один полный proof от owner account:**

   ```bash
   FROZEN_MAIN="$(git rev-parse origin/main)"
   gh workflow run evo-platform-ci.yml --ref main \
     -f proof_revision="$FROZEN_MAIN"
   ```

   Workflow должен выполняться от actor `72846050`, а `proof_revision`,
   workflow SHA и current `main` обязаны совпасть byte-for-byte.
8. **Автоматический app-only release:** дождаться image → Hermes → candidate
   smoke → atomic acceptance. Проверить public `/api/health`, реальный Admin
   login, authenticated read-only `/v3/main`, `/api/version`; проверить и
   сохранить вместе с hashes оба generated artifact: mode-0600
   `rollback-command.txt` с одной literal non-secret command и mode-0700
   state-bound executable wrapper `rollback-command.sh`.
9. **Disarm:** workflow не делает этого автоматически. После terminal success
   или failure вернуть `EVO_PRODUCTION_RELEASE_ARMED=false` и прочитать
   значение обратно. При failure выполнить только controller-defined rollback/
   recovery и не переходить к retirement.
10. **Завершить #552:** только после принятия V3 вывести из действия exact
   superseded active V1/V2 services, routes и workers; доказать no-fallback и
   один active runtime authority; затем закрыть #552.
11. **#553:** провести финальный exact-live authority audit. Только после него
    удалять safe stale refs/comments. Runtime retirement не переносить в #553.

Если release остановился на schema drift, сначала disarm/readback `false`,
исправить drift только через синхронный ledger `check -> apply -> check` на том
же frozen main, затем повторить все freeze-time preflight gates. Перед rerun
снова arm/readback `true`, использовать `Re-run all jobs` именно того run и
того же SHA, дождаться terminal результата и снова disarm/readback `false`.
Не запускать второй независимый full proof без причины.

### B: точные стоп-условия

- missing PAT/smoke identity;
- origin/main изменился после freeze;
- owner actor или proof SHA не совпал;
- managed ledger имеет extra/partial/неожиданный tail;
- production state нельзя однозначно классифицировать;
- появились реальные rows/Storage bytes без non-empty recovery proof;
- нет RAM/scanner/private-network prerequisite;
- настоящий Admin authenticated smoke не может выполниться.

## C — честные числа и критические замечания: сделано

PR #657 исправил честность totals/truncation, календарную пагинацию, Inbox
waiting lower bound, pipeline search/filters, audit cursor/filter semantics,
словарь и критические визуальные несоответствия. Два adversarial раунда закрыли
25 находок. Не возвращать приближённые числа как точные.

## D — пять потребностей заказчика: сделано в repo

### D1: migrations 117–121, PR #660

- **117 `case_notes`:** append-only lead/case notes, create/list RPC,
  organization/subject authority, idempotent `request_id`, locks, RLS.
- **118 application geography:** country ISO alpha-2 и target degree в
  university applications, формы и Russian wording.
- **119 queue extensions:** Inbox last direction/time/search, Sales
  `stage_entered_at`, Admissions task keyset cursor и due range.
- **120 `reply_snippets`:** audience-scoped create/update/archive/list с
  optimistic version.
- **121 media attach bridge:** WhatsApp media → exact case document version
  через существующие private Storage, reservation/finalize и ClamAV; никаких
  public URLs или browser byte copies.

Текущий статус D1: repo merge завершён и должен проверяться по наличию файлов,
а не по старому worktree. Live managed status — не доказан после 116; apply
117–121 входит в единый ledger tail B.

### D2: UI и corrective migrations 122–125, closure PR #673

Durable последовательность:

- contract #664;
- exact-case media correction contract #665;
- Inbox/migration 122 #667;
- reply snippets #668 и composer integration #671;
- Profile/Pipeline/migration 123 #670;
- Calendar/migration 124 #666;
- Media route + migration 125 #672;
- cumulative closure #673.

Принятый D2 surface:

- **Inbox / 122:** server-derived `waiting_since` от первого входящего в
  непрерывном unanswered tail; exact `waiting=1`; server-side search/filter до
  limit; canonical cursor/order сохраняются.
- **Snippets:** staff-controlled Russian templates доступны из Inbox composer;
  template selection не даёт autonomous/provider send.
- **Profile/Pipeline / 123:** notes и application geography/status работают на
  exact case через Supabase read/actions, без локального shadow authority.
- **Calendar / 124:** выбранный диапазон дочитывается keyset pages, не обрывается
  на первой странице; UI использует реальные Bishkek dates/times и открывает
  день на релевантном часу.
- **Media / 125:** attach action виден только при exact conversation→case
  relation; bytes остаются server-side; DB boundary требует exact non-null
  `student_case_id`; cross-org/revoked/quarantined/unavailable fail closed.

D2 локально и в protected checks принят. Managed apply 122–125 остаётся частью
B, а не поводом заново реализовать D2.

## E — портал студента: E0–E5 сделаны в repo

| Пакет | Результат | PR / migration |
|---|---|---|
| E0 | authority/product contract | #669 |
| E1 | Admin-authorized invite/provision receipt state machine | #674 / 126 |
| E2 | Student-safe overview/application/visa/finance read models | #675 / 127 |
| E3 | Auth callback, trusted coordinator, resolver/guards | #676 |
| E4 | отдельный Student layout и пять portal routes | #677 |
| E5 | private document upload/download + cumulative closure | #678 / 128 |

Пять Student routes E4 используют отдельную authorization ветку; Student не
получает staff `/v3/*`, а staff session не подменяет Student portal session.
Пустые факты остаются пустыми: UI не придумывает куратора, сумму, срок или
этап.

E5 дополнительно закрепил:

- Student видит только `document_slots.current_version_id/current_version_no`,
  а не max version guess;
- browser создаёт один UUID `Idempotency-Key`, сохраняет его через failed retry
  и меняет только после `201` или выбора другого файла;
- attempt admission происходит до body и считает все попытки, но не занимает
  scarce ClamAV capacity;
- service-only scan claim выдаётся непосредственно перед scanner: global 4,
  actor 2, slot 1, lease 15 минут;
- replay использует только остаток DB lease; перед каждым ClamAV scan нужно
  больше 30 секунд socket timeout + 1 секунда safety margin;
- completed receipt не читает body и не сканирует повторно;
- exact canonical API path проверяется Next и EVO Caddy;
- signed download URL обязан совпасть с exact expected origin/bucket/object,
  organization и version.

Repo evidence E5: exact reviewed head `d88a9bf8…`, squash #678 `001e1966…`,
две независимые проверки без P0–P2 и зелёные Build/Lint/Release contracts/
Migration boundary/Fast checks. Это не managed apply или live invite proof.

### Что нужно до одного live Student invite

- owner-approved real case и exact recipient/email;
- выбранный transactional sender/from-domain;
- custom SMTP credentials только в Supabase Dashboard;
- подтверждённые SPF, DKIM, DMARC, rate limits и delivery policy;
- email-provider link tracking выключен;
- managed Russian invite template совпадает с repo;
- Email OTP Expiration и `EVO_STUDENT_INVITE_OTP_EXPIRY_SECONDS` равны 3600;
- sole Site URL:
  `https://evo-crm.72.62.119.112.sslip.io`;
- sole redirect allowlist:
  `https://evo-crm.72.62.119.112.sslip.io/auth/callback`;
- рабочий TLS, managed schema through 128 и явное разрешение на ровно один
  provider invite call/принятие владельцем email.

Local config использует `http://127.0.0.1:3000` и
`http://127.0.0.1:3000/auth/callback`; старое утверждение про
`https://127.0.0.1:3000` недействительно.

Custom DNS `crm.evoadmissions.com` не блокирует первый sslip release. Поздний
переход требует отдельного owner-controlled DNS approval и должен заменить
sslip Site URL/callback, а не создавать параллельный authority.

## F — repo cleanup: сделано, PR #679

### Удалено ровно девять dead files

```text
src/lib/platform-ai-memory.ts
src/lib/platform-bw4-workflow.ts
src/lib/platform-case-assignment.ts
src/lib/platform-pilot-cohort.ts
src/lib/server/platform-ai-memory-repository.ts
src/lib/supabase/browser.ts
tests/platform-ai-memory.test.mjs
tests/platform-bw4-workflow.test.mjs
tests/platform-pilot-cohort.test.mjs
```

### Сопутствующие изменения

```text
.dockerignore
.env.example
docs/PLAN_CHANGES.md
docs/design/v3/run-plan.md
package.json
scripts/run-node-test-suite.mjs
scripts/test-v3-managed-supabase-recovery-orbstack.mjs
tests/ci-node-test-suite.test.mjs
tests/p6c-obsolete-database-tooling-cleanup.test.mjs
tests/platform-admissions.test.mjs
tests/platform-runtime-public-config.test.mjs
tests/runtime-hardening.test.mjs
tests/supabase-staff-auth.test.mjs
```

Итог PR #679: 22 files, `+127/-5689`; CI manifest 124 unique files, unit
manifest 119 unique files. E3/E4/E5 suites сохранены.

Тринадцать `drizzle/**` historical files **не удалены**: exact paths и SHA-256
зафиксированы P6C, а root `.dockerignore` исключает `drizzle` из production
build context. Они не являются runtime/schema authority. Не переносить,
редактировать, исполнять или бандлить их без нового решения.

F evidence на Node 22.23.1: targeted 44/44, E3 77/77, portal 27/27, frontend
109/109, deduplicated unit 169/169, lint/typecheck/build PASS, npm audit 0,
несколько exact-head reviews без P0–P2 и зелёные protected checks. Migration
boundary корректно skipped: SQL в F не менялся.

Не продолжать механическую чистку. `agent-lead2-inbox/`, `evo-lead-agent/`,
Transcription Lab, locale/`LangSwitcher`, `ThemeToggle` и dark mode не входят в
F. Remote refs/comments удаляются только после #553 exact-live audit.

## G — amoCRM: G0 сделан, live acceptance ждёт владельца

Repo-ready состояние: explicit manual outbound command существует и
исторически прошёл 8/8 live операций 2026-09-03, но оба старых VPS token дали
401 2026-09-06 и не должны retry/reuse. Inbound amoCRM→EVO, background и
two-way sync не реализованы.

PR #680 (`fb170b61…`) устранил главный G safety gap. Harness больше не может
сразу писать по автоматически выбранным pipeline/status/user/tags. Теперь
контракт строго двухфазный:

1. `discover` доказывает blocked authority/zero mutation, выполняет только
   provider reads и сохраняет canonical восемь routing values;
2. владелец отдельно проверяет бизнес-смысл значений и создаёт независимый
   private approval artifact;
3. `dispatch` строит immutable `git archive` exact-main snapshot, повторяет
   discovery и сравнение, семантически перепроверяет SHA-bound blocked markers
   внутри authorized child boundary и только затем допускает один browser
   dispatch.

Approval и discovery должны совпасть byte-for-byte. Approval — отдельный
regular non-symlink file, exact mode 0600, максимум 4 KiB, отдельные path и
inode. IDs — canonical positive int32 strings; tag names — exact strings.
Обход same-file/hardlink, loose mode, лишние/неупорядоченные keys, stale
discovery и malformed markers fail closed до запуска authorised child.

### Входные данные и обязательные prerequisites

1. Новый long-lived token отдельной private integration для
   `https://evoadmissions.amocrm.ru` в ignored private JSON:

   ```json
   { "access_token": "REDACTED", "token_type": "Bearer" }
   ```

   Канонический repo-local путь: `data/secrets/v2-amocrm-token.json`; можно
   передать другой абсолютный private path. Frozen V1 token не использовать и
   не ротировать.
2. Private provider env file с current amoCRM base URL, WAHA API key и exact
   session `crm_primary`; путь передаётся через
   `EVO_V2_AMOCRM_PROVIDER_ENV_FILE`. Его содержимое не печатать.
3. `crm_primary` должен пройти read-only probe со status exact `WORKING` и одной
   валидной self identity. Read-only snapshot 2026-09-07 показал `FAILED`.
   Значит до G нужен либо отдельно разрешённый private recovery/relink этого
   session, либо отдельный reviewed amoCRM-only harness. Самостоятельно
   restart/relink/QR scan не выполнять.
4. Чистый exact `origin/main`, Node 22, OrbStack и уже запущенный local
   Supabase. Без вывода секретов в logs должны быть установлены точные local
   values `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` и
   `EVO_PLATFORM_SUPABASE_SECRET_KEY`.
5. Отдельное явное разрешение на один live amoCRM write и решение: оставить
   только manual Admin button или открыть отдельный background/two-way проект.

### Phase 1 — read-only discovery

```bash
set -Eeuo pipefail
FROZEN_MAIN="$(git rev-parse origin/main)"
export EVO_V2_REAL_AMOCRM_ACCEPTANCE=1
export EVO_V2_AMOCRM_PROVIDER_ENV_FILE=/absolute/private/provider.env
export EVO_V2_AMOCRM_TOKEN_FILE=/absolute/private/v2-amocrm-token.json
# Три local Supabase env выше должны быть уже безопасно установлены.

EVO_V2_AMOCRM_VALIDATION_PHASE=discover \
  scripts/verify-connected-amocrm-validation.sh "$FROZEN_MAIN"
```

Результат для review:
`output/provider-acceptance/amocrm/<exact-main-sha>/routing-discovery.json`.
Он содержит ровно эти восемь ordered keys:

```text
EVO_V2_AMOCRM_SALES_PIPELINE_ID
EVO_V2_AMOCRM_SALES_STATUS_ID
EVO_V2_AMOCRM_SALES_RESPONSIBLE_USER_ID
EVO_V2_AMOCRM_SALES_TAG_NAME
EVO_V2_AMOCRM_ADMISSIONS_PIPELINE_ID
EVO_V2_AMOCRM_ADMISSIONS_STATUS_ID
EVO_V2_AMOCRM_ADMISSIONS_RESPONSIBLE_USER_ID
EVO_V2_AMOCRM_ADMISSIONS_TAG_NAME
```

Auto-discovery — предложение, а не бизнес-решение. До owner approval процесс
заканчивается; provider-authorized app не запускается. Если значения неверны,
STOP: не редактировать discovery/evidence так, чтобы пройти gate.

### Phase 2 — owner-approved bounded dispatch

Только после явного подтверждения owner создаёт отдельную canonical JSON-копию
с теми же восемью значениями, exact 0600, и передаёт её абсолютный путь:

```bash
EVO_V2_AMOCRM_VALIDATION_PHASE=dispatch \
EVO_V2_AMOCRM_ROUTING_APPROVAL_FILE=/absolute/private/owner-approved-routing.json \
  scripts/verify-connected-amocrm-validation.sh "$FROZEN_MAIN"
```

Wrapper сам ограниченно устанавливает write/provider flags только в дочернем
процессе; не экспортировать их глобально. После fresh equality proof допускается
ровно один explicit Admin browser dispatch:
`contact_create`, `lead_create`, `contact_lead_link`,
`lead_pipeline_status_update`, `lead_responsible_update`, `lead_note_create`,
`lead_task_create`, `lead_tag_update`. Проверить redacted SHA-bound evidence,
replay/idempotency и readback. Manual 8/8 acceptance не доказывает
inbound/background/two-way sync.

## Всё, что нужно от клиента/владельца

### Для B/#552

1. Fine-grained GitHub PAT только для `izzhackt/evo_AI_CRM`, permission
   `Variables: Read-only`, ограниченный срок; сохранить как secret
   `EVO_GITHUB_VARIABLES_READ_TOKEN`. Подходящего credential сейчас нет:
   built-in `GITHUB_TOKEN` не может запросить Variables permission, workflow не
   умеет mint GitHub App token, а текущий broad classic `gh` token копировать
   запрещено. Самый быстрый compliant путь — owner создаёт dedicated PAT в
   GitHub UI только для этого repo и вводит его через hidden stdin в
   `gh secret set EVO_GITHUB_VARIABLES_READ_TOKEN --repo izzhackt/evo_AI_CRM`.
   Не передавать token в command history, build, artifact, VPS, runtime или logs.
2. Smoke Admin должен одновременно иметь active Admin membership, известный
   password и обе GitHub secrets:
   `EVO_PRODUCTION_SMOKE_ADMIN_EMAIL` и
   `EVO_PRODUCTION_SMOKE_ADMIN_PASSWORD`.
   - Можно использовать отдельного готового production Admin и безопасно
     записать его credentials в обе secrets.
   - Для существующего Auth user `evo-release-smoke@evoadmissions.com`, id
     `0d7a3ea5-9098-405b-9c59-4af90c09acf1`, live Admin сначала выполняет
     только membership step (`provision_pilot_staff_member`), затем владелец
     устанавливает/сбрасывает известный password и безопасно заполняет обе
     secrets. Одной Admin session или одного membership без credentials
     недостаточно. Нужен доступ к уже существующей production Admin session;
     прямой SQL/service-role insert membership нарушает принятый контракт.

Production activation/cutover для #552 уже разрешён owner direction
2026-09-04 после #551 и всех named prerequisites. Не спрашивать второе routine
approval. Missing access, failed prerequisite или ambiguous external state всё
равно останавливают прогон. Это разрешение не включает provider enablement,
webhook ownership transfer, live invite, amoCRM или WhatsApp writes.

### Для одного live Student invite

Approved case/recipient, sender/domain, custom SMTP, SPF/DKIM/DMARC, exact
template/OTP settings, sslip Site URL/callback и разрешение на один invite
call. DNS custom domain сейчас не нужен.

### Для G

Новый private integration token; private provider env file; owner-reviewed
восемь routing values в отдельном exact-0600 JSON; live-write approval; решение
manual против background/two-way; и один из двух WAHA вариантов:

- отдельное разрешение восстановить/relink `crm_primary` до exact `WORKING`; или
- отдельный reviewed amoCRM-only harness, который не зависит от WAHA.

Текущий `FAILED` session не перезапускать и не QR/relink без такого разрешения.

## Следующие действия без потери времени

1. Слить этот docs-only handover PR и получить новый frozen exact-main SHA.
2. Параллельно собрать только read-only B preflight и запросить у владельца
   PAT + smoke Admin. Не ждать одно, чтобы начать другое.
3. При наличии inputs выполнить один последовательный production chain:
   source inventory → host prep arm=false → resume-safe ledger branch →
   arm=true → один exact-main full CI → downstream release/acceptance.
4. Внутри #552 после acceptance вывести superseded runtime, доказать один
   authority и закрыть #552; затем #553 и safe stale-ref/comment cleanup.
5. Портал live invite и G выполнять отдельными bounded acceptance окнами;
   ни один из них не должен задерживать первый V3 cutover на sslip.

Если PAT/smoke Admin отсутствуют, B заблокирован по точным пунктам выше. В этом
случае не создавать обходные credentials, не ослаблять smoke и не заявлять
production success: вернуть владельцу этот список одним сообщением.
