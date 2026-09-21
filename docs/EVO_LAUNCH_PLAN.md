# EVO Launch Plan

## CRM UX и единое поступление — принято к реализации 2026-09-20

Владелец поручил реализовать [план CRM UX и поступления](EVO_CRM_UX_AND_ADMISSIONS_PLAN_2026-09-20.md).
Он определяет выбранные CRM-изменения и общий путь программа → документы →
проверка EVO для CRM, веба и iPhone. Веб — первый полный рабочий выпуск;
iPhone использует те же серверные операции. Этот порядок относится к новому
admissions-пути и уточняет прежнее общее правило параллельной разработки.
[Ведомость исполнения](EVO_CRM_UX_AND_ADMISSIONS_EXECUTION_2026-09-20.md)
разделяет реализацию, review/merge, выпуск и реальные проверки.

Решение §14.2 получено: клиент с сопровождением сразу начинает подготовку
по выбранной программе, без отдельного одобрения выбора. Решение §14.1 также получено: сохранить нынешнее расположение сводки
и списка студентов.
Сопровождение остаётся обязательным условием нового клиентского пути.
Общий финальный E2E, контентная волна и App Store остаются отложенными; точечная
проверка изменённых функций обязательна. Поручение не включает применение
миграций, production-записи или release-arm без отдельной действующей authority.

## 2026-09-20 — точечная доработка карточки университета iPhone

По поручению владельца выполняется Impeccable critique → план → реализация.
Контракт и квитанция: [iPhone university refinement](design/portal/ios-university-refinement.md).
Это текущая работа над UI; итоговый E2E и App Store readiness остаются отложены.

## Текущий приоритет владельца — функциональность и интерфейс, 2026-09-20

После #920 владелец уточнил: состав продукта ещё открыт, продолжаем
действующий KB-контракт и доведение функций/UI. Закрытая портальная поставка
не означает, что продукт закончен или все сценарии доказанно работают.
Общий итоговый E2E (AST-2), контентная волна 2 (AST-3) и App Store readiness
(AST-4) отложены до явного решения владельца о завершении нужного состава
функций и переходе к этим этапам. Автоматически после KB их не запускать.
Точечные реальные проверки изменений, независимое review и управляемые
release-гейты сохраняются. Актуальный порядок и известные UI-пробелы:
[план продолжения Astra, §4–6](EVO_ASTRA_CONTINUATION_PLAN_2026-09-20.md#4-порядок-блоков).

## CRM Knowledge Base — план GPT-6 Astra, 2026-09-19

Контракт отдельной задачи: [EVO_CRM_KNOWLEDGE_BASE_PLAN_2026-09-19.md](EVO_CRM_KNOWLEDGE_BASE_PLAN_2026-09-19.md).
Admin-only база с папками, страницами и файлами, существующими материалами
клиентов, защищёнными записями доступа; обязательный перенос и сортировка всей
локальной базы, дальнейшая работа в CRM и выгрузка материала/папки/всей базы.
Связи — обычные ссылки; подключение ИИ остаётся отдельной будущей работой.
Astra владеет этим scope, Claude Code Fable продолжает Portal/App. Общие
документные/Auth-контракты, номера миграций и выпуск координируются; worktree
не изолирует общую БД. Это планирование, а не квитанция реализации или переноса.

### KB execution — 2026-09-20

Перенос, сортировка и полный экспорт завершены; 6 568/6 568 исходников в
скачанном ZIP проверены по исходным размерам и SHA-256 без пропусков и ошибок.
Восстановление после ошибки Storage выполнено по [контракту изменения](PLAN_CHANGES.md#2026-09-20--kb-восстановление-большой-выгрузки-после-ошибки-storage).

- KB-0 and runtime merged through #902/#906/#915/#916/#918/#919/#921/#924. Worktree `evo-crm-knowledge-implementation` preserves the canonical dirty checkout. Admin navigation is unified under Knowledge Base; staff document/template routes remain available.
- Production ledger 001–206 is contiguous and matches applied hashes. SOPS runtime, external age key and export maintenance timer are provisioned. The owner transferred schema/release and actual import/export coordination to Astra; Portal/App remains Fable's scope.
- The complete source plan covers 6,570 entries: 436 internal pages, 432 internal files, 5,668 raw files and 32 protected originals; two key files remain outside CRM. All 6,568 source originals and 25 structured protected records are imported. Full UI/API reconciliation: 6,568 verified, 0 missing, 0 mismatch; 5,961 unique blobs and 607 preserved duplicate source locations. After the first Storage failure, #924 was released and the same full snapshot resumed with all 206 verified parts retained. The 10,471,474,710-byte ZIP is downloaded and fully verified: 7,542 file entries, all 6,568 originals, 25 current protected records (26 versions) and 32 protected originals; zero missing/errors. All 2,655 review questions remain explicit; two key files stay outside the archive.
- Real editor/navigation, file-review metadata, selected canonical ZIP, normal Auth denials, source-byte preservation and earlier UI journeys are recorded in the [KB execution receipt](EVO_CRM_KNOWLEDGE_BASE_EXECUTION_2026-09-20.md). No Student customer acceptance or AI republication is claimed.
- Current release `35481793583` accepted exact main `b7598a1c5046fe3c2b16fc014bc0c22044e64b27`; runtime/accepted pointer match, healthy, pending absent and arm=false. The changed Storage path passed a real one-file Admin export/download with exact source bytes and five role denials. Earlier canonical-search HTTP/UI acceptance and guarded release history remain in the execution receipt.

## Portal release v3-r35473599531-a1-fd25b1ac accepted 2026-09-20

- [x] Ledger this cycle: the production ledger gained migrations
  201-204 (`platform_knowledge_*`, the Astra knowledge plan) — applied
  OUTSIDE the portal coordinator's schema-ledger workflow and without a
  pre-apply ping, which deviates from the cross-plan coordination
  protocol recorded in this file's KB section; noted here honestly.
  Both the coordinator and the peer session independently re-read the
  ledger via the Management API before arm: count=204, min=001,
  max=204 — contiguity intact, repo tree tail equals the live tail, so
  the release gate was satisfied and no apply step was needed.
- [x] Release from exact main `fd25b1ac9a3a4f7c31b7747b81bcba6e1c1fa8a9`.
  Five commits since the previous release: #909 (PORT-9d prep:
  photo-migration pipeline, manifest, URL-resolution switch), #910
  (previous receipt), #911 (manifest flip after the coordinator ran
  --apply: bucket `portal-university-photos` created and verified,
  87/87 uploads with zero failures, public URLs spot-checked with
  sha256 matches by two independent reviewers — this release makes the
  catalog serve managed photo URLs; 57 official-source photos stay
  hotlinks by license), #906 (Astra: Admin knowledge library, sealed
  import, canonical exports — includes a Dockerfile change; the peer
  session verified sops v3.13.2 is pinned by sha256 checksum for both
  architectures, and the built image passed browser smoke and the
  acceptance guard), and #912 (iOS wave 9b: catalog search/filters
  with exact RPC parameter parity, MapKit map fed only by the repo geo
  library with honest no-coordinates disclosure, app icon regenerated
  byte-identically from the official brand asset, a11y pass 16+5
  labels/traits/ScaledMetric across waves 1-7; 139/139 tests).
  CI run 35473582066 green on the exact merge SHA; release run
  35473599531 accepted; container `evo-crm-app-1` on hermes-vps
  carries the exact OCI revision (healthy); `/api/health` live;
  accepted pointer `v3-r35473599531-a1-fd25b1ac` with
  acceptance-record sha256 recorded; `EVO_PRODUCTION_RELEASE_ARMED`
  returned to `false` at 22:37 UTC.
- Independent exact-head reviews, each PASS: #909 9/9 + #911 flip
  delta-review (set-equality of the 87 flips, 5 reviewer-chosen public
  URLs with sha256 matches); #912 11/11 with one medium finding (a
  filter/collect race leaving stale map pins under new filter chips)
  fixed pre-merge via a generation-counter gate with three
  deterministic unit tests and delta-confirmed. Every merge-race
  rebase carried patch-id --stable proofs.
- Open item handed to Astra/the owner: #906's
  `deploy/knowledge/*.service|*.timer` are HOST-side systemd units not
  contained in the image — until someone installs and enables them on
  hermes-vps the knowledge-maintenance job simply does not run (no
  degradation of anything else). Who installs them is not decided in
  the portal plan.
- Not claimed: live authenticated render of managed photos in the
  production catalog (no credentials in the agent session — the
  managed URLs themselves return HTTP 200 with manifest-matching
  bytes); live filtered-RPC run and manual VoiceOver pass on iOS
  (static parity and attributes only); KY texts still await the
  owner's native-speaker proofread.

## Portal release v3-r35469103571-a1-b047e663 accepted 2026-09-20

- [x] No migrations this cycle: Management API readback before arm
  confirmed the live ledger tail `…196-200` equals the repo tree, and
  the released delta touches no `supabase/migrations/` files.
- [x] Release from exact main `b047e663ebcd72c7fa599f276f532abcd9b5cc3e`
  (wave 9). Web/shared deltas: #907 (PORT-9c: «Главная» кабинета at
  /portal/home in «Атлас» — continue-lesson/test from real attempt
  state, favorites with nearest open/announced intakes, анкета-status
  card for approved, case next-actions first for assisted; /portal root
  and the production smoke path byte-frozen; «новое в каталоге»
  honestly omitted — the catalog exposes no first-published signal) and
  the web half of #908 (two narrow intake endpoints: anonymous
  registration delegating to the unchanged createPublicStudentAccount
  with the same rate buckets and анкета validation, and bearer-only
  invite acceptance over the PORT-8a transport reusing the exact web
  callback seam). iOS half of #908 rides in the repo (9-step native
  анкета wizard with rule-for-rule contract parity, application status
  screen, invite flow, honest SessionRouter states, +188 RU/KY pairs,
  115/115 tests) — this release is what makes the phone flow live,
  since the endpoints now exist in production. CI run 35469083620
  green on the exact merge SHA; release run 35469103571 accepted;
  container `evo-crm-app-1` on hermes-vps carries the exact OCI
  revision (healthy); `/api/health` live; accepted pointer
  `v3-r35469103571-a1-b047e663` with acceptance-record sha256 recorded;
  `EVO_PRODUCTION_RELEASE_ARMED` returned to `false` at 21:07 UTC.
- Independent exact-head reviews, each PASS with reproduced validation:
  #907 10/10 (no new RPCs, smoke-path safety, honest data blocks, axe
  19/19; its finding A — a third copy of the tier derivation instead
  of actor.accessTier — was fixed pre-merge and delta-confirmed);
  #908 hostile security review 11/11 (registration parity incl. the
  cannot-create-account-with-invalid-анкета trace, invite identity
  binding in migration 126 SQL, proxy scoping, PostgREST GRANTs read
  from migrations 177/180, 66/66 web + 115/115 iOS reproduced; three
  non-blocking vocabulary/side-effect notes recorded in the review
  comment). Cross-session protocol observed both ways.
- Not claimed: no live registration or invite acceptance has been run
  against production (no real accounts created); the wave-9a phone
  flow is enabled by this release but not yet exercised end-to-end;
  KY texts still await the owner's native-speaker proofread.

## Portal release v3-r35465491203-a1-5ab34127 accepted 2026-09-19

- [x] No migrations this cycle: Management API readback before arm
  confirmed the live ledger tail `…196-200` equals the repo tree
  (`200_platform_portal_case_chat.sql` is still the repo tail), so the
  schema-ledger apply step was skipped by design.
- [x] Release from exact main `5ab341278c0422e45b4a555aa95ccf1a9bc93eef`
  (wave 8, closing plan-audit gaps). Web deltas: #899 (bearer-token path
  on exactly the two student document endpoints per ADR 0030 «Решение»
  п.2 — same authority chain on a token-bound publishable-key client, a
  present-but-invalid header never falls back to cookies, plus the
  narrowly-scoped proxy pass-through the middleware required) and #903
  (PORT-8c: tests screens rebuilt in «Атлас» with the assessment contract
  and the live e2e spec byte-untouched, full KY for the public /apply
  анкета with RU strings byte-frozen and test-pinned, operational stage
  rendered in «Моё поступление» mirroring the staff dictionary). iOS
  delta #900 (wave 8: documents with frozen-idempotency upload and
  bearer download, payments preserving the 189 null-semantics,
  notifications with real in-app targets, read-only tasks/next actions;
  the «доступны в веб-кабинете» deferral is gone) rides in the repo —
  no store distribution exists yet, so the container ships the web
  deltas. CI run 35465474055 green on the exact merge SHA; release run
  35465491203 accepted; container `evo-crm-app-1` on hermes-vps carries
  the exact OCI revision (healthy); `/api/health` live; accepted pointer
  `v3-r35465491203-a1-5ab34127` with acceptance-record sha256 recorded;
  `EVO_PRODUCTION_RELEASE_ARMED` returned to `false` at 19:54 UTC.
- Independent exact-head reviews, each PASS with reproduced validation:
  #899 hostile security review 9/9 (scope, no cookie fallback, identical
  authority chain, supabase-js getClaims verification traced, proxy
  anchored-regex scoping, adversarial sweep clean); #900 11/11 (every
  cited SQL anchor opened, UUIDv5 request-id vectors independently
  recomputed, cross-PR contract with #899 verified field-by-field,
  92/92 tests reproduced); #903 11/11 (assessment runner semantics
  diffed line-by-line against the deleted v3 components, e2e spec
  zero-diff, 15/15 axe both themes). Every merge-race rebase carried a
  patch-id --stable proof that the reviewed code commits were unchanged.
  Cross-session protocol observed (peer ack before arm, main frozen,
  accepted + disarm confirmed back); the parallel GPT-6 Astra knowledge
  plan merged #901/#902 into main during the wave — both are inside the
  released revision.
- Not claimed: live iOS document upload/download against production
  (the bearer path ships in this very release; a live pass needs a
  signed-in device session); live post-release web render of the KY
  tests/apply screens (no live credentials in the agent session); KY
  texts still await the owner's native-speaker proofread; four
  pre-existing local `test:ci:node` failures found on main by the #903
  reviewer (environment-dependence suspected, CI is green) are spun off
  as a separate task, not fixed here.

## Portal release v3-r35452266156-a1-b7052637 accepted 2026-09-19

- [x] No migrations this cycle: Management API readback before arm
  confirmed the live ledger tail `…196-200` equals the repo tree, so the
  schema-ledger apply step was skipped by design.
- [x] Release from exact main `b7052637d48c812ba37c68c5b9016615b59c55e0`.
  Web delta is #896 (PORT-6a: KY for the four re-skinned assisted screens —
  142 pairs, closing the debt named in the previous receipt — plus 8 a11y
  fixes and a static axe gate; RU smoke anchors byte-pinned). iOS deltas
  #893 (wave 5: favorites, profile, consultation, learning-read, incl. the
  live-found language save-button fix) and #897 (wave 7: lesson runner with
  server-receipt verdicts and frozen idempotent retries, review runner,
  case-chat thread honoring contract §6 — no task cards, NULL-label
  document cards — consultation parity, +56 RU/KY keys, 71/71 tests) ride
  in the repo only; no store/TestFlight release exists yet, so the
  container ships the web delta. CI run 35452248717 green on the exact
  merge SHA; release run 35452266156 accepted; container `evo-crm-app-1`
  on hermes-vps carries the exact OCI revision (healthy); `/api/health`
  live; accepted pointer `v3-r35452266156-a1-b7052637` with
  acceptance-record sha256 recorded; `EVO_PRODUCTION_RELEASE_ARMED`
  returned to `false` at 15:42 UTC.
- Independent exact-head reviews: #896 confirmed earlier this cycle; #897
  PASS 8/8 on head `c252d529` (build+test reproduced twice, secrets scan
  clean, §6 and read-only live-check claims verified against code and SQL).
  The reviewer's one non-blocking note — the wave-7 PLAN_CHANGES entry
  predicted a SignIn-only screenshot while the final validation was a wider
  but still read-only six-screen pass — is closed by an append-only
  PLAN_CHANGES entry in this receipt PR. Cross-session protocol observed
  (ping before arm acknowledged by the peer session, accepted + disarm
  confirmed back).
- Not claimed: live post-release web render of the KY assisted screens
  (no live credentials in the agent session); KY texts still await the
  owner's native-speaker proofread (standing PORT-6 item); iOS runner
  write-paths were never exercised against production (decoder fixtures
  and policy units only).

## Portal release v3-r35446304360-a1-50c932c6 accepted 2026-09-19

- [x] Migration 200 (student side of the per-case chat over OTH-5's 191
  model: portal read/post RPCs, assisted-only, students flip needs_reply,
  staff mechanics untouched; the 191-author's seven-point integration
  contract was enforced as the review gate — one deviation (task titles
  leaking past student_visible) was caught and fixed pre-merge) applied
  before the release; ledger tail `…196-200` verified.
- [x] Release from exact main `50c932c691a1bf5fd5f4bd8f2407fdaa056261fd`
  (#892 чат + #894 «Моё поступление» в Атласе: four assisted screens
  re-skinned with contracts byte-preserved, 9 legacy files deleted, smoke
  anchors byte-identical). Release run 35446304360 accepted; container on
  the exact revision; health live; ARMED back to `false`.
- First live authenticated verification happened this cycle: the owner
  signed the QA student into the wave-5 iOS build; favorites round-trip,
  the 196 language cycle (ru→ky→restart→full-KY UI→ru) and seeded lessons/
  professions were verified against production; one iOS save-button bug
  found live and fixed in PR #893 with a regression test.
- Not claimed: live web renders of the new chat screen; KY for the four
  re-skinned assisted screens stays a named PORT-6 item.

## Portal release v3-r35441505162-a1-a6e41aa9 accepted 2026-09-19

- [x] Migrations 197 (portal consultation requests into the staff Заявки
  queue on the existing lead.read permission; one-open-per-member; never
  attaches test results), 198 (learning/professions engine per the 135
  reference architecture: immutable versioned content, private attempts
  with mistake bank, server-only grading, staff-invisible progress) and
  199 (seeded content v1: module en-m1-start — 12 lessons / 99 exercises,
  and 24 profession cards, generated from the merged drafts with a
  sha256-stamped drift-checked pipeline) applied before the release;
  Management API readback: ledger tail `…195-199` equals the repo tree.
- [x] Release from exact main `a6e41aa975827ce5fe2a5e2ec01db24392be92e3`
  (#886 консультация, #887 движок, #888 сиды, #889 разделы «Английский» и
  «Профессии», #890 hotfix route-allowlist для /portal/favorites и
  /portal/profile — прод-дефект релиза d1b64849, найден независимым review
  и подтверждён живым чеком). Release run 35441505162 accepted; container
  carries the exact revision; `/api/health` live; ARMED back to `false`.
- Independent exact-head reviews on all five PRs; the engine review
  reconstructed all patched function bodies and hunted the key-projection
  leak (none found); rebase deltas re-confirmed, incl. a full content
  delta-review of the #889 union rebase after two seam repairs (CSS brace
  loss and a TS closing-brace loss were caught by real build/test runs).
- Not claimed: live authenticated journeys on the new screens; KY native
  proofread remains the named PORT-6 step.

## Portal release v3-r35435007516-a1-d1b64849 accepted 2026-09-19

- [x] Migrations 195 (student-owned university favorites: set/list/by-ids
  RPCs, case-independent guard per the catalog pattern, staff denied) and
  196 (portal_language on student_profiles, get/set-own profile RPCs,
  account-deletion REQUEST flow with a DB-enforced one-open-per-member
  index — the RPC deletes nothing) applied before the release; Management
  API readback: ledger tail `…192-196` equals the repo tree.
- [x] Release from exact main `d1b648499c75a5cda2371a5d0b113e47317ab4e0`
  (#883 избранное+сравнение, #884 профиль/язык/удаление, #882 iOS каталог-
  карточка/раннер тестов/профиль с 18/18 XCTest, #881 контент-драфты
  PORT-4). Release run 35435007516 accepted; container carries the exact
  revision; `/api/health` live; ARMED back to `false`.
- Independent exact-head reviews on all four PRs, including reviewer-run
  xcodebuild test reproduction for iOS and a content review with an
  independent validator script; every post-review delta re-confirmed on
  its final head. Cross-session protocol observed.
- Not claimed: live authenticated journeys on the new screens (no student
  credentials in the agent session); RU/KY native proofread remains the
  named PORT-6 step.

## Portal release v3-r35431481983-a1-0667c001 accepted 2026-09-19

- [x] Migrations 193 (invited intake unification: `intake_flow='anketa_v1'`
  invites route through the анкета and staff approval; approve reuses the
  invite-bound case; fixes the latent 180 defect where any ordinary анкета
  approve would raise 55000 on 042's BEFORE INSERT guard) and 194 (35
  business-code retags 40001→PT409 in prepare/authorize-reissue/finalize —
  the 186 infinite-retry class; readback asserts zero residual 40001)
  applied to production via the schema-ledger workflow; Management API
  readback: live ledger tail `…190-194` equals the repo tree.
- [x] Release from exact main `0667c001781372a36ebf3f7cef383e3e37552034`
  (#877 + #879 + receipt/docs); CI 35431469620 green, release 35431481983
  accepted, container `evo-crm-app-1` carries the exact OCI revision,
  `/api/health` live, accepted pointer recorded, ARMED returned to `false`.
- Independent exact-head reviews: #877 approve with the 180-defect claim
  independently confirmed (live full-chain run by the reviewer); #879 approve
  with all three function bodies reconstructed and all 35 sites recounted.
  Cross-session protocol observed (ping both ways, main frozen during runs).
- Known transient window (accepted, coordinated): between the 194 apply and
  this acceptance, a staff re-invite conflict would surface a generic error
  text on the old app; behaviour was unaffected.

## Portal release v3-r35428426080-a1-03fb983f accepted 2026-09-19

- [x] Migration 192 (portal access tiers) applied to production BEFORE the
  release via the manual schema-ledger workflow; Management API readback
  confirmed the live ledger tail `…188-192` equals the repo tree. Zero
  affected accounts (both live cases active); boundary suite checkpoint
  `P192_PORTAL_ACCESS_TIERS_SUITE_PASSED` verified in the full local log.
- [x] Release from exact main `03fb983fab746f167cccfec42df114d7da0adda3`
  (#869 access tiers + #873 catalogue «Атлас»: MapLibre map, geo library
  126 pins/17 honest omissions, OpenFreeMap keyless terms verified + #874
  node-suite guard fixes). CI run 35428409672 green; release run 35428426080
  accepted; container `evo-crm-app-1` on hermes-vps carries the exact OCI
  revision; `/api/health` live; accepted pointer
  `v3-r35428426080-a1-03fb983f` with acceptance-record sha256 recorded;
  `EVO_PRODUCTION_RELEASE_ARMED` returned to `false` at 07:12 UTC.
- Independent exact-head reviews: #869 triple-confirmed (incl. renumbering
  195→192 after OTHER released the 192-194 buffer), #873 confirmed on the
  merge tree, #874 confirmed at 10/10 guard. Cross-session release protocol
  observed both ways (ping before arm, main frozen during the run).
- Not claimed: real student sign-in journeys on the redesigned surfaces
  (no live credentials in the agent session); browser smoke covered the
  standing portal anchors only.

## Portal web + iPhone — parallel implementation approved 2026-09-19

The owner replaces the staff-only / no-self-serve restriction in
[`PRODUCT.md`](../PRODUCT.md). The target serves independent prospective
students and EVO clients through the same shared discovery and preparation
features. Clients also receive their authorized case, curator, documents,
tasks and communication; invitations and later service enrollment preserve
the same account, saved choices and learning progress.

Current contract: [full portal plan](EVO_PORTAL_WEB_IPHONE_PLAN_2026-09-19.md).
The owner's later clarification replaces PR #859's sequential delivery order:
develop the desktop-first web portal and the full iPhone app in parallel. Both
student audiences receive the shared features, with full accompaniment added for
clients. Every new student completes the questionnaire, creates an account at
its final step and waits for staff approval. Approval and accompaniment are
separate authorizations. Portal UI languages are Russian and Kyrgyz.

Fable owns the full portal UX/UI redesign within the EVO brand, concise frontend
copy, the mobile technology decision and implementation of the plan. The work is
portal-scoped; necessary CRM connections reuse existing staff workflows. Active
staff and incident scopes below remain unchanged. The plan carries forward the
owner's delegated release workflow, subject to real credentials and release
controls; this documentation change itself performs no deployment or migration.

- [x] PORT-0: current-main inventory, contracts and parallel worktree allocation.
- [x] PORT-1: approved access, shared data/API authority and account continuity.
- [x] PORT-2: selected design, RU/KY content system, web and iPhone foundations.
- [x] PORT-3: university discovery, map, comparison and saved choices on both clients.
- [x] PORT-4: professions, private assessments and English learning on both clients.
- [x] PORT-5: full client accompaniment and consultation requests on both clients.
- [x] PORT-6: scoped integration, content completion and final UX pass. (кроме вычитки KY носителем — владельческий пункт)
- [ ] PORT-7: managed web delivery, iPhone distribution and truthful handoff. (владельческие внешние шаги: Apple Developer/подпись/TestFlight/store; агентская часть — done: review-аккаунт, документация)

Финальные документы: [ведомость](EVO_PORTAL_FINAL_LEDGER_2026-09-20.md) · [handover и передача Astra](EVO_PORTAL_HANDOVER_2026-09-20.md).
План продолжения: [EVO_ASTRA_CONTINUATION_PLAN_2026-09-20.md](EVO_ASTRA_CONTINUATION_PLAN_2026-09-20.md) (исполнитель — GPT-6 Astra).

These checkboxes describe planned work, not existing feature readiness. Existing
authentication, organization/case access and private assessment boundaries remain
enforced; schema and API refinements are recorded before their implementation.

The matching 2026-09-19 entry in [`PLAN_CHANGES.md`](PLAN_CHANGES.md) records
the owner decision and the documentation-only validation boundary.

## Portal identity retry incident — resolved and released 2026-09-19

Owner approved the production fix and termination of the two confirmed looping
database backends. No compute/plan upgrade, data deletion or Auth policy change.
Live baseline: CPU 99–100%; 29,894 `portal_identity_conflict` / SQLSTATE `40001`
events in five minutes, correlated to two PostgREST 14.5 backends. Official
Supabase guidance identifies custom `40001` as an infinite-transaction-retry
trigger in PostgREST 14. Preserve the existing identity denial, not the retry.

- [x] Forward migration 186 replaces the incident RPC's business-conflict SQLSTATE
  with a non-retryable error, preserving signature, grants and all identity checks.
- [x] Update the server error mapping and directly affected assertions together.
- [x] Independent exact-head review and protected short checks; PR #858 merged
  as `b10034b1d93b89dfc520ef89c1ae182e64080938`. Exact migration 186 applied
  once; the contiguous 001–186 ledger and both function definitions verified.
- [x] Revalidate the two approved backend identities before guarded termination:
  no matching rows remained at 02:50:36.556Z, so no backend was terminated and
  no project restart occurred.
- [x] Real PostgREST missing-receipt path returns HTTP 409 / `PT409` in 831 ms;
  the actual server store with a real Supabase client returns `mismatch`.
  Existing identity only; all receipt rows remain unchanged.
- [x] Fresh exporter counter deltas show CPU falling from 98.774% before the
  fix to 1.855% during 02:51:06.842–02:52:46.080 UTC. Logs from
  02:50:30–02:52:03.192 UTC, filtered to `portal_identity_conflict`, contain
  only the two expected `PT409` check calls and no `40001` for this conflict.
- [x] Managed release 35416869712 passed after upstream 35416851038; accepted
  `v3-r35416869712-a1-b10034b1` matches the reviewed merged SHA and image.
  Acceptance/browser hashes match; app and scanner healthy, zero app restarts,
  public health 200/live and no pending candidate. After the terminal workflow,
  the release arm was manually reset and freshly read back as `false`.
- [x] Accepted authenticated read-only browser smoke confirmed the staff case
  and Student Portal entry paths.

Evidence, exact hashes and limits: [incident receipt](qa/portal-identity-conflict-186-2026-09-19.md).
No fake accounts, synthetic production records, compute purchase, broad suites
or unrelated provider actions are part of this incident response.

## Other staff UX — RELEASED 2026-09-19 as v3-r35425913124-a1-ad0b5267

Migrations 187-191 were applied to iosckaqtovbbnssqcpde via the
owner-delegated Management API path (per-migration object probes + ledger
rows verified; final ledger tail 187-191 on top of 186). The first release
attempt (v3-r35425318843-a1-bebe5df9) was HONESTLY ROLLED BACK by the
pipeline: a Next.js route-slug collision from OTH-3
(api/v2/payment-receipts mixing [paymentEventId]/[studentCaseId]) passes
`next build` but kills every request at runtime; diagnosed by running the
exact candidate image with its candidate env in an isolated container on
Hermes, fixed in #875 (download route moved to payment-receipt-files/…)
with a new route-walk guard `tests/next-route-slug-consistency.test.mjs`
(red on the broken layout, green after). Second run 35425913124 accepted:
container on Hermes reports revision ad0b5267 (healthy), accepted pointer
updated with the acceptance record, crm health 200, arm read back false.
Prod never degraded: the rollback restored the prior accepted release, and
every 187-191 reader was engineered for the apply→release window. The
release also carries the portal session's migration-free #867/#868.

## Other staff UX — merged 2026-09-19 (receipts)

All six slices of `docs/EVO_OTHER_FABLE_PLAN_2026-09-19.md` are merged to
main (5fbb1b08). Per the allocation update below-noted in the previous
revision, the chain was renumbered 187-191 mid-flight: the parallel portal
session shipped 186_platform_student_invite_conflict_codes first; ranges
were agreed by cross-session message (OTH = 187-191 plus buffer 192-194,
portal >= 195) and recorded in PLAN_CHANGES. Every migration slice passed
the full local OrbStack boundary run (001->191, five new privilege suites
at their checkpoints) and a full `npm run build` before its PR, plus two
adversarial review lenses per slice with every confirmed finding fixed
pre-merge. Remaining: owner applies migrations 187-191 in order, the
managed release follows immediately (the portal session holds its 195
until then; main also carries its migration-free #867/#868, which ride
this release).

- [x] OTH-0 (#857): plan committed; 11 explanatory paragraphs removed from
  8 staff components; pinned by `tests/v3-quiet-interface.test.mjs`.
- [x] OTH-1 (#861, migration 187): «Воронка поступления» board —
  `pipeline_stage` + `move_case_pipeline_v1`, `/v3/admissions-pipeline`,
  drag plus «Переместить в…», «Убрать из воронки»; «Мой день» retired.
- [x] OTH-2 (#865, migration 188): unified task composer + task side panel;
  notifications v2 (enriched rows, «Прочитать всё», case-task assignment
  notifications, lazy due-tomorrow reminders; the old page RPC excludes the
  new kinds, so the deployed app stays safe between apply and release).
- [x] OTH-3 (#866, migration 189): «Договор и оплата» — contract files,
  tranches on the canonical ledger (the 043 immutability/transition guards
  replaced by a tranche-aware guard: money columns freeze once paid),
  receipt files, оплачено/осталось from payments only; NULL-safe overdue
  live-patches in 107/127 readers protect the deployed app from apply to
  release; follow-up #870 fixed the missed canonical adapter pin.
- [x] OTH-4 (#862, migration 190): «Добавить вуз» dialog over the case,
  optional program, author attribution via _v2 readers (live-body
  reconstruction incl. 176's LEFT JOIN patch), submission marking exposed.
- [x] OTH-5 (#871, migration 191): per-case staff chat — /v3/messages
  two-pane screen, same-case quotes, «Обсудить» link-cards to case
  documents/tasks, await states with explicit «Ответ не требуется», board
  «Нужен ответ» pill, curator notifications (ids only); the student side
  stays an explicit portal-plan dependency, never claimed done.
- [x] Migrations 187-191 applied (Management API, delegated path); release
  v3-r35425913124-a1-ad0b5267 accepted; arm disarmed. Rollback of the first
  attempt and the slug-collision fix are recorded above and in #875.

## Auth email — SMTP and templates saved, delivery pending, 2026-09-19

Owner approved Resend SMTP, replies forwarded to Gmail and Student email confirmation.
Follow [the mail runbook](runbooks/resend-auth-email.md): DNS published, domain
Verified and domain-restricted key transferred to Supabase. Custom SMTP, rate
100/hour and Russian Invite/Confirm templates were saved and read back after
PATCH at `2026-09-19T02:03:21.264Z`; existing callback links and Auth signup
policy are unchanged. One plain forwarding-check mail was sent from the owner's
personal Gmail to `evo@evoadmissions.com`; receipt is unverified. No Auth mail
sent; approved test aliases remain pending.

- [x] Sign in to Resend and Spaceship; create domain; inspect existing forwarding.
- [x] Apply actual TXT/CNAME records; read authoritative DNS; confirm domain Verified.
- [x] Create domain-restricted sending key and apply SMTP credentials.
- [x] Save SMTP/rate limit and Russian templates; confirm exact Management API readback.
- [ ] Confirm protected SOPS key archival; transport delivery is not yet proven.
- [ ] Implement the separate `/apply` confirmation path; SMTP alone does not enable it.
- [ ] Prove invitation, signup confirmation and reply delivery to approved recipients.

## Unified workflow S8 — released 2026-09-19; план закрыт

Owner applied migration 185 from main 9cdea7aa (#854), ledger 001-185
confirmed; 185 replaces three RPC bodies with unchanged signatures and
response shapes, so no degradation window occurred. Exact-main CI and managed
release 35408839637 passed on `9cdea7aa6f55ae6e6c61286ef339ff311c10a686`;
accepted release `v3-r35408839637-a1-9cdea7aa`; the running container reports
the same revision, healthy, zero restarts; public health 200 on both origins;
arm read back `false`. The cabinet-invite privilege boundary is covered by a
real-Postgres suite executed at the 185 checkpoint of the authorization
harness (this release's own review requirement).

With S8 the unified-workflow plan (docs/EVO_UNIFIED_WORKFLOW_PLAN_2026-09-18.md)
is fully implemented: an independent audit of all nine owner criteria against
the shipped code found eight done and one gap — closed by this slice. The two
remaining documented cosmetic follow-ups (full-row card save vs partial
merge; playbook-bound legacy partner-details fail-closed) stay recorded in
PLAN_CHANGES and are not plan criteria.


## Unified workflow S8 — active 2026-09-19

Final plan gap (§4): invite dispatch for cabinet cases. Journal entry
2026-09-19 «unified workflow S8».

- [ ] Migration 185: cabinet_pending receipt shape (no curator ever;
  acceptance sets portal_activated_at only, case stays pending), Sales-or-
  admin authority scoped to the linked lead, every receipt assertion call
  site repointed consistently.
- [ ] UI: three-way shape discriminator on the access card; Sales can
  dispatch cabinet invites; admin flows for the two existing shapes intact.
- [ ] Validation: scoped suites, S8 migration suite, full local boundary run,
  smoke audit; release via the owner-migration path.


## Unified workflow S7 — released 2026-09-19

Owner applied migration 184 from main 28e8373f (#852), ledger 001-184
confirmed. The pre-release no-degradation claim was wrong and is corrected
here: staff_lead_sale_conditions_v1 was widened to 32 keys while the prior
app validated 15, so lead cards and the sale-conditions preview could error
in the window between apply and release — the owner flagged it and the
release went out immediately. Exact-main CI and managed release 35399135860
passed on `28e8373f6f0816cfa1890da28f03e1531e58103a`; accepted release
`v3-r35399135860-a1-28e8373f`; running container reports the same revision,
healthy, zero restarts; public health 200 on both origins; arm read back
`false`. Follow-up discipline recorded: a widened read-RPC return shape is a
compatibility change for the strict client validators — release immediately
after apply, or version the RPC.


## Unified workflow S7 — active 2026-09-19

Closes the three recorded partial items of the released pivot (journal entry
2026-09-19 «unified workflow S7»).

- [x] Migration 184: card-fields allowlist widened (Пожелания/Образование/
  Условия), prepare_lead_cabinet_v1 for site/WhatsApp leads, editable partner
  facts RPC without a playbook binding.
- [x] UI: three progressive card blocks, «Подготовить кабинет» on the access
  block (invite dispatch itself stays the existing admin-gated case-page
  flow — no 126 case shape fits a permanently curator-less cabinet yet, see
  docs/PLAN_CHANGES.md's implementation entry), partner-facts form on «Вузы и
  программы».
- [x] Validation: scoped checks + full local migration-boundary run (OrbStack,
  exit 0) + smoke anchor audit (unaffected) done before this note; release
  via the standard owner-migration path is still pending the owner's actual
  apply.


## Unified workflow — released 2026-09-19

Owner applied migrations 180-183 to iosckaqtovbbnssqcpde from main f2f64c8e
(#849), ledger 001-183 confirmed. First release run 35389414703 deployed and
then correctly rolled back on the browser proof: the smoke still waited for
the route-tracker testid deleted by the pivot; during that window the prior
app (97238e1e) ran against the new schema, so the replaced RPC surfaces
(анкета approve, добавить продажу, директория, сводка) were degraded until
the fix shipped. PR #850 repointed the smoke at the «Вузы и программы»
anchor; exact-main CI and managed release 35390450281 passed on
`f9a233c616e0438c837ed201ff66364468dbe516`. Accepted release
`v3-r35390450281-a1-f9a233c6`; the running container reports the same OCI
revision, healthy, zero restarts; public health 200 on both origins; release
arm read back `false`. The automated proof covered admin login, case tabs,
team chat and the student portal read-only path on the pivoted UI.


## Unified workflow — active 2026-09-18

Owner plan docs/EVO_UNIFIED_WORKFLOW_PLAN_2026-09-18.md supersedes conflicting
earlier decisions. Contract entry: docs/PLAN_CHANGES.md (2026-09-18, «unified
workflow: план-контракт реализации»). One release to production at the end.

- [x] S1 Заявки и доступ: одна очередь трёх источников под Продажами; анкета
  создаёт каноничного лида; одобрение — только доступ (pending-дело без
  куратора и направления); отклонение сохраняет контакт и историю.
  Receipt: a223bbd9 (feat), 51c6c68e (fix).
- [x] S2 Карточка Sales: структурные блоки и условия продажи на карточке;
  в отчёте — выбор лида и куратора с предпросмотром; обходная передача из
  карточки убрана. Receipt: 2bb0e65c (feat), e266aa78 (fix).
- [x] S3 Принятие дела: «Ожидает принятия», Принять/Отклонить; отклонение
  возвращает дело в «Нужно назначить куратора»; админ назначает внутри дела.
  Receipt: 0394c113 (feat), 65172df2 (fix).
- [x] S4 Admissions без трекера: «Вузы и программы» вместо «Маршрута»; без
  этапов, виз, подачи и прибытия; документы, пакет и история сохраняются.
  Receipt: 83908ef9 (feat), 86aff708 (fix).
- [x] S5 Портал одного дела: экран «Заявки и виза» убран; кабинет до продажи
  (анкета, файлы по мере появления); этап-пилюля убрана. Receipt: 99d0dfdb.
- [x] S6 Docs и наименования: без прямого создания студента; «Студенты»,
  «Заявки», Inbox; связь карточка↔чат; сводка только по реальным данным.
  Receipt: S6: this change (uncommitted at authoring time).
- [ ] Финальная проверка слайсов, применение миграций владельцем и один
  управляемый релиз с честной квитанцией.


## Admissions UX overhaul + baseline checklist — released 2026-09-18

Owner-directed release of merged #840 (UX overhaul), #844 (staff baseline
checklist seeding) and #845 (migration renumbered to 179 after a number
collision; applied by the owner as 179, ledger 001-179 confirmed before the
release). Exact-main CI 35358251790 and managed release 35358286475 passed on
`97238e1e89b9be8c9d751ac230e44a57aed49d12`. Accepted release
`v3-r35358286475-a1-97238e1e`; running app container reports the same OCI
revision, healthy, zero restarts; public health 200 on crm and app origins;
release arm read back `false`. Migration application itself was the owner's
separate manual action, not part of this automated run.


## Docs-intake baseline checklist — active 2026-09-18

A docs-intake case (176) is born without target_degree or a country-requirement
binding, so baseline document_slots never seed and staff add every item by
hand. Journal: docs/PLAN_CHANGES.md (2026-09-18, «staff baseline-checklist
seeding»).

- [x] Migration 179: case-scoped staff RPCs — compatible-version listing and
  atomic seed-and-bind (route NULL-fill only, exact-match otherwise, 053
  seeding semantics, one-shot binding, request-id replay), gated by the same
  document.manage case-operator check as custom slots.
- [x] Server action + row-validated read in the existing checklist-actions
  conventions; «Применить базовый чек-лист» form on the Documents tab shown
  only when applicable versions exist.
- [x] Scoped validation: eslint, tsc, build, extended checklist-action and
  profile-documents suites; migration source-reviewed, apply deferred to the
  standard manual release step.

Receipts (2026-09-18): implementation commit on
izzhackt/docs-intake-baseline-checklist; adversarial review closed three
verified findings (post-lock re-authorization per 053's pattern, read/write
playbook route-lock parity, bound-case form state). Checks: eslint clean, tsc
clean, next build compiled, checklist/profile-documents suites 17/17,
test:brand-ui 4/5 — the one failure is the pre-existing main-side
ProfileCaseDirectory regex already corrected in PR #840, untouched here.
Not exercised: migration apply and live-auth browser checks (no Supabase
credentials in this environment); apply follows the standard manual release
step.

Migration numbering correction: PR #841 already shipped the signup-conflict
correction as 178 before PR #844 merged another 178 for this checklist. The
checklist now uses 179; its executable SQL is unchanged. Preserve the existing
178 source and production history. Apply only the missing checklist 179 after
the corrected source is merged; do not repair or replay the applied 178.

## Admissions UX overhaul — active 2026-09-18

Owner requests a full UX/UI rework bringing Admissions to a finished product:
staff run their whole daily student workflow in the platform, students complete
their part in the portal. Presentation layer only; no SQL migrations (177 stays
reserved for PR830), no URL-contract changes, no new RPCs. Plan details:
docs/design/v3/admissions-ux-overhaul-run-plan.md; journal entry in
docs/PLAN_CHANGES.md (2026-09-18).

- [x] Foundation: one shared primitive set adopted from src/components/ui.tsx,
  single Card implementation, PartShell on every staff route, in-shell
  not-found/error pages, loading skeletons for heavy routes, distinct sidebar
  icons, quiet-UI and v3-brand-design invariants preserved.
- [x] Case workspace: persistent case header (student, direction, curator,
  stage, next action, blocker), case tasks and case help visible on Overview,
  Route tab degrades per-section instead of blanking.
- [x] Curator dashboard: admissions-first view of /v3/main from existing
  sources (my students, deadlines, overdue, blockers) without new backend.
- [x] Portal: shared-token styling replaces bespoke CSS modules, flat action
  queue with due dates, notification deep links and bulk mark-as-read over the
  existing per-item RPC, upload progress, explicit timezone labels.
- [x] Scoped validation: eslint, tsc, next build, test:brand-ui, touched unit
  suites; honest report of what was not exercised (no live-auth browser gate in
  this environment).

Receipts (2026-09-18): commits e9060538 (staff), bd5dc12f (portal), d2330a1c
(verified review fixes). Checks on d2330a1c: npm run lint clean, npm run
typecheck clean, npm run build compiled, test:brand-ui 5/5, affected
role/navigation/profile/portal suites 117/117. Known pre-existing failure not
introduced here: tests/v3-handoff-navigation.test.mjs fails on base 39999cc2
in this environment (react-dom/server named-export import under
--conditions=react-server). Not exercised: live-auth test:v3:gate browser pass
and production smoke (no live Supabase credentials in this environment);
production is unchanged by this slice. Addendum in PLAN_CHANGES.md covers the
/v3/main admissions route allowance and preview parity.


## Direct student creation in EVO Docs — active 2026-09-18

## Direct student creation in EVO Docs — released 2026-09-18

Owner requests **Добавить студента** directly in Docs and immediate production
delivery. A document workspace must not require a sale or Student login first.

- [x] Add a visible Docs header/empty-state action and a short existing-style
  form: student name, curator and optional direction; preserve entered values
  on validation failure and open the new case's questionnaire after success.
- [x] Create one canonical case and its access scope atomically using actual
  staff authority. Default the eligible curator to the current employee;
  preserve organization/own-scope rules and idempotent retry. No new Docs data
  store, sale, money/contract confirmation, Auth account or invitation.
- [x] Independently review the exact change, build and check only the changed
  real path; do not run a blanket suite or seed more test sales/students.
- [x] Apply the forward migration and ship through the existing short managed
  release; verify accepted runtime and the actual Docs entry/form on production.

Visual contract: calm light EVO workspace, one red primary action, short labels,
no explanatory banners or new sidebar design. Content order: title/action,
essential fields, create/cancel. Interaction feedback: existing focus styles,
disabled pending submit and actionable error; no ornamental animation.
Migration176 belongs to this accepted Docs slice. Student signup subsequently
merged in PR830 with migration177; its accepted release is recorded below.
An existing real-case/read-only check or rolled-back command is not evidence of
a newly saved customer record. Report the exact verification scope honestly.
Direct Docs origin permits no Sales owner; ordinary Sales-origin requirements
remain. Nullable Sales labels are handled in existing case/application readers.
Implementation follows [Supabase function authority](https://supabase.com/docs/guides/database/functions)
and [Next.js server actions](https://nextjs.org/docs/app/getting-started/mutating-data).

Source checkpoint: scoped ESLint and TypeScript pass. Actual migration176
compiled against managed175; actual Admin/MY password JWT claims were used for
the bounded SQL command check inside one transaction ending with ROLLBACK.
Own creation, Admin assignment, full case read, exact retry, changed-payload
rejection and denial of an unrelated curator passed. No durable student/client,
sale, Auth account or invitation was created. This is real SQL command evidence,
not a newly saved customer or a completed browser submission. Migration source
SHA256: `6d2aa086eaa62fd29f9c6f5c67ea237b25e5da9398c9dfe261b709843a1c9fa3`.
Independent review approved `80561d85066b02e0b0d3043d177eedb12a62225b`;
[PR #836](https://github.com/izzhackt/evo_AI_CRM/pull/836) merged as
`39999cc28e9438fac6bce07d197c52a592ec6c96`. Migration176 applied and its ledger
entry/source hash read back. Exact-main CI35338243745 and managed release
35338268320 passed. Accepted release `v3-r35338268320-a1-39999cc2` matches the
running image `sha256:5f01af84ce86d7a15f38f593e3201e0aeea8d76d527960a172913860434682b2`.
Acceptance record SHA256 `0fad6ab37b2fb7ac120db1e655aaead3f533be977e219dcff1cd4aaac535e510`
and browser receipt SHA256 `4c5e816702e57aff547cd79ffa5d8ac3ccb15df5d75995ca86c506d1c706e96b`
match server files. Runtime healthy, zero restarts, public health live, no pending
candidate; release arm read back `false`.

Actual production Admin and Admissions MY password sign-ins opened Docs →
Добавить студента, loaded real scoped curator options/defaults and returned via
Cancel; desktop1440/mobile390 passed with zero runtime errors. No form was
submitted, and no durable example student was added. Save behavior is supported
by the real transactional SQL proof above, not a persisted browser submission.
Entry: `/v3/profile?section=docs&new=student`.

## EVO Docs discoverability and focused UX pass — released 2026-09-18

Owner requests a visible EVO Docs entry and one practical UX pass across the
main staff screens. Reuse the existing case forms, uploads, generated artifacts
and partner ZIP workflow; do not resurrect the retired standalone Docs app.

- [x] Capture the actual staff screens, including document entry points.
- [x] Add a clear Admissions → EVO Docs entry with existing case access rules.
- [x] Link forms, files and ZIP work directly; retain the shared sidebar design.
- [x] Correct concrete quiet-UI/mobile/navigation problems found in this pass.
- [x] Short real browser checks on current source as Admin and Admissions MY;
  desktop 1440/mobile 390, scoped list → forms/files/ZIP and preserved context.
- [x] Managed production release and post-release readback; no blanket suite.

Current-source acceptance: real password sign-ins, existing authorized data,
ZIP auto-open/toggle and navigation passed with zero runtime errors and no
business writes. Typecheck, changed-file lint and all 16 navigation checks passed.
Independent exact-head review approved `d184ea11` after the page-specific empty
state copy fix; PR #833 merged as `d4594a0bf28b7bbc395d65a8cf0481c25198279a`.
Production release 35302956533 accepted that revision. Exact accepted/running
image and receipt hash match; healthy, zero restarts, no pending candidate,
release armfalse. Ordinary production Admin and Admissions MY repeated the
changed Docs and mobile paths successfully, without business writes. See the
[UX receipt](design/v3/references/2026-09-18-docs-visible-ux-pass.md).

The owner additionally authorizes one clearly labeled invented sale through the
real sales form to prove handoff. Use a reserved non-deliverable email, no real
phone, no payment/contract confirmations and no customer communication. Record
its identity and outcome separately; never present it as real business data.

## Shared staff roles and report handoff — released 2026-09-18

Owner approved all decisions in the [staff activation plan](design/v3/staff-sales-handoff-run-plan.md).
Use reusable roles, department-head/own-record scope and immediate new-sale
handoff to the selected curator. Do not alter historical reports or invent
contract/payment confirmations. Permanent staff credentials remain private.

- [x] Shared roles, role-derived confirmation rights and independent directions.
- [x] Atomic new report sale → one canonical case → selected curator implemented.
- [x] Permanent staff accounts, configured Admin login alias and encrypted delivery.
- [x] Scoped real checks, independent review, managed light production release.
- [x] Actual employee sign-in and effective-access readback.

PR831/832 shipped as accepted `99ac5aa3d76b14dfed4b0d12d30a5f46fb46a651`,
release35300843417. Exact running image matches the accepted receipt; healthy,
zero restarts, no pending release, armfalse. Five real password sign-ins and
role scopes passed; old209 sales rows unchanged. Subsequently one explicitly
authorized synthetic sale passed the ordinary Sales Manager form → report
readback → assigned curator login and case opening. Contract/payment remain
unconfirmed, no amounts or outgoing messages. Test case is recorded in the
staff activation plan; this is not real-customer acceptance. The separate Docs
UX release is recorded above.

## Public Student onboarding and clear product copy — released 2026-09-18

Existing Student re-registration correction is released: PR #841, runtime
`0156d965`, migration 178, accepted run `35345749947`. Both intake routes now
open the verified existing portal; terminal conflicts return immediately.
Actual browser and server readback passed; release is disarmed with no pending
candidate. [Scoped evidence and limits](qa/student-signup-conflict-178-2026-09-18.md).

Owner requests a public questionnaire followed by account creation and Admissions
approval. Full portal access starts only after approval (explicit confirmation).
Follow [the active onboarding contract](design/v3/public-student-onboarding-run-plan.md).
Reuse existing Supabase Auth, Admissions and Student profile; preserve private
assessments. Include bounded settings/CRM/Portal copy cleanup. No invented
matching claims or invented email-delivery proof. The owner now explicitly
selects signup **without email confirmation** and asks to complete the release.
Keep public Auth signup disabled and global confirmation settings unchanged.
A bounded server action creates only a new identity via Auth admin.createUser
with email_confirm=true, then uses normal password login. Durable service-only
rate buckets limit creation; duplicate identities are never updated or adopted.
A live Auth session submits the questionnaire, then Admissions approval
alone activates the existing portal. SMTP is not required for this signup flow.
An auto-confirmed Auth timestamp is not proof of mailbox ownership.

The bounded12-file copy cleanup shipped earlier in PR828, accepted `2908a0db`,
release35292232876. Student PR830 integrated accepted Docs176, independently
reviewed `5323f23321505a27d0e70b6ce2fdd3c9aff04555`, passed protected checks
`35340251635` and merged as `1de14c0ad02b97b5b576060864574ee70e9e8508`.
Production177 and ledger001–177 are confirmed. Upstream `35340610391` and managed
`35340641026` passed; release `v3-r35340641026-a1-1de14c0a` is accepted.
Image/receipt hashes match server readback, runtime is healthy with 0 restarts,
both domains' health is live, pending=false and arm=false. All Auth settings
remain unchanged.

Actual local QA completed nine-step signup, pending/portal denial, existing
Admin RPC approval, full portal and password relogin; 11 security-delta checks
also passed. Previous35/QA172 records remain historical. Production verification
covered existing-Auth browser smoke and anonymous `/apply`: all nine steps to
account creation, reload retention and visible mobile390 controls. No identity or
consent was entered or submitted; no new production Student or staff approval
submission was performed. Local business-path proof is not a production signup
or real-customer acceptance claim. Exact release, migration and evidence hashes:
[production receipt](qa/student-public-onboarding-177-production-2026-09-18.md).

## Quiet UI and Admin role preview — released 2026-09-18

Owner approves moving the Admin-only role preview out of the shared sidebar
into Settings → Roles and access, and requests one bounded UX audit. Additional
direction removes the chat keyboard hint, always-visible character count and
normal draft caption. This is a small UI release, not an authorization redesign.

- [x] Put «Посмотреть интерфейс роли» in role settings, Admin only. Keep an
  obvious «Вернуться к Администратору» action while preview is active, including
  routes where role settings are unavailable. Preserve actual server authority.
- [x] Remove normal composer helper captions/count; retain Enter/Shift+Enter,
  draft persistence, send/save feedback, errors and the 8,000-character limit.
  Explain the limit only when it prevents sending. Do not change global shell
  styling or create new staff messages for acceptance.
- [x] Record the quiet-UI principle in DESIGN.md and agent guidance: everyday
  controls should explain themselves; show actionable exceptions/context, not
  permanent technical narration. Preserve accessible labels and real feedback.
- [x] One short current-screen UX pass; record prioritized findings and visual
  proof limitations. Other redesigns are recommendations, not implied approval.
- [x] Scoped real UI checks, changed-file lint, independent review and the
  established light production release with rollback. No migrations, staging,
  provider activation or broad test replay.

Implementation and scoped real-browser observations are recorded in the
[quiet-UI pass](design/v3/references/2026-09-18-quiet-ui-pass.md). PR827 shipped
as accepted revision `4e6a452c19ee8a3ab7f7cb84fe842ea53b4eece7`, release
`v3-r35291480338-a1-4e6a452c`. Live/accepted image and acceptance hash match;
container healthy,0 restarts, pending absent, CRM/app health200, armfalse.
Separate Admissions-preview transition remains unconfirmed after browser-control
interruption; the full Sales-preview/denied-page/Admin-return path passed.

Visual thesis: existing calm EVO workspace, less peripheral text. Content:
business work first, rare Admin tools in settings. Interaction: familiar chat
input and a clearly reversible role-view mode, without changing permissions.

## University photo refresh — released59, scope closed 2026-09-18

Owner requests fresh, high-quality real university pictures on
`app.evoadmissions.com`. Follow the [photo refresh plan](design/v3/university-photo-refresh-run-plan.md):
audit all143 used photo keys, replace obsolete/poor images using verified current
campus sources, preserve truthful dates/attribution and existing keys. JSON-only
content refresh needs no schema, data or catalogue republication. Validate real
Student rendering and image decoding, exact-head review and the accepted
lightweight managed release. Record retained/unresolved sources honestly;
providers and private Student data are outside this change.

Latest owner direction stops further selection and requests saving/deploying
the completed work. Freeze59 replacements; preserve38 retained and46 unresolved
entries. Withdraw the HZNU candidate that failed real EVO embedding. See the
[143-key source ledger](design/v3/references/2026-09-18-university-photo-audit.json).
Do not claim all photos are recent or the interrupted full browser sweep passed.

The owner-frozen59 replacements shipped with chat in accepted revision600e11416,
release35289102489. The photo task additionally verified real Student AGH and
INTI cards after release, including decoded1280×964 and2560×1440 images.
Further selection remains stopped; the full143/mobile sweep is not claimed.

## Team chat Messenger — completed 2026-09-18

Owner approves direct production with light checks. This block removes the two
explanatory chat strings and the mute feature. After seeing all three grounded
visual concepts, the owner selected option2 (Messenger) during this run.

- [x] Remove normal-success status copy, internal-chat hint, mute/unmute controls
  and quiet-channel badges. Keep connection errors/recovery, live messages,
  history, unread counts and mark-read behavior.
- [x] Remove mute commands server-side and the mention-notification mute filter
  through one forward migration. Preserve messages, read cursors, receipts and
  inert compatibility fields; no destructive schema cleanup or provider work.
- [x] Changed-file lint, narrow actual-function checks, independent review, and
  the existing lightweight immutable release with rollback. Apply only the new
  migration through the established operator path; no full DB replay.
  The PR migration job uses a narrowly gated source-contract path for sole
  additive171, not the historical full DB harness or a claim of runtime proof.
- [x] Verify real authenticated production chat, absent removed controls/copy,
  retained channel/history navigation and healthy accepted release. Do not send
  staff messages or create accounts solely to manufacture acceptance evidence.
- [x] Show three distinct larger chat mockups; owner selected the second image.
- [x] Implement selected Messenger only inside the chat workspace: unchanged
  global left navigation and top utility bar, channel list and full-height
  conversation below the existing header; neutral incoming/soft-red own
  bubbles, fixed accessible composer, original EVO branding. Use only existing
  real data; do not invent channel previews, staff, messages or presence states.
  Preserve responsive channel/back navigation, threads, search, message actions,
  drafts, permissions and realtime. The shared shell stays identical on every
  page, including chat, per the owner's subsequent explicit correction.
- [x] Short real browser visual check of desktop/mobile and channel/thread
  navigation; no full suite. Deploy together with mute removal, not twice.

Accepted production revision `600e11416e0dff7021167253400d9fe72ffd11cc` includes
PR823 chat, separately reviewed PR824 university photos and PR825 source-check
correction. Migration171 is applied; actual authenticated production chat and
existing case/Student smoke passed. Healthy, pending absent, release arm false.
See the [release receipt](design/v3/references/2026-09-18-team-chat-release.md).
Local desktop/mobile visual proof passed; the optional post-release desktop
Chrome control timed out, so it is not claimed as a second visual acceptance.

Function replacement retains dependencies/permissions when signatures remain
unchanged: https://www.postgresql.org/docs/current/sql-createfunction.html.

## Lightweight production release — completed 2026-09-18

Owner explicitly approves replacing the heavy release prerequisite and deploying
the case-opening fix and reviewed Student portal UX now. Current mode is build,
short real checks of changed functions, and rollback; no full-suite replay.

- [x] Keep exact-current-main admission and existing workflow identity, but make
  `EVO platform CI` / `Main CRM` a truthful lightweight release-control check.
  Remove its blanket database/browser replay, full Node suite and dependency
  audit. Build the immutable image once in the downstream release workflow.
- [x] Keep image/artifact provenance, live main/arm checks, read-only schema
  ledger guard, exclusive deployment, public health and the existing rollback.
  No migrations, schema replay, provider activation or customer-data writes.
- [x] Extend the short production browser smoke to open the existing approved
  case (route and contract) as real Admin and overview/documents as the existing
  permanent QA Student. Credentials/case ID stay private; missing inputs or a
  failed real path fail the release and trigger pending-candidate rollback.
- [x] Merge independently reviewed PR820 and this release change using protected
  short PR checks, dispatch exact main, and accept only the actual immutable
  release with successful short production smoke. Never call that full-suite
  or real-client business acceptance.
- [x] Record deployed SHA, workflow result, healthy container, cleared pending
  state and disarmed release state. No unrelated heavy checks or Docs exports.

Implementation checks: four selected actual-file release contracts, six smoke
configuration/filesystem/source checks, changed-file ESLint, shell/Node syntax,
YAML parsing and whitespace check pass. These are not real UI acceptance; that
comes from the downstream production browser run. PR820 merged as61a1945c;
its reviewed portal patch and earlier actual QA browser results are unchanged.

Production receipt: PR821 merged as`ac04c8e38de7b27aadc1c926db40f65007b3c593`.
Light exact-main CI35276171822 succeeded (Main CRM9s); managed release35276212272
succeeded and accepted`v3-r35276212272-a1-ac04c8e3`. Real browser smoke took22s:
Admin login/dashboard/version, exact case route/contract, separate Student login,
overview, documents and sidebar return all passed. Container healthy/restart0,
accepted pointer matches, no pending pointer, arm=false; both domain health
routes200 with ordinary TLS. No heavy suite or business/provider writes.
Detailed [release receipt](design/v3/references/2026-09-18-lightweight-production-release.md).

Official workflow-run semantics: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run
and https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow.
Context7 was attempted but its monthly quota is exhausted.

## Admissions case opening and fast execution — completed 2026-09-18

Owner requests a targeted fix for opening an existing Admissions case and
scope-local real validation, not another heavy unrelated suite. Portal UX work
runs independently in a separate task; no employee invites, provider activation,
new clients, schema changes or fake Sales handoffs belong to this fix.

- [x] Reproduce the actual production case error and isolate its read boundary:
  digest3116888569 maps to `oneRow` in the Student handoff repository. The real
  authenticated Admin RPC succeeds200 with zero Sales handoff rows.
- [x] Replace blanket heavy-suite instructions in `AGENTS.md` with focused real
  checks. Existing enforced automation is not bypassed or declared satisfied.
- [x] Represent the legitimate absence of a Sales handoff explicitly. Keep
  real RPC errors, malformed responses and mismatched linked-lead context fatal;
  keep case permissions and all non-handoff case work intact.
- [x] Real regression: existing Admin Auth + real Supabase on unchanged persisted
  case. Before: production route500/digest3116888569, repository unavailable.
  After: local candidate route/contract/anketa200 with actual case content,
  contract workspace and partner-package section. Anonymous request307 to login.
  Two directly affected source-contract checks, changed-file ESLint and diff
  check pass. No case/file/account/provider writes and no full suite.
- [x] Review/publish the bounded patch. PR819 merged63a8b856; productionac04c8e3
  now includes it and PR820 portal UX. Above owner-approved lightweight release
  exercised the actual case route and contract on production successfully.

## amoCRM connection simplification — active 2026-09-17

Owner requests a more flexible connection without unnecessary rules. A bounded
read-only check at14:37 UTC found that the current app lacks its amoCRM account
URL/token binding and both enablement flags are false. The retired lead-agent
is absent; retained OAuth credentials exist, but one real account GET returned
401. No refresh or provider mutation was performed. This is a missing current
binding plus rejected access token, not proof that flags caused the outage.

- [x] Replace the duplicate `EVO_V2_AMOCRM_PROVIDER_AUTHORIZED` gate with the
  single explicit `EVO_V2_AMOCRM_WRITES_ENABLED` switch (default0). Update every
  active harness so its unauthorized mode still sets writes to0.
- [x] Preserve staff permissions, account/routing discovery, private token
  storage, idempotency and reconciliation. No automatic provider activation,
  legacy-writer fallback, token refresh/rotation or customer writes.
- [x] Scoped configuration/harness checks:38/38 pass; changed-file ESLint,
  script syntax and whitespace checks pass. Independent exact-head review is
  required before merge. No full release rerun or provider write was performed;
  do not claim deployed or connected while the existing release blocker remains.
- [ ] Separate follow-up: provision an explicitly approved current integration
  credential, bind its private file read-only to the app (readable by runtime
  UID1001), verify account access, discover the actual account's routing options
  instead of asking the owner to locate technical IDs, then enable the single
  switch for an agreed real operation. The tracked production Compose currently
  has no token-file mount; an environment path alone does not provision one.

The old OAuth file is not the current long-lived-token storage contract. Do not
silently mount it or revive the retired worker. Official amoCRM supports private
long-lived tokens without refresh logic; a current token still must authenticate
against the exact account: [token documentation](https://www.amocrm.ru/developers/content/oauth/step-by-step),
[account endpoint](https://www.amocrm.ru/developers/content/crm_platform/account-info).
The documented current token-file path and `.env.amocrm` are absent from both
the canonical local checkout and VPS checkout. This limited inventory does not
claim that no credential could exist elsewhere. On upgrade, `WRITES_ENABLED=1`
becomes the sole operator enablement decision; do not retain a value of1 while
expecting the removed second flag to block execution. Current production has0.

## Current checkpoint — 2026-09-17 12:24 UTC

- **Inbox dependency work complete:** PR811 merged; PR701/702 superseded.
  The retired companion was not deployed or reactivated.
- **Lightweight live integration check complete:** current readiness only;
  WhatsApp pairing and amoCRM operations are not accepted. See next section.
- **Portal performance code merged, not deployed.** Latest frozen-main
  CI35219750669 at `1d0a64afa6f500448aa5aefb1cf98987601e3923` failed at
  `COLD_EXPORT_HISTORY`; release35220644955 was skipped, arm remains false.
  Production retains accepted `41394497fa61d37d543091e9b22f8b62902c09bb`.

The new CSS proof passed all24 staff viewport/route combinations. TLS,18 staff
scenarios, immutable Storage, isolated provider-surface checks and D2 draft/final
generation/download/exact replay also passed. Both POSTs finished normally in
this observation; that does not prove the intermittent cancellation fixed.
The failure occurs while opening export history in a **new page of the same
authenticated context**, not a new login. The log does not expose which history
assertion failed; no workflow artifacts were retained. Cold-history downloads,
ZIP acceptance and later negative-dev gates are not proven by this run.

Next bounded task: expose a safe error category/substage for that existing cold
history assertion, then fix the evidenced cause. Keep original persistence,
historical-version, immutable-byte and access assertions. Do not rerun the same
failed revision, invent a cause, weaken the gate or deploy around it. No further
full run was dispatched in this lightweight-check pass. Fresh read-only ledger
35219785624 matches170/170 with empty differences; no migration apply is needed.

## Lightweight live integration check — approved 2026-09-17

Run in parallel with the already-running Portal release gate; no additional full
suite, unchanged rerun, demo data or broad integration audit. Reuse current valid
evidence and inspect only the actual configured services.

- [x] amoCRM: inspect current authorization/configuration and attempt only
  available read-only evidence. Active canonical CRM has no amoCRM configuration;
  writes and provider authorization are disabled. An authenticated account read
  could not be performed with current runtime access. Historical connection is
  not proof of current operation.
- [x] WhatsApp: authenticated private WAHA health returned200/ok; `crm_primary`
  returned `SCAN_QR_CODE`, not `WORKING`, at 11:58 UTC on 2026-09-17. No QR or
  session mutation was requested. CRM ingress is disabled, webhook HMAC absent,
  and no enabled runtime binding was found.
- [x] Record the small check without expanding scope: recent-message aggregate
  reads were denied403, so incoming/outgoing operations are **unconfirmed**,
  not zero. No further privileged access or provider activation was attempted.
- [ ] Later, with approved connection details, restore current amoCRM access and
  verify one agreed real operation; pair an agreed WhatsApp number only after
  explicit connection approval, then verify authorized incoming/outgoing traffic.

Health/configuration reads are not business acceptance. Keep credentials,
phone numbers and raw messages private. Pairing and real traffic verification
remain deferred; do not reconnect/reset/logout or message clients now.

## Student Profile response cancellation — active 2026-09-17

Owner approved investigating the release blocker and completing the Portal
deployment. Start from merged main `efd53076`; Inbox maintenance is complete.
Keep the existing failed request/body assertions, real Auth/PostgreSQL/Storage,
private data boundaries and managed release gate. Do not fabricate successful
responses, retry a mutation blindly, activate providers or alter working cases.

- [x] Establish a bounded feedback loop for the exact document-export draft
  POST using the existing isolated profile proof; record whether it reproduces.
  A cold profile-only run is not equivalent to the warmed full-CI predecessor
  sequence, and a single green run does not prove an intermittent bug fixed.
- [ ] Distinguish client cancellation, proof lifecycle and development-runtime
  behavior with actual request events and narrow official-source research.
  The approved production-build comparison also changes local Supabase HTTP
  to TLS; these two factors prevent a causal claim about runtime alone. It is
  not a presumed remedy or permission to weaken checks.
- [ ] Independently review and merge the diagnostic change, then run the
  frozen-current-main full gate once. If red, retain the blocker and fix only
  an evidenced cause in a new reviewed candidate. If green, the already-reviewed
  Portal changes may use managed release with the unexplained intermittent
  cancellation explicitly still open. Verify accepted SHA/image/health/pending/
  disarm and real Student navigation; a green run is not a cancellation fix.

The first profile-only run on `efd53076` passed against its owned local Auth,
PostgreSQL and Storage: original draft/final POSTs finished, persisted exports
and cold history passed, cleanup completed. Evidence is the ignored local
`output/student-profile-fields/efd53076a60b8423306fa4c4d68660c841d72447/foundation-19334-47451/`.
The cancellation remains unreproduced locally, not fixed. The next Linux
observation adds only a passive, enum-only export-panel status to the existing
body-transport failure evidence; original failure and release gates remain.

Update: that single Linux observation (35212637934, `9c9d2a4e`) reproduced the
failure with `exportUiState=READY`: the application validated the successful
receipt before the browser/network body inspection failed. Product stream
cancellation is not established as the cause. Next is the documented bounded
production build/start comparison against the same isolated services, full
post-provisioning predecessor order and unchanged assertions. Production stays
disarmed; see the latest PLAN_CHANGES entry for mode and build-binding rules.

The production profile-only proof passed locally on `6e4f22a8` (PR814), but
full Linux run 35215643933 on `31df7111` stopped earlier at two staff Storage
download assertions. These APIs redirect to Storage; Node-only TLS trust did
not establish browser trust. No retained trace proves the timeout's precise
cause, and Student Profile was not reached. Complete run-owned browser NSS
trust and real negative/positive TLS preflight without changing machine trust,
HOME, product code, assertions or predecessor order. Observe one new reviewed
exact-main run; do not reuse the failed run as release evidence. Ledger check
35215849593 confirmed all170 versions match, so no schema apply is needed.

PR815 completed run-owned browser trust. Run35217820587 at `7f475686` proved
negative certificate rejection, positive browser/Node200 and all18 applicable
staff scenarios, including the original Storage downloads. It then stopped at
the old styling guard: 77,438 stylesheet characters were below its arbitrary
100,000 threshold, before checking applied styles. This is not proof of broken
CSS. Replace the size heuristic with runtime-independent actual stylesheet and
rendered-theme integrity checks, following the existing Student styling proof;
retain the original layout/accessibility and later business assertions. Run
only the focused changed check before one reviewed exact-main release gate.
Student Profile was not reached; production remains unchanged and disarmed.
Fresh ledger35217974366 confirms170/170 versions and empty differences.

Focused CSS-guard proof: the existing local production build
`pf2fwmZqRVJAsmwIzDs40` first returned a real CSS404 and was correctly rejected.
With its own matching static/public assets, anonymous login passed desktop,
mobile and dark-system checks (HTTP200, loaded CSS/font/logo and applied theme;
no POST, external request or page error). This reused older unchanged UI output,
not the frozen CI build, and does not retroactively prove the77KB artifact.
Owned temporary runtime was removed. Ten source-contract checks, scoped lint,
syntax and whitespace checks passed; full exact-main gate remains required.

Current [Next.js Playwright guidance](https://nextjs.org/docs/app/guides/testing/playwright)
recommends a production build for realistic browser validation. Context7 was
attempted again; its monthly quota remains exhausted. The prior red/green logs
both contain HMR `built` during the POST, so that event alone is not causal.

## Portal latency and Inbox dependency maintenance — Inbox complete; portal release blocked 2026-09-17

Owner approved these two checklist items. This is a bounded performance and
dependency run, not a redesign, provider activation or a second product launch.
Keep the existing production database, permanent QA Student, staff accounts,
private assessment authority and host-only sessions. Canonical dirty checkout
is preserved; work starts from current GitHub main in isolated worktrees.

- [x] P1: measure real authenticated Student section transitions and inspect
  server data/auth calls. Record before/after on the same execution path; browser
  automation overhead is not application latency. Change only evidenced waste
  (duplicate same-request reads or independent reads serialized unnecessarily).
  No cross-request private-data/authority cache, auth bypass or weakened checks.
- [x] P2: inspect current Inbox lockfile, advisories and PR701/702 failures; apply
  the smallest complete dependency correction and run actual install, audit,
  scoped checks and build. Distinguish stale PR/alert state from unresolved code.
  Inspect the deployed boundary read-only. Do not resurrect a retired companion,
  modify WAHA sessions or recreate the shared edge to publish library updates.
- [ ] P3: independently review exact diffs and plan freshness, publish/merge the
  validated slices, and supersede obsolete dependency PRs with explicit evidence.
  Run the production app's existing full gate once on the frozen release SHA;
  use the managed release and verify accepted SHA/image/health/pending/disarm.
  Repeat real Student navigation, own-case reads and staff-access denial.
  If Inbox is not an active runtime, report repository remediation separately
  rather than inventing a deployment or claiming provider acceptance.

Real validation reuses the authorized QA identity; do not create test employees,
new cases or assessment answers. No fixtures/mocks stand in for timings, auth,
provider success or dependency audit. Missing real access is a named blocker.
Retain persistent portal navigation and unsaved-answer protection. No DNS,
email, website, business data or unrelated dependency-wide upgrades in scope.

Implementation references: [React request-scoped cache](https://react.dev/reference/react/cache)
and [Next.js caching model](https://nextjs.org/docs/app/guides/caching-without-cache-components).
Context7 was attempted but its monthly quota was exhausted; consult official
docs/advisories and the installed Next.js documentation instead.

Diagnosis: route-entry notification polling immediately calls `router.refresh`
on operational pages, redundantly requesting fresh server content already being
loaded. Preserve the initial badge read but refresh content only on subsequent
timer/focus/online/manual updates, with stale-effect completion ignored. Also
deduplicate the layout/page Student guard only within a React render request,
and run independent application/visa list and timeline reads concurrently.
Proxy authorization order and all RPC validators remain unchanged. Baseline
Chrome observed real page responses around 0.9–1.74s and the extra route request;
these are response-header observations, not completed-render percentiles.

Portal candidate `95a3fd35` checkpoint: production build, scoped ESLint,
typecheck and 19 source-contract checks passed; independent code review found
no issues. Real Chrome reused the permanent QA Student against the existing
database. Applications navigation before: GET at 0ms, badge POST at 28ms,
redundant GET at 1975ms. Candidate: GET at 0ms, badge POST at 185ms, no second
entry GET; the periodic POST at 30186ms and GET at 31457ms still occurred.
The local candidate and public production have different network paths, so do
not turn their response timings into a claimed percentage speedup. The rendered
screen and shell passed; console errors came only from a Chrome extension.

A separate real SDK-authenticated candidate probe confirmed two consecutive
overview requests each execute one proxy authority read and one shared render
authority read (not a retained result between requests). Application/visa list
RPCs began in the same millisecond; own pages returned200, staff audit returned401,
and a following anonymous request redirected to login. Only the probe's new
session was signed out. No rows/accounts/assessment answers were changed. Empty
QA applications prove the list-wave overlap, not live populated timeline paths.
Portal code is merged in [PR #810](https://github.com/izzhackt/evo_AI_CRM/pull/810)
as `7ba78dfd409554051c150461e31e62f95d964238`, but is **not deployed**.

Inbox reviewed source `8894e83a493a8a6e0fa1abfeaa981c2e4e3e41d1`
([PR #811](https://github.com/izzhackt/evo_AI_CRM/pull/811)) passed independent
review and [its exact-head CI](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35203691579).
Next.js/eslint-config-next are 16.3.5, Sharp 0.35.4, js-yaml 4.3.2 and
Vitest/@vitest/mocker 4.1.11. Actual npm install, full dependency audit (zero
vulnerabilities), typecheck and production build passed. Lint has no errors and
11 existing warnings. Twelve pure helper tests run without the archived Vitest
config or any dummy provider environment; classifier and release-policy checks
also pass. PR811 is merged as `1954cab06525149bfeb5ad444e32194bd104bfdf`;
superseded PR701/702 are closed. GitHub's open Dependabot alerts read back as
zero after merge. The historical full Inbox suite is not a live acceptance gate:
its three previously observed legacy topology/migration/bucket expectations
remain outside this bounded dependency correction.

Only the two Inbox package-manifest paths are newly admitted by the classifier.
Their dedicated CI job must pass when selected; failed/cancelled/skipped jobs
and unknown sibling paths still fail closed. No retired service is started.
The production CRM image excludes `agent-lead2-inbox`; this archived-source
maintenance does not require reactivating or deploying the old companion.

Production release is blocked: full CI
[35203650319](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35203650319)
passed current-main admission, dependency audit and Node/static checks, but the
database/browser gate failed in the existing Student Profile draft-save proof.
It recorded `DRAFT_BODY_TRANSPORT`, `RESOURCE_DATA_MISSING`,
`Network.getResponseBody`, `ERR_ABORTED`, requestFailed=true and no main-frame
navigation; the page/browser remained alive. Earlier release runs recorded the
same signature. This establishes a canceled response, not the initiating cause
or a portal-performance regression. Do not suppress the assertion or blindly
rerun until green. Diagnose that separate gate before the next release attempt.

After this failure, the release arm was set to `false` and read back. Inbox was
then merged independently. Read-only VPS verification confirms accepted source
`41394497fa61d37d543091e9b22f8b62902c09bb`, release
`v3-r35172861130-a1-41394497`, image
`sha256:91218814ece4c411edddf80a49e233561304cd8c9942cdfb16ed8a92236dc058`,
acceptance SHA256
`30f2c74d79a2986b4ec85037ffe5d7de23484094786379b0d6db0cec6b24ff28`,
healthy with zero restarts and no pending release. No production deployment,
data change or post-release browser success is claimed for this run. The
temporary candidate server was stopped; the owner's production tab stays open.

Resume: agree the bounded Student Profile response-cancellation investigation,
fix only an evidenced cause and obtain independent review. Fetch current main
(which now includes Inbox maintenance), freeze its exact SHA, then run one full
release gate and the managed release. Verify the accepted server receipt and
repeat real Student navigation/own-case/staff-denial checks; disarm/read back.
P3 stays open until this production acceptance, not merely a successful build.

## Real Student login and stable navigation — accepted 2026-09-17

Owner requests retiring the Admin Student preview from CRM and using one
permanent, separate QA Student login on `https://app.evoadmissions.com` instead.
This supersedes the active preview requirements in #721/AGENTS/DESIGN, not
historical receipts. Existing Admin credentials, real students and their data
remain unchanged. One explicitly requested test Student is allowed; this does
not authorize a fake authentication path, universal test password, impersonation,
synthetic provider success or general production seeding.

Current accepted source: `41394497fa61d37d543091e9b22f8b62902c09bb` ([PR #808](https://github.com/izzhackt/evo_AI_CRM/pull/808)).
Full CI [35172153854](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35172153854)
and managed release [35172861130](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35172861130)
passed. Release `v3-r35172861130-a1-41394497` is accepted on Hermes; running image
`sha256:91218814ece4c411edddf80a49e233561304cd8c9942cdfb16ed8a92236dc058`
matches the immutable record. Acceptance SHA-256:
`30f2c74d79a2986b4ec85037ffe5d7de23484094786379b0d6db0cec6b24ff28`.
Healthy, zero restarts, no pending-current record, both host health endpoints
HTTP 200; release arm set and read back `false` after acceptance.

Real production Chrome: an existing staff session on app now sees the Student
login form; ordinary QA password sign-in reaches its own portal. All seven
sections render, shell remains during transitions, saved QA assessment progress
survives reload, logout and fresh login work. CRM remains signed in as Admin and
has no Student-preview link; its separate staff-role preview is intentionally
unchanged. Old `/preview/student/payments` returns HTTP 404. A separately reviewed
process-only check used a genuine SDK-issued QA session: own `/portal` 200 then
staff `/api/platform-audit/export` 401, with local-scope session cleanup confirmed.
Chrome's extension blocked direct API navigation, so that browser attempt is
not counted as HTTP denial proof.

Handover: reuse this one permanent QA account and existing database. Owner's
canonical local checkout contains ignored mode-0600 `.env.student-portal-qa.json`
with the login/password; never commit or print it. Do not recreate the account,
reset its password or restore preview as a convenience. The fictional case is
visible in Admissions but has no Sales/client/payment facts. One English answer
was saved only to prove persistence; this is not real-client business acceptance.
Remaining network/server response time is not eliminated: observed browser
section checks took roughly 1.5–3.6 seconds including tool overhead. This release
removes the disappearing shell and broken login, not all latency or auth checks.

- [x] Reproduce the reported transition in real authenticated Chrome. On the
  accepted production preview, Payments → Documents showed only the global
  preview loader at 340ms, no navigation, and completed at 1001ms. The preview
  renders PortalShell inside its catch-all page rather than a persistent layout.
- [x] Remove the preview routes, sidebar entry, preview-only renderers/readers,
  obsolete route exceptions and implementation-only tests. Keep real Student
  portal, published catalogue and assessments; old preview URLs must not render
  a parallel portal or fall back to Admin impersonation.
- [x] Verify/improve real Student navigation on the candidate: preserve shell and useful pending
  feedback; eliminate demonstrated duplicate work only. Keep current identity,
  role/RLS checks and assessment unsaved-change protection. Never cache private
  authority/data between users or requests to improve timings.
- [x] Provision exactly one permanent QA Student using confirmed owner-controlled
  email and supported Auth/provisioning lifecycle. Reuse the existing Supabase
  project; keep the QA case out of working Sales reports and provider sends.
  Do not fabricate an invitation receipt or mutate auth.users directly. Missing
  mailbox/provider/lifecycle access is a named blocker, not a success substitute.
  Store credentials only in an ignored 0600 owner handoff; never in code/logs/chat.
- [x] Real Student password login, refresh and section navigation on app; verify
  persistent shell, actual persisted test-student data, staff/private denial,
  sign-out, mobile usability and removal of preview from CRM. Record timings
  separately from authentication/functional proof; don't claim instant networking.
- [x] Scoped checks, independent exact-head review, PR merge, one frozen-main
  full gate and managed release; production readback and same real Student
  browser proof, then disarm and publish receipt. No unrelated provider/DNS work.

The proposed login is a plus-address of the Gmail mailbox already approved by
the owner in this task history; no unrelated recipient or email send is added.
Normal SMTP availability and the exact case/provisioning path are checked before
any account write. Keep the exact login only in the private operator handoff.
The owner retains website-inquiry and Gmail-delivery checks from the prior run;
those are not reopened by this narrowly requested Student login.

Historical pre-release implementation checkpoint: nine preview-only source files and
their dedicated test are removed; old preview paths are pre-auth 404 tombstones.
The real Student layout already preserves PortalShell above its child loading
boundary, so no unmeasured auth-cache or navigation rewrite was added. Scoped
checks passed: 69 route/UI/catalogue tests, 10 CI-manifest tests, ESLint,
repository typecheck and diff-check. Independent source review found no issues
at non-plan diff SHA-256
`666cf9a463df0a7a5274bd0e908af4747bcb5d3b4e4530020db8ab975787b9e6`.

Production read-only inventory on 17 September found no Student memberships,
cases or provisioning receipts to reuse. Custom SMTP remains off; provider OTP
expiry is 3600 seconds. A real manually delivered Supabase invite link is a
supported alternative to email delivery, not yet executed at that checkpoint.
Account setup and a real Student browser journey were the release gate;
removing preview code is not itself proof of an operational replacement login.

Approved narrow implementation path: operator creates one visibly fictional
pending case and its case scope only, with no lead/client/payment/contract facts;
existing Admin authorizes `legacy_pending` provisioning and owns curator duties
under current capability rules. Reuse the normal coordinator/receipt/finalize
guards with a real Supabase `generateLink(type: invite)` provider operation.
Record delivery honestly as a private manual link, not an email. Consume the
real one-time token and set the requested QA account's password using supported
Auth operations; verify real Student authority and fresh password login.
No direct auth.users changes, auto-confirm flags, fabricated timestamps,
synthetic domain receipts, new staff account or new tenant are allowed.
Independent operator-script review precedes any bounded production writes.

17 September execution checkpoint: independently reviewed operator completed the
bounded QA case bootstrap, real manual invite, real OTP acceptance and password
setup. Fresh password authentication and own-case Student authority passed.
Credentials and receipts remain in a protected ignored owner handoff; no email
was sent, and no Sales/client/payment facts were created. This supersedes the
pre-execution inventory above, not the still-open browser acceptance gate.

The first normal browser sign-in exposed a separate existing-session bug:
`/login` proxy redirects authenticated POST requests before the login action can
read the submitted credentials. An existing staff session on the Student host
then returns the browser to CRM. Extend this slice narrowly: let login POST reach
the normal password action and show the intended host's login form when the
existing session belongs to the other audience. Preserve CSRF/origin validation,
real password verification, current authority checks and host-only cookies.
Regression-test this boundary, then prove the candidate in a real browser before
claiming the replacement workflow accepted. No session injection or auth bypass.

Candidate checkpoint: real Chrome at loopback port 3114 used only publishable
configuration against the existing database, not a second data source. Normal
Student password login, account/case readback, saved assessment progress after
reload (one QA answer), staff-page exclusion and normal logout passed. Shell
remained visible during Payments/Documents/Applications/Universities/Tests
transitions. Navigation observations are development observations, not production
latency guarantees. Mobile menu at 390px opened without horizontal overflow.
Old preview URL returns HTTP 404. The local process holds no service/provider key.

Login-routing delta passed 39 focused tests, ESLint, normal typecheck and a
second independent review (21 route tests independently rerun). Reviewed delta
SHA-256: `f0f2b8506e2f76d4ee218237e2d520bf23143c12cf84a8059eb31946fcf1ae6e`.
At this pre-release checkpoint production still ran the prior accepted source; repeat
ordinary login on app with its retained staff session, section content/persistence,
CRM preview absence, acceptance readback and disarm before closing this run.

## Canonical staff and Student domains — accepted 2026-09-17

Owner approved connecting `crm.evoadmissions.com` for employees and
`app.evoadmissions.com` for students, including verification from the owner's
current Mac network. This supersedes deferral of the custom CRM hostname.
One existing application, Supabase project and authorization system remain;
no new product/runtime, data copy or authentication bypass is permitted.

- [x] Add only the two exact Spaceship A records to the existing VPS; preserve
  apex/www, mail, MX/TXT, DNSSEC and nameservers.
- [x] Implement exact staff/Student auth callback origins, canonical entry
  routing and required real Supabase URL configuration. Keep CSRF, role/RLS
  checks and host-only sessions; do not use a wildcard redirect allowance.
- [x] Independently review the code/edge delta; pass scoped PR checks and the
  existing exact-main release proof when application code changes.
- [x] Bootstrap the two HTTPS hosts on the existing Caddy edge, deploy through
  the managed release, then finalize the edge without recreation. Preserve unrelated sites, the private
  website receiver and every private API guard. Retire the old hostname as an
  application entrypoint once both new hosts are proven; do not retain a second
  active app origin as a fallback.
- [x] Verify authoritative/public DNS, real trusted HTTPS, staff/Student entry
  routing, actual available login/session behavior, negative private-path gates
  and unchanged marketing-site availability. Distinguish a real authenticated
  journey from a login-page/health-only check; name missing credentials clearly.
- [x] Save exact source/release/edge/DNS evidence and update shared context.

The owner takes over the real website-inquiry and Gmail-delivery checks; remove
them from the agent's active checklist without reporting either as verified.
Web-X billing clarification is separate from this cutover: do not cancel the
domain, delete old hosting data or send support requests in this run.

Preparation receipt: both exact A records are saved with TTL300 and read back
as `72.62.119.112` from both authoritative Spaceship nameservers. Bootstrap and
final configuration are separate: keep the old application proxy only during
this bounded cutover, then retire it after canonical-domain release acceptance.
No application/edge deployment or new-domain login was claimed by that
preparation receipt; the accepted result follows.

### Accepted cutover receipt — 17 September, 00:43–00:45 UTC

- [PR806](https://github.com/izzhackt/evo_AI_CRM/pull/806) merged as
  `62b16ca8a12d8181ffbad03a000ca0695cb59689`, identical to independently reviewed
  source head `63a1aaedcdbd82c3e0a4cc433c9e5fdfb39945bb`.
  [Full CI35166365096](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35166365096)
  and [managed release35167122534](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35167122534)
  succeeded. No database/account migration was added for this change.
- Server readback at 00:43:03 confirmed accepted release
  `v3-r35167122534-a1-62b16ca8`, running healthy with 0 restarts and no pending
  candidate. Pointer→acceptance record→env/Compose/browser snapshot hashes and
  named/container-ID image identity matched. Image:
  `sha256:3f3ecb543c6430727f66f9aa9ca03b80cb07143e1439e2306f6d2644f413f48e`.
  Acceptance record SHA-256:
  `5c9522bdaeea271e7fce3c69680f9d92053543ea34c460f96e20f3b90e08b2b1`;
  browser receipt SHA-256:
  `c26a075745877fa306fa8cfd762e803a4c433034637c71c6c99b569b1ea047f7`.
  `EVO_PRODUCTION_RELEASE_ARMED=false` was explicitly restored/read back.
- Final edge loaded at 00:43:23, SHA-256
  `90f463bb3d578d37dde9f1fbbda4513a18eb94f7c9fa07197a7101741fb1a1ec`.
  The real loaded configuration matched its adapted source in memory; same
  edge container, 0 restarts, preserved unrelated routes/private website header.
  All 24 public checks passed with normal TLS: both login/health endpoints 200,
  private guards 404, cross-audience GET 307, wrong-audience POST 404, old-host
  GET 308 to fixed audiences, old auth POST 405 and marketing homepage 200.
- Supabase Dashboard readback: Site URL `https://crm.evoadmissions.com`; exactly
  `https://crm.evoadmissions.com/auth/staff` and
  `https://app.evoadmissions.com/auth/callback` in the redirect allowlist.
  The old wildcard was removed. Invite and Recovery templates use RedirectTo
  plus TokenHash and the appropriate invite/recovery type, reloaded and verified.
  SMTP remains off; no invitation/recovery email was sent by this run.
- On the owner's Mac, real Chrome displayed both new audience-specific login
  screens and followed both navigation links correctly without bypassing TLS.
  The production Admin browser smoke passed using normal existing credentials.
  No production Student credentials were supplied/exercised for a new
  authenticated Student journey; do not infer that business acceptance from the
  public login screen or the isolated full-CI Student proof. Current Mac curl
  still resets its TLS connection, whereas Chrome and VPS HTTPS checks pass;
  no network/trust-store setting was changed.

Both exact DNS A records retain TTL300 and resolve to 72.62.119.112 on both
authoritative servers, public Google/Cloudflare resolvers and the Mac system
resolver. The old technical hostname is now navigation-only, not a parallel
application. Passwords, memberships, databases and provider credentials remain
unchanged. The final documentation publication does not trigger another app release.

## EVO workspace consolidation — 2026-09-17

Owner approved a common local `EVO/` parent with independent Platform and
website Git repositories, shared agent context and brand navigation. This is
a local organization/docs-only change, not a production release.

- [x] Move the two main checkouts intact; preserve dirty/untracked work and
  HEAD/index, repair all existing linked worktrees (including nested ones).
- [x] Add shared README, AGENTS, infrastructure/status map and brand entrypoint;
  keep secrets/raw/private files out of versioned context.
- [x] Link each product to the shared context while retaining self-contained
  runtime assets, tests, migrations and product docs. Move only inventoried
  non-product local materials; no blanket deletion or history rewriting.
- [x] Verify real Git paths, worktree identities, dirty-file hashes, links and
  repository boundaries; independently review and publish the scoped docs.
  CRM publication is completed by merging this docs-only PR805; no deploy follows.

Saved Codex tasks may still reference old checkout paths. Temporary directory
symlinks are permitted solely to preserve those active paths until the user
opens the new directories; they are not duplicate checkouts. VPS paths, DNS,
deploy workflows, database and external services remain unchanged.

Local receipt 2026-09-16 22:53:50 UTC: two real child directories moved under
`01_Projects/EVO`; all 102 existing worktrees preserved HEAD/index/status and
modified/untracked-file hashes. All 100 linked worktree gitdir/backlinks were
canonicalized and verified independently of the old-path aliases. Eight
previously missing worktrees were left untouched. Seven inventoried corporate
files moved to ignored shared storage with unchanged SHA-256. Both distinct
logobook PDFs were copied to the shared brand index with verified provenance;
the product fixture remains. Shared metadata repository `izzhackt/EVO` is private;
existing CRM repository is public, website private, visibility unchanged.

Shared context [PR1](https://github.com/izzhackt/EVO/pull/1) and website context
[PR9](https://github.com/izzhackt/evoadmissions-website/pull/9) are merged; both
local checkouts are clean on main. CRM context links and removal of the two
retired corporate registry Markdown files are published through
[PR805](https://github.com/izzhackt/evo_AI_CRM/pull/805); originals remain in
ignored shared storage and Git history is unchanged. Fourteen added link targets,
five retained product-asset hashes and the website's60-relative-link check passed.
Independent exact-head review and the protected short checks passed before merge.
The original dirty CRM checkout remains on its user's branch, not forcibly synced.

Post-move availability is recorded separately: website HTTPS200 from Mac, CRM
health200 with verified TLS from the VPS over both public and loopback/SNI paths.
The Mac connection to CRM currently sees a substituted Fortinet issuer and rejects
the chain; this is not a successful Mac-access check or evidence of a server TLS
failure. No trust bypass or network change was made. The accepted production
release receipt below remains historical evidence, not a new release for this move.

## Active website checkpoint — released, apex/www live (2026-09-17)

PR803 merged as `5736405b025c29caaf6767da0cef4df1ce6fb3a1` after independent
exact-head review and short CI. [Full CI35155801219](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35155801219)
passed on that exact main, including real isolated Student profile Word, ZIP and
fresh-login/history verification. Draft POST start4284ms→headers4735ms→finished4737ms
and final27236ms→27740ms→27741ms; neither failed. `ABORTED`/`ECONNRESET` server
categories also appeared in this GREEN run, so those categories alone do not
identify the earlier cancellation cause. That cause remains unknown; no
transport fix or relaxed gate is claimed.

[Automatic managed release35156824957](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35156824957)
passed. Independent readback verified accepted release
`v3-r35156824957-a1-5736405b`, its receipt/browser hashes and exact image. The app
is healthy, restarts0, pending release absent and release arm read back `false`.
Private intake app/edge key, organization and eligible-owner checks passed
without exposing their values; migration170 was already applied.

Only apex/www A records changed to `72.62.119.112` (TTL300). Around 22:30 UTC,
both public HTTPS addresses returned200 with valid TLS and the deployed website
`d2ab537` HTML hash. All five prior edge routes remained healthy. Chrome opened
the new apex site and its Apply Now control reached the visible form; no form
submission was made. The shared edge retained its container identity and
restarts0; initial graceful apply at22:23:54 and one same-config forced graceful
reload at22:29:41.949 completed www certificate issuance after DNS propagation.
No proxy recreation, config change on that second reload or secret deletion.

Public negative checks passed: intake GET405, empty POST with website Origin
400/invalid_request before the database RPC, other website API paths404, direct
public CRM receiver404. These prove routing/fail-closed behavior, not a delivered
lead. Remaining acceptance: one owner-authorized real inquiry, staff visibility
and idempotent retry; Gmail delivery also remains unverified. See the exact
[receipt and remaining boundaries](PLAN_CHANGES.md#2026-09-17--exact-linux-ci-and-managed-release-passed-public-apexwww-live).

Latest owner approval ("отменяем web-x окей делай") authorizes cancelling only
the Web-X **hosting Start** service after a healthy website cutover. Cancellation
has not been performed or confirmed. No cancellation button is available; a
support request is planned from the registered business email
`evoadmissions@gmail.com`, whose mailbox access remains pending. This sending
channel is our plan, not a verified mandatory provider policy. Do not cancel
domain registration or mail, or permanently
delete hosting files. The earlier one-time-payment fact does not revoke this
new, explicit cancellation authorization.

### Historical controlled Linux lifecycle observation

PR802 merged as `0f40f7ad`; CI35151520335 failed the original draft POST with
`RESOURCE_DATA_MISSING`, `Network.getResponseBody`, `ERR_ABORTED`,
requestFailed=true/requestFinished=false and a live page/browser. No main-frame
navigation committed. This proves cancellation, not its initiator. Release is
disarmed and production/edge/DNS remain unchanged.

The one authorized full local `npm run test:database:local` run passed on Node
22.23.1/Playwright1.61.1, including the previously warmed predecessor order and
real profile→Word→ZIP→fresh-login history. Draft POST finished normally
(start1893ms, headers2079ms, finished2080ms); errors0, overlay absent. Its generic
server Error summary also occurs on GREEN and does not identify the CI cause.
Owned stack cleanup passed and all66 prior running container IDs were preserved.
Temporary observers were removed; no product fix or release success is claimed.

Approved next slice: reapply the reviewed passive observer as opt-in diagnostics
for one exact-main Linux CI, keeping bounded allowlisted chronology in CI logs
(not only runner files). Validate privacy/parser boundaries and independent review;
do not rerun the local full suite. No extra requests, retry, timeout, product fix,
fallback or gate change. Root alone dispatches the one observed CI and decides
release/cutover; main and production stay unchanged until those gates pass.

### Completed single local experiment

Authorized diagnostic experiment: run the existing `npm run test:database:local`
once on Node22, preserving its full predecessor order, isolated stack ownership,
original requests/assertions and cleanup. Add temporary passive observations only
to the exact Student page: navigation start/lifecycle events and allowlisted HMR
types/session-change/category timing. Keep raw messages, URLs, credentials and
payloads out of persisted output. No product change, extra API request, retry,
timeout, fallback or gate change; no CI, deploy, push or observational PR. Stop
after this single run even if cancellation does not reproduce; report the causal
evidence or explicit remaining blocker and remove the temporary observers.

### Historical PR802 diagnostic scope

PR801 merged as `be79b290`. Full CI35149706220 passed Node/static and dependency
audit, then failed `DRAFT_BODY_TRANSPORT`: HTTP200 headers were observed, the
exact POST emitted requestfailed (not requestfinished), no main-frame navigation
occurred and page/browser remained alive. The retained subtype was only
`OTHER_PROTOCOL_ERROR`; zero CI artifacts exist. Release is disarmed; accepted
production remains `35868e75`, website edge/DNS unchanged.

- Add only fixed-enum `request.failure().errorText` and known body protocol
  subtypes/method to the existing captured-POST diagnostic. Project them through
  the existing sanitized CI printer; no raw messages, URLs or private values.
- Preserve BODY_TRANSPORT failure, original request identity and all gates.
  No retry, timeout, alternate read, CDP fallback or speculative product fix.
- Run focused parser/privacy tests and lint, then exact-head independent review.
  Do not replay local Student/full CI here; root owns one subsequent instrumented
  exact-main CI and any release/cutover decision.

Source review found no generation-time download/navigation or POST abort signal.
The browser request's failure code was not recorded, so its precise cause cannot
be reconstructed. Earlier local GREEN does not establish the CI cause.

### Historical PR801 resumption

Owner approved diagnosing the remaining blocker before cutover. Main `c5e088`
failed CI35129471538 at `PACKAGE_UI_SAVE_COMPOSITION`; production remains the
accepted `35868e75`, release disarmed, website edge/DNS unchanged. PR801 is draft:
its actual SSR readiness assertion passed after the narrow guard, but its final
local run failed `BROWSER_RUNTIME_ERRORS` (one console error, no page errors,
overlay present). The cause is not established.

Resumed isolated verification passed once on the existing readiness guard:
real Auth/UI → profile Word exports → private ZIP → fresh login/history returned
identical bytes, zero browser errors, no overlay and verified owned cleanup.
The earlier console error did not reproduce; no fix of that unknown error is
claimed. Safe event diagnostics remain for the next CI failure, including the
existing CI log printer. No additional product change or runtime retry was made.

- Capture exact console/page-error events in memory on both existing browser
  contexts, emit only bounded static categories and known repository frames.
- Reproduce through the existing isolated Student profile → saved ZIP → fresh
  login/history path. Preserve every assertion, permissions and cleanup.
- Change product code only after evidence identifies the cause; require actual
  GREEN, scoped checks and independent exact-head review before PR801 can merge.
- Root owns final exact-main CI, managed release, public edge/DNS and Web-X
  operations. No provider/deployment action or fabricated customer acceptance
  belongs to this diagnostic slice.

## Website public edge — public HTTPS accepted, real inquiry pending (2026-09-17)

Owner approved the public website and real website-to-Platform inquiry path.
Marketing runtime remains separate at `/opt/evo-website`. PR796 merged the
apex/www routes into the existing shared Caddy source, preserving all five live
routes including OlympiadAI. Website `d2ab537` is deployed and apex/www public
DNS, TLS, matching HTML and edge routing are verified. A delivered inquiry is
still unverified.

- [x] Implement `evoadmissions.com` / `www.evoadmissions.com` → `evo-website-web:8080`.
- Only exact `POST /api/website-leads` reaches the existing private CRM app,
  rewritten to `/api/public/website-leads`. Bound the body to 8 KB; overwrite
  the private key and socket client-IP headers; strip Cookie/Authorization.
  Reject other website API paths/methods; hide the receiver on the CRM public host.
- Preserve the existing container, bind-mounted Caddyfile path, ports and network.
  No stop/recreate: import the private key header from an operator-provisioned
  file in the already persistent `/data` volume, then validate and gracefully
  reload. Cold restart requires the same file; no secret enters Git or output.
- [x] Independently review the exact edge commit and validate with real pinned
  Caddy. Matching private app/edge configuration and the eligible existing Admin
  are provisioned; migration170 is already applied, ledger001–170 verified.
- [x] Pass full CI for final Platform main `5736405b`; CI35155801219 passed after
  PR803. Previous cancellation remains unexplained; no gate was weakened.
- [x] Accept managed release35156824957; independent exact receipt/image/browser
  readback passed, app healthy/restarts0, pending absent and release arm false.
- [x] Validate/reload the existing edge gracefully and change only apex/www A.
  Both public addresses passed HTTPS/TLS/exact HTML; all five old routes passed.
  Shared edge identity and restarts0 were preserved.
- [ ] Receive one owner-authorized real inquiry, confirm its fields and staff
  visibility, and verify an idempotent retry. No fabricated customer acceptance.

The owner previously clarified that Web-X was paid once with no recurring
charges; the latest explicit approval additionally requests cancellation of
only hosting Start after healthy cutover, under the current boundary above.
Provider cancellation is not yet performed or confirmed. Keep domain registration,
mail and the chosen Gmail forwarding; do not permanently delete hosting files.
Actual mail delivery remains a separate check. Changes to
`crm`, `app` and `inbox` DNS are deferred, not part of this apex/www cutover.
Do not reset data or expose WAHA. [Edge procedure](design/v3/references/2026-09-16-website-edge.md).

## Website lead intake — released, real submission pending (2026-09-17)

The owner selected **EVO Platform**, not direct amoCRM, as the recipient for the
separate marketing website. The site deployment/DNS work is a separate lane.

- [x] Add one service-only transactional intake RPC (migration170), reusing the
  canonical client/lead helpers, persistent request receipts, contact locking,
  persistent per-IP/organization throttling and the existing scoped owner rules.
- [x] Add a bounded `POST /api/public/website-leads` handler. Website Caddy maps
  same-origin `/api/website-leads` and overwrites the private edge key and real
  client-IP headers. Exact HTTPS website origins, request schema/size limits and
  server-side organization/owner configuration fail closed. No staff impersonation,
  browser service key, direct amoCRM write or second business database.
- [x] Preserve name/phone/age/city/exact country and consent with the receipt;
  show a compact website inquiry detail only to staff who can read its lead.
  Do not overwrite an existing person's identity or silently merge conflicting
  contacts. Browser replies do not disclose contact existence/internal IDs.
- [x] Complete scoped schema/grants and fail-closed HTTP checks plus independent
  code review; merge backend PR795. No customer row was used for those checks.
- [x] Release the receiver and public website route; production negative checks
  passed without creating a customer record.
- [ ] Complete the real inquiry acceptance listed above.
  Schema/HTTP checks are not a successful submission or staff visibility proof.

Remaining intake acceptance is the authorized real submission and staff
visibility/idempotent retry. Organization/eligible owner, private key and migration170 are already
configured/applied; do not repeat them. Repository implementation is not delivery
evidence. The owner waived the unrelated chosen-client form-to-ZIP acceptance;
it is not a gate here.

Official implementation basis: [Supabase functions](https://supabase.com/docs/guides/database/functions),
[backend API keys](https://supabase.com/docs/guides/getting-started/api-keys).

## Historical release checkpoint (2026-09-15)

**Released and independently verified:** `35868e75d2cd3c041b415c809f222c252a3b86a1`,
version `r72.1-35868e75`. [Canonical CI34989896327](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34989896327)
and [managed release34991072628](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34991072628)
passed. Catalogue selection in applications (PR789) and contract workspace
recovery (PR790) are now in production. The existing PDF/ZIP delivery remains
included; no new migration, database, staging or provider write was introduced.

Independent readback matched the accepted pointer/record/browser SHA256 chain,
app revision/version/image and GitHub artifact. App is healthy with zero restarts;
pending is absent and `EVO_PRODUCTION_RELEASE_ARMED=false` was read back after
explicit disarm. The unchanged SSH tunnel at `http://localhost:3000` reaches this
same production. The owner's ordinary Admin browser reopened four role drafts
and the paged university catalogue; no employee invitation or client write occurred.
[Exact release receipt](design/v3/references/2026-09-15-docs-managed-release.md#catalogue-and-pilot-production-release).

The configured sslip HTTPS endpoint passed HTTP200/TLS0 from the VPS. The custom
`crm.evoadmissions.com` hostname did not resolve there; do not claim it working.
Use the tunnel or verified fallback while custom-domain DNS remains a separate
follow-up. No certificate warning was bypassed and DNS/proxy configuration was
not changed by this release.

Next P1 work: obtain the EVO invitation sender/mail service, reconcile the roster
with current users, confirm exact recipients/roles/scopes, then exercise one
employee's invitation and first login. Separately, use the owner's chosen case
for a saved university form → ZIP → fresh download. Four unassigned role drafts
are preparation, not employee access; isolated document proof is not client
acceptance. Gemini, USTC and additional polish remain P2. Keep one permanent
database, small parallel changes and one release owner; do not repeat completed
full checks, schema169 apply, template imports or standalone Docs retirement.

### Historical release recovery — resolved, not work to repeat

PR791 added fixed-shape callback diagnostics as
`da4956d333ba15f32eb680222b567b30c78b9980`. CI34985451032 passed unchanged staff
onboarding and the original contract/application/handoff workflow. The earlier
callback cause remains unconfirmed; no Auth gate was relaxed.

The later Student Profile proof failed at `DRAFT_GENERATE_RECEIPT`. PR792 split
that diagnostic as `761ae8ed55ad57998f4b890f4baf236821a0ea2d`; subsequent
CI34987631399 passed draft generation/receipt/download but failed at
`FINAL_RESPONSE_BODY_READ`, after HTTP200 and before receipt normalization.
This narrows the failure to body retrieval/JSON parsing or a null envelope;
the product export route/normalizer remained unchanged. Releases34986705706 and
34988890671 were skipped, arm was returned to `false`, and production stayed
on `5bc5df73` until the successful release above.

The unchanged scoped workflow passed locally: draft, final, ZIP, exact replay,
cold same-byte downloads and owned-stack cleanup. PR793's bounded mitigation
captures the same POST body immediately when matched, before click completion,
with fixed transport/JSON diagnostics and all existing receipt/history/download
checks. It adds no HTTP request/retry or mocked response. The ordering regression
proves earlier capture, not the underlying Chromium cause. The exact reviewed
patch passed 25 focused tests, the original scoped profile/ZIP workflow with
owned cleanup, required PR checks and the full canonical CI above. All receipt,
history and byte checks remained in place. This is a validated lifecycle
mitigation, not a claim that the prior Chromium failure's root cause was proven.

## Catalogue release recovery (2026-09-15)

PR789 merged as `b194bb57b760db1b2795f8dba0a346fa8294e772`, with fast checks
and independent review passed. CI34980108921 passed Node/static and dependency
audit but failed the later Admin case-open assertion in the real Admissions
scenario. Release34981142975 was skipped; release arm was set back to `false`.
At that point production remained accepted `5bc5df73`; no new schema or provider
write occurred. This incident is resolved by the current release above.

The unchanged isolated `--admissions-workflow-only` run reproduced the same
failure after the new catalogue-selection/manual-entry checks had passed. Its
bounded diagnostic points to contract workspace normalization on Admin load.
SQL057 returns all reviewed sources, while catalogue publication148 adds
`official_website`, which the older contract-source parser rejects. A focused
regression at the existing public normalizer confirmed RED before the fix and
GREEN after it. The read-side fix validates this known unrelated source, then
excludes it from contract-template choices; unknown/malformed sources and
duplicates remain rejected, with the five mutation source kinds unchanged.
All 24 focused contract tests and scoped lint pass; URL length boundaries and
closed-schema/identity guards are covered by the same existing test file.
PR790 completed required PR checks and exact-head review. The unchanged original
integration scenario passed in CI34985451032 and the successful CI34989896327.
The later Student Profile blocker is now resolved for release. Do not repeat
the Admissions run without a changed input or concrete failure.
Do not remove the failed assertion, relax Auth or change applied migrations.

## Catalogue application selector implementation (2026-09-15)

The bounded P1 selector is implemented in the ordinary application form:
explicit catalogue search/selection, paging, retry and manual entry. The existing
authorized reader and create RPC preserve the catalogue ID; programme text,
request identity and optimistic version checks remain unchanged. No migration,
new authority, historical relinking or production fixture is introduced.

Focused Node checks (28/28), scoped lint and TypeScript passed. The existing
isolated Admissions browser scenario now covers catalogue and manual creation,
Enter without accidental submission, programme preservation and authenticated
RLS readback after reload. This real scenario passed in canonical CI34985451032;
source assertions alone are not the evidence. PR789 passed required checks and
independent exact-head review. Managed release34991072628 is accepted and read
back as recorded above. Do not create staging or duplicate the full
database/browser run locally.

Employee invitations still need the EVO mail sender and exact recipient/scope
approval. The owner's chosen-client form/ZIP flow remains a separate acceptance
gap; the isolated fixture does not satisfy it. Earlier checkpoints below are
historical and must not cause completed work to be repeated.

## P1 readiness checkpoint (2026-09-15)

Prepared four **unpublished, unassigned** Sales/Admissions role drafts through
the ordinary production Admin UI. Reload and reopen confirmed permission counts
15/11/27/11; all four have zero employees and no published permissions.
No invitation, account creation or access expansion occurred. The source roster
contains twelve employees, but it is not approval of individual access grants.
See [staff checkpoint](design/v3/employee-roles-accounts-run-plan.md#подготовка-пилотного-подключения-2026-09-15).

Actual onboarding is waiting for a service sender: the live Supabase dashboard
still shows built-in email and no configured custom SMTP. Obtain the sender and
service, reconcile existing users, confirm exact recipients/roles/scopes once,
then send one invitation and have the employee complete their own password/login.
Do not substitute a shared password or claim delivery from an invitation row.

The chosen-client form/ZIP acceptance is still open; the inspected Admissions
list had no available case. The earlier catalogue-linking gap is fixed and now
released: the normal application creator supports explicit catalogue selection
through the existing authorized reader and creation RPC, with search, paging
and retry. Manual entry and typed programme are preserved; old applications
were not relinked and duplicate cases were not created. Use the owner's selected
case for a real saved form → final ZIP → fresh download.
No further PDF/ZIP release, schema169 apply or old Docs retirement is needed.

## Pilot priorities: prod first, small parallel deliveries (2026-09-15)

Owner direction: this is currently a pilot with test clients and employees.
Prioritize a usable production release and ordinary authenticated access; do not
hold it for every backlog item or add a staging environment. Keep the same
permanent database and the localhost SSH view of production.

- P0 complete: PDF/ZIP released and read back; normal authenticated access,
  changed PDF screen and production/tunnel access verified (receipt below).
- P1, separate follow-ups: actual employee invitations/first login and a chosen
  client document flow. These are honest acceptance gaps, not reasons to hide
  already working screens from the owner.
- P2, not release blockers: real Gemini acceptance, USTC format/mapping decision,
  further visual polish and broad completeness work. Reprioritize when needed
  for the first actual workflow; do not claim these items done.
- Deliver small independent slices in parallel branches/worktrees with explicit
  file ownership. One release owner serializes deployment; do not mutate the
  frozen candidate while its release is active. Merge finished slices promptly.
- Verify the actual changed path; reuse still-valid exact-revision evidence.
  Do not repeat expensive full runs without a changed input or concrete failure.
  The current configured CI/release checks remain in force: this decision does
  not silently disable Auth, role checks, migration validation or rollback.
  Any future narrowing of CI belongs to a separate measured change, not this
  release. Test-client status does not authorize fabricated proof or unsafe
  handling of employee/customer data.

The existing lane already deploys without staging: successful exact-main CI
starts one automatic release via `workflow_run`, followed by short production
checks. See [runbook](../deploy/fast-app-release.md) and the
[official trigger semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).

## ZIP release recovery checkpoint (2026-09-15)

**Released and verified:** `5bc5df73a03825d9b5dba4ad4b8bdf65d0a8f809`,
version `r66.1-5bc5df73`. [CI34972050911 attempt2](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34972050911)
and automatic [release34973968977](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34973968977)
passed. Independent server readback matched accepted pointer/record/browser
hashes, app image and revision; health200/TLS0, pending absent, arm=false after
explicit operator disarm. In ordinary Admin Chrome through the existing tunnel,
GDUT pages1/2, three rapid page-return cycles and cold reload decoded correctly.
No source upload or mapping edit was repeated. [Full release receipt](design/v3/references/2026-09-15-docs-managed-release.md#pdf-and-zip-production-release).

No further release/apply/retirement is needed for this slice. Next work follows
the P1/P2 priorities above. The remaining paragraphs are historical incident
evidence, not current commands or an unresolved release blocker.

Current source is `5bc5df73a03825d9b5dba4ad4b8bdf65d0a8f809` (PR786).
The exact-role ZIP selector fix and bounded diagnostic substages passed an
independent review,23 harness checks, full lint and the original isolated
profile/ZIP run. Its receipt verifies2 profile files +1 ZIP, private Storage
readback, independently decoded selected bytes, identical fresh-login download,
no download-created artifacts and owned cleanup. This is synthetic technical
proof, not a real client or Gemini acceptance.

CI34972050911 attempt1 passed Node/static and dependency audit but failed earlier
than D2 at `LOCAL_STAFF_CALLBACK_URL_NOT_CLEAN` during staff invitation setup.
The same unchanged staff-onboarding-only loop then passed real local mail,
callback/password/fresh login, role/member editors and business scopes. No auth
rewrite or weakened URL check was made; the bounded same-SHA failed-job retry
(attempt2) subsequently passed. Release34972496448 was skipped before the later
successful release above. If the callback failure recurs in future, compare only
cached/browser clean-URL booleans. Never log URLs
containing tokens, passwords or raw callback errors.

The paragraphs below retain the earlier recovery evidence, not instructions to
repeat completed work. Draft PR769 is closed as owner-cancelled D5;770/771 are
closed as superseded. Their source/history remains available.

PR785 is merged as `cfac17f7923cdd52408b40addc2d67eacb48a5f1`. Managed
schema run34969326250 applied only169 and verified001–169; the private export
bucket is now50MiB/DOCX+PDF+ZIP with exact readback. Global capacity and tariff
are unchanged. Do not repeat these writes or the old Docs retirement.

Full CI34969363566 passed Node/static, dependency audit, real staff workflows
and the desktop/mobile/dark V3 gate, then stopped at the existing D2
`REFRESH_AND_FINAL_DOWNLOAD` stage before reaching ZIP. No CI artifacts were
published. Release34970414014 was skipped; arm=false was restored and read back.
The app remains the accepted `a358a3e3`. Reproduce the exact D2 failure with the
existing isolated `--student-profile-fields-only` harness; inspect its bounded
diagnostic before changing code, fix only the proven cause, review and retry
the exact-main lane. Never change an already applied migration169 in place.

The isolated local D2 run passed final profile generation and cold downloads,
then timed out at ZIP application selection. A bounded real Chromium repro
confirmed that exact `getByLabel` does not match the implicit label containing
option text, while the existing accessible combobox has the exact correct name.
Change only the test selector to that exact role/name and verify its selected
value. Add fixed-enum diagnostic substages for the old broad D2 failure, without
changing product behavior, timeouts, assertions or data/privacy boundaries.
Rerun the complete original isolated profile/ZIP scenario before review/release.

## Owner scope update: discard old test data and retire Docs (2026-09-15)

The owner confirms the five old Docs students were test records, explicitly
waives their history transfer and filled-document acceptance, and requests
deletion of standalone EVO Docs. D5 is cancelled by owner decision, not completed
by migration. Do not create Platform cases or replay old history. Existing
Platform profiles, form generation/history and the nine imported blank templates
remain; this does not remove those product features.

The owner also authorizes the standard isolated test checks requested in the
previous turn. Use them for regression/release evidence, never as real-client
acceptance. Complete the prepared PDF fix with scoped regression, independent
review, required PR checks and one exact-main CI/release. Then verify the actual
published GDUT mapping through the production tunnel. No gate bypass or new
production test students. No new backup, reset, paid upgrade or provider action.

Retire only verified old Docs app resources and its now-disposable test runtime;
preserve shared Caddy/network, CRM, WAHA, unrelated projects and external secrets.
Prefer recoverable removal of the standalone source checkout; retain reused code
until ZIP needs are resolved. Existing backups are not deletion targets.
The owner explicitly accepts ZIP up to50MiB without additional costs, replacing
the former260MiB capacity goal. Implement it in the existing partner-packet panel
and document-export history: immutable selected original/generated versions,
hash-verified bytes, private persistent artifact, idempotent save and cold
download. Never omit an oversized/invalid selected file. Original-only packages
must not fabricate a profile. Keep current5/20MiB profile/form limits; raise only
the private export bucket to50MiB and add ZIP MIME, with exact readback. Global
Storage limit and tariff remain unchanged. See the updated D4 package contract.
Merge the bounded PDF slice first, then ZIP; run one final combined exact-main
CI/release rather than deploying twice.

Standalone retirement is now executed independently of the still-pending PDF
release: the old container/image/private network are absent; source/data were
moved recoverably, not copied. Existing backups and keys remain. See the
[retirement receipt](design/v3/references/2026-09-15-docs-managed-release.md#standalone-retirement-after-owner-test-data-waiver).
The main app, scanner, WAHA and shared edge retained their IDs/images and zero
restarts. Tunnel login=200. Primary-domain DNS fails from Mac and VPS; this is
not a successful custom-domain health check and no DNS/proxy change was made.
Follow-up confirms the existing owner decision: sslip is the sole configured
production hostname; custom DNS is deferred. VPS sslip login=200/TLS verify0.

## Active PDF preview reliability slice (2026-09-15)

Historical source checkpoint; the recovery checkpoint above is authoritative
for the subsequently merged ZIP source and completed managed prerequisites.

Source checkpoint: reviewed PR784 merged as `5cf45158f910146028f6714a1a769526cb3b683b`.
The revoked-URL regression fails against the former implementation and passes
against the fix; required fast checks34964735716 passed. Production remains
`a358a3e3`. ZIP source is committed as `e088e8ba` on
`izzhackt/docs-persisted-zip-50m`, including migration169. Independent backend
and UI reviews passed; isolated SQL001–169, existing164/167 regressions,
50MiB unknown→reconcile→ready,54 producer/builder/route tests,16 client/action
tests,18 UI tests, typecheck and scoped lint passed. The actual ZIP browser/
Storage proof, managed169 apply, private bucket upgrade and app release remain
pending. Do not repeat the old Docs retirement or blank-template import.

On accepted `a358a3e3`, rapid GDUT Degree page1→2→1 changes reproduced a
transient broken image twice: `complete=true`, natural dimensions0×0 and no
loading message. The image later recovered without retry. Cleanup revokes the
page's object URL but leaves its matching read-state key available for reuse.
Bind read state to the current request instance, not a reusable page key;
retain abort, digest/dimension checks, access-loss handling and existing retry UI.
No schema, template bytes, mapping, publication or applicant data changes.

Acceptance: rerun that real saved-mapping flow on the changed application;
each intermediate state must show loading/error or a decoded image, never a
revoked image. Check both pages, cold reload and unchanged read-only controls.
Static checks and independent review are additional evidence, not a substitute
for the real browser check. A new manifest instance must also invalidate the
preview before cleanup, without resetting the editor's mappings. Keep other
City/server failures unclaimed until separately reproduced. Do not redeploy or
retire Docs on source inspection alone.

Implementation was prepared on `izzhackt/docs-preview-reliability` and is now merged. Scoped ESLint,
TypeScript and the full production build pass on Node22.23.1. Positive browser
acceptance is pending: the Mac preview cannot run the Linux-only native page
handler, and localhost:3000 still serves the unchanged accepted app. Do not
invent a controller image identity or replace the real page endpoint. The owner
has now permitted existing isolated CI checks; run them under the owner scope
update above and keep the real post-release GDUT check separate.

## Active Docs release checkpoint (2026-09-15)

The application release is complete; the full Docs unification is not.
[Platform CI34901397830](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34901397830)
and [managed release34902113327](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34902113327)
passed on `a358a3e3767264bd3c77c4afc0e50af2c11b3eba`. Production accepted
`r63.1-a358a3e3`; independent pointer/record/image/runtime readback agrees.
App and private scanner/WAHA are healthy with zero restarts; pending is absent,
and release arm=false was explicitly restored and read back. The existing
localhost:3000 SSH tunnel still targets this same server app, not a local copy.
See the [release evidence and handover](design/v3/references/2026-09-15-docs-managed-release.md).

PR779–781 repaired only stale test inventory, real-child loading and the strict
v2 cold-history proof. Full Node checks:2029 PASS,1 existing SKIP,0 FAIL;
build/lint/types, database/Auth/browser gates and read-only production login
passed. Saved-profile cold downloads and replay are technically proved with
synthetic fixtures, not accepted as a real client/form workflow.

Managed001–168 and both private20MiB PDF/DOCX buckets are verified; do not repeat
schema apply, bucket creation or unchanged successful suites. Retain168 while
the retained05585020 rollback app still needs the two unchanged service-only
RPCs. Actual project Storage limit is50MiB;260MiB ZIP parity remains unresolved.

Ordinary Admin continuation (2026-09-15): the owner personally logged in through
that tunnel. All nine approved real blank PDFs are uploaded and verified through
the current UI. INTI draw/body move/corner resize and two undos passed; its13
fields were saved, cold-read and explicitly agent-reviewed before publication.
Tongmyong's20 fields likewise match the source preset after cold readback and
visual review of both pages. All eight eligible forms are published with94
saved/cold-read/visually checked fields; City PreU/Postgraduate geometry uses
the recorded0.01-point normalization (maximum delta0.005), not exact legacy
numeric identity. USTC remains a verified draft because acceptance of
the local DOC→PDF conversion is unconfirmed. Use the
[per-template receipt table](design/v3/references/2026-09-15-docs-managed-release.md#продолжение-в-обычной-admin-сессии)
for target IDs and mapping status; do not repeat uploads or published mappings. This records
blank-template checks, not university acceptance or filled-client-form proof.
The ordinary Admissions worklist showed no accessible cases across its filters;
no applicant records or values were created or changed.

Resume real-case filled-form save/history/download acceptance; resolve USTC's
format before its mapping/publication. Reproduce/fix the observed City/GDUT
preview failures: normal retry/reload recovered them, but no fix is claimed.
Obtain explicit mapping of the five source student records, then
reconcile the twelve D5 domains and43 original files. Complete persisted ZIP
integration after the owner's50MiB-versus260MiB capacity choice and real Gemini
acceptance with an authorized document. D5/D6 remain open: no old Docs runtime,
data, source, history or secrets were deleted. No new backup was created.
This UI/docs continuation made no application release, schema or provider change;
earlier preparation checkpoints below remain historical.

## Docs release preparation before PR778 (2026-09-15)

The owner requests verification, server release and retirement of standalone
EVO Docs. Preserve the D5/D6 data and real-workflow gates before retirement.
Read-only schema check [34893968851](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34893968851)
confirms managed001–161; source162–167 is not deployed. The live accepted05585020
still calls the transient161 export RPCs revoked by164. Prepare forward168
compatibility for exactly those two unchanged service-role-only RPCs; preserve
their existing actor/case/revision checks and generation-only audit. Never map
legacy `generated` to stored-artifact `ready`, grant browser roles, or expose
frozen values to service readers. The new app continues to use164/167 only.
Remove compatibility in a later reviewed migration once both the current and
retained rollback app use persisted exports. This postpones only transient-RPC
retirement, not the one-Platform target or standalone data-preservation gates.

Fix the existing Storage configurators' handling of the observed legacy
missing-bucket response before exact private20MiB PDF/DOCX provisioning.
Keep checks read-only by default, one explicit create/update plus readback,
and fail closed on permissions, conflicts and unknown responses. No public
bucket, global limit, paid upgrade or provider submission is authorized here.

Read the actual project-wide Storage file-size limit before enabling20MiB
forms. Reuse the existing manual schema-ledger workflow with an optional,
default-off read-only capacity input; call only the official project's GET
Storage-config endpoint using its existing step-scoped management credential.
Print only the numeric limit and20MiB eligibility, never the response or token.
Fail before schema apply on unknown, insufficient or rejected capacity checks.
This adds no provider write, new workflow, object upload or tariff change.

## Active owner clarification: reuse EVO Docs, do not rebuild it (2026-09-14)

The owner approved transferring the existing five Docs workflows: university
templates/mapping, PDF editing, filled DOCX/PDF with saved history, ZIP packages,
and Gemini extraction. Preserve their behavior and reuse their code/assets;
adapt only the Platform case/catalog identity, existing staff permissions,
Postgres persistence, private Storage and UI shell. Existing migrated renderers,
registry and job lifecycle remain reusable work, not reasons to start over.
Restore source PDF move/resize interactions in the current editor; do not add a
second editor or replace the already integrated private page route.
See the [unification plan](design/v3/evo-docs-unification-run-plan.md#reuse-first-delivery).
Latest clarification governs older speculative implementation sequencing.

D4 user-facing continuation: [university template workspace](design/v3/evo-docs-template-ui-contract.md)
extends the existing university detail and reviewed registry/native inputs.

D4 resume checkpoint (2026-09-14): registry, [native template inspection](design/v3/evo-docs-template-native-contract.md),
private ingress and mapping source were merged in [PR773](https://github.com/izzhackt/evo_AI_CRM/pull/773)
as `0f58072b`; exact-head review and all six checks on `7ce58d35` passed.
The next source slice is [PDF page rendering and region editing](design/v3/evo-docs-template-page-render-contract.md#staff-pdf-page-http-and-region-editor).
Native arm64 and amd64 evidence is accepted; the staff HTTP/editor integration
and its actual browser acceptance are still pending. No production update is implied.
The original combined browser flow now passes on `5833cd77` after the reviewed
acceptance-only HTTPS correction: [actual ingress/mapping evidence](design/v3/references/2026-09-14-university-template-ingress-proof.md).
Resume PDF region UI and saved forms/packages, not the completed login/ingress proof.
This is not full D4, provider/client acceptance or a production release.
PDF inspection reports `slots: []`; editable regions belong to reviewed mapping.

D4 approved readable mapping context: [bounded native source preview](design/v3/evo-docs-template-preview-contract.md).
Keep the minimal inspection/165 receipt unchanged; a separate read-only operation
inside the same isolated runtime returns exact-source-bound DOCX text excerpts.
Root approved the exact protocol before implementation; UI/ingress remain separately owned.

Status: active V3-on-managed-Supabase production-successor contract
Date: 2026-09-14 (Asia/Dubai)
Authority: owner directions 2026-09-04 and 2026-09-06, ADRs 0024, 0026 and
0027, this plan and
the latest append-only `docs/PLAN_CHANGES.md` entry, parent issue #543 and the
ordered sequence #594 through #600, then #551 through #553. After #594 merges,
root `CLAUDE.md` and `docs/design/v3/product.md` govern V3 product detail under
those higher-level authorities.

Previous accepted application: `05585020a411111939a72c4121c66369839a066b`.
The current application/schema checkpoint is the September15 entry at the top.

Historical release checkpoint (2026-09-13): S2 dynamic staff authority and D2
reviewed profile fields/Student Profile DOCX are released. Full exact-main
CI34770582933 and automatic release34771170873 passed on05585020. Independent
Hermes readback at17:25:50UTC matched revision/image/acceptance/browser hashes:
healthy zero-restart app, no pending release, unchanged private WAHA/ClamAV.
Release arm=false was explicitly read back. Existing localhost3000 tunnel
targets the same new app; actual Admin staff → roles → editor → permission
search → cancel passed without persisted writes. See
[the combined release evidence](design/v3/references/2026-09-13-staff-docs-s2-d2-release.md).
Do not repeat this completed full gate/release for status-only documentation.
Real employee mail/first-login, real client document/provider acceptance and
D3–D6 remained open. At that checkpoint managed schema was001–161 and source
162–166 was not yet applied. Current managed001–168 supersedes that state.

### Historical release diagnostics before accepted05585020

These checkpoints retain their original evidence and then-next actions. They
are not current blockers or instructions to repeat completed migrations/releases.

Previous release checkpoint (2026-09-13, after PR757): full CI34767766251 on
`bc0cde68` passed the corrected scoped Admissions calendar controls, then stopped
when the same Admissions identity reopened `/v3/profile` at test line1998.
No failure artifacts were retained by Actions. The bounded real reproduction
traced it to optional Sales handoff enrichment denied to the assigned Admissions
actor. The candidate preserves the canonical full case without that optional
section. Its next real run passed reopen and document operations, then exposed
the Sales summary branch throwing instead of returning the existing unavailable
profile state. Both scoped-authority transitions must pass the original scenario;
the missing downstream P4 receipt does not establish another Storage failure.
Automatic release34768123391 was skipped, arm=false, and production remains
the accepted77cde9ba. The isolated --admissions-workflow-only command retains
the actual workflow and final Storage receipt. Require its positive result,
independent exact-head review and one new exact-main gate before release.
D3/D4 continue independently without production enablement.

Local result: both existing real Auth/DB/Storage/scanner/browser scenarios now
pass, including the complete P4 database receipt and the company-file prerequisite
(01a09bb4700a7c23adfe675ed1b044d3, 2 passed in40.7s,
LOCAL_ADMISSIONS_WORKFLOW_VERIFIED, exit0). The case and Sales summary regressions
are retained in the ordinary full scenario; no assertions or grants were relaxed.
65 related Node checks and actual test:frontend183+23 pass, scoped lint and
bash/diff checks pass. This is a local release correction, not a new production
version, real employee invitation, provider call or client acceptance.

Previous release checkpoint (2026-09-13): managed001–161 applied/verified via
34765867429/34765967956, but full CI34766012215 on c6669ff1 failed at the
scoped Admissions calendar visibility selector. Automatic release34766594252
was skipped and arm=false verified; no new application release is claimed.
The product intentionally submits hidden student_visible=false without the
separate task.visibility.manage permission. The candidate corrects only that
proved stale expectation; actual-component SSR and frontend/module checks pass.
The end-of-scenario P4 writer and business gates remain intact. Independently
review before a root-directed exact-main retry. The later
missing P4 fixture is downstream of this timeout, not evidence of a media defect.
This checkpoint supersedes earlier release-pending diagnostics below.

## Active run: dynamic employee roles and unified document automation

The owner requests editable staff roles, departments and personal Gmail-based
accounts, with a compact EVO management interface. Follow the
[employee roles and accounts plan](design/v3/employee-roles-accounts-run-plan.md).
Extend the existing canonical Supabase identity/permission system; do not build
a second role engine. Keep each permission bound to its assignment scope,
Admin's staff functional superset and Student-private boundaries.

The owner approved implementation on 2026-09-13. The documented S1 staff
directory/department slice and S2 scoped roles are released; real employee
onboarding remains pending. Custom SMTP was read as disabled in the existing
Dashboard session on 2026-09-13; this is not a refreshed configuration check.
The supported ConfirmationURL template is not a proved defect.
Follow the [activation runbook](runbooks/team-workspace-activation.md) for the
exact missing mail configuration and recipient/first-login sequence.
Personal contacts stay outside Git; no automatic bulk invitations or role grants.
The owner also requests [EVO Docs integration and retirement](design/v3/evo-docs-unification-run-plan.md).
[ADR0028](adr/0028-unify-document-automation-inside-evo-platform.md) supersedes
ADR0017's separate-product decision: one Platform/Auth/data authority, with exact
legacy retirement only after real transfer and integrated workflow acceptance.
This release does not close the prior Portal's remaining real Student acceptance.

D2 implementation now follows the [profile fields contract](design/v3/evo-docs-profile-fields-contract.md):
an explicit partial canonical profile, human-confirmed field review and the original
Student Profile DOCX. Migrations159–161 and the application path are merged
in main as `fd5b6a08`. Historical local proof used the original158–160 numbering;
the renamed SQL sequence now passes with the actual S2 migration158 from561aa920.
The final current-main Auth/DB/browser proof passed as34770582933 on05585020.
The bounded real Auth/DB/browser workflow passed locally on that earlier candidate:
initialize one absent profile, confirm fields, preserve a stale editor's draft,
and download draft/final DOCX files whose hashes match the export audit.
Both actual files rendered correctly on all two pages. See the
[local D2 proof](design/v3/references/2026-09-13-student-profile-fields-local-proof.md).
D2/PR752 merged as `fd5b6a085ae97e8cb120f9998dc3418b0e6b580c` at15:24:30 UTC,
tree-identical to reviewed `daf5b5ac`; all six fast checks34765172099 passed.
D2 is now released in05585020, but real client acceptance remains open.
Managed schema001–161 is applied and verified through34765867429/34765967956.
D3–D6 and real employee/document acceptance remain required; the scoped profile
failures above were corrected in reviewed PR761 before the successful full gate.

Current document-development checkpoint, 2026-09-14: PR773 source `55b7f41c`
passed the actual app/derived-image builds and all six short
[CI checks 34792136150](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34792136150).
Its real combined browser run failed at `LOGIN_UI` before upload
(`01a09d50d4667d8087e475e282c0fbfe`): no acceptance receipt, owned cleanup passed,
production unchanged. Reviewed diagnostic `f58f6d81` and PDF resolver `0e748452`
are integrated in source `13a9c8c8`. Its next actual run reached
`AUTHENTICATED_SHELL` but remained at login with `authUnavailable`; the real
configuration validator rejected the acceptance-only HTTP origin as `insecure_url`.
Reviewed correction `4e120599` uses real ephemeral HTTPS in that test transport;
33 scoped checks pass, including real TLS trust/hostname refusals. The original
browser workflow then passed on `5833cd77`, including PDF lost-response recovery,
DOCX mapping/review/publication, mobile/cold resume and owned cleanup;
see [the exact proof](design/v3/references/2026-09-14-university-template-ingress-proof.md).
Basic native inspection/source checks do not prove PDF rendering, saved university
forms/ZIP packages, full-worker/provider/client acceptance, full D3–D6 or release readiness.

Historical merged checkpoint: [PR768](https://github.com/izzhackt/evo_AI_CRM/pull/768) at
`ef279986124c7b1f8298994d152ee134aced655c` passed independent merge review,
contiguous001–164 SQL, exact production/native image build and both actual local
Auth/Storage/browser flows. See [predispatch proof](design/v3/references/2026-09-14-recognition-predispatch-proof.md#combined-checkpoint-ef279986)
and [persisted profile proof](design/v3/references/2026-09-14-persisted-profile-export-proof.md#combined-checkpoint-ef279986).
It merged as `c2ddd12d` on 2026-09-13; its then-next main-readiness/merge step is
complete. The later managed schema/bucket/release gates remain open. Preserve
these earlier successful flows without treating them as PR773 browser proof.

Preparation for the next document blocks is described in the
[D3 recognition contract](design/v3/evo-docs-recognition-contract.md) and
[D4 university forms/packages contract](design/v3/evo-docs-university-packages-contract.md).
The approved D4 receipt dependency now follows the
[runtime image identity contract](design/v3/runtime-image-identity-contract.md):
controller-generated identity in sealed per-generation env, verified candidate
and rollback readback. This is bounded implementation, not a production release
or proof that template ingestion/forms are complete. It is merged through PR772
at `06d43b29`.
These are the execution contracts, not provider/client acceptance. The earlier
transport/queue and D3 integration PR758/760/763 inputs were incorporated through
PR768; their historical draft status is not a current missing-source dependency.
Forms PR759 and package PR762 engines are retained, not proof of saved outputs.
With D2 released,
the two lanes may proceed in parallel because D4 accepts manually confirmed
profile values. Preserve the D5 data reconciliation and D6 real acceptance/
standalone-retirement gates; allocate forward migrations against current main.

### Historical document implementation checkpoints

The records below retain earlier evidence and then-next actions. They do not
override the current resume checkpoint or request another completed merge/build.

The bounded D3 worker completion on combined `b5a73b2b` adds the production
`--once --mode processing|cleanup --worker-id <id>` CLI to the same application
image. Each invocation claims at most one job or cleanup record. Processing uses
the actual fixed source inspector; cleanup remains independent of processing
permission and inspector availability. A240s processing/90s cleanup deadline,
SIGINT/SIGTERM cancellation and a5s hard-stop grace bound process lifetime.
Missing backend/provider configuration fails closed; model/budgets remain the
existing database snapshot. Bundle, focused CLI checks and one Next build are
required; image/browser/provider acceptance remains a separate root-owned gate.
No activation, scheduling, provider calls, database changes or deployment occur
in this implementation slice. See the [CLI runbook](document-recognition-worker.md).

Root approves the bounded [isolated source runtime](design/v3/document-source-runtime-contract.md)
from reviewed D4 `ae52a316`: fixed Linux source inspector, `document-source-v1`,
real OS isolation/resource bounds and synthetic Linux proof only. It does not
activate recognition, grant file access or complete D3/provider acceptance.
Independent runtime review found signal-ownership and worker-thread re-exec gaps.
The source-runtime contract now requires command-limited `fcntl` and mandatory
native TSYNC sealing before document parser loading; both real regressions and
production bootstrap proof are required before integration. Earlier ARM64 proof
does not establish these missing invariants or native AMD64 readiness.

The correction at `0584d2d` passed independent review with actual native ARM64
12/12 proof, including both reproduced P1 regressions and required native bootstrap.
Its integration refresh merges main `85a1efdf` after PR762 without runtime-source
changes. This still does not prove native AMD64, combined D3 workflow or provider
acceptance; the refreshed exact head requires separate independent delta review.

PR766's first actual Next build (34774354642) rejected the adapter's empty
environment against Next's required NODE_ENV type. The bounded correction is
an explicit production-only launcher environment, without inherited secrets,
casts or weaker type checks; native isolation bytes remain unchanged. Actual
build and independent delta review are required before updating that draft PR.

That adapter fix passed short CI34774934032 at32e7255. Native AMD64 then passed
11/12 checks but correctly rejected bootstrap.mjs group-write permission0664.
Asset COPY modes were normalized without changing source/isolation tests.
The reviewed correction10f1a08 then passed all12 native checks, confirmed from
complete terminal TAP after SSH reconnect; original docker-run exit unobserved.
The permission audit found187 files/32 directories root-owned and read-only.
See [native evidence](design/v3/references/2026-09-14-document-source-native-amd64-proof.md).
Production stayed on accepted05585020; combined D3 acceptance remains open.

Next integration candidate composes runtime32c6403 with reviewed D3 acceptance
d4423d8d (including queue/integration ancestry), preserving the current main
package/Admissions gates. It does not add duplicate DTO/transport implementations.
After independent combined review, run one real predispatch proof; only then
integrate the proved D4 persisted-export slice with contiguous162→163→164.
Production worker composition, provider and real-client gates remain open.
The combined source candidate now passes the focused D2/D3 npm entrypoint,
21 manifest/route/foundation checks, scoped lint and one Next build including
TypeScript (`01a09c995e0c7b238f5656b78afb886c`). Both parent decision journals and
reviewed runtime/D3 module bytes are preserved. Exact-head independent review
and actual combined-image/local predispatch acceptance have not run.

The subsequent b5a73b2b native combined image gate passed, but the actual local
browser run failed at recognition history before enqueue (01a09ca56eee76309a0ded574bbcadd2).
Keep D3 unaccepted while investigating nullable history RPC transport; preserve
all current authority and repeat the same real scenario after a reviewed fix.

The reviewed fix1b699587 passed actual UI enqueue and same-session replay on
repeat, then failed at cold-history reopen with zero console/page errors
(01a09cb162eb7ae08ab7a0f90afd77f1). Preserve this failure and split its diagnostic
stages before changing product behavior; provider and D3 acceptance remain open.

Frozen fb9d3949 and its actual native image pair repeated the same failure at
COLD_HISTORY_EXPANDED (01a09cbdaf0a70508bd715ca638ada66), isolating an unchanged
collapsed disclosure after reload/click. The next bounded correction reuses the
existing hydration-readiness pattern for that toggle; SSR regression and the
original real workflow must both pass. No provider call or D3 completion implied.
The next D4 vertical slice is [persistent profile exports](design/v3/evo-docs-export-artifacts-contract.md):
freeze confirmed inputs under the actual staff session, store immutable generated
bytes, and expose history/download without regeneration. Student Profile is the
first producer of this shared artifact lifecycle, not completion of university
forms/packages. A separate private export bucket preserves the existing student
upload/scan boundary. Migration164 is reserved behind the unmerged D3 162–163;
do not apply an incomplete forward migration sequence to production.

Parallel D4 registry slice: [template/version/mapping contract](design/v3/evo-docs-template-registry-contract.md),
migration165, exact approved catalogue IDs and live S2 permissions. It installs
immutable source/mapping/review history and fail-closed publication, not template
ingress or a fabricated inspection writer. Full forms/package UI, real upload/
inspection/render, exports and acceptance remain required after this slice.

The persistence/API/history candidate now builds successfully with all three new
routes and the exact template in standalone output. Independent initial SQL,
HTTP/Storage and UI slice reviews passed; final combined review remains open.
Expanded source/scoped SQL checks passed in isolated001–161+164, including real
scoped-role commands, healthy historical sources, revocation and expiry. This
uses synthetic scanner/Storage metadata, not actual file-store acceptance.
Frozen0cc1f5c7 passed the actual local Auth/Storage/browser history flow and verified
owned cleanup (exit0, two persisted DOCX files, exact replay/cold-download hashes).
See [persistent export proof](design/v3/references/2026-09-14-persisted-profile-export-proof.md).
The same-slice transient route/RPC retirement passed independent review, focused
SQL (including legacy grants), route/manifest tests and the production build.
No managed bucket or deployment is claimed; D3's missing
162–163 sequence must still be composed before a contiguous release.

Current combined checkpoint: the original D3 predispatch flow passed on reviewed
819268e9 with verified cleanup, actual cold-history reopen and native source
inspection. [Proof and boundaries](design/v3/references/2026-09-14-recognition-predispatch-proof.md).
Integrate reviewed D4c49707ef next, retaining its persisted-profile replacement
and both independent workflow gates. Verify contiguous162→163→164 in one owned
SQL proof; D3 provider/full-worker and full D4 forms/packages remain incomplete.

The follow-up “okay do it” authorizes the requested bounded isolated S1/D1
technical identities/data and required CI. Use actual Supabase/scanner/browser
execution, clean up owned validation resources, and keep real business acceptance
and production/Docs retirement separate. See the latest PLAN_CHANGES entry.

### Historical staff and Docs checkpoints

The current continuation requires the whole employee and Docs plans, not only
S1/D1. The records below are historical evidence and then-next actions; current
acceptance is05585020 above. S1/D1 was accepted at `77cde9ba` on managed
schema154: local gateway corrections #743/#745 and PNG verifier correction #744
are merged; exact-main CI34740753764 and automatic release34741107458 passed.
Independent Hermes readback matched the exact image and acceptance/browser
hashes, healthy zero-restart app, unchanged private WAHA/ClamAV and no pending
release. Arm=false was explicitly read back. Chrome through the existing
localhost3000 SSH tunnel opened staff list, member details and departments
under the existing Admin session without mutations. Local HTTPS curl had a CA
verification failure; Hermes HTTPS on the active sslip hostname and the release's authenticated browser proof
passed. Do not treat that local failure as a completed network diagnosis.
Continue scoped role authority/employee onboarding and D2–D6; do not repeat this
completed release or interpret it as delivery of those remaining features.
Keep the recipient/effective-rights confirmation, real employee first-login,
approved source-to-case mapping and real document/provider acceptance gates.
No invitation, customer-file disclosure or standalone retirement is implied by
technical CI. That historical release checkpoint is
[the S1/D1 evidence](design/v3/references/2026-09-13-staff-docs-release.md).

S2 is merged in [PR747](https://github.com/izzhackt/evo_AI_CRM/pull/747) as
`0f80ced1`, but the application release remains pending.
Latest terminal full CI34763194546 on `b1ebeddf` passed Node/static and the scoped-staff proofs, then stopped
at creation of a document requirement: the organization-resource matcher rejects
the case-scoped document.manage permission even for System Admin (42501).
PR755 is merged as `561aa920`; its forward158 restores only the
existing protected requirement-configuration path; applied migrations, role grants
and case-local authority remain unchanged. Preserve the full browser/Storage
acceptance gate. Release34763572090 was skipped; arm=false was read back.
Schema34763124585 previously confirmed157=157; no application release is implied
by merging158. Merged D2/PR752 composes the actual158 with its renamed159–161;
coherent SQL validation, independent review and all six fast checks34765172099 passed.
Merge reviewed preparation-only PR754 before freezing one final main release candidate.
Apply/check001–161 and run the full Auth/DB/browser plus D2 proof on that exact
final SHA. No intermediate S2-only full cycle is required; all acceptance,
runtime/tunnel and explicit disarm gates remain. See the sequence amendment.

Historical PR750 checkpoint: `abe8109d`; schema34760275283 confirmed157=157.
Full CI34760328421 passed Node/static, dependency audit and all four scoped-staff
onboarding markers. The broad browser path then reported15 passed/3 failed/2 skipped.
Two source-grounded UI defects remain: known record-read denial becomes a generic
profile exception, and the completed handoff link incorrectly depends on a submit
permission that is false after handoff. The third missing P4 evidence file is a
downstream effect: its writer is after the failed handoff assertion in the same test.
Fix only those two transitions, retain authorization/assertions, and verify the
actual affected path in the next exact-main release gate. Release34760696579
was skipped; arm=false was read back. No new application was released.
This checkpoint supersedes the historical PR749 diagnostics below.

The follow-up has65 passing related module checks and3 actual React SSR/projection
checks, plus scoped lint. These prove the two local corrections, not real browser
acceptance. The existing full main-only CI will exercise the unchanged Auth/DB/
browser assertions once; do not duplicate that full suite on a routine PR.

Previous: PR749 merged as `c02c9ad0`; read-only schema34759018265 confirmed157=157.
Full CI34759082235 found one stale Node harness assertion (1303/1304 passed):
its broad `browser_assert` prohibition also rejects PR749's intended two-test
staff-only browser call. The narrow follow-up must require that exact call while
retaining provider/Storage exclusion. The full Node manifest now passes locally.
The database/browser job then failed at the combined callback URL/email-confirmation
assertion after invitation_ui. The follow-up bounded real onboarding passed,
including both actual baseline browser checks (01a09aef64be78b0bf9eb144a7b0dd28),
but did not reproduce the CI failure. Three fixed diagnostics distinguish URL,
email or both without logging values or relaxing assertions. The cause remains
unproven. Release34759287701 was skipped, arm=false was read back and there was
no app replacement. Independent review, full exact-main CI and release remain
open. This checkpoint supersedes historical diagnostics below.

PR748 is also merged as ce404b87. Its full CI34757193916 passed the scoped-staff
invitation/editor/business proof, then failed old staff baseline expectations.
The follow-up reconciles those assertions with the published scoped permissions
and adds the missing department-transfer warning; it does not widen access.
Automatic release34757536480 was skipped and arm=false was read back. No app
replacement occurred. This checkpoint supersedes the older diagnostics below;
the exact full proof, release, tunnel check and real employee onboarding remain open.
The follow-up bounded local run passed all four scoped-staff markers and the two
real login/dashboard + department/title-only browser tests (9.5s browser phase;
receipt01a09ad834dd73328cab5a736792edc0). Focused checks passed46+9. This closes
the local baseline mismatch, not the full release gate or real employee acceptance.
Migrations155–157, editable roles/scoped assignments and prepared invitations are
implemented; the full expanded local onboarding/business proof passed on `451944cd`.

- **Current local PASS (`451944cd`):** actual Admin invitation form, Auth/Mailpit/
  password/login, role catalogue, consecutive member edits, independent
  department/direction/combined case reads and assigned-role archive completed
  with exit0 and all five required markers. Owned local resources were removed.
  The prior intermittent failures did not recur; their cause is not established.
- **Current release blocker:** all six fast checks passed in CI34754199878 on
  reviewed746cbd7f; independent whole-S2 approval preceded the merge. Managed
  schema155–157 was applied by34754696541 and check34754823366 proved157=157
  with no missing/extra versions. Full exact-main CI34754654192 failed at
  `DEPARTMENT_READ_CARD_URL_BROWSER_CONSOLE_OTHER`, after successful authority,
  case/member readback and URL checks. Investigate the console failure without
  suppressing it; the earlier fixture/DDL gates are closed. Release arm remains
  false, no app replacement occurred, accepted app77cde9ba is unchanged.
  A bounded local rerun identified `REACT_LIST_KEY`; actual TrendChart execution
  reproduces duplicate grid keys at zero/one leads. The one-line grid correction
  and actual-component regression pass42 focused checks and scoped ESLint;
  new browser/full-release proof is still required.
  Follow-up6e353819 completed database reset and invitation/login but stopped at
  role creation: the enabled SSR button had no handler at the attempt. PR748 now
  also gates role controls until hydration using the existing React pattern;
  its real SSR regression passed after failing before the gate. The original
  positive browser workflow remains required. The earlier disposable reset
  failure is not diagnosed or silently counted as PASS.
  Latest47f0687e local proof completed invitation and onboarding, but stopped at
  `DEPARTMENT_READ_CARD_URL_BROWSER_CONSOLE_HYDRATION`. Its disposable project
  was removed; there is no browser PASS or release permission from this result.
  Diagnose the mismatch at the first affected component before another fix;
  distinguish native disclosure interaction from server/client render differences.
  The diagnostic-only repeat confirmed `HYDRATION_DETAILS_OPEN` in staff invite.
  PR748 now replaces the three staff disclosures with hydration-ready buttons
  and mounted hidden content. Actual component browser checks pass at1440/393px
  (early click blocked, Space/Enter, draft retention, no console errors);46 focused
  checks and scoped lint pass. The full positive workflow is still pending.

The following checkpoints are historical, not additional current blockers.

- **Earlier local proof (`02497173`):** actual Auth/Mailpit/password/login, full unused-role catalogue
  lifecycle and two same-card member-assignment saves with live V+1/V+2 and exact
  restoration. Owned test resources were removed; screenshots cover the final
  catalogue draft only. Earlier source findings are closed, not whole-S2 approval.
- **Previous local check (`21cc76cb`):** whole onboarding stopped at role-editor
  `CREATE_ID`. Individual invitation/acceptance markers were not retained in the
  failed output. The cause is not established; no product fix is claimed.
- **Previous CI:** CI34750378975 on `21cc76cb` stopped at
  `staff_backfill_owner_scope_requires_review`: DETAIL reports
  `selected_owner_missing_case_scope: 3`; the other three categories are zero.
  Source tracing found three incomplete P135 synthetic handoff snapshots; their
  fixture-only correction is independently reviewed. The product guard is unchanged.
- **Previous complete local proof (`6ae41a2a`):** `--staff-onboarding-only` exited 0 with
  invitation UI, role editor, member editor and onboarding verified. Owned local
  project cleanup was checked; desktop/mobile screenshots show the final role
  catalogue only.
- **Previous CI blocker:** CI34751346856 passed the earlier owner-scope guard, then
  failed at migration155:1297: `cannot ALTER TABLE staff_role_definitions because
  it has pending trigger events`. The RLS ALTER statements are now moved before
  backfill with guards and constraints preserved; populated upgrade still needs CI.
- **Archive correction:** compact impact preview/confirmation and fingerprint
  binding are implemented and independently source-reviewed in `40dc3498`.
  The assigned-role runtime scenario subsequently passed on451944cd.
- **Previous CI:** CI34752745887 passed the previous migration155 ALTER point,
  then failed the historical current-actor aggregate. Align that test with the
  accepted live staff identity/scoped-permission contract; preserve identity,
  status and ACL guards. Populated upgrade still needs a successful required CI.
- **Previous local check (`d82a3fc0`):** qualification and handoff progressed, but
  the expanded proof stopped at `DEPARTMENT_READ`; the exact subcheck is not yet
  known. Owned resources were cleaned. Fixed private diagnostic substages are
  source-reviewed and focused tests passed34/34; the next runtime is pending.
- **Previous candidate (`375e58ef`):** actor-contract alignment is independently
  source-reviewed; focused tests10/10 and ESLint pass. CI result is recorded above.
  Its local proof instead stopped earlier at SALES_READBACK; no scope result can
  be inferred. Owned resources were removed. Invitation readback and sticky
  browser-error checks are now separated with fixed private diagnostic labels;
  36/36 helper tests pass, but the next actual workflow is still needed.
- **Next:** verify the corrected chart and interactive role controls in the positive browser workflow, then
  finish the exact-main release gate, accepted deployment and localhost check.
  The ordinary handoff, separate scoped reads, populated migration and whole-S2
  source approval have passed; do not reopen them without new contrary evidence.
- **Separate human gates:** confirmed employee recipients/rights and real first
  login, document/provider acceptance and Docs data transfer. No live activation
  or employee email is implied by local checks.

Detailed source/build/runtime evidence and historical limits remain in the
[S2 contract](design/v3/staff-scoped-authority-contract.md#локальная-проверка-2026-09-13).

## Active follow-up: complete Portal document review and reply notifications

The owner's 2026-09-11 checklist instruction approves closing the staff document
review flow and notifying Students about curator replies. Follow
[the bounded workflow completion plan](design/v3/student-portal-workflow-completion-plan.md).
Email editing and forgotten-password recovery are explicitly excluded by the
owner. Do not add retrievable passwords to application records or change Auth.
Keep the remaining real Student/staff acceptance checklist explicit; Admin
preview, static checks and historical fixture suites do not prove those journeys.
The owner has explicitly approved isolated technical fixtures for required
publication checks. Keep real Student acceptance separate; do not seed production.

Implementation and isolated verification are complete in PRs #736 and #738.
Managed migration153, full CI34591103747 and guarded release34591693323 passed.
Independent server and post-release browser checks confirm accepted `4e35b896`;
release arm is `false`. See the [workflow release record](design/v3/references/2026-09-11-student-portal-workflow-release.md).
Only the explicitly listed real Student business acceptance remains open.

## Active continuation: accepted portal retirement and real working checks

On 2026-09-11 the owner explicitly accepted the new Student Portal, requested
removal of the old portal and authorized full verification wherever existing
real access/data permit, with missing owner inputs supplied later. Execute
[the bounded continuation](design/v3/portal-retirement-real-acceptance-plan.md).
Retire only the obsolete portal RPC with a reviewed forward migration; preserve
all business records and historical migrations. The separate Admin task-reason
exception in #687 is not implied by acceptance of the portal.

PR #735 and managed migration 152 retired only the obsolete v1 portal API.
Exact-main CI 34585205187 and guarded release 34585916884 attempt 2 passed;
independent managed/server/browser readbacks verified accepted `268bbdbc` and
final release arm=false. See the [real verification record](design/v3/references/2026-09-11-portal-retirement-real-checks.md).
Data and v2/task contracts are unchanged. Native available checks passed;
real Student/client and multi-employee paths remain open. Keep actual working
journeys separate from structural checks, Admin previews and isolated proofs.

## Previous accepted release: compact Student Portal

The owner-selected compact desktop/mobile design is published. Follow the
[compact portal contract](design/v3/student-portal-compact-plan.md) and
[release evidence](design/v3/references/2026-09-11-student-portal-compact-release.md).
PR #724 implemented the sidebar, burgundy action workspace and EVO/curator
column; PR #733 corrected an ambiguous E2E selector without weakening assertions.
The first failed CI/skipped release remains recorded in that ledger.

Exact-main CI 34576885307 passed all five jobs. Guarded release 34577575858
accepted `6ac8007fe5f0a323ec1f23e7af23b9443810574e`; independent readback
confirmed matching accepted revision/hash, healthy app/zero restarts, no pending
candidate, public HTTPS live and final release arm=false. Actual post-release
Admin preview through localhost:3000 passed desktop and 320/393 CSS px checks,
all seven navigation routes and the authored English question preview. The
live desktop tab is available to the owner; the isolated port 3001 server stopped.

This preserves the reviewed catalogue, existing real Student read/action paths,
auth and private-assessment boundaries. Admin preview does not prove populated
Student actions, uploads, payments or private test persistence; no such data was
created or accessed for this release acceptance.

## Previous accepted run: complete university catalogue

Owner follow-up #729 (2026-09-11): remove editorial uncertainty notices from
university reading views, omit missing fields/unconfirmed intakes and report
research gaps in conversation. Preserve stored content, real conditions/sources,
photo attribution and publication controls. Transfer confirmed facts from mixed
notes to existing summaries/labels and normally publish only affected cards;
no schema or new facts. Normal reviewed release remains required.

Initial follow-up application was accepted at `1a7f870bb350ef5ab6dd4cd67596d321e3e71cbc`
(PR730; CI34567818877; release34568354768; arm=false). All82 changed cards were
published through the real Admin batch; fresh reload confirms143 current,
0 conflicts and0 remaining. Staff ECUST/APU/EMA and Admin Student EMA readback
confirmed the shared-reader cleanup. Corrective PR731 removed the remaining
instruction from both Student/preview page wrappers. Full CI34573219849 and
release34573853260 accepted `4dc5ead9`; fresh live preview shows the neutral
heading and preserved facts/photo. Batch remains143 current /0 conflicts /
0 remaining; healthy/restarts0, no pending candidate, acceptance hash verified,
release arm=false. Follow-up #729 is complete; no repeat migration/publication.
See the [release record](design/v3/references/2026-09-11-university-clean-reader-release.md).

The owner authorizes the [full university-catalogue completion run](design/v3/university-catalog-completion-run-plan.md):
inventory all eligible institutional KB/raw files, deduplicate and verify official
facts, include correctly attributed real campus photos, publish through existing
Admin authority, deploy and show the same server through the localhost tunnel.
Original catalogue acceptance (historical): PR726, full CI34526967052, managed151
and release34527806723 attempt2 passed.
Real Admin publication and complete five-page readback confirm143 institutions /
251 programmes, all16 original IDs retained. There were136 published changes
and seven already-current records. The tunnel serves this accepted server.
Corrective PR727, exact-main full CI34530087316 and release34530968045 attempt1
accepted `892558b2`. All143 images loaded in the fresh five-page Chrome readback;
both replaced images also loaded in the read-only Admin Student preview.
That batch readback was143 current /0 conflicts /0 remaining, with no repeat
publication or schema apply. Healthy/restarts0, no pending release, public HTTPS200,
acceptance hash verified and release arm=false. This institutional inventory scope
is complete; unknown programme language/duration/intake fields remain explicitly
unconfirmed, not invented. Documentation closeout does not redeploy the app.
See the [production evidence ledger](design/v3/references/2026-09-11-university-catalog-production-acceptance.md).
Preserve raw/privacy
boundaries, source authority, immutable canonical identity and normal release gates.

## Previous follow-up: Admin Student Portal preview

The owner approved [a bounded Admin-only Student UI preview](design/v3/student-portal-admin-preview-plan.md)
after the real browser reproduced the existing Admin `/portal` → staff-home redirect.
Delivered an explicitly marked, read-only preview using the existing Portal UI,
genuine published university catalogue and version-pinned questionnaire content.
No Student identity, case or private attempt is loaded or created; answers remain
unsaved in-memory UI selections. Preserve the ordinary Student/private boundaries.
PR #722 is merged; exact-main CI `34482883741` and guarded release `34483764042`
passed. The accepted pointer and healthy app identify `32693abb`; pending state
is absent and release arm is verified `false`. Real Admin Chrome through the
existing localhost tunnel opened the preview and both authored questionnaires.
Use `/preview/student` (or `/preview/student/tests`), not the Student-only `/portal`.
See the linked plan for proof limits; this is not Student account/persistence proof.

## Historical bounded continuation: Admin, chat and university expansion

The September10 screenshots/request are implemented in
[the Admin/realtime/university expansion run](design/v3/admin-realtime-university-expansion-run-plan.md).
PRs #717–#719 extend Admin responsibility eligibility across Sales/Admissions,
clarify the existing automatic private chat and add reviewed university content.
Auth, private Student assessments, business transition conditions and provider
boundaries remain intact. Genuine Admin lead-form eligibility/private connection
were verified; no lead or chat message was created to claim business acceptance.

Full CI `34466066204` passed all five jobs on exact `a52cca37`; guarded release
`34466804312` accepted that revision. Readback at10:40 UTC confirmed pointer
`v3-r34466804312-a1-a52cca37`, healthy app/restarts0, no pending release, public
HTTPS and localhost health200, and release arm=false. Managed ledger001–150:
149/150 were applied once by `34462429988`, not repeated by later releases.
At that acceptance the catalogue had16 distinct institutions (CN7/MY9),14 photo-backed;11 new
institutions were published through the real Admin approval flow with all10 new
photos loaded. No duplicate records or pending drafts remain. City/APU photos,
OUC source confirmation and further institutional expansion were explicit gaps,
superseded by the current catalogue run above.
The localhost SSH tunnel serves the same Hermes application, not a second app/DB.
See [exact release/publication evidence and remaining acceptance](design/v3/references/2026-09-10-admin-catalogue-release.md).
Do not repeat these schema changes, publications or the prior sales import.

## Previous accepted release (historical)

The previous business-operations correction accepted `f5d0157a92b8929d0f9271e76a99f02b876517de`
(PR #714), version `r32.1-f5d0157a`, after full CI `34424853227` passed all five
jobs and release `34425391638` succeeded, including `Accept exact V3 candidate`.
The permanent Supabase source `iosckaqtovbbnssqcpde` has ledger001–148; the
reviewed tail139–148 was applied once by `34421758765` and checked again by release.
Accepted pointer: `v3-r34425391638-a1-f5d0157a`; at 01:30:12 UTC app/ClamAV were
healthy with zero restarts, public HTTPS and localhost health200, and
`pending-current.json` absent. API readback at 01:30:36 UTC confirmed arm=false,
with variable `updated_at=2026-09-10T01:30:06Z`. SSH PID93942 forwards
`127.0.0.1:3000` to the same Hermes app at `172.16.8.4:3000`; recheck PID/IP before reuse.
See the [production evidence](design/v3/references/2026-09-10-operations-universities-production.md)
for immutable image/acceptance hashes, schema and bounded live Admin/tunnel proof.
The one-time import of 209 sales/4 targets remains the prior reconciled import,
not a new import or evidence of student cases. Two-employee business acceptance
and live Student proof remain separate. No new backup/rehearsal was performed
under the standing owner instruction; retained backups and the previous
accepted `8b70332f` image remain rollback evidence, not a new recovery point.
That image was the immediate predecessor of the f5d0157a release; `76c62b90`
remains earlier acceptance history.
The [September9 acceptance](design/v3/references/2026-09-09-student-admissions-production.md)
and earlier #552/#553 records remain history. Documentation alone does not
deploy a new revision or require repeating this accepted release or schema tail.

## Previous implementation: business operations and universities (2026-09-10)

The owner approves the audited operational gaps, explicitly adds university
pages with pictures/details/deadlines, and requests production plus localhost.
The current contract is [business operations and universities](design/v3/business-operations-universities-run-plan.md).
It builds on merged PR #710; it does not repeat R1–R4 or earlier
Student/CN/MY work. O1/O2 Sales/Finance, O3 Admissions and O5 catalogue run in
parallel; coordinator owns O4 task links/results and shared integration/release.
O0–O5 merged in PR #712, main `cb8e932f7c4cc5cee04c0767519ae6e83ba1df33`.
Exact-head independent review and all six fast checks `34421255285` passed.
Managed schema apply `34421758765` succeeded with dry-run and exact readback
001–148; do not repeat those migrations. PR #713 then merged the test-only
alignment as `8b70332f`; fresh full CI `34422704610` and guarded release
`34423266788` passed. O6 technical release/readback/disarm is complete.
All five reviewed university records were subsequently published through the
genuine Admin UI and confirmed by canonical catalogue readbacks; four photos
loaded in the browser. The coordinator owns the detailed browser/publication record
in the linked production evidence. This does not prove a private Student visit.

The narrow post-release corrections shipped in PR #714 and the then-accepted
`f5d0157a` release. Independent review covered `c39ff6af`, fast CI `34424624216`
passed its selected checks, and the whole local Node suite passed1289/1289 with
no skips before the exact-main full CI/release above. No SQL or schema changed.
The first image's draft-page revalidation hid a successful publication receipt;
the correction now navigates to the canonical result after a validated write.
In the genuine Admin browser, the already-staged APU editorial draft was
published once and automatically opened its canonical detail page with version2
and the revised caveat. No manual navigation supplied that success destination;
do not repeat the original five publications or create a duplicate draft.

The same release supplies only validated public URL/key from the authenticated
server page to chat; private Auth/RLS and private-channel/session checks remain
unchanged. In the genuine Admin Chrome session, `/v3/team-chat` reached
`Обновления подключены`: the existing user's private subscription is verified.
No message was sent and no second employee joined; connection status does not
prove delivery, reconnect or revocation. Both bounded browser fixes are checked.
This handover records the completed release. The next work is the separate
real-employee/Student acceptance checklist and, only when authorized, the
deferred provider lane. Do not rerun this accepted release, migrations or sales
import as an unfinished step.

Historical pre-release failure: full CI `34421761988` stopped at stale task-picker text and browser
selectors for newly nested disclosures. The following media test lacked the
proof file because the first browser flow stopped before writing it; do not
fabricate or skip that proof. Release `34422198926` was guarded/skipped; no app
changed in that failed attempt. PR #713 corrected the expectations/selectors,
with the complete Node suite passing1283/1283 across137 files, before the
successful exact-main CI/release above. This paragraph is not a remaining action.
The standing no-new-backup instruction is recorded explicitly in the new plan;
do not ask it again or fabricate restore evidence. Keep all other release gates,
the existing persistent Supabase project, Auth and deferred WAHA boundary.

## Previous implementation checkpoint: team workspace (2026-09-10)

Completion notice: R1–R4 first shipped in accepted `8b70332f` and remain included
in the later `f5d0157a`; R5 technical release and same-server tunnel are complete.
The current Admin private-chat subscription is verified, but real two-employee invitation/chat/task and
access-revocation acceptance remains pending. The candidate/R0 wording below
is retained as history, superseded by the current checkpoint and
[team-workspace status](design/v3/team-workspace-run-plan.md#9-холодное-продолжение-и-дисциплина).

After planning PR #709, the owner approved implementation of issue #708 and
explicitly deferred WAHA confirmation because employee WhatsApp numbers are
not available. Implement R1–R4 and prepare R5 through its real release gates;
prepare the future provider activation checklist, but do not pair, send,
activate or claim live WAHA success now. Existing real employee inputs are
needed for multi-user acceptance; no new synthetic staff authority is granted.
The planning-only wording below records R0 history, not the current stop point.

Implementation checkpoint: R1–R4 code is integrated on
`izzhackt/team-workspace-implementation` (issue #708). Migrations139–142 add
staff invitation recovery, standalone tasks, native chat and staff workflow
notifications; the Option2 shell exposes the new routes. Scoped checks and a
schema-only migration rehearsal passed; this is not live acceptance or a release.
See the [candidate evidence](design/v3/references/2026-09-10-team-workspace-candidate.md)
and [activation runbook](runbooks/team-workspace-activation.md). R5 remains held
for real staff acceptance, exact-head checks/review and current recovery authority.

The owner requests a current gap inventory and an optimized long-run plan for
employee-only corporate chat and useful task creation, preserving the EVO UX.
The bounded [team workspace plan](design/v3/team-workspace-run-plan.md) is the
next-run contract. Its original R0 checkpoint was planning only; the implementation
checkpoint above supersedes that status without claiming provider or production activation.

Recommended sequence: existing staff Auth/membership administration → parallel
canonical staff-task and native team-chat modules → shared notifications and
message-to-task integration → one reviewed release. Three channels are General,
Sales and Admissions; Student is excluded. Existing Admissions case tasks stay
canonical and gain discoverable entry points; new staff tasks are staff-only,
not nullable-case hacks or a copied Admissions engine. Private Student tests
remain private. Keep one Supabase project and the selected Option 2 shell.

Corporate WhatsApp mirroring is an explicit optional W2 lane; Sales Inbox live
provider acceptance is separate W1. Neither may silently block native chat or
be claimed as working without actual provider evidence. Do not reopen completed
Portal/CN/MY/report implementation, repeat the sales import, revive retired
routes, or apply #687 before owner acceptance. The R0 audit treated the
September9 backup waiver as specific to its original release. The subsequent
September10 instruction explicitly retained no-new-backup authority for this
continuation under O6; do not reopen that resolved question or invent restore proof.

Read-only server recheck during this planning turn confirmed the accepted
revision/image recorded above, healthy app/WAHA containers and HTTPS health200.
No WAHA session or message delivery was checked. #707 is merged as `b53265a1`,
but its menu remains local/main-only, not part of the accepted production image.
R0 uses docs/contract checks and independent review, not a product build or
full database/browser replay. See the new plan for exact acceptance and inputs.

## Completed local follow-up: sidebar Option 2 (2026-09-10)

Production notice: the menu described below is now included in accepted
`8b70332f`. The local delivery sequence and unreleased wording below record
the earlier #707 checkpoint, not the current production state.

Owner selected collapsible department groups from the three visual options.
Implement inside the existing app: Sales → Pipeline / Sales report; Admissions
→ Worklist / Direction summary; shared Inbox / Calendar / Knowledge; Settings
and account controls at the bottom. Preserve fixed-role visibility and server
authorization, original EVO assets/tokens, current page content and all four
Admissions metrics. Keep countries inside Admissions and private Student tests
outside the staff navigation. Settings remains a direct link, not an empty group.

Current-route group opens on navigation; users can collapse or expand groups.
Use query-aware active links to distinguish Main/Sales report and Worklist/
Direction summary. The summary shortcut must actually reveal the existing report.
Explain the empty Admissions list: cases appear after Sales handoff, and China/
Malaysia playbooks are selected inside the case's «Маршрут» tab. Do not create
production cases/accounts to make this UI look populated.

Delivery gates: focused navigation/role/report tests, lint/typecheck/build,
real local browser checks (desktop/mobile, keyboard, query navigation), visual
comparison with selected Option 2, independent review and exact-head PR checks.
No migrations, provider changes, Auth bypass, new database, data imports or
backups. Keep the existing production/tunnel working. Production release, if
performed, must follow the existing exact-main acceptance process; local visual
proof alone is not deployment proof. Implementation and local validation are
complete: build/TypeScript/lint,152 frontend tests and15 role/brand/auth tests
passed; actual desktop/mobile/query/focus checks are in [design QA](../design-qa.md).
The PR records final-head independent review and CI/merge status. Accepted
production remains the revision recorded above until separately released.

## Predecessor UI block: EVO brand and usability refresh (2026-09-09)

This is the bounded PR #692 scope. The current run below supersedes its earlier
no-synthetic-Student restriction and separately authorizes reviewed deployment.

Owner request: apply the British Higher School of Art and Design article and
bring EVO logobook colours/logos into the existing platform. This supersedes the
earlier monochrome-only visual experiment, not its business contracts. Baseline:
`bd4af5cb31f9b17d9c0ec09d4cd7c5f4bbbb2294`.

One cohesive frontend slice, with parallel ownership inside the slice:

1. Ground the visual contract in the article, logobook and current screens;
   record decisions in `design/v3/references/2026-09-09-evo-brand-ux.md`.
2. Refresh shared V3 colour/type/spacing/control tokens. Use original EVO artwork,
   red primary actions, restrained active navigation and neutral work surfaces.
3. Simplify staff navigation/account controls, page hierarchy, student-directory
   search and Sales report. Carry shared branding into login and student portal.
   Preserve existing routes, permissions, data, forms and server actions.
4. Validate the actual build, scoped checks and real authenticated navigation at
   desktop/mobile sizes. No seeded users/cases, mock responses, Auth bypass,
   provider calls or business writes. Empty surfaces stay honestly empty; record
   unavailable real-case coverage separately from successful checks.
5. Independent exact-head review, scoped PR checks, push and PR. Merge only after
   approval. Production deployment is not part of this new visual request.

Acceptance: original logo proportions/clear space, coherent action colours,
readable controls/content, keyboard focus and reduced-motion support, no page
overflow at 393px, no lost actions or changed authorization. No country workflows,
catalogue, parent roles, post-arrival module, schema, authentication or integration
changes. Keep owner-deferred #687 intact.

Status: implementation, production build and 29 scoped source/token checks pass.
The owner signed into the real local Chrome preview. All seven staff routes,
report period/archive filters, actual sales rows, directory empty/search/reset
states and Admin role-preview disclosure were checked at desktop and 393px CSS
width. Mobile filter compression, escaped screen-reader labels causing page
overflow, and stale native search fields after reset were fixed and rechecked.
No business data was written. See the reference note for exact evidence/limits.
The owner separately approved rotating the existing smoke Admin password and
updating the associated GitHub secrets on September 9. Real password sign-in,
verified Auth identity and canonical active Admin authority passed at 11:12:57 UTC;
both GitHub smoke secrets were updated at 11:12:58–59 UTC. No role or metadata change.
The local private ignored `.env.evo-smoke` (0600) is the owner handoff, not repo data.
Staff visual acceptance is now exercised in a real browser, not inferred from
API Auth proof. Student visual acceptance subsequently passed in an isolated E4
runtime: all five pages at desktop, 393px and forced-dark; 6 passed/6 intentional
viewport skips, 15 inspected screenshots. The fixture uses real Auth/Postgres with
a preactivated synthetic case, not proof of the normal invitation flow. See the
reference note. PR #692 subsequently passed independent exact-head review and
CI34358523190 and merged as `198f5551`; do not reset the password again.
The September 8 deployment is predecessor history; the current accepted
production checkpoint is recorded above.

## Current run: Student Portal and China/Malaysia Admissions (2026-09-09)

The owner authorizes the separate [Student/Admissions run plan](design/v3/student-admissions-run-plan.md)
and sustained implementation through reviewed production release. Scope: improve
the existing Student Portal; native English screening and Russian career-interest
assessment with saved private results/profession guidance; full China and Malaysia
Admissions using existing cases/tasks/applications/Finance; direction worklists,
manual partner-message templates and a short manager report. Read [DESIGN.md](../DESIGN.md).

All English questions remain inside EVO. Assessment results are Student-private,
not staff projections or curator assignments. Initial screening reports factual
quiz performance and topic strengths/weaknesses, not a validated CEFR certificate.
The owner supplied both country DOCX sources and delegates uncertain product
choices for documented post-edit; Malaysia is not awaiting a source document.

### Latest owner direction: release, no new backup, persistent source

Historical checkpoint notice: this subsection records the September9 acceptance
of `76c62b90`. It has since been superseded by accepted `8b70332f` with schema148
at the top of this plan; do not repeat the earlier release or migration steps.

Current execution checkpoint: P9 is technically DEPLOYED on `76c62b90`.
The earlier `3b4e08db` full CI `34389680062` failed before deployment and
release `34390292724` was skipped. Stale profile-denial copy, the directory's
route-tab destination and its collapsed workspace were corrected without
changing the real P4 producer or weakening denial/RLS/media checks. The failed
producer had prevented its receipt, causing the secondary D2 error; no receipt
was fabricated. Full exact-main CI `34391182045` then passed all five jobs;
release `34391907814` and its exact-candidate acceptance completed successfully.

The existing localhost3000 tunnel targets the current Hermes app at
`172.16.8.4:3000`, not a second runtime. A real Chrome session using the existing
Admin loaded the branded Admissions worklist, zero-count summary and direction
links. Read-only CN/MY navigation, MY overdue/reset, short-report expansion and
September2026 period submission, plus the Sales report, passed in that session.
This is bounded live Admin evidence, not a full country-case journey,
production Student assessment/invitation proof or owner business acceptance.
Detailed browser outcomes are recorded in the production evidence.
No new synthetic production users/cases or business writes were made. One active
Admin membership and the second legacy Auth identity remain unchanged pending
the exact account-consolidation target. Existing owner waiver and persistent-source
boundaries remain unchanged; #687 still needs its separate owner acceptance.

On September 9, after the backup blockers were explained, the owner explicitly
requested this release without a new backup for now, plus a localhost tunnel to
the same server and one permanent working database. The latest PLAN_CHANGES
entry is the bounded exception to the earlier fresh-export/restore prerequisite
for this Student/Admissions evaluation release. Do not claim either proof passed,
delete retained backups, or bypass any other release control. There is no newly
verified recovery point for current data; image rollback does not undo migrations.

Retain project `iosckaqtovbbnssqcpde` as the permanent product source until a new
explicit owner deletion instruction. No database clone/reset or new local app is
needed: localhost forwards to the existing server. The old CLI-role cleanup and
Auth2 restore-harness extension are deferred with export/restore, not prerequisites
to this release. Exact-main CI, reviewed forward schema, immutable app release,
real authenticated readback and disarm still apply.

Resolve the requested single-account target through actual ownership inventory;
preserve the existing Platform Admin and all data pending that decision. Do not
add a permanent one-user restriction or merge Student-private authority into Admin.
Account consolidation does not require delaying the independent release.

### Implementation and pre-waiver evidence

The owner now explicitly permits bounded fictional Student QA data for this run,
with real Auth/backend/browser and report isolation. This narrowly supersedes the
prior run's no-synthetic-case acceptance restriction, not real-service or release
gates. Production authorization does not imply migrations/features are already
deployed. PR #692's Student visual check is locally verified as described above.
The separate normal invitation flow now passed real isolated Auth/Mailpit/browser
acceptance and merged through #696 (`24267beb`, reviewed `b0a763db`). Private
assessments merged through #695 (`4d122ab5`, reviewed `95c0847a`, all six CI checks
passed); E4 proves both native tests, persistence, private results and failure
recovery, not production use. Admissions #697 contains implemented CN/MY routes
and has passed fresh SQL001–138, independent product/content review and scoped
CI. Final E5 at `452e3e05` passed 8 tests/8 intentional viewport skips: the full MY
route through confirmed arrival/reopen, CN through conditional decision, private
Auth boundaries, races/offline recovery, direction worklists and manager report.
CN beyond conditional through arrival is separately SQL-proven, not claimed as a
full browser journey. Six axe scans found no violations; all 16 screenshots were
inspected; owned isolated runtime cleanup passed. See [E5 evidence](design/v3/references/2026-09-09-admissions-e5-browser.md).
The snapshot projection, route-refresh race and stale visa revision fixes were
independently reviewed and exercised. Frontend140, typecheck and lint passed.
Final reviewed head `806c0b40` passed all six checks in CI `34371092144` and merged
through #697 as `c95a892c` on September 9 at 15:40 UTC. This is not a production
release. Any later product fix repeats its affected gates.

The September9 pre-waiver production preflight reported `0cbb2d42`/schema134,
health200 and arm=false. At that point a fresh backup of current imported data,
its isolated restore/migration rehearsal, final-main CI and controlled release
were remaining gates. The owner subsequently deferred the new backup/rehearsal;
the later completed exact-main CI and controlled release/readback are recorded
in the current checkpoint above. Bounded temporary
read-only backup transport #703 at
`279787cd` passed independent review, focused tests, real isolated PostgreSQL18.6
dump-parity/privilege checks and actual read-only exporter preflight. No live
lease/export/restore was performed. Source inventory found a foreign expired CLI
login role (no active sessions); its collective provider cleanup must not run
without ownership reconciliation and explicit authorization. The exporter must
retain its zero-baseline guard. Source also has two Auth identities, one active
Admin membership and 209 sales: the old recovery exception for exactly one Auth
identity/Admin does not cover this inventory. Aggregate read-only classification
at 15:34 UTC found both Auth identities own separate legacy accounts; only one
has new Platform Admin membership, and neither has Student links. The second
identity is not fully unassigned. A separately reviewed restore contract must
preserve both identities/legacy ownership, check account isolation and absence
of new Platform/Student authority for the second identity; do not loosen a count
check or delete that user. See the [managed read-only checkpoint](design/v3/backup-lease-local-proof.md#managed-read-only-checkpoint--september-9-1534-utc).
#703 merged as `11cfbd306f6c3bceeac1efd4fe8f4005c0badc04`, reviewed head
`62842346`, CI `34372235415`. Export is now deferred; tooling merge is not
cleanup authority.
These were pre-waiver P9 blockers, not unfinished Student/Admissions features.
The latest owner direction above defers that backup/restore path. At that
pre-waiver checkpoint no database password reset, JIT/SSL setting change or
production runtime mutation had occurred; the subsequent app release is recorded above.
Existing #687 rollback exceptions remain under their separate owner-acceptance gate.

## Historical integration and release-preparation checkpoints

The following checkpoints describe earlier revisions, not current blockers or
instructions to rerun the first release. Current follow-up authority follows them.

Verified starting baseline: GitHub `origin/main` at
`d6fc0f4720fcb6a1d012a4bfb4faa4ea1553f47b`
Verified V3 merge target: GitHub `origin/claude/v3-frontend` at
`c53c978e251754509948240fc7eef40d3a74da90`
Verified #594 execution baseline: GitHub `origin/main` at
`bcced0a6c58216479b1d873c08cc7293cbb1edaf` after PR #608 merged the V3
authority reset.
Verified #600 completion baseline: GitHub `origin/main` at
`405201141649805cb8f5d40f633e1483ed582094` after PR #627 made V3 the sole
product surface; exact-main CI run `33935503547` completed successfully.
Verified #551 implementation baseline: GitHub `origin/main` at
`dd11a3da62fe34ff915d88c41d4a53f671c64768` after PR #631 merged the first
unarmed release-controller and repository staging-retirement candidate. The
stricter trust, lifecycle and recovery contract below remains the #551
completion authority.
Verified #551 contract baseline: GitHub `origin/main` at
`0b3d72e40ee19d9fbf711bc2490c9683c677d2ef` after PR #634 merged the
no-staging recovery/release contract; exact-main CI run `33944079179` passed
and production-release run `33944667061` remained safely skipped while the
release arm was absent.
Verified #551 signed-consumer baseline: GitHub `origin/main` at
`72ce0a4b480ac63c12dca4a25b295ad04c7a7cf9` after PR #640 merged the
result-v2 signed-artifact, lineage, isolation, exact-image and cleanup
architecture. That merge was not #551 completion: it was not exercised with
Docker and a post-merge audit found production-local TLS, real product-route
malware-scanner, provider-readiness, private Node/buildx and complete role-
outcome proof still missing. At that checkpoint #551 remained open and #552
remained unarmed pending a corrected exact-head rehearsal. Both are now closed.
Historical release-preparation baseline: GitHub `origin/main` at
`f3c591ee40a5f76e4279e74adbc2c20a82958077`; manual full-proof run
`33982734454` succeeded for that exact SHA, while downstream release run
`33983142821` remained safely skipped because the production arm was absent.
For a candidate actually being released, a merged correction changes its SHA
and requires one new manual full proof after freeze. This is not an instruction
to redeploy the accepted baseline for a later documentation-only amendment.

## Current follow-up: approved curator and light UX improvements (2026-09-08)

The owner's September 8 selection approves only recommendations **2, 3, 4,
6 and 8** from the fourteen-item business/product review: own operational-task
deadline/priority changes; acknowledgment of Sales handoff; one permitted
student history; curator workload/absence/coverage; and a clearer existing
student portal. Item 9 (parent/payer feature) is rejected; 10 (offer comparison
and catalog extension) and 13 (new post-arrival scope) are deferred. Items
1, 5, 7, 11, 12 and 14 are not approved by this selection.

The executable scope, unchecked acceptance list and UX criteria are in
[the separate September 8 run plan](design/v3/curator-ux-run-plan.md),
with owner wording in [product.md](design/v3/product.md#owner-curator-ux-20260908).
Implementation was explicitly authorized on September 8 and merged with the
Sales report in PR #688. The owner explicitly authorizes deployment
although the live Admin directory has no case on which to perform the real
Curator/Sales/Student workflows before release. That business-case acceptance is
waived and deferred, not passed, and must not be replaced with synthetic users or
cases. The owner will inspect the deployed product afterwards.

This authorization does not weaken the technical release contract: exact reviewed
SHA/current-main binding, required CI, backup, rollback and production health
readback remain mandatory. By the owner's later explicit decision, migration 131
adds `student_portal_overview_v2()` and leaves the existing
`student_portal_overview_v1()` unchanged for one temporary rollback window. The
new application calls only v2, with no fallback; a rollback to the accepted image
continues to use v1. After the owner accepts the deployed portal, a separately
reviewed forward migration must delete v1. The overall 129–133 schema release still
requires migration-history readback and a reviewed database recovery path. It also
uses the owner's September 8 approved minimal cutover guard: migration 129's
canonical task handler permits only a server-resolved Admin to omit `p_reason`,
as the accepted old application does. Explicit blank reasons still fail; Curator
reason enforcement and all ownership/coverage locks remain unchanged. Migration
133 reuses that body; no overload or second runtime is added. After owner
acceptance a reviewed forward migration removes this temporary exception together
with the portal rollback window. Existing isolated CI fixtures are authorized only
for technical checks, never as real business/provider acceptance. The owner also
authorizes a password-only reset of the existing smoke Admin account
conditional on read-only proof that it is already an active Admin, and a localhost
SSH tunnel to the deployed app. This does not authorize new users or role changes.
See the run plan for the exact order, file inventory and proof still required.
Only a small usability polish of existing V3 surfaces/shared controls is in scope;
no platform rebuild, new design system, dense all-in-one screen, extra staff role,
Auth change or provider activation.

The source-backed Sales report is part of the same deployment objective. Its
contract was recorded before implementation in
[sales-report-run-plan.md](design/v3/sales-report-run-plan.md) and the append-only
decision log. Code is on `main` and deployed; the authorized 209-row/4-target
import and duplicate-free repeat/readback are complete. Google was not modified.

### September 8 release checkpoint

- Merged: [PR688](https://github.com/izzhackt/evo_AI_CRM/pull/688) (curator/Sales),
  [PR689](https://github.com/izzhackt/evo_AI_CRM/pull/689) (backup ledger ordering),
  [PR690](https://github.com/izzhackt/evo_AI_CRM/pull/690) (test inventory/reason).
  Frozen candidate: `0cbb2d42d9691fac392864fea72a3f0894826773`.
- Fresh signed backup is complete, not the earlier interrupted export. Artifact
  `evo-v3-managed-export-20260908114631-bf20388b-cd2e-4b94-8810-dfee4ccf576e`
  resides in the private CRM backup directory; receipt SHA256
  `2ca18e7ece4042809016011f2f49222831f572e1f96da91770d0683b16a90580`.
  Source-main `a3c01015`, pre-change ledger 001–128, Auth 2; all 15 checked core
  business relations empty, Storage 0 objects/bytes. Signature, eight ciphertext
  hashes and five decrypted SQL hashes passed. #551 remains the old recovery-engine
  proof under that empty-source condition; no new restore rehearsal is claimed.
- Production schema [apply 34223314795](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34223314795)
  and [check 34223577479](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34223577479)
  passed: exactly 001–134, no missing/extra versions. Read-only catalog/ACL proof
  covered 27 functions, single 11-argument task RPC, private coverage bodies,
  five FORCE-RLS private tables and portal v1/v2 grants. Ordinary real Admin
  JWT → authority RPC → `read_sales_register_v1` returned HTTP 200 and passed
  the canonical DTO parser. This pre-import read had 0 rows/targets and made no
  business write; the later authorized import is recorded below.
- [Full CI 34223961358](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34223961358)
  passed on that frozen candidate: Node/static/build, real browser/database,
  dependency audit and final Main CRM gate. [Release 34224668896](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34224668896)
  also passed, including the normal Admin browser gate and acceptance step.
  Independent host readback at 12:19:24Z confirms healthy app/ClamAV/WAHA with
  zero restarts, external health PASS, no pending release and lock 0. This is
  container health, not live WhatsApp delivery. App/image/OCI revision is `0cbb2d42`,
  version `r27.1-0cbb2d42`, release `v3-r34224668896-a1-0cbb2d42`.
  Immutable image: `sha256:de5b625518efc094f7be1437a4188dc713d2f7979cc66b900c6e55026dc20dda`.
  Accepted pointer SHA256: `bc7275af1d3cbfa3f4c6ef3d95ee75be0a89ed217a842e74bcc6421741c8ec11`;
  acceptance receipt SHA256: `a40439ca8288d4fde009c75cd59336dbbfc40800445c2d8a0fc0357c5f264f89`.
  Rollback remains bound to prior `4e6057f0`. Arm=false was read back twice,
  last at 12:16:19Z. Do not repeat a successful release/schema apply for docs.
- Real Admin import completed: 209 rows and 4 targets inserted; skipped 0,
  mismatches 0. Repeating the same source inserted 0 and skipped 209 rows/4 targets,
  again mismatches 0. Durable readback reconciled all source keys, months,
  currency-specific totals and unresolved counts: 2025 has 22 sales, 2026 has 187;
  archived 0. Safe import evidence SHA256:
  `dffe38b88b391f2ba454ae3153281aae931de253eadcaa42138e61f23e599400`.
  Details and private evidence locations are in the Sales run plan. Historical
  imported records deliberately have no invented pipeline/customer links.
- Owner business acceptance remains DEFERRED. [#687](https://github.com/izzhackt/evo_AI_CRM/issues/687)
  is OPEN for removal of the temporary portal v1 and Admin omitted-reason
  exceptions after owner acceptance. The loopback tunnel is ready at
  `http://127.0.0.1:3000`; local and remote login return HTTP 200 with matching body
  hashes. A separate headed Chrome proof passed through the ordinary Admin login
  form: the 2026 report shows 187 populated records, correct currency totals and
  the Admin-only import control, without a load error. A private screenshot was
  captured at 12:20:51Z; no cookie/JWT injection or Auth bypass was used.
  Chrome remains open at `http://localhost:3000/v3/main?view=sales&year=2026&month=all`.
  The Mac is locked; owner unlock is needed to see the already-loaded window,
  not to complete technical UI proof. Owner inspection is still deferred.
  This is production, not local development; recheck the tunnel target after
  container recreation.

To shorten the release critical path, exact-main isolated CI may run concurrently
with backup/schema preparation while the release arm stays false. Arm only after
all backup, schema and host gates pass and only if that same exact-main CI run is
still running. If CI already completed while unarmed, do not assume it scheduled a
release: keep the arm false until ready, then dispatch a new exact-main proof.

The first release and certification are already closed in #552/#553 on
`4e6057f0159dba6515ea18b412567b48779cf77f`. Preserve that evidence; a new plan
commit does not redeploy the app or reopen completed launch blocks. Apply the
current scoped short-PR cadence, not historical full-gate-per-merge wording.

## Current follow-up: sales report in the platform (2026-09-08)

The owner authorizes replacing the supplied monthly sales spreadsheet workflow
with a year/month report and editable sales register inside V3, importing the
actual source, and deploying it for owner inspection. The executable contract
is [sales-report-run-plan.md](design/v3/sales-report-run-plan.md).
This is reporting data, not automatic contract/payment confirmation or case
creation. Keep currency-specific totals, source provenance, unresolved values,
existing identity/finance boundaries and own-record Sales scope. Google remains
unchanged; after the initial transfer, platform records are edited in EVO.

## Current authority: V3 becomes the managed-Supabase product

The owner has ended both the self-hosted/no-Supabase direction and the
V3-as-side-branch direction. The target is one EVO Admissions CRM: V3 as the
active product surface, backed by the ready-made managed Supabase foundation
retained from V1 and by the already proved server-side business engine now used
by the current staff UI. After controlled cutover and cleanup, `V1`, `V2` and
the unmerged V3 branch are historical implementation labels, not active product
choices.

The preferred foundation is the existing dedicated EVO managed Supabase
project. A read-only audit must first prove its project identity, applied
migration history, `platform`/`platform_private` schema state, staff/Auth state,
private buckets, RLS, data population, backup capability and current consumers.
If that proof fails, stop and record the exact discrepancy; do not silently
create another paid project, reset the existing project or substitute a fake
environment.

The production successor uses:

- root `supabase/` as the only target migration authority;
- managed Supabase Postgres as the only business-data authority;
- Supabase Auth plus server authorization/RLS for real staff identity;
- private Supabase Storage for accepted documents and WhatsApp media;
- Realtime only where a proved product interaction needs live updates;
- the V3 product surface for Sales, Student 360, Admissions, documents,
  applications, visa, finance, WhatsApp and advisory-AI staff experience;
- the V2 human-reviewed Gemini, explicit WhatsApp send, ambiguity recovery and
  idempotent amoCRM command semantics;
- the already connected private sales WAHA transport session `crm_primary`,
  read-only verified `WORKING` with an identity on 2026-09-02, without another
  QR scan or an `evo-inbox` fallback;
- the existing EVO-owned VPS, Caddy, CI/release and private WAHA capabilities
  where the audit proves they are current and correctly isolated.

### Current public hostname

The owner's 2026-09-06 decision makes
`https://evo-crm.72.62.119.112.sslip.io` the sole current production hostname.
The hostname resolves to the EVO VPS from its embedded IPv4 address, and the
existing EVO edge Caddy already serves it with an individually issued publicly
trusted certificate. `EVO_CRM_DOMAIN`, the release external-health URL and all
production browser proof use this sslip hostname. `crm.evoadmissions.com` is
deferred until EVO controls working DNS; it is not a #551, #552 or #553
prerequisite and must not remain as an active parallel route.

The active edge source is
`agent-lead2-inbox/deploy/Caddyfile.evo-edge`. Its one production CRM block
proxies the sslip hostname to `evo-crm-app:3000` on `evo_public_web`. Caddy
automatic HTTPS owns certificate issuance and renewal. Missing or invalid TLS,
an unexpected upstream, or any non-V3 response still stops the release; the
hostname decision does not weaken health, authenticated-browser, exact-image or
single-runtime acceptance.

### V3 integration boundary

`claude/v3-frontend` at `c53c978e251754509948240fc7eef40d3a74da90` is the first
active integration target. Bring its V3 surface onto current `main` before
continuing the successor sequence, reconcile it with the current
Supabase/runtime contract, and then continue on one branch of truth. Do not
blindly merge branch-wide deploy, workflow, archive, SQLite, Drizzle or
runtime-contract changes that would regress completed `main` work or delete
frozen history.

Before any #594 change or merge, read the complete pinned-branch versions of
`CLAUDE.md`, `docs/design/v3/product.md`, `docs/design/v3/frontend-rules.md`,
`docs/design/v3/backend-gaps.md` and `docs/design/v3/handover-to-codex.md`.
Those files are required integration inputs before they become ordinary
`main` files through the merge.

Do not rebuild business logic that already exists. The current server actions in
`src/lib/server/` and the canonical CRM repository remain the product engine.
V3 work connects forms and source adapters to that engine with real server
validation, `useActionState`, authorization checks and `expected_version`
optimistic locking. When V3 gains a proved business action, delete the
superseded V2 screen in the same replacement slice.

Do not rebuild schema or duplicate UI that already has a clear owner. Reuse the
existing Supabase document checklist/review model from migrations 043, 046, 053
and 055, visa cases and commands from migration 042, lead ownership and
extended sales workflow from migration 086, and the platform audit slice behind
`EVO_PLATFORM_P7A_AUDIT_ENABLED`. `src/lib/v3/*` is the V3 data-access rewrite
boundary; prefer changing those source adapters before changing screens. Do not
add a third university-application status dictionary or an in-app WhatsApp
channel-connection flow.

The production successor does not keep Drizzle `evo_*`, SQLite, the two-field
development gate, application-local private document bytes, old manual or
autonomous messaging workers, superseded provider adapters, duplicate UI,
dual reads/writes or a fallback repository as a second active path. V2-only
business gaps move into `platform` or `platform_private` with immutable forward
Supabase migrations. Cleanup happens in the same slice after real replacement
proof; historical migrations, ADRs, runbooks, archived docs and evidence remain
preserved.

### Execution and production gates

Work executes as coherent sequential launch-control PRs. Every PR requires an
independent exact-head review, scoped real tests for the behavior it changes,
the short protected PR checks and a match-head merge. Routine PRs and pushes to
`main` do not automatically run the full PostgreSQL migration/RLS, local
Supabase and Chromium suite. That full suite runs manually once, only after the
release-candidate SHA is frozen on exact current `main`; unchanged evidence is
reused rather than rerun. A candidate SHA change invalidates that proof and
requires one new manual full run. A slice still includes a scoped import/runtime
inventory showing that the superseded path is no longer active and a
fail-closed proof showing that the app does not fall back.

The validation pipeline itself is risk-routed and non-duplicating. The one
manual release-candidate proof applies the forward migration chain once through
`supabase db reset`, then exercises real local Auth, RLS, Storage, application
and Chromium outcomes against that same Supabase state. The historical
intermediate-migration boundary harness remains a separate named gate and runs
only when migration or boundary-test inputs change; it is not replayed inside
the final proof. Aggregate Node coverage resolves to one deterministic unique
test manifest, so composed npm suites cannot execute the same test file twice.
On fresh GitHub-hosted runners the browser install is limited to Chromium's
headless shell and occurs only in a job that will actually run browser proof.
For code requiring a production build, `next build` is the TypeScript/build
authority and standalone `typecheck` is not repeated; ESLint remains a separate
gate. Documentation-only changes keep the required `Changed range` and `Fast
checks` contexts visible, but run only diff and applicable contract checks.
Unknown or empty ranges fail the classification guard; mixed known paths select
the union of their risk-matched gates.

Repository changes, read-only provider/deployment inspection, isolated local
Supabase work and isolated recovery/migration rehearsal continue without
routine approval pauses. The owner has authorized #552 to perform the bounded
V3 production deployment and active-runtime retirement without another routine
approval request, but only after all of these are true:

1. the exact managed project and production runtime are identified;
2. separate recoverable pre-change artifacts exist for managed Supabase
   Postgres and, for private Storage, either a signed exact empty-source
   inventory or a non-empty object-byte backup; the applicable restore,
   empty-source and lifecycle/scanner paths are proved without inventing source
   bytes;
3. forward migrations and data reconciliation pass only on an isolated,
   loopback-bound OrbStack copy whose source and destination identities are
   demonstrably different, using the minimum authorized representative data;
4. real Auth, RLS, Storage and CRM browser workflows plus provider
   configuration and fail-closed readiness checks pass; live Gemini/WhatsApp
   delivery is not an active gate and must not be claimed;
5. the production document path has one real malware scanner and proves clean,
   detected, unavailable, timeout and recovery outcomes fail closed;
6. the no-dual-write/no-fallback inventory passes;
7. an exact rollback boundary and maintenance sequence are recorded.

The final cutover performs one bounded authority switch. It does not operate
V1 and the successor indefinitely. Active V1 code, SQLite data path, old
workers, old routes/config and stale dependencies are retired only after the
new path is accepted; historical and rollback material remains preserved.

### Active production-successor sequence

| Order | Issue | Slice | Outcome |
| --- | --- | --- | --- |
| 0 | #594 | Merge V3 | merge `claude/v3-frontend` into current `main`, preserve #585-#587 cleanup, resolve the route contract and run the V3 quality gate |
| 1 | #595 | Sales decisions and handoff | wire stage/next action, contract/first-payment evidence and the atomic Admissions handoff into V3, then remove only their superseded V2 controls |
| 2 | #596 | Inbox and provider commands | wire human-reviewed Gemini proposals, explicit WhatsApp send and explicit amoCRM commands into V3 while production providers remain disabled |
| 3 | #597 | Admissions operations | wire tasks, applications, visa, finance stop and private documents into the V3 profile/calendar, then remove their superseded V2 controls |
| 4 | #598 | Remaining Supabase reuse | expose the existing Admin-only audit CSV export in V3 and verify that #597 already supplies the approved two-state canonical document checklist and complete canonical visa snapshot without duplicate work |
| 5 | #599 | Confirmed schema gaps | complete the confirmed V3 gaps through forward Supabase migrations: case-level document add/remove/rename plus group and baseline/custom metadata while preserving the `нет` / `есть` surface, private company knowledge files, explicit all-day task deadlines, exact first-qualified-entry evidence for the selected lead-creation cohort, one explicit main university application with its university-owned all-day deadline, and case-safe document links; reuse the existing staff, profile, payment and case-task authorities |
| 6 | #600 | One V3 UI | move the authenticated root to V3 and remove the remaining superseded V1/V2 screens and dead runtime code after replacement proof |
| 7 | #551 | Release and recovery without staging | gate a same-repository exact-green-main release behind an explicit fail-closed arm, keep schema apply manual, and prove separate database/Storage recovery, isolated migration rehearsal, malware-scanner failure/recovery and first/later application rollback |
| 8 | #552 | Production deployment and retirement | deploy the exact green V3 revision, verify it, and retire the superseded active runtime without a fallback path |
| 9 | #553 | Completion audit and safe cleanup | certify one exact-main live product authority, then remove only inventoried stale branches/comments while preserving history |

#551 replaces the active manual fast/staging release workflow rather than
adding another deploy lane. `EVO platform CI` is the manually dispatched full
release-candidate proof and accepts only exact current `main`; it has no PR or
push trigger. One downstream workflow listens only for its successful
same-repository `workflow_dispatch` run.
Its fresh secretless build job has only read access, no production Environment,
secret, cache, SSH or Supabase access, and builds only after the event, current-
main, fail-closed arm and original-actor-ID guards pass. It uploads only one
immutable image archive and closed manifest, bound to the same workflow run and
source SHA by numeric artifact ID plus GitHub and archive digests. A separate
fresh privileged deploy job independently repeats every guard before any
production secret or access, downloads only that exact artifact ID, treats it
as untrusted data until all identities pass, never executes artifact-supplied
code, and obtains its release code from a second credentials-disabled exact-main
checkout. One non-cancelling concurrency group plus one host lock serialize all
production mutations.

The downstream release lane has no direct `workflow_dispatch`, staging job,
GitHub Environment reviewer or schema-apply step; only the upstream full-proof
workflow is manually dispatched. `EVO_PRODUCTION_RELEASE_ARMED` remains absent
or not exactly `true` through #551, and the exact original workflow actor must
match canonical repository variable `EVO_PRODUCTION_RELEASE_ACTOR_ID`; #552
configures both only after every schema, recovery, scanner and staging-
retirement gate passes. #551
removes the active staging Compose/env/profile/CLI/test contour and archives
the superseded staging runbook under `docs/archive/v2/`; #552 retires the exact verified
non-production managed Supabase staging ref and remote/GitHub contour under the
recorded owner authority, then proves their absence independently. Historical
runbooks and evidence remain unchanged. Immediately before the first SSH or
mutation the deploy job repeats current-main, CI, arm, actor, artifact and
migration-ledger checks. Under the host lock it snapshots `.env.production`
once without symlink following into a generation-owned mode-`0600` file,
validates and probes Supabase credentials only from that snapshot, and binds its
hash to release/rollback state; no later Compose call reopens the mutable source.
It then replaces only `app`, preserves private WAHA and volumes, and records a
protected pending candidate. Every first or later V3
candidate becomes authoritative only in the named acceptance step after exact
image, health and authenticated V3 browser proof. Until that atomic current-
accepted pointer change, the exact prior absent/frozen-V1/accepted-V3 state is
the sole rollback target; ambiguous state and every superseding release fail
closed. Schema recovery stays forward-only and schema apply remains a separate
#552 action followed only by a clean same-SHA all-jobs rerun.

#551 recovery proof uses no managed staging project. A read-only encrypted
database export and a separate private-Storage object inventory, plus object
bytes only when the signed source inventory is non-empty, are restored or
validated only inside a disposable local OrbStack Supabase contour with
provider configuration absent and outbound provider actions blocked. The rehearsal
binds the signed export to its exact source Git commit and migration tree. When
that source was squash-merged, one explicit integrated-equivalent commit must
have the identical complete Git tree and migration tree, and that equivalent
commit—not the pre-squash SHA—must be an ancestor of the target. The
authenticated database history is independently required to be the exact
ordered prefix of both source and target migration roots, while the complete
source Git migration root must be the exact ordered prefix of the target root.
Either ordered relationship may be equal when a later authentic backup is
already fully migrated; the current signed export must still prove its real
database suffix `080`-`116` and source-code suffix `115`-`116` exactly.
The rehearsal applies every target migration after the restored database
history and records the database-pending and target-only source-code suffixes
separately.

The signed 2026-09-05 source history contains exactly three closed legacy
anomalies. `038 authorization_containment` and `039 private_inbox_media` have
signed empty statement arrays even though their source Git migration files are
non-empty. `030 ai_knowledge` has the same 36 executable statements as its
source Git file, but two recorded statement strings retain earlier comment text.
The consumer may accept only those exact version/name and signed-row/statement-
digest/root-file/statement-digest tuples. It must bind both sides into durable
evidence, while every other recorded row still requires exact statement-count
and statement-digest identity. A different version, name, count, digest, extra
empty row, missing Git migration or reordered prefix fails closed. This is not
permission to reconstruct or edit signed history: the restored ledger remains
the signed database ledger, new rows come only from the verified pending Git
suffix, and recovery still restores the signed schema/data artifacts before
applying that suffix.

The recovery target is bound to the exact clean target checkout, a verified
private Git snapshot and a locally built `linux/amd64` production image that is
run by inspected image ID. Locked dependency acquisition is the only build-time
network use. Before restore, the harness requires the exact reviewed
service-to-image-ID allowlist for the six local Supabase services both at their
local tags and again on the running containers. The disposable runtime has one
owned user-defined Docker bridge with IPv6 disabled, IPv4 masquerading disabled,
and every published port bound to loopback. A working private-network TCP
positive control followed by a bounded public IPv4 TCP/443 denial probe runs
independently inside the database, candidate-app and scanner containers; any
missing probe capability, successful public probe, enabled masquerade, wildcard
port, unexpected alias/container-shape change or second network fails closed.
Before interpreting a timed-out public probe, the harness calibrates the pinned
container image's own `timeout` exit behavior against a local sleep and accepts
only that exact calibrated timeout status (or an immediate connection-denied
status). The complete owned container, volume, network and image identity is
captured before the first public probe so a probe failure can still perform
strict identity-bound cleanup instead of leaving an avoidable quarantine.
These claims are deliberately limited to the exact inspected bridge and probes.
Docker documents that bridge masquerading supplies external access, that
`com.docker.network.bridge.enable_ip_masquerade` controls it, and that
`com.docker.network.bridge.host_binding_ipv4` controls the default publish
address: <https://docs.docker.com/engine/network/drivers/bridge/#options>.
The reviewed Playwright Chromium revision, path, owner/mode, version, launcher
SHA-256 and complete application-bundle manifest are exact bindings checked
before execution. The manifest binds every directory, file byte digest,
executable mode and contained relative symlink; the exact lockfile registry
integrity plus installed-tree manifests bind `@playwright/test`, `playwright`,
`playwright-core` and the macOS optional runtime before dynamic import. Node's
documented module-relative `import.meta.resolve()` result must remain inside that
reviewed package root: <https://nodejs.org/download/release/latest-jod/docs/api/esm.html#importmetaresolvespecifier>.
The harness copies those exact trees into its unique private recovery root,
rechecks the live source and copied manifests for identity, then imports and
executes only the private snapshot so a concurrent install/cache replacement
cannot change the attested runtime. An ambient `PLAYWRIGHT_BROWSERS_PATH` is
forbidden. Chromium version inspection and the browser itself run only under a
macOS `sandbox-exec` policy that permits loopback and denies other outbound IP
traffic, with both allowed-loopback and denied-public runtime controls. Its CDP
endpoint must be the reserved
`ws://127.0.0.1` port and exact browser path. The harness
also blocks every browser HTTP request and every WebSocket before page creation
using Playwright's documented `BrowserContext.routeWebSocket` interception:
<https://playwright.dev/docs/api/class-browsercontext#browser-context-route-web-socket>.
The trusted OrbStack Docker frontend is a verified multi-call executable: the
recovery harness executes its resolved allowlisted binary with `argv[0]`
explicitly fixed to `docker`. It must not invoke the resolved `docker-tools`
basename, follow an unverified PATH fallback or bypass the exact `orbstack`
context.
The recovery scanner is a distinct runtime resource with its own exact type
and project labels and exactly-one census; it must not share or weaken the
exactly-one candidate-app owner identity. Every disposable container and
volume is enumerated, inspected and matched to its exact project/type labels
before removal. A same-name collision, missing or conflicting label, duplicate
type, or incomplete inventory quarantines the private contour; cleanup never
removes a container directly by a planned name. The streaming SQL-artifact
validator must observe exactly one matching `\restrict` before its
`\unrestrict`, not merely count equal guard tokens.
Cleanup is also bound to the immutable network, Supabase-census, scanner,
candidate-app and TLS-proxy IDs captured at creation/validation, plus the exact
validated volume-name census. The candidate image must be the one captured
image ID with its sole expected tag and complete revision/tree/archive/build
provenance; an inherited-label image or any identity drift quarantines rather
than expands the deletion set. Every reserved ownership label must be absent or
exactly correct for the selected resource category. The private plaintext root
keeps its exact owner/mode/content marker until all non-marker children are
removed; final-directory failure atomically restores that marker and never
falls back to recursive root deletion.
Before image removal, the all-container inspection must prove that references
to the captured candidate image are exactly the still-present captured app and
TLS-proxy containers, then zero after their removal. Image deletion is
non-force so a new foreign reference fails closed. Each volume identity binds
its captured name, `CreatedAt`, driver, scope and full label/options hashes;
same-name recreation or metadata drift quarantines. Volume removal is also
non-force so an in-use or raced reference cannot bypass Docker's protection.
The rehearsal reconciles aggregate counts rather than publishing
customer rows, proves the safe available Supabase Auth/RLS/private-Storage and
V3 browser behaviors, then destroys the disposable contour and atomically
retains only mode-`0600` redacted evidence outside the runtime directory.
Database and Storage proof are independently required because a Supabase
database backup does not contain Storage object bytes. The current managed
production source is explicitly one confirmed Admin and zero private Storage
objects. For that exact state, a signed source inventory proving zero objects is
valid release evidence because there are no source bytes to restore. It must be
reported as exact empty-source inventory evidence, not as source-byte recovery.

Admin-only managed proof must use the normal Supabase Auth/session path, load
the V3 shell and demonstrate the Admin presentation preview of Sales and
Admissions while the actual live authority remains the Admin identity. Missing
live Sales and Admissions users are not fabricated. Their RLS and business
outcomes remain isolated-local proof only and must be labelled explicitly as not
live staff acceptance.

Private Storage lifecycle and scanner proof remain required through the real
product document path: an authenticated controlled proof file is scanned,
stored, finalized, downloaded, rejected on the safe detection sample, denied
when the scanner is unavailable or times out, and recovered only after a clean
rescan. That lifecycle/scanner result proves the current product path, but it is
not source-byte recovery and cannot substitute for source object bytes when a
source inventory is non-empty. If a future or incident source contains any
private Storage objects, the full disaster-recovery proof is strict again: the
exact object-byte export, bucket/count/size/checksum reconciliation, private
restore and signed-access checks are mandatory. A missing backup directory,
missing source credentials, missing non-empty object bytes, or any unsigned or
ambiguous Storage inventory is a named blocker, and synthetic identities,
records or objects cannot satisfy this gate.

The signed source bucket rows and, when present, object bytes are reconciled
before target Storage configuration is applied. Only after that exact source
proof, the consumer restores the exact target commit's `[storage.buckets.*]`
declarations as its contract and reconciles them through the local Supabase
Storage bucket API. It lists the API inventory before and after the change and
requires every configured bucket's privacy, byte limit and MIME allowlist to
match before any application lifecycle/scanner proof starts. The complete final
inventory must equal the exact source inventory with target-config buckets
overlaid, so a source-only bucket cannot disappear or change behind an equal
count. An `objects_path` is forbidden in this recovery gate so configuration
cannot inject fixture bytes. Target bucket creation is forward infrastructure
rehearsal: it neither changes the signed source-recovery counts nor satisfies a
non-empty source-byte recovery requirement. Supabase documents bucket declarations
in the [CLI config reference](https://supabase.com/docs/guides/local-development/cli/config)
and the bucket lifecycle in
[Creating Buckets](https://supabase.com/docs/guides/storage/buckets/creating-buckets).
The private-document canary consumes the Storage API's raw `/object/sign/...`
response only after resolving it beneath `/storage/v1` on the exact local API
origin; a different origin, object path, fragment or query shape fails closed.
Because the managed schema export intentionally excludes extension-owned
`pgmq` objects while the signed data export retains queue rows, recovery must
recreate only the two migration-045 queues before loading `data.sql`. It binds
the exact four `q_*`/`a_*` COPY sections and their column order, recreates two
logged non-partitioned metadata entries and two identity sequences, reapplies
the migration's deny ACLs, requires its exact `create`, `read`, `send`,
`set_vt` and `archive` worker signatures, and then inspects direct, inherited
and `SET ROLE`-reachable column, function and additive default grants plus
schema/relation/function/default-ACL ownership for every browser/service role.
The same inspection runs before data, after signed row-count reconciliation
and again after pending migrations; the final inspection never repairs ACLs,
so a bad target migration fails instead of being masked. PostgreSQL documents that a
per-schema default `REVOKE` cannot cancel a global or hard-wired default grant,
including default `PUBLIC EXECUTE` on future functions. Therefore only explicit
current-object revocation plus the repeated effective-privilege inspection is
claimed here; the harness does not promise automatic containment of unknown
future extension objects. Supabase's PGMQ reference confirms that
`pgmq.create(text)` creates a queue, while its Queues quickstart documents the
paired `q_<name>` and `a_<name>` tables and warns that direct queue tables do
not receive RLS by default:
<https://supabase.com/docs/guides/queues/pgmq> and
<https://supabase.com/docs/guides/queues/quickstart>. PostgreSQL default-
privilege behavior is authoritative at
<https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html> and
the inspected catalog is documented at
<https://www.postgresql.org/docs/17/catalog-pg-default-acl.html>.

#600 keeps the proved `/v3/*` module URLs and makes the authenticated root a
role-aware dispatcher into them: Admin and Sales enter `/v3/main`, while
Admissions enters `/v3/calendar`. The V3 shell retains logout and Admin's exact
role-preview control, and route visibility follows the selected presentation
role while every mutation continues to authorize the real Supabase staff
identity. Existing contract-draft/report behavior moves into V3 Student 360 and
provider-readiness browser proof moves to V3 before `/clients/:id` and the
remaining V2 staff routes are removed. V3 Student 360 must also retain the
canonical case directory outcome: strict name/route/country/UUID search,
pending/active/closed filters, bounded keyset pagination and direct access to
arbitrary authorized cases rather than only the first picker page. Bare
`/v3/profile` is the directory landing; only one exact `id` or `case` parameter
opens a person, and UUID search uses the RPC's exact case-id filter. Admin role
preview keeps Admin-authorized row scope but down-projects fields, actions and
links to the selected role surface. Each role
home must render the role-scoped canonical operational snapshot: `/v3/main`
for Admin/Sales and `/v3/calendar` for Admissions. Together they retain Sales
overdue and unassigned work, Student 360 attention, Admissions overdue tasks,
Finance stops and open WhatsApp queues; the Sales funnel remains on
`/v3/main`. The canonical
Supabase readers, `src/lib/server` engines and private P6C operations endpoint
remain; #600 does not enable providers, transfer webhooks, deploy or apply
schema.

The final #599 slice extends the existing case-document authority rather than
creating another document or visa model. It uses one typed link relation with
separate application and visa foreign-key columns, a mutually exclusive target
shape and organization-and-case-qualified foreign keys to both endpoints; it
never stores an unqualified polymorphic target id. One authenticated
Admin/Admissions command links or unlinks one exact target for an active slot,
requires the slot's optimistic version plus a unique request id and reason,
advances that same slot version exactly once, and writes the canonical audit
result. The staff document-workspace projection returns sorted links through
`src/lib/v3/*`; the existing V3 Documents tab is the sole editor. Direct table
writes, a second status dictionary, student-portal mutation and
provider/deployment changes are outside this slice.

Every retained V3 screen is either a real canonical read or an honestly
unavailable action. Browser-only stage, task, file or document mutations and
success messages are prohibited. The corresponding controls entered V3 only
with their canonical server actions and durable proof in #595 through #599;
#600 retires the replaced routes instead of keeping redirect or UI fallbacks.

The previous managed-Supabase successor sequence through #550 is complete and
remains historical evidence below. Issues #551 through #553 now follow #600;
their old staging-first text is superseded by the no-staging recovery, direct
deployment and exact-main audit contracts above.

### Deferred provider and data changes

- live Gemini/WhatsApp delivery proof, provider enablement and webhook-ownership
  transfer;
- broad historical-data migration or any provider/customer mutation not named
  in #552.

No staging environment is created. Supabase migrations are developed and
proved against the real local stack and an isolated copy, then applied as a
separate controlled schema step in #552. Application deployment follows only
after exact-commit CI success and must retain immutable-image rollback.

### #551 V3-H release and recovery contract

#551 replaces the current manual/staging release lane with repository controls
and isolated recovery proof. It does not configure GitHub or VPS secrets, arm a
release, deploy, apply production schema, change provider/webhook state, or
touch production traffic or customer records. Those production actions remain
in #552 after every prerequisite below passes.

1. **Trusted manual-proof entry.** The release workflow is triggered only by a
   completed `EVO platform CI` `workflow_run` whose conclusion is `success`,
   event is `workflow_dispatch`, branch is `main`, head repository is exactly this
   repository, `head_sha` still equals fetched current `origin/main`, and the
   original `github.actor_id` exactly equals the raw GitHub repository variable
   `EVO_PRODUCTION_RELEASE_ACTOR_ID` configured in #552. That variable is one
   canonical positive decimal account ID matching `^[1-9][0-9]*$`; comparison
   is byte-for-byte without trimming or numeric conversion. Missing, empty,
   malformed or unequal values fail closed. A different `github.triggering_actor`
   on a rerun cannot supply or elevate authorization.
   Because `workflow_run` is privileged, build and deploy are different jobs on
   fresh runners. The secretless `build` job has explicit `contents: read`, no
   Environment, production secret, cache, SSH or Supabase access, rejects every
   upstream artifact and performs a credentials-disabled checkout/build only
   after its admission guard. It uploads once a run/SHA-qualified immutable
   image archive plus closed manifest and exposes the numeric artifact ID and
   GitHub SHA-256 digest. The separate `deploy` job receives no workspace/cache,
   independently repeats every non-secret guard from the job-dispatch variable
   snapshot before production secret, SSH or Supabase access, downloads only
   that same-run artifact ID, verifies the
   GitHub digest and manifest/archive/image/OCI identities, and never executes
   artifact-supplied scripts or Compose. Release code comes from its own second
   credentials-disabled exact-main checkout. Production secrets are scoped only
   to later minimum steps after artifact and trust checks pass.
   Immediately before first SSH, transfer or production mutation, `deploy`
   freshly fetches `origin/main`, re-reads the raw arm and actor-ID repository
   variables, and repeats repository, event, branch, SHA, exact actor-ID,
   successful-CI, artifact ID/digests/manifest and migration-ledger gates. The
   server preflight independently binds that complete state to the candidate.
   Because GitHub interpolates `${{ vars.* }}` before dispatching a job, the two
   fresh variable re-reads use the Variables REST API and one repository-scoped
   `EVO_GITHUB_VARIABLES_READ_TOKEN` limited to `Variables: read`. This narrow
   control-plane exception is referenced only in the final pre-SSH and
   pre-acceptance guards; it never reaches `build`, initial deploy admission,
   candidate code, artifacts, checkout scripts, Supabase/VPS commands, the host
   controller or evidence. Any API/schema/raw-value mismatch stops. #552 owns
   its installation, rotation and revocation before arming.
2. **Explicit fail-closed arm and actor binding.**
   `EVO_PRODUCTION_RELEASE_ARMED` is disabled when missing and permits release
   only when its raw value is the exact lowercase literal `true`.
   `EVO_PRODUCTION_RELEASE_ACTOR_ID` is the sole actor-authorization source and
   must be one raw canonical positive decimal ID matching `^[1-9][0-9]*$`, with
   no whitespace, sign or leading zero. It is compared as a string with the
   original step-only `github.actor_id`; login, `github.triggering_actor`, write
   access alone and other config sources are not substitutes. Both variables
   are checked from the secretless dispatch snapshot before any secret-bearing,
   SSH, build or transfer step, then live through the narrowly scoped
   Variables-read control credential immediately before production contact and
   again before acceptance. #552 owns configuring the required
   secrets and both repository variables after its schema and pre-cutover gates
   pass; #551 only implements and tests the circuit breakers. One constant
   `evo-production-release` concurrency group with `cancel-in-progress: false`
   prevents overlapping production changes.
3. **Immutable app-only release.** The secretless job builds one fresh exact-SHA
   `linux/amd64` image and seals the artifact ID/GitHub digest, archive checksum,
   image/config digests and labels. The separately privileged job revalidates
   that immutable artifact, verifies the read-only Supabase migration ledger and
   transfers through a temporary private release directory. It replaces only
   `app`, preserves private `waha`, its
   `crm_primary` session and all named volumes, and never builds on the VPS.
   Schema application remains a separate, manual #552 action and is never
   executed or rolled back by this workflow. A ledger-mismatch stop continues
   only through **Re-run all jobs** on that same release workflow after the
   separate manual schema action. The rerun preserves the triggering SHA but
   uses the privileges of the original workflow actor, not the rerun initiator.
   It starts clean, freshly re-reads `EVO_PRODUCTION_RELEASE_ACTOR_ID`, requires
   exact equality with the original `github.actor_id`, and repeats both trust
   guards, CI, arm, ledger, checkout and build; it never resumes or reuses the
   stopped run's artifacts or state.
4. **Explicit pre-change, pending and acceptance states.** A release starts only
   from a genuinely
   absent app, the exact frozen V1 app whose image ID, OCI labels and retained-
   file hashes match #552's approved inventory, or an exact previously accepted
   V3 release matching the protected current-accepted pointer. Before mutation,
   it writes exact release state and a protected pending pointer; the previous
   state remains authoritative and the sole rollback target while the candidate
   is pending. Failure/interruption never implies acceptance and an unresolved
   pending candidate blocks another release. State and pending remain immutable;
   after replacement a separate create-once `candidate-runtime.json` binds their
   state hash to the observed container. Missing runtime proof blocks acceptance
   but never prevents rollback from the intact state/pending pair.

   For first cutover and every later release, only the **Accept exact V3
   candidate** step in the fresh privileged deploy job, under the verified
   original actor ID, may invoke `accept-candidate`. It does so only after exact
   image/revision/digest, container, internal/public health and authenticated
   read-only V3 browser proof. Under one lock the controller re-verifies those
   identities, create-once writes a deterministic immutable
   `v3-acceptance-record.json` marked as prepared/non-authoritative on its own,
   then compare-and-swap advances `current-v3-accepted.json` as the sole
   acceptance commit point and removes pending. A crash before the pointer
   commit leaves the prior authority and pending candidate intact; a locked
   retry must rerun all proofs, match the prepared record byte-for-byte and
   resume only that same pointer transition. A crash after pointer commit allows
   only exact pointer/record/pending verification and redundant-pending cleanup.
   Any mismatch or superseding release stops.

   Every release emits one state-bound rollback wrapper. It must prove the
   running image/revision is the candidate installed by that exact release and
   bind release/generation/source, workflow, artifact/archive/image/config
   digests, OCI labels, installed container and prior target. It refuses if any
   newer/superseding accepted/current/pending release exists. An absent-state
   wrapper removes only its pending candidate, never accepted V3; a V1 wrapper
   restores V1 only while first V3 is pending, never after acceptance; an old
   wrapper never overwrites newer V3. Accepted V3 can return only to its exact
   prior accepted V3 while atomically moving the current pointer. WAHA, its
   session and volumes remain untouched in every mode.
5. **Separate recovery paths.** The pre-change recovery set identifies one
   recoverable managed-Postgres backup and a separate signed authenticated
   private-Storage inventory. If that inventory is non-empty, it must include an
   object-byte export with count, size and checksums; if it is signed and empty,
   it is exact empty-source evidence because there are no source bytes to
   restore. Database backup metadata is not file-byte recovery. Restore and
   forward-migration rehearsal run only in a loopback-bound OrbStack copy. The
   gate proves source and
   destination project refs, URLs, networks and volumes are unequal, limits
   application-level verification to a named minimum authorized cohort, and
   never publishes row, object, credential or session data in evidence. Exact
   source bucket/object reconciliation completes before the target commit's
   bucket declarations are reconciled and verified through the real local
   Storage API. A signed exact zero-object source inventory is valid
   empty-source evidence because no source bytes exist; target bucket lifecycle
   and scanner proof remain required but cannot be described as source-byte
   recovery. If the signed source inventory is non-empty, that target upgrade
   cannot replace or waive exact source-byte recovery.
6. **Scanner prerequisite.** Before the release may be armed, both active
   document-ingress paths are bound to the same real scanner implementation.
   Each upload first scans the ingress bytes before any reservation or Storage
   write. Only a server-held service credential may then create the reservation,
   through one post-ingress-scan command that revalidates the authenticated
   actor, membership and exact clean-scan evidence; browser principals cannot
   execute either reservation command directly. After the private object is
   written, the server must download those exact stored bytes, re-verify their
   size, MIME/signature and SHA-256, then scan them again. Durable clean proof
   and document finalization commit in one database transaction, so neither a
   published version nor a downloadable company file can exist without its
   exact stored-byte proof. The scan and its engine/signature identity use one
   request-ID-matched clamd `IDSESSION`: send the first `VERSION` and await its
   correlated reply, send `INSTREAM` and await its correlated verdict, then send
   and await the final `VERSION` before `END`. The socket remains continuously
   drained, and the two recognized engine/signature facts must be identical. A
   clean pre-scan alone is never durable proof.
   The gate proves a clean file is accepted through both routes, a standard safe
   detection sample is rejected, and infected, unavailable, timeout, malformed,
   uncorrelated or identity-drift results deny finalization and download until a
   successful rescan. Missing, malformed, duplicate, unknown or premature
   request IDs fail closed. Missing scanner access is a named #551 blocker, not
   permission to reuse `scanner_proof=false`; this proof does not imply
   WhatsApp, Gemini or amoCRM provider acceptance.
7. **Sanitized evidence.** Evidence binds the exact source SHA, CI run, arm
   result, actor, build/deploy job separation, artifact ID/digests/manifest,
   image, Compose/controller/config hashes, pending/acceptance transition,
   rollback shape, backup identities, restore/migration results and scanner
   outcomes. It contains no secrets, customer rows, object names, session
   identifiers, provider payloads or rendered environments.
8. **Delete the obsolete staging contour.** #551 deletes
   `docker-compose.staging.yml`, `deploy/env.staging.example`,
   `scripts/evo-release-environment-profile.mjs` and
   `tests/release-environment-profile.test.mjs`; removes release-environment
   staging branches/references from the exact scripts/tests/package inventory in
   [`deploy/runtime-hardening.md`](../deploy/runtime-hardening.md); removes the
   staging route from `agent-lead2-inbox/deploy/Caddyfile.evo-edge`; updates
   `deploy/README.md` and root `CONTEXT.md`; and archives the superseded runbook
   as historical-only documentation. This does not remove the private transient
   transfer function renamed from `EVO_RELEASE_STAGING_ROOT` to
   `EVO_RELEASE_TRANSFER_ROOT`, the neutral distinct-config test outcome, or
   business catalog-import staging rows. Before arming, #552 inventories and
   removes only the exact remote staging route/root/Compose project/containers/
   networks/volumes and GitHub `staging` Environment/config, then repeats the
   read-only inventory and requires complete absence. Ambiguity or any survivor
   keeps the lane disabled; production services, data, WAHA/session and
   historical V1/V2 records remain.

GitHub documents that `workflow_run` can access secrets and write tokens and
warns against running untrusted code in that privileged workflow; its
`concurrency` contract permits one constant group to serialize releases. See
[workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run),
[GitHub context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context),
[reruns](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs),
[workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data#validating-artifacts),
[artifact API identity](https://docs.github.com/en/rest/actions/artifacts#get-an-artifact),
[configuration variables](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables),
[Variables REST API](https://docs.github.com/en/rest/actions/variables),
[GitHub token guidance](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token),
and [concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency).

#### Completed #585 Supabase application-runtime and UI replacement slice

#585 replaces the remaining live Drizzle/SQLite application reads, repositories,
routes and duplicate staff screens with the existing canonical Supabase
interfaces. A completed slice has one managed Supabase Postgres business
authority, one Supabase Auth/session and server authorization path, one staff UI
for each retained outcome, and no local-database or compatibility fallback.

The retained product outcomes map as follows:

- the main dashboard aggregates the canonical Supabase Sales pipeline, Student
  360 cases, Admissions task queue, Finance control queue and WhatsApp
  conversations instead of reading local summary tables;
- Student 360 reads the canonical Supabase student-case interface and preserves
  the accepted Admin, Sales and Admissions visibility rules; its existing
  case-to-Sales-lead navigation is preserved through one bounded Supabase RPC
  and is rendered only when the effective fixed role may open `/sales`;
- old Calls follow-up is represented by Sales next actions and Admissions
  tasks, old Chat by the canonical WhatsApp workspace, old Notifications by the
  task/document/finance queues, and old Reports by the canonical dashboard;
- the superseded telephony webhook has no retained successor behavior in this
  slice and is removed rather than routed to a second authority or shadow
  worker.

The old Calls, Chat, Notifications and Reports routes and navigation entries,
the telephony webhook, local database-status surface, SQLite helpers and the
Drizzle-backed canonical repository are deleted once the mapped Supabase
outcomes pass. Missing Supabase configuration, identity, organization
membership or RPC access must stop clearly; the application must never select
SQLite, Drizzle, cached fixture data or an alternate repository.

Acceptance requires all of the following on the same candidate head:

1. focused outcome tests prove the canonical dashboard aggregation, Student
   360 read and fixed-role behavior through Supabase-facing module interfaces;
2. real local Supabase/PostgreSQL migrations and the retained application flows
   pass, followed by real browser validation of the dashboard, Student 360 and
   mapped destination workspaces; the same configured browser run proves that
   `/calls`, `/chat`, `/notifications`, `/reports`, `/api/database/status` and
   `/api/webhooks/telephony` all return `404`;
3. the production build route inventory contains no removed staff or telephony
   route, and a scoped `rg` inventory finds no active import or runtime reference
   to the deleted SQLite/Drizzle repositories or fallback paths;
4. fail-closed tests prove that unavailable primary Supabase configuration or
   authority produces an explicit error rather than old local data;
5. `src/lib/v3/*`, the unmerged V3 screens, frozen V1 deployments and all
   historical ADRs, migrations, runbooks, archived docs, evidence and other
   decision/rollback material remain untouched and are never executed as
   successor authority.

#585 makes no VPS, public-route, provider, customer-data or production-traffic
change. Those actions remain controlled by the later #551/#552 gates.

#### Completed #586 obsolete executable database-tooling eradication slice

#586 followed removal of the live application's old
Drizzle/SQLite path. This slice deletes the superseded executable
toolchain itself: candidate dependencies, scripts, schema code, env seams and
tests that still assume local SQLite, Drizzle migration control or a backup
directory. The result is one managed-Supabase-backed candidate build that no
longer bundles or validates an inactive second database system.

The slice removes all active candidate references to:

- package scripts `db:generate`, `db:check`, `db:migrate`, `db:verify`,
  `bootstrap:admin`, `backup:db` and the legacy visa-role migration helper;
- package/runtime dependencies `better-sqlite3`, `@types/better-sqlite3`,
  `drizzle-orm`, `drizzle-kit`, and any Next.js standalone externalization
  retained only for those packages;
- executable helpers such as SQLite backup/bootstrap, Drizzle migration/history
  verification and dead schema code under `src/db/schema/*`;
- active env/runtime contract keys such as `EVO_DB_PATH` and `EVO_BACKUP_DIR`
  from the candidate runtime, image inventory and validation harnesses.

Frozen V1 history remains preserved as history only: historical migrations,
ADRs, runbooks, archived docs, evidence and other decision/rollback material
stay in the repository but must not be imported, bundled, executed or required
by the successor candidate.

Acceptance requires all of the following on the same candidate head:

1. package metadata, the lockfile, Next.js config and the candidate image
   contain no active `better-sqlite3`, Drizzle or SQLite-tooling dependency;
2. obsolete executable helpers, dead schema code and implementation tests are
   deleted or replaced by current Supabase outcome checks at the retained module
   boundaries;
3. the local foundation harness no longer depends on the Drizzle migration
   journal and cleans up its own lock state correctly after exit;
4. lint, typecheck, production build, real local Supabase/PostgreSQL
   validation and a scoped repository/image inventory pass without any active
   `EVO_DB_PATH`, `EVO_BACKUP_DIR`, `better-sqlite3`, `drizzle-orm`,
   `drizzle-kit` or legacy database-script requirement;
5. `src/lib/v3/*`, the unmerged V3 screens, frozen V1 deployments and all
   historical ADRs, migrations, runbooks, archived docs, evidence and other
   decision/rollback material remain untouched and are never executed as
   successor authority.

PR #592 completed #586 on exact main
`69e529be4236e10aff21ae8f0fa7b1d8074566ac`. Its exact-head CI, independent
reviews, deterministic `linux/amd64` image inventory and exact-main tree
verification passed before #587 became active.

#### Completed #587 single Supabase release-candidate proof slice

#587 replaces the remaining active release automation, CI entrypoints and
operator runbooks that still describe or execute the frozen multi-application
V1 topology. The successor release contract is exactly one EVO Next.js app,
one private WAHA transport using the `crm_primary` session contract, and the
retained Supabase Auth/Postgres/private-Storage authority. Companion Inbox,
Lead Agent, manual-send worker, SQLite backup and historical P8 release
programs are not candidate services, checks or fallbacks.

At #587 completion, the retained executable release authority was
`.github/workflows/evo-fast-release.yml`, `scripts/evo-fast-release.sh`,
`scripts/fast-release-ci-gate.mjs` and
`scripts/evo-release-environment-profile.mjs`, updated to the single successor
contract. #551 now supersedes that staging-oriented profile and removes it from
the active executable surface while retaining the exact-main CI gate and
rewritten production controller.

This slice must preserve frozen V1 deployment and rollback history, but move or
mark it as unmistakably historical and remove every active package, CI,
release-controller, validation and runbook reference that could execute it as
the successor. The active CI and release gate validate only the root EVO
product. Production Compose and the isolated loopback candidate profile must
render exactly the accepted `app` and private `waha` services; an externally
configurable list may not reintroduce legacy containers as release requirements.

Acceptance requires all of the following on the same candidate head:

1. one current release runbook, release controller and CI path describe and
   validate only the root app plus private WAHA and managed-Supabase contract;
   frozen `/opt/evo-inbox`, Lead Agent, manual-worker, five-container and
   SQLite-backup instructions remain only in clearly labelled historical
   rollback material and are not imported or executed;
2. `.dockerignore`, the Dockerfile/build context and package entrypoints exclude
   ignored `.env*` secrets, frozen application source, local evidence and
   obsolete P8 release programs; the final image contains only the root
   successor application and its production dependencies;
3. production Compose and the isolated OrbStack candidate profile are rendered
   canonically and prove exactly `app` plus `waha`, private WAHA networking,
   immutable WAHA digest input, healthchecks, resource limits and bounded logs;
4. a clean exact-SHA `linux/amd64` app image records the approved source,
   revision and version labels, and a sanitized sorted inventory proves the
   expected production dependency set without secret values, SQLite, Drizzle,
   companion Inbox, Lead Agent or manual-worker artifacts;
5. one isolated OrbStack candidate run uses real disposable Supabase
   Auth/Postgres/Storage plus the root application and a private WAHA service,
   then proves health `200`, authenticated readiness `503` with Supabase and
   audit ready but WAHA/AI not falsely marked ready without authorized provider
   evidence, browser access, exact runtime services/networks, fail-closed
   missing Supabase/provider configuration and owned cleanup without touching
   VPS, public traffic or provider state. Before candidate boot, the disposable
   organization receives append-only `configuration_check`/`unconfigured`
   events matching the candidate's disabled WAHA/AI environment, so provider-
   shaped evidence from earlier foundation checks cannot satisfy readiness;
6. a scoped repository/image/runtime inventory reports zero active legacy
   service, package, env, script, route or fallback reference. Historical
   material is reported separately and never counted as active authority;
7. focused tests, lint, typecheck and production build pass locally, followed
   by one independent exact-head review, one exact-head CI run, a
   `--match-head-commit` merge and exact-main verification.

#587 does not mutate `hermes-vps`, Caddy/DNS, the managed Supabase project,
provider or customer state, webhook ownership, V1 deployments or public
traffic. It does not edit `src/lib/v3/*`. #551 supersedes that active staging
contour with a disposable local backup/restore and migration rehearsal;
production cutover and active-runtime retirement remain owned by #552.

### P1 existing-state finding

The sanitized read-only audit is recorded in
`docs/audits/evo-production-successor-existing-state-2026-09-02.md`. It proves
that the existing healthy managed Supabase project is the correct retained
foundation, but production is still split across Supabase `public`, Supabase
`platform`, CRM SQLite, lead-agent SQLite, separate CRM/Inbox apps and two WAHA
contours. The live migration ledger ends at `079`; root `080`–`092` remain
unapplied. The target private document and WhatsApp-media buckets are also
absent. Seven provider backups are listed, but a current pre-change artifact
and successful restore rehearsal are not proved.

Accordingly, #546 may proceed with isolated real-Supabase implementation and
proof, but no production migration, data write or traffic switch is authorized
by P1. The recovery and rehearsal gates remain mandatory before production
mutation.

### P2 delivery decomposition: real staff and Sales tracer

Issue #546 is delivered as P2A followed by one regression-free P2B/P2C
replacement PR. Exact-head review proved that merging the Supabase Sales read
switch while leaving its writes for a later PR would publish a read-only lead
workspace and break the first complete tracer. The read and workflow-write
authority therefore move together, while their tests and commits remain
separately reviewable inside the same PR:

1. **P2A — real staff session and role shell.** Replace the root two-field
   development gate with Supabase Auth SSR cookies, validate every protected
   request against the live Supabase membership authority, keep Admin as the
   full functional superset, and retain exact Sales/Admissions preview only as
   an Admin-authorized presentation choice. Delete the development-gate
   runtime, config and tests in this PR after real local Supabase and Chromium
   proof.
2. **P2B — canonical Sales reads.** Treat migrations 084-085 as the canonical
   lead and linked-conversation foundation, and wire the already-existing
   `staff_sales_lead_page` and `staff_sales_lead_detail` read RPCs from
   migration 086 as the exact bounded Sales read contract through authenticated
   Supabase/RLS. Forward-only migration 093 corrects the existing detail RPC
   so its displayed conversation list/count use the same exact Sales-intake
   authorization predicate as the nested transcript RPC. Forward-only
   migration 094 applies that same predicate to the existing page RPC's
   `is_connected` and `linked_conversation_count` values. These migrations
   replace the two existing functions in place; they do not add a wrapper or
   second read contract. Delete the corresponding Drizzle read path after
   authorized and unauthorized database, app and browser proof.
3. **P2C — canonical Sales writes and slice cleanup.** Move qualification,
   ownership and next-action mutation through only the mutation RPCs in
   migration 086, prove business outcomes and direct denial, then remove the
   replaced active Drizzle Sales workflow action, UI, route imports, tests and
   configuration. The inactive `updateCanonicalSalesLeadWorkflow` fixture
   helper and its old stage contract may remain reachable only from the named
   local #547/#549 preparation scripts/tests until those downstream slices move
   their gate, handoff and provider fixtures to Supabase; they have no active
   route/action import and must be deleted in those issues, not revived as a
   runtime path.
   P2B and P2C must merge together so `/sales/[id]` never lands as a read-only
   regression. Contract/payment gate and Sales-to-Admissions handoff remain
   owned by #547; the Sales amoCRM command surface remains owned by #549. Their
   old Drizzle controls and historical provider acceptance expectations must
   not be reactivated as a compatibility path. Close #546 only after the final
   scoped active-runtime legacy inventory is empty and the temporary fixture
   inventory names its #547/#549 exit.

Implementation inspection clarified the original migration boundary. P2B must
not add a migration 093 wrapper around the migration 086 read RPCs, because
duplicating an already bounded read contract would layer a second runtime path.
The exact-head review subsequently found a narrower detail/transcript predicate
mismatch inside that existing contract; migration 093 may therefore replace
the existing detail function in place solely to make both surfaces enforce the
same predicate.

A later exact-head review found the same legacy broad predicate in the
`staff_sales_lead_page` WhatsApp-derived queue values. Migration 094 must
replace that existing page function in place so `is_connected` and
`linked_conversation_count` accept only the exact verified Sales-intake link
used by detail and transcript. Its database proof must include exact intake,
client-only, non-intake and unverified/direct-link cases. No other queue
behavior, signature, ACL or authority may change.

### P3 delivery decomposition: Student 360, contract/payment and handoff

Issue #547 must publish one complete Supabase-backed Student 360 tracer from an
already qualified Sales lead through contract and first-payment evidence to one
accountable Sales-to-Admissions handoff. The active `/clients/[id]` route still
renders `CanonicalStudentCaseWorkspace`, which reads the old repository-backed
student case, handoff, task, operations, document and amoCRM surfaces. At the
same time, root Supabase migration history already contains the canonical
gate, handoff, contract and profile RPCs required for the local/rehearsal
replacement:
`platform.staff_student_profile_snapshot(UUID)`,
`platform.staff_case_contract_workspace(UUID, UUID)`,
`platform.staff_lead_admissions_gate(UUID)`,
`platform.mutate_lead_admissions_gate(...)`,
`platform.staff_lead_admissions_handoff(UUID)`,
`platform.staff_student_case_handoff_context(UUID)` and
`platform.handoff_lead_to_admissions(...)`.

Accordingly, #547 is a replace-not-layer slice with one active Student 360
runtime path:

1. **P3A - contract/payment gate and accountable handoff.** Add one typed
   Supabase boundary for the four existing gate/handoff RPCs and one server
   action module that uses the signed-in staff cookie client, never a service
   role. Restore the accepted Sales controls on `/sales/[id]` so authorized
   staff can confirm contract evidence, confirm first-payment evidence, select
   the Admissions owner and perform one normal or explicit Admin-override
   handoff. Database permissions, RLS, version checks, immutable request
   receipts and transaction locks remain the authority; the UI must surface
   invalid, forbidden, stale, request-conflict, gate-blocked and unavailable
   outcomes without blind retry.
2. **P3B - Student 360 Supabase path.** Replace the active `/clients/[id]`
   summary and handoff reads with authenticated calls to a typed
   `staff_student_case_handoff_context` adapter. Reuse
   `getPlatformStudentProfile`, `getPlatformCaseContractWorkspace`,
   `ContractDraftReportWorkspace` and the existing Supabase contract actions
   rather than rebuilding those ready-made capabilities. Admissions and Admin
   may open the full case only when the live database authority allows it;
   Sales receives the committed handoff result on Lead 360 but does not inherit
   full Admissions case access. Admin preview remains presentation-only and
   never creates a second authority path.
3. **P3C - real proof and bounded cleanup.** After authorized/unauthorized SQL,
   application and real Chromium proof, delete the superseded modules
   `src/components/platform/sales/CanonicalSalesGateCard.tsx`,
   `src/components/platform/sales/CanonicalSalesHandoffCard.tsx`,
   `src/lib/server/canonical-sales-gate-actions.ts` and
   `src/lib/server/canonical-sales-handoff-actions.ts`, plus the replaced
   repository-backed Student 360 summary/handoff shell and its implementation
   tests. Remove the #547 gate/handoff fixture callers from the old repository.
   The routes must fail clearly if Supabase is missing or rejects the request;
   they may not fall back to the old repository path.

#547 must not silently absorb later-owned surfaces. During #547, the only
temporary repository-backed containers created on `/clients/[id]` are
`src/app/(staff)/clients/[id]/AdmissionsCaseOperationsSection.tsx` and
`src/app/(staff)/clients/[id]/AmoCrmCaseCommandSection.tsx`. The first may
fetch props only for the existing `CanonicalAdmissionsTaskPanel`,
`CanonicalPrivateDocumentsPanel` and `CanonicalAdmissionsOperationsPanel`
through `canonical-crm-repository`, the two canonical Admissions action modules
and `private-document-repository`; #548 must replace and delete that container,
those panels and their superseded dependencies when Supabase Admissions and
Storage land. The second may fetch props only for
`CanonicalAmoCrmCommandPanel` through the canonical amoCRM command action and
repository modules; #549 must replace and delete that container, panel and
superseded dependencies when the provider tracer lands. These are
section-isolated unreplaced capabilities, not alternate Student 360 summary,
gate, handoff or contract paths. No other repository-backed wrapper or stub may
remain on the route.

The temporary fixture-only coexistence from #546 narrows here. #547 must remove
all gate/handoff preparation callers that still depend on
`updateCanonicalSalesLeadWorkflow` or the old stage contract. If the amoCRM
preparation callers remain after #547, they stay named and local to #549 only.
Before merge, attach a scoped `rg` inventory proving that no active route,
action, rendered UI or browser test still imports the superseded gate/handoff
runtime. Existing SQL proof for migrations 087-088 must run with all root
migrations in real local Supabase/PostgreSQL, including concurrent duplicate
handoff and request-id replay cases. The app proof must use real Supabase Auth,
RLS and Chromium. This scope is isolated/non-production: it does not apply the
migrations to the managed project, mutate production data, send a provider
message, write amoCRM or change V1 deployment/traffic.

### P4 delivery decomposition: Admissions operations and private documents

Issue #548 completes the post-handoff product path without rebuilding the
ready-made Supabase foundation. Migrations 042, 043, 046, 055 and 089 remain
the existing authority for tasks, applications, visa, finance controls,
immutable document versions, the private `platform-documents` bucket and
audited one-use download grants. One forward migration 095 may replace the
missing staff queue/workspace functions and narrow finance-stop role behavior;
it must not duplicate an existing Storage or case authority.

1. **P4A - bounded database contract.** Add one role-scoped task queue, visa
   queue, document queue and Student 360 document workspace over the existing
   canonical tables. Admin sees the tenant union; the assigned Admissions
   Manager sees only active or closed handed-off cases assigned to that live
   membership; Sales is denied. Admissions and Admin may assert a finance stop,
   while only Admin may release one. All writes retain exact request receipts,
   transaction locks and fail-closed response validation.
2. **P4B - one accepted Admissions interface.** Mount the typed Supabase task,
   application, visa, finance and document adapters directly in Student 360 and
   use the same adapters for `/tasks`, `/applications`, `/visa`, `/finance` and
   `/documents`. Admin preview changes presentation only; authenticated role,
   RLS and server authorization remain authoritative. An ambiguous mutation
   returns the same request identifier to the exact matching form so a retry
   replays rather than duplicates the business transition.
3. **P4C - private Storage lifecycle.** Accept PDF, JPEG or PNG bytes only from
   an authenticated actor, scan them first, then create the exact reservation
   through a service-only command that revalidates that actor and the clean
   ingress proof. Browser principals cannot reserve metadata or mutate scanner
   evidence directly. Storage persistence, atomic stored-byte-proof
   finalization and one-use signing use the server-only Supabase secret; the
   secret never reaches browser code. Resubmission creates a new immutable
   object/version, and download uses a consumed grant plus a signed URL valid
   for at most 60 seconds. Direct user list/read/update/delete and public-bucket
   behavior remain denied.
4. **P4D - proof and replacement cleanup.** Real local Supabase/PostgreSQL,
   Storage API, application and Chromium checks must prove Admin and assigned
   Admissions success, Sales/anonymous/other-membership denial, immutable
   resubmission, audited short download and missing-primary failure. In the same
   slice delete the old local-file/Drizzle document stack, Busboy parser, old
   generic document routes, repository-backed Admissions actions/panels,
   implementation tests and dead environment/config references. A scoped
   inventory must show no active import or fallback remains.

Local #548 validation may record checksum and file-signature evidence through
the already documented `scanner_proof=false` contract; it must not be described
as antivirus or malware-provider acceptance. Before #552 may arm a release,
#551 must bind the production document-ingress path to one real scanner and
prove clean acceptance, safe detection-sample rejection/quarantine, fail-closed
unavailable/timeout/malformed outcomes and successful recovery/rescan. Missing
scanner access blocks #551 and must not be replaced by an invented provider
claim. The only named temporary
coexistence after #548 is `AmoCrmCaseCommandSection` and the exact command-read
dependencies owned by #549; they may not read or render an alternate
Admissions, Student 360, document or finance path and expire in #549.

This Storage implementation follows Supabase's current private-bucket/RLS,
standard-upload and signed-download contracts. See the official
[bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals),
[Storage access control](https://supabase.com/docs/guides/storage/security/access-control),
[standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
and [signed URL reference](https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl).

### P5 delivery decomposition: canonical provider workflows

Issue #549 is an ordered parent delivered through #565, #566, #567 and #568.
The current provider UI is useful product work, but its durable state is still
split: Gemini proposals/reviews, WhatsApp send attempts and amoCRM command
receipts remain partly in the local Drizzle runtime while root Supabase already
contains the accepted Gemini and WAHA foundations. The provider tracer must
replace those local authorities rather than copy them into a second path.

1. **#565 / P5A - bounded Supabase provider contract.** Inventory and reuse
   migrations 066, 078, 080, 081, 082 and 091. Add one forward migration only
   for the staff-safe initiation/audit and latest send-attempt/read/
   reconciliation shapes that the accepted UI genuinely lacks. Every claim is
   bound to one canonical organization, conversation, source message, staff
   actor and request identity. Real local Supabase/PostgreSQL and SQL/RLS proof
   must pass, but this contract-only slice does not import a new application
   adapter, contact a provider or activate a second runtime path. It expires
   into the atomic #566 cutover.
2. **#566 / P5B - one WhatsApp and Gemini runtime.** Atomically switch the
   accepted staff communications queue/thread, canonical inbound projection,
   Gemini proposal/result/read/review and explicit WhatsApp send/reconciliation
   path to Supabase. The signed-in staff session remains the authorization
   boundary and only the server contacts Gemini or private WAHA. The provider
   binding reuses the already connected sales session `crm_primary`; it does
   not require a new `evo-inbox` QR scan. This is transport session/container
   reuse only: the V2 command path must not execute the frozen V1 sender,
   writer or webhook worker, and Supabase remains the sole business authority.
   Active acceptance verifies the exact `crm_primary` binding and `WORKING`
   state read-only without selecting an inbound message, calling Gemini or
   sending through WhatsApp. Gemini stays
   advisory until explicit Accept/Edit/Reject review and can never invoke a
   command. One explicit staff action over final reviewed text may send; an
   unknown outcome blocks another send until exact WAHA readback reconciles the
   same request, recipient and text. After real local Supabase, application,
   Chromium, server-boundary and read-only provider-readiness proof, delete the active local
   Drizzle conversation/proposal/send state, superseded local inbound route,
   adapters/workers/imports/tests/config and every fallback path.
3. **#567 / P5C - Supabase-authoritative amoCRM commands.** Add the missing
   forward-only private command-attempt, immutable receipt and provider-binding
   model plus narrowly scoped staff/service RPCs. Explicit authorized commands
   cover the approved contact, lead, link, pipeline/status, note, task and tag
   operations, but Supabase remains business authority and amoCRM identifiers
   remain provider evidence. Replays return the original receipt; an ambiguous
   outcome must reconcile by provider readback before any retry. The inert
   replacement code lands only after real local Supabase, application and
   Chromium proof, with the local command repository/state, temporary
   `AmoCrmCaseCommandSection`, superseded provider UI/adapters/imports/tests and
   every fallback path deleted in that same code slice. Keep #567 open after
   the code merge. Its real-write acceptance then runs once from the reviewed,
   CI-green exact `main`, because the guarded provider harness rejects branch
   or dirty checkouts. #568 cannot start and #567 cannot close until that one
   bounded validation entity has matching amoCRM readback and sanitized
   PostgreSQL/application/browser evidence. A failed or ambiguous result stays
   blocked for reconciliation and never revives the deleted runtime.
4. **#568 / P5D - exact-main provider runtime inventory.** On exact main, prove
   that the Supabase-backed Gemini, WhatsApp and amoCRM modules have one active
   state/runtime path, that `crm_primary` is the only configured WAHA session,
   and that missing or ambiguous provider state fails closed. Use real database,
   application and Chromium outcome tests plus read-only configuration/session
   inspection. Do not require a selected inbound message, call Gemini, send a
   WhatsApp message or write amoCRM. Record explicitly that live Gemini/WhatsApp
   delivery was not exercised and is not being claimed.

Delivery status on 2026-09-03: #565 merged through PR #570, then #566 merged
through PR #571 at exact main
`8bb96c35b401c81e625773cc5ec594c68f956f39`; exact-main CI run `33683881377`
passed. #567's command cutover merged through PR #572 at exact main
`23360a9f3816f7de8d33c162d550fc56688b9c1d`; exact-main CI run `33695138189`
passed. PR #574 added the missing canonical Sales surface and merged at exact
main `a9da91a23c2c8c1f9c475ae72faf8c4a52e4789f`; exact-main CI run
`33699454396` passed.

The next guarded #567 run reached the real provider once. Contact creation,
lead creation, contact/lead linking, pipeline/status, responsible user and note
creation each returned HTTP 200, matched exact readback and persisted accepted
Supabase attempts/receipts/bindings. amoCRM also created exactly one task on
the exact validation lead with the expected text, but the deliberately distant
`2099-09-15` deadline returned as a negative provider timestamp instead of the
submitted Unix time. The command therefore stayed `unknown`, no tag operation
ran, no success marker was emitted and #567 remains open. A bounded read-only
task-list reconciliation proved the task exists uniquely; no provider write or
retry followed the mismatch.

The corrective slice must fail before dispatch for task deadlines above the
provider-safe signed 32-bit Unix range, keep all service/provider validation on
the same bound, and use a normal near-future deadline in connected acceptance.
It must add unit/browser regression proof and pass the normal exact-head and
exact-main gates. The already created validation entities and unknown attempt
remain immutable evidence; this code correction does not authorize another
provider run, cleanup mutation or acceptance claim. The owner removed the
controlled-inbound Gemini/WhatsApp send exercise from the active merge and
completion gates because the controlled account is unavailable.

PR #575 merged that fail-before-dispatch guard at exact main
`a572cd73f48c9d6020a2c532f0ec036e9b19c74a`; exact-main CI run
`33702536583` passed the CRM, Inbox and Lead Agent jobs. The corrective slice
made no provider call and did not resolve the unknown task attempt. Issue #567
therefore remains open at one fresh, separately authorized, bounded amoCRM
validation from reviewed and CI-green exact main. Issue #568 has not started
and remains sequenced after that validation. The V3 ownership and adapter
boundaries above are unchanged.

The owner-authorized fresh validation then ran from clean exact main
`8444b4cbcd648a28a929ae604597cecfeb35d06c`; exact-main CI run
`33704513203` had passed. Contact create, lead create, contact/lead link,
pipeline/status, responsible-user and note operations each returned HTTP 200
and persisted accepted exact readback. Task creation also returned HTTP 200,
but its immediate exact readback ended `provider_unavailable`, so the harness
failed closed at `unknown`; tag execution never started and no `success.json`
was emitted.

A bounded read-only task-list reconciliation found exactly one task on the
fresh validation lead with the exact reviewed text and corrected near-future
deadline. The existing service-only reconciliation RPC then changed only the
local Supabase attempt from `unknown` to `accepted`, retained exact hashed
readback and cleared the failure. It did not retry the task mutation or mutate
amoCRM. Sanitized evidence records seven accepted attempts and seven receipts,
one contact binding, one lead binding, one provenance record, zero tag attempts
and no full replay proof. Therefore #567 remains open and #568 must not start.
The completed one-run authority does not permit a later tag write or another
provider run; either needs a separate explicit owner continuation. WhatsApp,
Gemini, V1, deployment, customer migration and cutover remained untouched.

On 2026-09-03 the owner supplied that explicit continuation and clarified that
the goal is not a one-step tag patch: finish #567 as a complete product slice.
Before another live run, correct any product-path defect exposed by the failed
acceptance, including single-shot post-mutation readback and exact replay that
could re-derive `contact_update` / `lead_update` after newly created bindings.
The completed implementation must keep the original request's operation
sequence stable, retry only bounded read-only verification, and never repeat an
unreconciled mutation. A provider rejection or ambiguous write is reconciled
before any continuation; it is never converted into success or retried blindly.

After the correction is independently reviewed, merged and green on exact
main, run the complete guarded connected acceptance. Reuse valid checkpoints
when their canonical database state still exists. Because the earlier
disposable database was intentionally removed, do not reconstruct its private
IDs or invent bindings; if it cannot be resumed exactly, create one new clearly
marked validation entity and run the full canonical sequence. Completion
requires all eight operations accepted with exact provider readback, an exact
UI replay that adds no attempt, receipt, binding or provider entity, persistence
after reload, and a sanitized `success.json`. The owner permits the bounded
fresh attempts genuinely needed to reach that proof, but every attempt remains
fail-closed and must reuse confirmed results rather than repeat work without new
signal. Only then may #567 close and #568 start. The authorization still excludes
WhatsApp sends, Gemini calls, frozen V1 execution, customer-data mutation,
deployment, historical migration and cutover.

That final acceptance has now completed. PR #581 merged the last harness
correction at exact main `5e32bdc9391f46e73dcca1a433a52c823fae9e8a`; exact-head
CI run `33761605343` and exact-main CI run `33762782675` both passed first.
The guarded connected acceptance then emitted sanitized
`output/provider-acceptance/amocrm/5e32bdc9391f46e73dcca1a433a52c823fae9e8a/success.json`
with all eight operations accepted, exact provider readback, one contact
binding, one lead binding, one provenance record, persistence after reload and
an exact UI replay that added zero attempts, receipts, bindings or provider
entities. Boundaries remained unchanged: local Supabase PostgreSQL stayed the
only database authority, the existing `crm_primary` WAHA session was inspected
read-only, no V1 application path executed, and no deployment or fallback path
ran. Issue #567 is therefore complete and Issue #568 may now proceed from this
exact merged main.

The provider tracer is also complete. PR #583 merged the single-runtime
inventory at exact main `8da65163695d293769e60682d08fe8f6be51d138`
after two independent exact-head approvals and exact-head CI run `33777698346`.
The exact-main harness then emitted the private sanitized artifact
`output/provider-runtime-inventory/8da65163695d293769e60682d08fe8f6be51d138/run-20260903T163116Z-85239/success.json`.
Real local Supabase/PostgreSQL, the Next.js application and Chromium passed;
before/after provider and business-event counts were identical; the remote
read-only probe observed the private `evo-crm` / `waha` /
`evo-crm-waha-1` / `evo_crm_private` runtime with `crm_primary` in
`WORKING` state; and the active fallback count was zero. The evidence keeps
the exact-main harness identity separate from the observed WAHA container and
image identities and explicitly makes no application-deployment claim. No
selected inbound replay, live Gemini call, WhatsApp send, amoCRM write, V1
execution or deployment change occurred. Issues #568 and #549 are therefore
complete and #550 is active through #584-#587.

ADR 0026 records that scope correction; no synthetic or customer-chat
substitute is allowed. The existing
`src/lib/platform-communications.ts` authenticated Supabase reads and the
service-only provider contracts from migrations 080, 082, 091 and 096 are the
reuse boundary for schema and workflow behavior. Their historical
`evo-inbox` exact-session selection is superseded by ADR 0025; immutable past
migrations remain unchanged, while current runtime/provisioned configuration
must resolve only `crm_primary`. The local Drizzle communication, proposal and
send symbols,
their synthetic inbound implementation and their tests/config are deletion
targets after equivalent real PostgreSQL, application, Chromium, server-boundary
and read-only provider-readiness proof exists in the same slice.

All lower historical launch sections that name `evo-inbox` as the exact
forward session are preserved as V1/companion decision and rollback evidence,
not as current #566/#568 authority. They must not be imported as a compatibility
path. If a currently provisioned Supabase selector still names `evo-inbox`, use
a reviewed forward correction or current provisioning step; never rewrite an
immutable historical migration. A missing or unhealthy `crm_primary` stops
clearly instead of selecting another session or asking for a routine QR scan.

Production inbound ownership does not move during repository #566 acceptance. The
later controlled cutover must inventory per-session and global WAHA webhooks,
stop the superseded V1 sender/writer/webhook worker, transfer the one provider
webhook to the V2 Supabase-backed runtime, and prove that exactly one active
consumer can process an inbound event before traffic is accepted.

Each child is a separate launch-control PR with exact-head review/CI, match-head
merge and exact-main verification. A completed child has one active state and
execution path for the capability it replaces. Its scoped `rg` inventory must
show that the old Drizzle repository, worker, route, component, test and config
cannot be imported or called, and missing Supabase/provider configuration must
fail clearly instead of falling back. No Gemini call, WhatsApp send, amoCRM
write or selected customer/inbound message is part of active #566/#568
verification. This does not authorize frozen V1 execution, production
deployment, broad customer mutation, migration, public traffic or cutover.

This follows Supabase's current guidance that exposed tables remain protected
by RLS and authenticated RPCs carry the caller's authorization context, plus
PostgreSQL's transaction-level advisory-lock contract for short atomic
business commands. See the official
[RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security),
[database-functions guide](https://supabase.com/docs/guides/database/functions)
and [PostgreSQL explicit-locking reference](https://www.postgresql.org/docs/17/explicit-locking.html).

The existing database enum value `curator` is the retained technical name for
the human-facing **Admissions Manager** role. The server maps that one database
role to the single accepted Admissions interface; it does not create a second
role authority or compatibility runtime. A later forward migration may rename
the stored value only if the full dependent SQL inventory proves that change
is safer than the explicit mapping.

P2A follows Supabase's official SSR contract: cookie-backed server clients,
middleware/proxy token refresh, verified claims rather than a trusted
`getSession()` snapshot, and the existing custom-access-token hook plus live
membership/RLS checks. See the official
[server client](https://supabase.com/docs/guides/auth/server-side/creating-a-client),
[advanced SSR](https://supabase.com/docs/guides/auth/server-side/advanced-guide),
[JWT](https://supabase.com/docs/guides/auth/jwts) and
[custom-claims/RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac)
guidance.

Issue bodies must repeat their destructive/external boundary and legacy
eradication acceptance criteria. The sequence is strictly ordered unless the
plan records a justified dependency change before implementation.

## Completed historical V2 product-validation contract

This section preserves the product-validation contract and evidence completed
under ADRs 0022 and 0023. Its words such as `active`, `current` and `must` are
historical within this section and do not override ADR 0024 or the current
Supabase-backed production-successor authority above.

The completed historical goal was to prove the main EVO CRM product and its
real provider operations quickly in a private local contour. It was not a
production-readiness or replacement contract.

That completed V2 contour kept one staff interface and the core workflow
across Sales, Student 360, Admissions, Documents, Applications, Visa, Finance,
WhatsApp and advisory AI. It replaced the Supabase execution path with a
direct self-hosted runtime:

- a real private local PostgreSQL service;
- Drizzle schema definitions and committed, reviewed SQL migrations;
- a two-field server-side development gate with a short signed HttpOnly
  session cookie;
- three fixed test roles: Director/Admin, Sales Manager and Admissions Manager;
- server-side role authorization, with Admin as the full functional superset;
- Admin role-preview that renders the exact Sales or Admissions interface and
  permissions rather than a cosmetic approximation;
- application-owned private document bytes plus PostgreSQL metadata;
- a minimal append-only business event log sufficient to debug and verify
  consequential transitions.

The completed V2 product path did not use Supabase SDK/Auth/Storage/Realtime,
Supabase migrations or runtime environment variables. It did not dual-read,
dual-write, write through, fall back to Supabase/SQLite or preserve a
Supabase compatibility layer.

### Historical development access and fixed roles

The access page has exactly two fields. The first identifier selects one of
three technical profiles configured only through ignored local secrets; the
second value is that profile's secret. Both lookup and comparison happen only
on the server. A successful comparison creates a short-lived signed HttpOnly
cookie that carries only the selected technical role and expiry.

This is development access, not staff identity. There is no active account
lifecycle, signup, invitation, password recovery, per-user grant system,
membership administration or real-staff claim. The local contour remains
private/non-public. It does not ingest or migrate a broad real customer data
set; #464-#467 may use only the minimum fields and transcript context from one
owner-authorized exact provider target needed for proof: either an existing
real conversation/case or one clearly marked validation entity on the connected
session self identity. The run must never select an arbitrary customer merely
to satisfy acceptance.

The roles still have real server-side behavior:

- Sales Manager owns the Sales pipeline, lead qualification, next action and
  pre-handoff customer work;
- Admissions Manager owns handed-off Student 360 cases, tasks, documents,
  applications and visa work;
- Director/Admin can perform the union of both roles, exercise explicit
  overrides and preview the exact Sales or Admissions interface.

Role enforcement occurs in route handlers/server services and transactional
database commands. The active product-first build uses one local EVO
organization and does not build multi-organization tenancy, memberships,
cross-organization RLS or fine-grained per-user grants.

#### V2-3 fixed-role execution contract

V2-3 uses one canonical role vocabulary everywhere: `admin`, `sales` and
`admissions`. `curator`, `finance`, membership status and individual grant
vocabularies are not active authorization inputs. A server-resolved role policy
drives navigation, page guards, Server Actions, Route Handlers and repository
commands; a page-level redirect or hidden control is never the only check.

| Effective role | Allowed product responsibility | Required denial |
| --- | --- | --- |
| `sales` | Sales pipeline, qualification, ownership, next action and pre-handoff work | Admissions case/document/application/visa commands |
| `admissions` | handed-off Student 360, tasks, documents, applications, visa and the later minimal finance stop/release | Sales ownership and pre-handoff qualification commands |
| `admin` | union of Sales and Admissions plus explicit Admin controls | none inside the fixed-role product union |

The signed development session records both the gate-selected authority role
and the effective role. They are identical for Sales and Admissions. Admin may
ask a server action to reissue the same signed session with effective role
`sales` or `admissions`; while previewing, both the rendered interface and
server command checks use that effective role. Only the server-confirmed Admin
authority may enter, change or exit preview. Client state, query parameters and
unsigned cookies are never role or preview authority.

V2-3 replaces the historical staff-role shell in place. It removes the
`curator` projection, the fixture/connected/legacy staff-screen switches, the
staff fixture flag from those routes, and the real-staff lifecycle settings
surface that contradicts the three fixed profiles. The single surviving Sales,
Admissions and shared shell components receive neutral product names rather
than `Legacy*`, `Connected*` or `Fixture*` names. Supabase-backed business
repositories remain only under their already approved #429 expiry and are not
accepted as V2 proof; V2-3 adds no adapter, fallback or second UI around them.

Acceptance uses the real signed session, real Next.js routes/actions, real
PostgreSQL-connected app and real Chromium. It proves all three role shells,
Admin preview entry/exit, allowed route/command policy and direct denials without
creating fake leads or cases. Later business slices must exercise this same
policy when their real commands and canonical PostgreSQL records are added.

### Replace, do not layer

Each completed V2 slice leaves exactly one active runtime, data authority,
session/file path and UI for the capability it replaces. After real
database/application/browser proof, the same slice removes the superseded
runtime code, imports, dependencies, implementation tests, environment/config,
scripts, routes, webhooks/workers and parallel `Legacy*`/`Connected*`/
`Fixture*` screens. Its PR includes a scoped `rg` inventory and a real
fail-closed check showing no fallback survives.

Only frozen V1 staging/production and historical ADRs, migrations, runbooks,
archived docs, evidence and other historical decision/rollback documentation
may remain as inert deployment/rollback inputs; V2 may not import, execute,
bundle or treat them as authority. Temporary coexistence requires explicit
owner approval with named files, reason, expiry/exit criteria and a deletion
issue. Phase 0 records this rule and deletes no V1 code.

### Historical product paths that were proved

1. Start real local PostgreSQL, apply the complete migration chain and query it
   from the application.
2. Enter the real app through each fixed technical role and verify the exact
   role interface plus direct server denials.
3. Create and qualify a canonical Sales lead with owner and next action.
4. Show the lead and communications in the WhatsApp workflow and let an
   authorized staff role explicitly send final reviewed text through WAHA.
5. Enforce contract plus first mandatory payment before normal handoff.
6. Perform the audited Sales-to-Admissions handoff.
7. Operate Student 360: case, tasks, private documents, applications and visa.
8. Raise and release the minimal finance stop with a durable reason.
9. Produce a real Gemini draft and human-review it without granting the model
   action authority.
10. Execute the required amoCRM contact, lead, link, pipeline/status,
    responsible-user, note and tag commands while PostgreSQL remains canonical.
11. Explain every consequential transition and provider attempt through the
    minimal event log and durable command receipts.

In that completed local contour, private documents needed real local
persistence, authorized upload/download and resubmission, metadata, byte
length and checksum. Full backup/restore drills, off-host retention and
production rollback evidence were not active scope there.

Within that completed contour, WhatsApp, Gemini and amoCRM had to remain real
product paths rather than mocks or fake success. The owner authorized #464-#467
on 2026-08-29 to use the existing connected providers from the private V2
contour without routine confirmation. Credentials stay in ignored server-only
configuration. Gemini remains
advisory; only a staff role may send final reviewed text or invoke an explicit
amoCRM command. No autonomous reply, broadcast, fallback provider, blind retry
after an ambiguous result, V1 runtime change or production-readiness claim is
authorized.

### Completed foundation issue contract

| Order | Issue | Product outcome |
| --- | --- | --- |
| V2-0 | #424 | product-first architecture and issue reset |
| V2-1 | #425 | real private PostgreSQL and Drizzle migration gate |
| V2-2 | #426 | two-field development gate and three fixed role sessions |
| V2-3 | #427 | fixed Admin/Sales/Admissions server-side behavior and Admin preview |
| V2-4 | #428 | private local document persistence and authorized file routes |
| V2-5 | #429 | canonical CRM model and minimal business event log |
| V2-6 | #430 | Sales pipeline, lead qualification and inbound WhatsApp workflow |
| V2-7 | #431 | contract/payment gate and audited Admissions handoff |
| V2-8 | #432 | Student 360, tasks, documents, applications, visa and finance stop/release |
| V2-9 | #433 | staff WhatsApp workflow and human-reviewed Gemini draft |

#424 through #433 and parent #407 are completed foundation history. They are
not reopened or used as permission to revive deleted provider writers.

### Completed real-provider issue contract

| Order | Issue | Product outcome |
| --- | --- | --- |
| V2-10A | #464 | real Gemini provider acceptance on the canonical proposal/review path |
| V2-10B | #465 | one canonical human-reviewed WhatsApp outbound path through WAHA |
| V2-10C | #466 | permanent PostgreSQL-authoritative amoCRM writes and provider bindings |
| V2-10D | #467 | bounded real provider, PostgreSQL, application and browser acceptance |

Only #464 through #467 were active V2 long-run issues under parent #463. They
executed in this exact order as small PRs. Each PR required independent
exact-head review, all protected exact-head CI checks,
`gh pr merge --match-head-commit` and exact-main CI verification before the
next slice starts.

V2-8 (#432) is intentionally delivered as three internal vertical PRs under
the same issue:

1. replace the active Student 360 task path with canonical PostgreSQL reads and
   task commands in `/clients/:studentCaseId` and `/tasks`;
2. replace applications, visa milestones and minimal finance stop/release with
   canonical commands and UI;
3. wire the existing private-file foundation into the canonical document UI,
   then remove the remaining superseded Student 360/Admissions runtime paths.

#### V2-8B applications, visa and finance-stop execution contract

V2-8B has one write surface inside `/clients/:studentCaseId`. The
`/applications`, `/visa` and `/finance` routes are read-only queues over the
same canonical PostgreSQL authority and link back to the relevant Student 360
section; they are not parallel workflow implementations. Superseded dynamic
detail routes and their Supabase/RPC or SQLite actions, queries and
implementation tests are deleted after the canonical browser proof.

Admissions and Admin may create a university application as `draft`, update
its required next action, submit it and record an outcome. The allowed status
graph is `draft -> submitted -> accepted|rejected`, plus a reasoned withdrawal
from `draft` or `submitted`. Accepted, rejected and withdrawn applications are
terminal. Rejection and withdrawal require a durable reason. Every application
is owned by the fixed `admissions` role and is unique per case, institution,
program and intake.

Every newly handed-off case receives exactly one milestone for each canonical
visa kind: document preparation, appointment, submission, biometrics,
interview and decision. Allowed progress is `pending -> in_progress ->
completed`; `pending|in_progress -> blocked` requires a reason and `blocked ->
in_progress` resumes work. Completed milestones are terminal. Milestones keep
the fixed Admissions owner plus next action and due date where applicable.

Finance control is one case-level stop state, not a payment ledger or fourth
staff role. Admissions or Admin may assert the stop with a reason. Only Admin
may release an active stop, also with a reason. While stopped, server commands
reject both application submission and progress of the visa `submission`
milestone; no UI state, alternate route or legacy repository may bypass that
check. Other visa milestones remain operable.

All mutations require an active handed-off case, server-resolved Admissions or
Admin authority, optimistic row versions, idempotency receipts and an atomic
minimal business event. Exact replay returns the recorded result; a reused key
with a different request fails; a stale version or unavailable PostgreSQL
writes nothing and exposes no fallback. Sales is denied every mutation, while
Admin preview exercises the exact Admissions interface.

Each internal PR must remove the old runtime path for the capability it proves;
the split is not permission for dual read/write or fallback. Issue #432 remains
open until all three verticals and the final scoped legacy inventory are green.

#### V2-8C private documents and final Admissions replacement contract

V2-8C reuses the already proven #428 authority exactly: PostgreSQL
`evo_private_documents` and `evo_private_document_versions`, opaque objects
under the private `EVO_PRIVATE_DOCUMENT_ROOT`, and the three `/api/v2`
upload, resubmission and download routes. It does not copy bytes into
PostgreSQL, introduce a second document model, revive Supabase document slots
or use the legacy SQLite `documents` table.

Student 360 is the only document write UI. Admissions and Admin can upload a
PDF, JPEG or PNG of at most 25 MiB, see the stored metadata and immutable
version history, download any listed version and resubmit a new version of the
same document. `/documents` becomes a read-only PostgreSQL queue over the same
authority, showing the latest version and linking back to the owning Student
360 document section; the legacy numeric `/documents/:id` detail and its
mutation action are removed rather than adapted.

Every metadata read and byte download resolves the owning handed-off case on
the server. Upload and resubmission additionally require that case to be
active. Admissions and Admin are the only allowed roles; Sales, unknown UUIDs,
documents outside a handed-off canonical case, inactive-case writes, missing
PostgreSQL and missing or invalid private storage fail closed without an
alternate data or file path.
Responses and UI metadata never expose the opaque object key. Paused or closed
handed-off cases remain readable but render no upload or resubmission controls.

The slice replaces, rather than preserves, the old document review/status
workflow. V2-8C has no fake required-document slots or production review
approval lane: an uploaded document, its immutable versions, verified bytes
and owning case are the complete active product contract. After real
PostgreSQL, application, file-byte and Chromium proof, delete the inactive
`StudentWorkspace`/presenter, old Admissions case-workspace and document-review
actions/repositories, the SQLite staff document queue/detail/action path and
their implementation-level tests. Keep only outcome tests at the new
Student 360/private-document boundary and attach a scoped inventory proving no
active Student 360 or staff-document import, route or mutation can reach
SQLite, Supabase or a fallback.

#### V2-9 WhatsApp and advisory-Gemini execution contract

V2-9 is delivered as three small replacement PRs under Issue #433. The split
does not authorize two active implementations of any completed capability:

1. V2-9A replaces the staff `/whatsapp` queue and `/whatsapp/:conversationId`
   transcript with canonical PostgreSQL reads. Sales sees Sales-owned
   conversations, Admissions sees Admissions-owned conversations and Admin
   sees their union through the exact role-preview policy. Handoff transfers
   the lead's conversations to Admissions atomically with the canonical
   handoff; there is no second inbox, Supabase Realtime refresh, RPC read or
   SQLite fallback. This PR is read-only from the staff UI and exposes no send
   action. The superseded `/api/ai/draft` route is also removed in V2-9A:
   it reads the deleted SQLite WhatsApp tables and has no surviving UI caller.
   V2-9B introduces the canonical proposal adapter directly, without a
   compatibility window or fallback to that route.
2. V2-9B adds one server-only Gemini draft adapter over the canonical
   transcript and stores each successfully validated result in
   `evo_ai_proposals`. The persisted record identifies the conversation,
   optional Student Case, provider, configured model, provider time and exact
   source message context. The adapter requests structured JSON and validates
   the returned value again as untrusted application input. Missing key,
   disabled provider authorization, provider failure or invalid output reports
   a truthful blocked/error state and writes no proposal; no alternate model,
   local generator or canned draft may succeed instead.

   The active V2-9B entry point is a staff server action on the canonical
   `/whatsapp/:conversationId` page, not an internal HMAC endpoint. The
   provider uses the stable `v1` `@google/genai` Interactions API with `store: false`,
   synchronous execution, tools disabled and JSON `response_format`. The exact
   system instruction treats every transcript message as untrusted data rather
   than model instructions. The exact
   `EVO_V2_GEMINI_MODEL` value is required; EVO has no implicit model. A real
   call additionally requires both `EVO_V2_GEMINI_PROPOSALS_ENABLED=1` and
   `EVO_V2_GEMINI_PROVIDER_AUTHORIZED=1`, plus the server-only
   `EVO_V2_GEMINI_API_KEY`. All other states are blocked before provider
   execution and write no proposal. This replacement deletes the old
   HMAC/Supabase proposal execution, SQLite/Anthropic summary and deterministic
   Prepared AI canned-response contour; none remains as a callable fallback.

   Before any transcript reaches Gemini, the repository locks the canonical
   lead row, rechecks the caller's current owning-role access, reads the newest
   bounded transcript and reserves a deterministic command receipt. It keeps
   that same PostgreSQL transaction and lead lock through the configured
   provider call, whose timeout is bounded to at most 60 seconds, and through
   proposal/event persistence. Inbound ingestion and Sales-to-Admissions
   handoff take the same lead lock, so neither ownership nor source messages
   can change during disclosure. A concurrent duplicate waits, replays the
   completed receipt and does not call Gemini again. The latest-proposal read
   joins current conversation authorization and the proposal in one SQL
   statement, so it cannot return a draft after a role handoff between two
   reads.
3. V2-9C adds the human Accept/Edit/Reject workflow over that same PostgreSQL
   proposal and on the same canonical `/whatsapp/[id]` panel. It does not add a
   second review screen or review store. A role may review only a conversation
   it currently owns; Admin may operate the union. Accept preserves the stored
   proposal text, Edit requires the final reviewed text and Reject requires a
   non-empty reason. The repository rechecks current conversation ownership
   while locking the proposal/conversation boundary, writes the final review to
   the existing `evo_ai_proposals` row and appends exactly one
   `ai_proposal.accepted`, `ai_proposal.edited` or `ai_proposal.rejected` event
   in the same transaction. The same request replays only after a fresh access
   check; a different concurrent or later final decision fails closed. Review
   never authorizes send, creates an outbound message or changes consequential
   CRM state.

   V2-10B / #465 supersedes the V2-9 read-only WAHA preflight. The standalone
   preflight UI, action, module and retired flag alias are not active runtime
   paths. Session verification now belongs to the one canonical server-only
   WAHA provider adapter and is used inside the explicit outbound workflow,
   not exposed as a second staff operation. The active environment contract is
   `EVO_V2_WAHA_ENABLED`, `EVO_V2_WAHA_PROVIDER_AUTHORIZED`,
   `EVO_V2_WAHA_BASE_URL`, `EVO_V2_WAHA_API_KEY` and
   `EVO_V2_WAHA_SESSION_NAME`. Disabled, missing or invalid configuration,
   credentials or provider authorization is `blocked` and performs no provider
   request. Before the single outbound request, the adapter requires an
   authorized `GET /api/sessions/{session}` response for the exact configured
   session whose status is exactly `WORKING`; otherwise the send stops clearly.
   The API key stays server-only in `X-Api-Key`. Start, restart, logout and QR
   operations remain outside the V2 product path.

The current provider contract follows the official WAHA session and API-key
documentation and the official Gemini structured-output documentation. WAHA
uses a server-only `X-Api-Key`; only `WORKING` counts as ready. Gemini uses the
committed `@google/genai` SDK, a server-only key, an explicitly configured
model and a small JSON schema whose final value is parsed and business-
validated by EVO. The model name is configuration, not a silently changing
default. These contracts are documented at
<https://waha.devlike.pro/docs/how-to/security/>,
<https://waha.devlike.pro/docs/how-to/sessions/> and
<https://ai.google.dev/gemini-api/docs/structured-output>. The Interactions
selection also follows
<https://ai.google.dev/gemini-api/docs/interactions-overview> and the stable
API-version contract at
<https://ai.google.dev/gemini-api/docs/api-versions>.

At #433 exit, no V2-9 browser or server route could send WhatsApp, write
amoCRM, enable an autonomous reply or invoke a fallback provider. That was the
truthful pre-authorization boundary proved by V2-9. The 2026-08-29 owner
decision and ADR 0023 now supersede only the no-real-call/no-write restriction
for the new #464-#467 canonical paths; they do not revive any deleted V2-9
sender, writer, worker or fallback.

Each internal PR deletes the superseded active runtime for the capability it
proves. By #433 exit, the V2 app import/route graph contains no Supabase/SQLite
staff WhatsApp reads, Supabase browser realtime, old AI draft/summary route,
manual-send worker, autonomous-reply worker, Supabase-backed Gemini proposal
or review repository, or old WhatsApp/Gemini implementation test. Frozen V1
deployments and historical ADRs, migrations, runbooks, archived docs, evidence
and other decision/rollback documentation remain unchanged and are excluded
from the active-import inventory.

#### V2-10 real-provider execution contract

V2-10 uses the existing connected provider accounts and four sequential
issues. The owner granted standing authority for the actions inside this
contract; agents do not pause for routine confirmation after every provider
call. A missing secret, provider denial, unresolvable recipient/case or a side
effect outside the named issues remains a real stop rather than permission to
guess, simulate or fall back.

1. **V2-10A / #464 — Gemini acceptance.** Exercise the existing canonical
   Interactions adapter with `store: false`, tools disabled, one explicit model
   and structured JSON on the minimum authorized context from an existing real
   conversation. PostgreSQL locks the source context and command receipt as
   already defined by V2-9. The application validates the response, persists
   the provider-returned `created` timestamp and stores the proposal before it
   requires Accept/Edit/Reject in the actual staff UI. A stateless
   `store: false` response may omit the provider interaction ID; absence is
   stored as no reference, a returned reference must validate, and the app must
   never invent one. Current SDK HTTP failures are classified from structural
   status and bounded provider error-info reasons, never from provider message
   text. There is no artificial call-count or cost limit in the product
   contract, but a completed receipt replays instead of paying for or
   disclosing the same request again.
2. **V2-10B / #465 — WAHA outbound.** Add one server-only adapter for the
   official `POST /api/sendText` operation and one explicit send action on the
   canonical conversation UI. This slice deletes the separate WAHA preflight
   panel as an active surface: the same send path performs the exact `WORKING`
   session check internally and, after a successful send response, performs the
   immediate provider read-back needed to reconcile current delivery/ACK state.
   The action rechecks current role ownership and persists a unique send attempt
   and processing receipt before any provider request. Only the direct canonical
   chat identity (`@c.us` or `@lid`) already received from that conversation is
   eligible. The `WORKING` session response also proves its own `me.id` and
   optional `me.lid`; when the canonical recipient is one of those self
   identities, WAHA may return either member of that exact provider-proven pair.
   No unrelated or inferred recipient alias is accepted. Success records the
   provider message identity and timestamp, then creates the one canonical
   outbound message plus the latest reconciled ACK marker. A timeout, lost
   response, provider 5xx or malformed success response becomes a durable
   `unknown` result with no fake message and no blind resend. The same UI may
   perform a read-only, bounded reconciliation of that exact attempt: only one
   provider message matching its immutable text, time window, outbound direction
   and verified recipient identity may settle it; zero or multiple matches leave
   it `unknown`. An explicit provider rejection becomes a durable `rejected`
   result. Exact
   request replay returns the stored result, while changed-payload reuse
   conflicts. Sales and Admissions may send only while the conversation still
   belongs to their role, and Admin is the union. Staff-authored final text and
   the exact accepted/edited Gemini text share this one send command; the model
   cannot invoke it. No group/broadcast send, autonomous worker, second sender,
   standalone preflight UI, public webhook dependency or fallback route is
   allowed.
3. **V2-10C / #466 — amoCRM writes.** Add one canonical server-only integration
   over account metadata discovered from the real connected amoCRM account.
   The account read requests `with=datetime_settings` and obtains timezone only
   from the documented `_embedded.datetime_settings.timezone` object; it must
   not invent an undocumented top-level timezone field. Custom-field `code`
   values are bounded, exact, inert provider strings rather than application
   identifiers with an invented leading-character grammar. Only the exact
   unique `PHONE` and `EMAIL` codes have routing meaning; every other code is
   catalog evidence and is never executed or interpolated.
   PostgreSQL remains the business authority and stores durable provider
   bindings/command receipts. Explicit product commands may create, update and
   link contacts/leads and apply the required pipeline, status,
   responsible-user, note and tag operations. Every operation uses exact
   server-side role/workflow authorization, provider correlation and read-back.
   Managed Sales and Admissions tag names are part of the routing contract,
   but their provider IDs may be absent on the first command. In that case the
   same canonical lead-tag mutation adds the exact tag by name, reads back the
   provider-created ID and rejects duplicate exact-name matches; there is no
   separate tag-bootstrap writer or prerequisite manual setup. Existing tag
   IDs remain the preferred mutation identity after discovery.
   The active V2 auth path is one private-integration long-lived Bearer token
   stored only in ignored server-side secret material. V2 does not depend on
   `refresh_token` rotation, `client_id`, `client_secret`, `redirect_uri` or
   `POST /oauth2/access_token` during normal command execution. If the token is
   missing, expired, revoked, malformed or rejected, the command path fails
   clearly with no fallback auth path or blind retry.
   The active V2 amoCRM path does not require or exercise the private-
   integration permissions `files`, `files_delete`, `notifications` or
   `push_notifications`. Their presence on the already connected integration,
   if any, is pre-existing provider configuration rather than V2 authority:
   do not add, modify or reissue token permissions solely for this acceptance
   run.
   An ambiguous result is reconciled before retry; amoCRM is never a dual-write
   authority, fallback repository or source of a second workflow state.
4. **V2-10D / #467 — real acceptance.** Use one minimized owner-authorized
   exact provider target whose private identifiers stay out of Git and GitHub
   evidence: either an existing real conversation/case or one clearly marked
   validation entity on the connected session self identity. Prove `Gemini
   proposal -> human review -> explicit WAHA send -> provider identity/ACK ->
   amoCRM command/read-back` through the real application, PostgreSQL and
   Chromium. If no exact safe target can be resolved, the run blocks honestly
   rather than selecting an arbitrary customer or creating fake business data.
   Deliver this final proof through this reviewed plan stage, one separately
   reviewed inert harness PR and one bounded exact-main execution. The harness
   PR adds the combined runner and its fail-closed tests without calling a
   provider. Then run that merged harness against one disposable PostgreSQL
   database and the private local application. The run
   may request one real Gemini proposal automatically, but it must stop in a
   visible `review_required` state before any WAHA send or amoCRM command. One
   real human must inspect the actual proposal in Chromium and either accept it
   or edit it, then explicitly confirm the final send. This is required product
   input, not a new provider-operation approval; the standing #463 authority
   remains sufficient and no routine confirmation is added. Playwright, Codex
   and Gemini must not click the review or send controls on the human's behalf.
   After the reviewed send, the same run may execute the explicit amoCRM sync,
   reconcile provider identities and ACK, prove exact replay/no duplicates and
   finalize only hashed/count evidence. An interrupted or ambiguous run
   preserves its private database and dispatch markers and resumes by exact
   reconciliation; it never starts a second send or selects another target.
   Recovery has two explicit durable boundaries: the pre-send human-review
   checkpoint and a post-WAHA checkpoint created only after PostgreSQL plus an
   exact read-only provider lookup prove the one reviewed message identity and
   ACK. A run resumed from the post-WAHA boundary disables Gemini and WAHA
   mutation authority, performs no inbound seed, review action or send, and may
   continue only with the one remaining amoCRM sync, read-back and exact replay.
   A provider rejection before a proposal exists, with zero downstream
   mutations, writes immutable exact-SHA failure evidence and stops. A fresh
   attempt is permitted only after a concrete new provider signal such as an
   owner-supplied credential that passes a real non-mutating provider check,
   an append-only authorization entry, a newly reviewed and merged exact-main
   SHA and an empty evidence directory for that SHA. The prior failure marker
   is never edited, moved or deleted, and the fresh attempt remains single and
   bounded rather than becoming an automatic retry loop.

Provider secrets remain in ignored server-only files or the authorized secret
injection workflow and never enter browser state, PostgreSQL business rows,
logs, Git, issues or PR evidence. #465 and #466 replace the completed read-only
restrictions with exactly one active provider path each; their slices delete
any superseded active writer, token/config dependency, route, script and
implementation test after real proof. Frozen V1 deployments and historical
artifacts remain inert and unchanged.

The contracts follow the current official provider documentation:

- WAHA send, session, event and API-key contracts:
  <https://waha.devlike.pro/docs/how-to/send-messages/>,
  <https://waha.devlike.pro/docs/how-to/sessions/>,
  <https://waha.devlike.pro/docs/how-to/events/> and
  <https://waha.devlike.pro/docs/how-to/security/>;
- Gemini Interactions and structured output:
  <https://ai.google.dev/gemini-api/docs/interactions-overview> and
  <https://ai.google.dev/gemini-api/docs/structured-output>;
- amoCRM/Kommo OAuth, contacts, leads, links and notes:
  <https://developers.kommo.com/docs/oauth-20>,
  <https://developers.kommo.com/reference/add-contacts>,
  <https://developers.kommo.com/reference/adding-leads>,
  <https://developers.kommo.com/reference/link-entities> and
  <https://developers.kommo.com/reference/add-notes>.

### Real validation boundary

- Use Node `22.23.1` and OrbStack with Docker context exactly `orbstack`.
- Use real PostgreSQL, actual SQL migrations, actual application routes, real
  file bytes and a real browser.
- Isolated technical records may prove mechanics, but no fake/demo record may
  be presented as business acceptance.
- Do not invent provider success. A missing real credential is a named blocked
  state, not a mock, fallback or skipped-success result.
- Ordinary lint, typecheck, unit/integration, browser and build checks remain
  required in proportion to each slice.

### Historical deferred set before ADR 0024

The following were preserved as one deferred-before-broad-real-use note and
were not active dependencies for local product and bounded provider validation:
production-grade staff authentication/account lifecycle; multi-organization
tenancy and cross-organization RLS; fine-grained per-user grants; public/VPS
deployment, DNS/TLS/Caddy and paid infrastructure; production monitoring,
health center, compliance-style audit/export; full database/file restore drills
and production rollback proof; managed staff acceptance; a 10-day or five-case
pilot; broad or historical customer migration; replacement, cutover and
tagging.

ADR 0024, parent #543 and children #544-#553 are now the separately authorized
plan covering the applicable controls. The historical bounded provider
authority in #463-#467 by itself granted no deployment, broad migration or
cutover authority.

V1 staging and production, their code, data, images, runbooks and rollback
artifacts remained unchanged during that program. The V1 history below is
retained as evidence and does not override the current ADR 0024 successor
contract.

## Frozen unified V1 authority and execution evidence

- EVO is one internal platform with one login, one accepted UI, one pilot role
  model and one end-to-end workflow. CRM, Inbox, Lead Agent, Admissions,
  Finance, Tasks, Documents and AI are modules, not separate products.
- Supabase is canonical for operational client, lead, stage, ownership, next
  action, Student Case, documents, applications, visa, payment control, tasks,
  communications and audit. SQLite runtime/fallback, dual-read, dual-write and
  compatibility layers are prohibited.
- amoCRM is a temporary read/import adapter. WAHA is a private transport
  adapter. Gemini Flash is the single pilot AI provider; every result is a
  human-reviewed draft and cannot act autonomously.
- The normal Admissions handoff requires confirmed contract plus first
  mandatory payment. Director/Admin override requires a reason and audit.
- The first live stage is receive-only: no outbound WhatsApp and no amoCRM
  write. Repository evidence does not prove managed Supabase, provider,
  deployment, backup or rollback behavior.
- The pilot is net-new after an explicit cutoff or an authorized small
  allowlist. Existing active and historical legacy records stay excluded or
  read-only until separately approved post-pilot work. No coexistence bridge,
  broad pre-pilot migration or fallback write path is authorized.
- For #382-#388, exact-diff self-review, all required exact-head CI,
  `--match-head-commit` and exact-main verification are mandatory. A separate
  GitHub Reviews API `APPROVED` record is not a merge gate for this owner-
  authorized program.

The historical V1 dependency order was:

| Slice | Issue | Outcome |
| --- | --- | --- |
| U0 | #377 | Authority docs and complete legacy crosswalk |
| U1 | #378 | One login and three pilot roles |
| U2 | #379 | Canonical Supabase client and lead |
| U3 | #380 | Receive-only WhatsApp in the unified Sales queue |
| U4 | #381 | Sales qualification, owner and next action |
| U5 | #382 | Contract and first-payment evidence |
| U6 | #383 | Audited Sales-to-Admissions handoff |
| U7 | #384 | First complete Admissions case |
| U8 | #385 | Minimal payment control and finance stop-factor |
| U9 | #386 | One Gemini Flash assistant with human review |
| U10 | #387 | Net-new pilot cohort and legacy isolation |
| U11 | #388 | Truthful admin health, audit, backup and rollback |
| U12 | #389 | Real managed receive-only acceptance |
| U13 | #390 | Ten-workday, five-case internal pilot |
| U14 | #391 | Historical closed-record migration/archive |

U0 merged as one reviewed docs-only PR. Its complete disposition of the 16
then-current draft PRs and 11 pre-#376 open issues remains in
`docs/platform/u0-draft-pr-issue-crosswalk.md`. U1 merged in PR #393 with one
login, exactly `sales`/`curator`/`admin`, live Supabase claim-to-row validation,
Admin-only lifecycle management, immediate revocation and explicit individual
contract/first-payment permissions. U2 added the canonical client/lead
identity, provenance, duplicate and bounded read contract described in
`docs/platform/u2-canonical-client-lead.md`. U3 merged in PR #395 with signed
receive-only WAHA intake, canonical conversation linkage and bounded Sales
intake/history reads described in
`docs/platform/u3-receive-only-sales-queue.md`. U4 merged in PR #396 and owns
only canonical
Sales qualification, eligible owner assignment, paired next action/deadline,
truthful connected/unconnected queue filters and durable audit described in
`docs/platform/u4-sales-qualification-owner-next-action.md`. U5 merged in PR
#397 and owns the contract/first-payment gate described in
`docs/platform/u5-contract-first-payment-gate.md`. U6 merged in PR #398 and
owns the audited canonical handoff described in
`docs/platform/u6-sales-admissions-handoff.md`. U7/#384 merged in PR #399 at
`bbc78a376b017a1d068c20ccce7978a128858371`; exact-main run `33004299957`
completed successfully. Its workspace contract remains
`docs/platform/u7-admissions-case-workspace.md`. U8/#385 merged in PR #400 at
`e3a681774bcb2c37a7f4c1600341cc16d6282892`; exact-main run `33013322714`
completed successfully. Its implementation contract is
`docs/platform/u8-payment-control-stop-factor.md`. U9/#386 merged in PR #401 at
`48d15818d51a629ea97f914b93c2beca82ee0c2b`; exact-main run `33017855457`
completed successfully. Its human-review contract remains
`docs/platform/u9-gemini-human-review.md`; repository evidence does not claim
live Gemini or production proof. U10/#387 merged in PR #402 at
`2ea92ac547d7f526f0e886a81f871936af456635`; exact-main run `33024106321`
completed successfully. Its contract remains
`docs/platform/u10-net-new-pilot-cohort-legacy-isolation.md`. U10 extends
canonical Student Cases with explicit pilot membership and a truthful
legacy-write boundary; it does not authorize a legacy fallback, provider
action or production rollout.

U11 repository implementation merged in PR #404 at
`6d2109b865da334bd41ad8c432147a2f7045937b`; exact-main run `33073539999`
completed successfully. On 2026-08-27 the owner-authorized staging execution
created a data-less persistent Supabase Micro branch, applied migrations
`001-092`, provisioned one approved Admin, passed protected validation-only
GitHub run `33084233185`, and started only the exact V1 CRM app under Compose
project `evo-crm-staging`. Production remained on
`ee8a825ebc72f84449636e3feaefab7a330913d4` with restart count `0`.
Canonical `staging.crm.evoadmissions.com` DNS, real browser UI acceptance and
the Database plus separate Storage recovery drill remain blocked/open, so this
execution does not close #388, complete R3 or authorize R4 production
promotion.

## Historical pre-#376 execution record

Everything below this boundary records earlier P/BW/NW/P8 planning and exact
historical evidence. It is not an active execution sequence and cannot
override #407, ADR 0022 or active V2 issues #424-#433.

Historical P1, reusable greenfield P2A-P2H, BW0, P3A-P3C, BW1-BW7,
P2R0-P2R4 and P4A are merged. PR #118 merged the P4B docs-only contract, PR
#128 merged the owner-authorized correction that keeps Student Profile document
automation outside `evo_AI_CRM`, and PRs #129-#130 merged the local-validation
prerequisite and repair, PR #132 merged the disabled-by-default P5A WAHA
ingress, PR #133 merged the disabled-by-default P5B projection, PR #137 merged
the P5C available-history reconciliation lane, and PR #138 merged the
disabled-by-default P5D private WAHA media archive and accepted media display.
PR #141 merged the disabled-by-default P5E ACK/session projection and private
Realtime invalidation lane, PR #142 merged the bounded P4R1 read-only
canonical amoCRM context lane, PR #144 merged the disabled-by-default P5F1
Platform-owned memory/retrieval foundation, PR #145 merged the disabled-by-
default P5F2 stateless Gemini proposal adapter, PR #146 merged the disabled-by-
default P5F3 deterministic autonomous inbound-reply lane, and PR #147 merged
the reviewed P6A-P6D implementation contract. PRs #148, #149, #152 and #153
then merged P6A read-only attention, P6B durable Student Portal notifications,
P6C overdue-transition publication and P6D cross-domain Student 360 closure.
PR #154 merged the P7 security/reliability contract, PR #156 merged P7A safe
Admin-only audit search/export, PR #157 refreshed accepted status and the
OrbStack-only rule, PR #160 merged P7B private observability, PR #163 merged
the P7C authority contract plus the `evo-platform-prod` organization and name
consolidation, PR #164 deferred the P7C drill, PR #165 merged the local
knowledge-ingestion contract, PR #166 merged its deterministic Takeout
preparation pipeline, PR #170 merged the real lead-processing proof plan, and
PR #171 merged Codex review plus Obsidian publication. PR #169 merged the
focused P7D accessibility contract, and PRs #172-#174 hardened the local
knowledge-ingestion path. PRs #208, #212 and #214 then merged knowledge
audience isolation, atomic Obsidian bundle sync and audited staff assistants;
PR #215 merged the P8D4 staff-pilot contract, PR #216 merged the supervised
Lead Agent sales policy, PR #218 unified Platform intake memory with the
draft-only consultative-sales proposal path, and PRs #220 and #222 refreshed
and bound the unified P8D4 portable candidate. PRs #224 and #226 then applied
production migrations `073-076` and froze the final 11/291 knowledge identity,
PR #228 repaired the isolated importer Compose invocation, PR #230 packaged
the importer as a runnable, UUID-redacting production-image artifact, and PRs
#232-#233 built and independently verified the exact P8D4F `linux/amd64`
candidate, and PR #235 authorized the closed P8D4G production execution order.
Repository status through PR #374: the single active WAHA session authority
merged at 2026-08-23 02:12:16 UTC, which is 2026-08-23 08:12:16 in the workspace
timezone (+06), as `2db8810213c7944aaf2f1b8e52ef4c0ab7824aa5`; the canonical
migration chain is contiguous through `001-082`; and exact-head PR CI run
`32611834420` passed Changed range, Main CRM, EVO Inbox and EVO Lead Agent. A
post-merge tree comparison also confirmed that the merge commit is equivalent
to the reviewed PR head `9f7901d7cf2c434819b86d634fd26af102302615`.
Always re-query `origin/main` and exact-main CI before a release instead of
treating this recorded merge SHA as a moving-current alias.

P4B implementation is preserved on remote branch
`izzhackt/evo-platform-p4b-mapping-approval` at
`e53ba94954f147b295f596421a255591fa343ce8`; no implementation PR exists.
Focused repository checks passed, but its attempted full local Supabase gate
failed closed in the real Auth/PostgREST hook before Playwright and is
failed/non-evidence. The owner keeps P4B activation/writes deferred but resumes
a bounded read-mostly P4R lane after the messaging foundation. P9 remains
removed. Lead Agent, the legacy webhook/session path and rollback path remain
deployed/frozen. P5A-P5F3 and P4R1 are merged without real-provider proof. The
completed P6A-P6D evidence is synthetic/local and authorizes no managed or
production claim. P7A and P7B are repository/local evidence only and remain
disabled by default. On 2026-08-14 the owner deferred the P7C restore drill
until the Platform is functionally complete and concretely operating.
Supabase Pro scheduled database backups remain enabled, but they are not
restore evidence and do not include Storage object bytes. `inbox-prod` is a
currently separate deployment contour, not a separate target product. Keep it
stable until a separately authorized unified-Platform cutover proves the
replacement path, then retire the contour without a dual-read/write bridge.
Read-only server evidence on 2026-08-23 (+06) shows healthy CRM, Inbox and Lead
Agent application images at release
`ee8a825ebc72f84449636e3feaefab7a330913d4`, with the sslip.io CRM and Inbox
health routes returning HTTP 200. That release predates PRs #371-#374 and still
runs three application boundaries plus two WAHA services; it is not the target
all-in-one proof. Canonical DNS/TLS is deferred by owner direction. P8R5 and
P8R6 are merged in the repository, but production still runs the older
`ee8a825e...` release and there is no real provider proof for the new path. The
active non-runtime lane is BH1 repository branch/worktree hygiene; it cannot
authorize deployment or provider activity. All outbound WhatsApp and amoCRM
writes remain disabled.

Separate owner-authorized hygiene on 2026-08-23 removed only the superseded
temporary revision `2c38a325e85fe798ccece31c4e91db909a49246d`: its three
unused EVO application image tags and exact `/opt/evo-releases/<sha>` checkout.
No active container, WAHA image, volume, rollback tag or `ee8a825e...` release
was removed; CRM and Inbox fallback health remained HTTP 200 afterward.

The previously active P8D4S lane under issue #270 remains historical evidence.
P8D4R safely verified the exact candidate,
migrations `001-076`, staging, rollback capture and disabled configuration,
then stopped with `knowledge_failed` before any database import, application
deployment or pilot. Cleanup removed all four local build roots, the remote
knowledge directory and the isolated importer; all five production containers
retained their prior image IDs, healthy state and restart count zero. The
immutable P8D4R result is retained with SHA-256
`9217322cf48f96daadd8ef780732b8c29cc54e9234bc4c6e2b8ecfbe4c459577`.
Its evidence incorrectly records account resolution and deterministic builds
as `not_run` even though four removed build roots prove those pre-effect
substeps ran. P8D4S corrects only this evidence integrity gap: partial
knowledge progress and a fixed redacted failure step/attempt must be retained
on failure, while credentials, UUIDs, content, stderr and private paths remain
excluded. The existing three spaced `scp` attempts, byte/deadline checks and
all remote/container SHA-256 gates remain unchanged. It uses new
collision-free release, rollback and evidence roots.
After independent review, merge, exact-main CI, execution-control rebinding,
fresh preflight and a new action-time confirmation, it may resume the frozen
11/291 import, deploy the three application boundaries with outbound behavior
disabled, and run only the two fixed staff draft pilots under
`docs/platform/p8d4-current-main-staff-pilot.md`. The owner
deferred the large capacity stress test and approved a small-launch monitoring
envelope plus focused human review on the exact P8 candidate.
Updated 2026-08-17 in the workspace timezone.

This document is the execution contract for the current EVO Platform MVP lane in
this repo. The current detailed contract is
`docs/EVO_PLATFORM_LONG_RUN_PLAN.md`. New implementation lanes are blocked
until their plan and `docs/PLAN_CHANGES.md` amendment are independently
reviewed and merged. If scope, architecture, API/schema, acceptance criteria,
file ownership or merge order changes, stop the affected code change and merge
a separate plan amendment first.

## Lead-processing real-proof lane

Block-ID: `EVO-LEAD-PROCESSING-REAL-PROOF-PLAN-2026-08-14`.
Tracking issue: [#168](https://github.com/izzhackt/evo_AI_CRM/issues/168).

This lane converts the merged, disabled Platform messaging capabilities into a
reviewable sequence for later real-provider proof. It authorizes documentation
only. It does not authorize deployment, a managed Supabase migration, WAHA
webhook/session changes, WhatsApp messages, amoCRM writes, Gemini calls,
autonomous replies or provider-side configuration.

### Verified baseline

- Current GitHub `main` is `f363630cd2296da32930f18e64c2895e60475818`.
  Push CI run `31804372439` was still in progress when this docs head was
  created. PR #166 merged the separate knowledge-ingestion K2 implementation
  while this plan was under review; its files remain outside this lane. No
  lead-processing implementation PR was open when this refreshed baseline was
  recorded.
- P5A-P5F3 and P4R1 are merged and disabled by default. Repository contracts
  cover signed raw ingress, idempotent projection, history/media handling,
  ACK/session state, read-only canonical amoCRM context, Platform-owned memory
  and approved-knowledge retrieval, structured Gemini proposals,
  qualification, deterministic send eligibility, staff takeover/pause/resume
  and append-only audit evidence.
- Production `/opt/evo-crm` was inspected read-only on 2026-08-14. Its running
  app image and source revision are
  `564332b420a1fb1bd6232dda945d044bb922d3f0`, started 2026-07-24. The running
  app and `.env.production` expose none of the Platform enablement flags. The
  merged Platform lane is therefore not deployed or enabled there.
- No accepted evidence proves the real chain from WhatsApp through Platform
  persistence, amoCRM context, approved-knowledge retrieval, Gemini proposal,
  governed reply or handoff, WAHA ACK and staff-visible audit. Local and CI
  fixtures remain repository proof only.

### External contracts rechecked

- WAHA documents `message` as inbound, `message.any` as every message creation
  including messages sent through its API, `message.ack` as delivery/read/error
  progression, and `session.status` as the session lifecycle. The Platform must
  keep inbound identity, outbound observation, ACK and session reconciliation
  distinct: <https://waha.devlike.pro/docs/how-to/events/>.
- Kommo documents contacts as people, leads as sales opportunities and explicit
  links between them. P4R1 may read canonical linked context; creation, linking
  or stage mutation remains a separately approved write:
  <https://developers.kommo.com/reference/link-entities>.
- Gemini structured outputs constrain the final JSON shape but do not make its
  facts or reply safe. The deterministic Platform policy remains the only send
  authority: <https://ai.google.dev/gemini-api/docs/structured-output>.

### Approval-gated execution order

1. **L0 — contract (this block).** Merge this docs-only baseline after
   independent exact-head review and CI. No runtime or provider action.
2. **L1 — deploy disabled capability.** With explicit action-time deployment
   approval, deploy an exact reviewed Git SHA and apply the already-merged
   additive migrations. Keep every Platform enablement flag off and the
   autonomous-reply kill switch engaged. Prove revision, migration inventory,
   private routing, health and rollback without provider calls.
3. **L2 — receive-only intake.** With explicit WAHA webhook/session-cutover and
   managed-Supabase approval, use one EVO-controlled sanitized sender. Prove
   HMAC verification, raw persistence before processing, replay safety,
   operator-visible text and media, history reconciliation and private
   Realtime. Send no reply and write nothing to amoCRM.
4. **L3 — canonical context and retrieval.** With explicit approval for one
   real amoCRM read and the approved-knowledge publication contract available,
   resolve the sanitized sender to canonical contact/lead context or record a
   fail-closed human handoff. Consume only versioned approved knowledge and
   persist retrieval evidence; never read the raw ingestion archive directly.
5. **L4 — structured proposal and governance.** With explicit Gemini-call
   approval, produce one schema-valid proposal bound to the exact message,
   memory version, qualification version, amoCRM-context observation and
   knowledge evidence. Exercise forced-human, staff takeover/pause and audited
   resume without sending WhatsApp.
6. **L5 — one governed outbound proof.** Only if the owner separately approves
   a real WhatsApp send, queue one eligible single-use reply to the sanitized
   number, reconcile `message.any`, ACK and session evidence, and prove that an
   unknown transport outcome cannot retry automatically. Otherwise L5 remains
   blocked and the accepted milestone is receive-only plus draft/handoff.

Every block requires its own linked issue/PR, exact-head independent review,
green exact-head CI, real-path evidence, rollback record and final provider-
state recheck. A block must stop before the first externally visible action if
its action-time approval or credential is absent.

### Inputs and blockers

- deployment approval for `/opt/evo-crm` and the managed Supabase target;
- explicit ownership/cutover choice for the single target `evo-inbox` WAHA
  session and webhook, without altering the retained Lead Agent rollback path;
- sanitized EVO-controlled test sender and an identifiable test lead;
- backend-only WAHA, Supabase, amoCRM-read and Gemini credentials;
- approved, versioned knowledge artifacts and their retrieval publication
  interface from the independent ingestion lane;
- separate action-time approvals for one amoCRM read, one Gemini call and, if
  L5 is attempted, one WhatsApp send.

The default milestone is L4 with no send. No amoCRM write is required or
authorized anywhere in L0-L5.

## Local EVO Knowledge Ingestion Lane

Proposed independent slice: `EVO-KNOWLEDGE-INGESTION-LOCAL-2026-08-14`.
This slice does not modify or deploy the production CRM, EVO Inbox, WAHA,
amoCRM, Supabase, or any managed provider. It creates a local, resumable
pipeline that prepares the owner-supplied Gmail and Google Drive Takeout data
for semantic review by the authenticated Codex app or CLI without using the
OpenAI API or storing an API key.

### Scope

1. Add a Python CLI under `scripts/knowledge_ingestion/` and focused tests under
   `tests/knowledge_ingestion/`.
2. Read source roots without modifying them. The first real sources are the
   Gmail MBOX and Google Drive snapshot in
   `/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Сырой архив ЭВО`.
3. Write generated manifests, checkpoints, extracted business text and Codex
   review queues only beneath a caller-supplied output root. The default
   operational output is the internal Obsidian vault's `Входящие кандидаты`.
4. Use SHA-256 as content identity, preserve every source path as provenance,
   and avoid re-extracting content that a completed checkpoint already covers.
5. Exclude every Google Drive path beneath `Корзина` and every Gmail message
   labelled Spam or Trash from analysis.
6. Detect sensitive applicant files conservatively from path, filename and file
   type. Record only archive metadata for them; do not extract document text,
   OCR, previews, or attachment bodies.
7. Extract supported business content locally from plain text, HTML, PDF,
   DOCX, XLSX and PPTX. Unsupported or failed files remain explicit manifest
   records; there is no fake or empty-text success.
8. Extract Gmail business attachments under the same rules as Drive files and
   deduplicate them by SHA-256 across all sources.
9. Generate bounded Codex review batches and a Russian instruction contract.
   The preparation CLI must never call an LLM API. An optional operator command
   may invoke the installed authenticated `codex exec` CLI, so usage remains
   Codex-plan usage rather than OpenAI API billing.
10. Keep the client-facing Obsidian vault outside direct ingestion. Only
    reviewed outputs may be promoted there under the knowledge authority rules
    in `AGENTS.md`, `CONTEXT.md`, and
    [ADR 0029](adr/0029-resolve-knowledge-by-authority-order.md).

### Delivery blocks

- **K1 — Contract and fixtures:** merge this plan amendment, domain vocabulary,
  ADR and repository rules before implementation.
- **K2 — Deterministic preparation:** implement source discovery, exclusions,
  sensitive classification, local extraction, SHA-256 deduplication,
  checkpoints, manifests and bounded review batches.
- **K3 — Codex review and Obsidian publication:** add the authenticated Codex
  CLI operator command, structured review schema, authority resolution and
  idempotent Russian Markdown publication to the internal vault.
- **K4 — Real corpus completion:** run K2 and K3 against all accepted source
  material, record counts and failures, resolve escalated conflicts, and verify
  that prohibited content never enters either AI vault.

### K2 acceptance criteria

- The CLI runs against the real Gmail and Drive roots and exits non-zero for a
  missing source, extraction failure that was incorrectly marked successful,
  corrupt checkpoint, or output outside the caller-authorized root.
- Re-running unchanged real inputs produces no duplicate extraction or review
  item and reports a zero-new-work result.
- No item beneath Drive `Корзина`, no Gmail Spam/Trash item, and no extracted
  sensitive applicant content appears in generated text or review batches.
- The manifest preserves source path, source kind, size, modified time,
  SHA-256, classification, extraction status and all duplicate locations.
- Tests cover the real supported parsers with repository-owned non-sensitive
  files; the end-to-end gate additionally runs against the owner-supplied real
  Takeout roots and reports real counts without printing personal content.

### K2 validation commands

- `python3 -m unittest discover -s tests/knowledge_ingestion -v`
- `python3 scripts/knowledge_ingestion/prepare.py --help`
- a real preparation run with explicit Gmail, Drive and output roots;
- the same real command a second time to prove resumability and idempotence;
- a manifest audit that fails if excluded or sensitive content entered a review
  batch.

### Stop conditions

- Stop before reading source content if the expected real roots are missing or
  their recorded Takeout checksums no longer verify.
- Stop before Codex execution if CLI authentication is unavailable or the
  prepared batch contains a prohibited classification.
- Stop before client-vault publication when authority is unresolved, a source
  conflict is escalated, or the destination is not the configured client vault.

For the currently active owner-authorized MVP lane, older references in this
file to a scheduled Launch Auditor, controller-only merge, or globally
draft-only/manual-send AI are historical unless restated inside the active
slice. The superseding rule is:

- one fresh independent read-only exact-head review is required;
- exact-head GitHub CI must be green;
- before merge, refresh `origin/main` and the PR base and confirm the reviewed
  head SHA and reviewed base/main still match the evidence;
- the executor may merge only that exact reviewed head directly;
- intermediate blocks stop after their selected short PR checks and exact-head
  merge; do not repeat a full exact-main proof between them; and
- run the one manual exact-current-main proof only after the release-candidate
  SHA is frozen, before release or recovery acceptance.

## Historical goal slice before #376

> Superseded by #376, ADR 0020 and U0-U14. This section is retained only to
> explain prior repository evidence and does not authorize P8 or runtime work.

The active planning slice at that historical checkpoint was P8 controlled
release-candidate preparation under
`EVO-P8-CONTROLLED-RELEASE-CANDIDATE-2026-08-14`. P6A-P6D, P7A and
P7B are merged, PR #163 merged the P7C authority contract and managed project
consolidation, PR #164 merged its deferral, and exact-main run `31820931774` is
green. The owner has deferred P7C database plus separate
private Storage recovery execution and the large P7D capacity stress test; those
deferrals do not count as recovery or capacity acceptance. The P7D contract is
merged; P8 now prepares the exact candidate. Accessibility closure still
requires exact-candidate automated evidence and the approved human review
before a release decision.
Each block still requires its own
fresh exact-head review, exact-head CI, exact-base recheck, reviewed merge and
green exact-main push CI. No P7 block inherits managed, provider or production
proof.

### Historical goal

Build the unified EVO Platform in ordered, independently reviewed blocks while
preserving the accepted frontend contract and current production safety.
amoCRM remains canonical for contact, lead, responsible sales manager and
sales stage. One greenfield Supabase-native backend becomes the platform-owned
operational store, with physically isolated dev/staging/preview environments.
The existing unified frontend from PRs #64/#71/#72 is the sole product UI
contract and must be wired through repository/session seams, not replaced or
paralleled. The MVP priority is the real operator workspace: available WAHA
history and private media, ACK and true realtime, then bounded canonical
amoCRM reads, Platform-owned lead memory/pgvector retrieval and real Gemini
qualification/replies.

Gemini may only return a structured RU/EN proposal. Deterministic server policy
may auto-send it solely as a reply inside the WhatsApp 24-hour service window
when every consent, opt-out, language, evidence, risk/confidence,
business-hours, cooldown/rate, staff-takeover, session-health, idempotency and
policy-version gate passes, explicit runtime enablement is present, and the
emergency stop/kill switch is not engaged. Cold outbound, broadcasts, autonomous follow-ups,
re-engagement, out-of-window free-form sends and direct model-to-WAHA access are
prohibited. Every other result becomes a durable human-review handoff.

This amendment preserves P4B activation/write work, recognizes merged bounded
read-only P4R1, and keeps P9 removed. The deployed Lead Agent remains frozen
only as a current-state rollback/cutover input; its useful orchestration belongs
inside the one Platform product and the separate contour is not retained as
target architecture. No mock, SQLite shim, hardcoded mapping, fake provider or
silent fallback may substitute for canonical amoCRM or provider evidence.

### Reconciled baseline

The first bullets below retain the P0 snapshot. The current sequential
checkpoint is:

- P0 plan/TZ/architecture merged in PR #75.
- P1A no-Visa-role migration merged in PR #76.
- P1B Admin-only Curator assignment/lifecycle merged in PR #77.
- P1C current-app object scope merged in PR #78.
- P1D current-root WhatsApp object-scope containment merged in PR #80.
- P2 Supabase-foundation decomposition merged in PR #81.
- P2A canonical migration authority merged in PR #82.
- P2B-P2H merged sequentially on `main`; this amendment recognizes them as
  reusable greenfield foundation rather than the active product slice.
- PR #93 merged the greenfield/UI boundary; PR #94 merged BW0; PRs #95-#97
  merged P3A-P3C; PRs #100-#103 merged BW1-BW4; PR #104 merged P2R0; PR #105
  merged P2R1; PR #107 merged the BW5 checkpoint amendment; PR #109 merged the
  P2R2 plan gate; PR #111 merged the P2R3 plan gate; PR #112 merged the P2R3
  repair; PR #113 merged BW5; PR #114 merged BW6; PR #116 merged BW7; PR #117
  merged P4A; and PR #118 merged the P4B plan at
  `10e5d85147ed6b87bfbd0281fc6ccce5464e8d3b`.
- PR #119 is immutable merged history but PR #128 supersedes it as current
  product authority. PRs #120, #122 and #124 were removed by reviewed revert
  PRs #127, #126 and #125. PRs #129-#130 then merged the bounded local-validation
  plan and repair. PR #132 merged the disabled-by-default P5A WAHA ingress,
  PR #133 merged the disabled-by-default P5B projection, PR #137 merged the
  P5C available-history reconciliation lane, PR #138 merged the P5D private
  WAHA media archive/display lane, PR #141 merged P5E ACK/session plus private
  Realtime, PR #142 merged bounded P4R1 read-only canonical amoCRM context,
  PRs #144-#146 merged P5F1-P5F3, PR #147 merged the P6A-P6D contract,
  and PRs #148/#149/#152/#153 completed P6A-P6D. PR #154 merged the P7
  contract, PR #156 completed P7A, PR #157 refreshed the accepted status and
  OrbStack-only rule, PR #160 completed P7B, and PR #163 merged the P7C
  authority contract plus managed project consolidation. Current `origin/main`
  is `8d16a551111add9d5e299db66bb519812473a89a`. Exact-main push CI
  `31810033100` is green, and migrations end at `072`.
- P4B implementation is preserved on remote branch
  `izzhackt/evo-platform-p4b-mapping-approval` at
  `e53ba94954f147b295f596421a255591fa343ce8`, with no implementation PR.
  Focused checks passed; the later full local Supabase gate failed closed in
  the real Auth/PostgREST hook before Playwright. Cleanup verification found no
  exact Platform resources/process/lock. This is failed/non-evidence, not P4B
  acceptance or provider proof.
- PR #108 exact head `f719b749efaadaf02c6344c5d01cd4b6bbe3d79c`
  is historical recovery evidence: it passed focused tests and CI but was
  closed without merge after controller
  comment `5166574008`: no prior plan authorization and no independently
  reproducible real local reset exit zero.
- PR #110 exact head `fd4428451793bdc59b3b183dcc9dde7518e80201`
  passed executor proof, exact-head CI and independent review but was closed
  without merge after controller comment `5171649961`: connected-route stale
  authority did not clear the resident Supabase browser cookie, and the
  controller's OrbStack endpoint did not permit the second physical-worktree
  local proof.
- Root `/whatsapp` remains a SQLite `wa_*` shadow surface with P1D
  authorization containment. It is not the unified communications backend;
  the greenfield application seam was established through P3C, while real
  provider completion remains P5.

- At the P0 snapshot, GitHub `main` and the clean P0 worktree resolved to
  `a16cd3fb`; the exact `EVO platform CI` run for that SHA was green and there
  were no open PRs.
- Production Inbox runs revision `a09a72fc`, release `2026-07-24.2`.
  Production CRM and Lead Agent run revision `564332b4`, release
  `2026-07-24.1`.
- The root app still uses SQLite/custom auth and local `wa_*` shadow tables;
  EVO Inbox still uses a separate Supabase model.
- The retained Lead Agent is frozen with worker, outbound, and automatic reply
  paths disabled; amoCRM readiness remains false.
- Read-only WAHA session queries returned `401` without a key, so current
  session state was not re-proved and no secret was read.
- No real WhatsApp/amoCRM end-to-end proof exists. Missing gates include exact
  amoCRM mappings/credentials, a dedicated sanitized test lead and number, QR
  owner, controlled-send authorization, release window, reconciliation window
  and rollback evidence.

### Immediate execution order

0. PRs #148, #149, #152 and #153 completed P6A-P6D, PR #154 merged the P7
   contract, PR #156 completed P7A, PR #157 refreshed accepted status plus the
   OrbStack-only rule, PR #160 completed P7B, and PR #163 merged the P7C
   authority contract plus managed project consolidation. Current main is
   `a8474eb57f94f952711e953be21b5e6041d2f36e`, migrations end at `072`,
   and exact-main push run `31820931774` is green. Preserve this accepted
   repository/local evidence and its non-production truth boundary.
1. Preserve P4B at
   `izzhackt/evo-platform-p4b-mapping-approval` / `e53ba94954f147b295f596421a255591fa343ce8`.
   Keep mapping activation and writes deferred. Merged P4R1 remains bounded
   read-only context without provider proof or mutation authority.
2. Defer the P7C encrypted database plus separate Storage recovery drill until
   the Platform is functionally complete and concretely operating. Keep
   automatic database backups enabled, do not create a billed recovery project,
   and leave the current `inbox-prod` runtime stable until the separately
   authorized unified cutover; do not add features or a second data authority
   there.
3. Preserve the merged focused P7D contract. Defer the large load test and
   temporary managed load environment without calling capacity passed. Prepare
   the real P8 candidate, then run the existing automated accessibility gate and the
   owner-led Mac/iPhone/Android human matrix on that exact candidate.
4. Do not infer canonical sales identity, responsible Sales, stage, Portal
   activation or contract handoff, and do not convert missing managed/provider
   evidence into a passed P7 claim.
5. P8 may prepare the real candidate after the P7D contract merges. A release
   decision remains blocked until focused accessibility and external-evidence
   accounting complete. Prove only executable P5-P7 plus P4R read paths. Report
   P4B activation/writes and unavailable provider segments as deferred, never
   passed or synthetically replaced.
6. Skip P9. Keep Lead Agent and the legacy webhook/session path deployed/frozen
   only until the unified replacement is proven and a separate retirement
   operation is authorized. Do not extend either contour or introduce a
   compatibility bridge. Run P10 directly after P8 as an authorized-scope audit
   that lists P4B activation/writes deferred and does not claim full Platform
   completion.

### P7 authority and sequence

The implementation authority for P7 is append-only Block
`EVO-P7-SECURITY-RELIABILITY-PLAN-2026-08-13` in `docs/PLAN_CHANGES.md` and the
P7 section of `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`, expanded by
`docs/platform/p7-security-reliability.md` and the primary-source note
`docs/research/p7-official-evidence-2026-08-13.md`. P7A removes direct browser
audit-table access and connects the accepted Platform Settings surface to a
safe, bounded, replay-aware Supabase audit projection/export. P7B keeps
readiness, metrics, internal routes and Lead Agent operational surfaces private.
P7C follows `docs/platform/p7c-managed-recovery-contract.md` when the owner
resumes it: it will use the real managed source, a newly owned empty managed
destination, and separate encrypted database and Storage evidence. It excludes
the current companion-era `inbox-prod` runtime because that runtime is not the
P7 recovery target; this physical exclusion does not make it a separate target
product or data authority. P7D now follows the focused
accessibility contract: high-load capacity stays deferred/unproved, while the
exact release candidate must pass the retained automated gate and approved
human review before release.

No P7 block authorizes public metrics, provider calls, customer-data exposure,
live sends, amoCRM writes, retention deletion or deployment. Only the exact
managed Supabase transfer and rename already completed under the P7C contract
supersede the earlier blanket provider/service prohibition. The deferred
recovery drill, production migration and destructive restore require fresh
action-time authority. P8 remains blocked until P7D completes and unavailable
evidence is recorded. P8 preparation may begin after the focused P7D contract
merges, but the release decision remains blocked until its accessibility proof
is complete.

### P5B authority and rollback contract

PR #133 merged as `18e0e0855fda31cba1fa837d81b3a75cedd585e9`
after its corrected exact head passed independent review, exact-head CI and the
full local Supabase/browser gate. Its accepted scope remains only a
disabled-by-default, amoCRM-independent projection worker behind the accepted
`/whatsapp` UI:

- private bodyless `POST /api/internal/platform-messaging/waha/work`, called by
  a private scheduler with UUID request ID, Unix-millisecond timestamp,
  `sha256` algorithm header and lowercase HMAC-SHA256 of
  `<request-id>.<timestamp>`;
- configured organization, exact `evo-inbox` session and `waha:evo-inbox`
  account only; verified inbound `provider_webhook_process` work only;
- service-only organization/session/provenance-bound claim, project and finish
  RPCs with a lease, bounded retry/manual-review disposition and no finish on
  invalid repository output;
- `sales_authority_source='platform_intake'` means only a Platform intake queue,
  never canonical amoCRM Sales ownership;
- raw WAHA chat/message identifiers stay in private append-only bindings and
  never appear as phone-bearing identifiers in public rows;
- valid media-only inbound remains pending/actionable and operator-visible; it
  is never terminally consumed solely because text is absent;
- no provider call, send, amoCRM write, production migration or legacy
  cutover. Rollback keeps feature flags off, reverts code and forward-fixes the
  additive schema; no destructive down migration. Lead Agent and the legacy
  path remain available.

P5B does not authorize AI or provider claims. History/media reconciliation,
ACK projection and Supabase Realtime are later independently reviewed P5
blocks and precede the autonomous-reply lane.

### P5C authority and rollback contract

Block `EVO-P5C-WAHA-HISTORY-2026-08-10` adds only a disabled-by-default,
server-side reconciliation lane for history that the existing WAHA store can
actually return for the exact `evo-inbox` session:

- the private trigger is HMAC-authenticated and requires an explicit feature
  flag, tenant, private WAHA origin, provider credential and service-only
  Supabase credential;
- provider access is read-only: session preflight plus paginated `GET` chat and
  message history with `downloadMedia=false`. It sends no message, sets no read
  marker and changes no WAHA session or webhook;
- NOWEB must explicitly report its store enabled; supported engines and
  `WORKING` session state fail closed before reconciliation;
- only direct chats enter this block. Inbound and historical outbound rows are
  projected behind the accepted `/whatsapp` UI, while raw WAHA chat/message
  identifiers remain private and browser-visible provider/amoCRM IDs stay null;
- cursor movement, page effects, replay evidence and lifecycle state are
  service-only, organization/session-bound and atomic. A provider/repository
  failure leaves the last committed cursor resumable;
- media-only history becomes an operator-visible marker. P5C does not download,
  archive or display media bytes; private media is the next P5 block;
- the configured Sales membership is an intake authorization only. P5C creates
  no canonical amoCRM identity, Sales owner, stage or handoff claim;
- synthetic local adapter/browser evidence proves the Platform path only.
  Real WAHA history completeness and provider behavior remain blocked until a
  separately authorized controlled provider run.

Rollback keeps P5C disabled, reverts the route/worker code and forward-fixes
the additive migration. It performs no destructive down migration, provider
mutation, production migration or legacy-path retirement.

### P5D private WAHA media authority and rollback contract

Block `EVO-P5D-PRIVATE-WAHA-MEDIA-2026-08-10` adds only the private-media
archive and authorized display path behind the accepted root `/whatsapp` UI.
It is deliberately separate from ACK/session projection and Supabase Realtime,
which remain the next independently reviewed P5 block:

- the Platform may archive media only for an already projected P5B/P5C
  communication message whose raw WAHA identity and source evidence remain in
  the reviewed private bindings;
- the server re-fetches one exact message with `downloadMedia=true`, validates
  the exact `evo-inbox` session, direct chat, message identity and configured
  private WAHA origin, rejects redirects and enforces bounded timeout/size;
- WAHA URLs and API keys never reach the browser. Object names are opaque,
  contain no phone, chat, contact, student or provider locator, stay out of RPC
  rows/page content and may appear only inside a short-lived audited Storage
  download URL;
- bytes are written through the Supabase Storage API to the fixed private
  `platform-whatsapp-media` bucket. Application SQL never inserts or updates
  Storage catalog rows directly;
- missing provider media, unsupported or unsafe inline content, oversize
  objects, Storage failure and binding conflict remain explicit archive states
  or staff handoff. They never become silent success or fabricated media;
- media-only messages stay operator-visible and remain in human-review state.
  P5D performs no media understanding, Gemini call or autonomous reply;
- no WAHA send/read marker, ACK/session mutation, amoCRM write, production
  migration, legacy-path change or service deletion is authorized.

Rollback keeps the archive worker disabled, reverts server/UI code and
forward-fixes additive schema. It does not delete archived objects or apply a
destructive down migration. Real-provider completeness and production
retention/restore remain blocked until separately authorized evidence exists.

### P5E WAHA ACK/session projection and private Realtime authority and rollback contract

Block `EVO-P5E-WAHA-ACK-SESSION-REALTIME-2026-08-10` keeps the accepted Claude
Design `/whatsapp` UI and adds only the next bounded P5 truth path after P5D:
durable ACK/session projection plus private Realtime invalidation. It consumes
only already verified P5A signed WAHA work and exposes only safe delivery and
session-health state through the existing server truth path:

- the disabled-by-default server worker may project exact `message`,
  `message.any`, `message.ack` and `session.status` observations for one
  organization-bound, session-bound lane. Existing P5B message projection
  semantics remain unchanged;
- ACK projection requires the exact documented integer/name pairs
  `ERROR/-1`, `PENDING/0`, `SERVER/1`, `DEVICE/2`, `READ/3` and `PLAYED/4`,
  plus exact private message binding and observation time. Missing bindings,
  cross-tenant/session mismatches, malformed pairs, inbound targets or stale
  regressions fail closed;
- current session health is bounded to the exact `evo-inbox` session and is
  observe-only. The Platform may not start, restart, log out, pair, mark read
  or reconfigure WAHA in this block;
- record-free private Database Broadcast invalidations may be emitted only on
  `platform-messaging:<organization UUID>`. Browser subscribers are
  receive-only and authenticated; no browser send/insert permission exists;
- Broadcast data is an invalidation hint only. The browser must refetch
  authoritative RLS-scoped state after subscribe, reconnect, visibility restore
  and accepted invalidation through bounded `router.refresh()`. Payload fields
  never merge directly into UI state;
- the accepted UI may show safe ACK name/time and safe session health, but raw
  WAHA chat/message/contact identifiers and raw provider payloads remain
  private. Unknown session values render unhealthy/unknown, never healthy;
- this block does not authorize provider send/read markers, amoCRM writes,
  production mutation, legacy-path retirement or any change to the autonomous
  send gate. The later AI/send lane still follows the ADR 0019 deterministic
  reply-only policy.

Validation requires focused ACK/session parser and replay-denial tests,
disposable PostgreSQL RLS/grant/topic checks, no raw-ID exposure proof,
private receive-only Realtime authorization, accepted browser update without
reload plus reconnect catch-up proof, and the full local Supabase/Auth/Storage/
PGMQ/browser gate under the repo singleton protocol. Synthetic local WAHA and
Broadcast evidence prove only the adapter, authorization and UI integration;
real-provider proof remains blocked.

Rollback keeps P5E disabled, reverts worker/UI code and forward-fixes additive
schema. It does not apply destructive down migration, mutate WAHA session
state, delete historical evidence or retire the frozen Lead Agent / legacy
rollback path.

### P4R1 bounded live canonical amoCRM read authority and rollback contract

Block `EVO-P4R1-AMOCRM-CANONICAL-CONTEXT-2026-08-10` adds the smallest
read-only amoCRM context behind the accepted `/whatsapp/[id]` thread. It does
not resume the deferred P4B approval/activation implementation.

- The server may read only the exact amoCRM account, contact, lead,
  responsible-user, pipeline and status identified by provider IDs already
  attached to the authorized Platform conversation. It may not search by name
  or phone, infer a link, select a mapping, or create an identity.
- The adapter is disabled by default and accepts only a validated HTTPS
  `<subdomain>.amocrm.ru` or `<subdomain>.kommo.com` origin plus a server-only
  read credential. The credential never reaches browser code, URLs, logs,
  errors or committed configuration.
- The provider account ID must equal the conversation account ID. Contact and
  lead responses must cross-reference each other, the lead's pipeline/status
  must resolve inside the exact provider pipeline, and a returned user must
  equal the lead's responsible-user ID. Any mismatch fails closed.
- The accepted UI may show only sanitized contact, lead, responsible-manager,
  pipeline/stage names, active status and the observation time. Missing IDs,
  configuration, scope, provider availability or administrator-only user
  access produces an explicit disabled, blocked, degraded or stale state.
- Supabase records an append-only refresh observation for each completed live
  attempt and a bounded current read projection for the authorized UI. A
  failed refresh preserves the last successful value only with an explicit
  `stale` state and original observation time. Browser actors receive it only
  through the existing live-authority and conversation-scope checks.
- The projection records the provider account/entity relationships actually
  verified, the exact adapter-contract version, observed endpoint
  capabilities, refresh outcome and time. It is not P4B mapping approval,
  custom-field semantic mapping, provider proof, AI authority or a handoff
  signal.
- No legacy SQLite settings or existing mutable amoCRM adapter may supply this
  Platform path. This block adds no approved mapping pointer, P4B event,
  task/call/chat read, webhook/poll reconciler or autonomous-send input.
- Official GET-only CRM endpoints are the account, contact-by-ID,
  lead-by-ID, pipeline-by-ID and user-by-ID APIs. The user lookup is allowed to
  degrade independently because the official Users API is administrator-only.
  Kommo Chats API is not required when the exact CRM entity IDs already exist.

Validation requires focused config/parser/client/repository and fail-closed
tests, append-only/idempotency/RLS/tenant/conversation-scope SQL tests,
secret-containment/client-boundary checks, accepted-thread integration checks,
root lint/type/build/unit/security gates, exact-head CI and one fresh
independent exact-head review. Synthetic fetch responses are adapter tests, not
real-provider proof. A live sanitized amoCRM read remains `blocked` until a
valid read credential and dedicated test entities are separately supplied and
authorized.

Rollback leaves the feature disabled or reverts server/UI code and forward-
fixes the additive schema; no destructive database down migration is allowed.
P4B remains preserved/deferred and Lead Agent plus the legacy rollback path
remain frozen and available.

### P5F authority and sequence

Block `EVO-P5F-AI-MEMORY-REPLY-LANE-2026-08-10` was the accepted docs-only
authority gate after merged P4R1. It preserves the accepted Claude Design
frontend as the sole UI contract, keeps P4B activation/writes deferred, keeps
P9 removed, and retains Lead Agent plus the legacy rollback path as
deployed/frozen current-state safety contours. The later 2026-08-22 all-in-one
authority supersedes their target retention: useful orchestration moves inside
the unified product and the separate contour is retired only after proof. Its
P5F1-P5F3 implementation slices are merged, and P6A-P6D are now complete.
P7-PLAN, P7A and P7B are also complete. The active plan group is P7C, gated
P7D, narrowed P8 and P10.

P5F SHALL be implemented in three independently reviewed slices:

- `P5F1` — Platform-owned durable conversation-scoped memory, approved-
  knowledge chunks, retrieval audit, RLS and pgvector foundation.
- `P5F2` — stateless Gemini structured qualification/reply proposal adapter.
- `P5F3` — deterministic policy-owned autonomous reply intent and worker.

Every P5F implementation slice SHALL remain disabled by default, SHALL carry no
real-provider success claim without sanctioned credentials and runtime proof,
and SHALL fail closed to durable human review whenever any required runtime
input, policy gate or provider response is missing, invalid or ambiguous.

### P5F1 authority and rollback contract

`P5F1` SHALL add only the Platform-owned memory and retrieval foundation.

- Supabase SHALL own durable conversation-scoped memory, explicit facts,
  qualification state, takeover/pause state, approved-knowledge chunk
  references and retrieval audit. Neither per-client filesystem agents nor
  Gemini server-side state/cache may be a source of truth.
- Migration `065` SHALL establish only additive schema for staff-controlled
  memory, approved-knowledge chunks, retrieval audit, RLS and pgvector. It
  SHALL NOT add Gemini execution, WAHA send, amoCRM writes or production
  enablement.
- The embedding target SHALL be `gemini-embedding-2` at a fixed `1536`
  dimensions. Provider-backed ingestion remains disabled by default and real
  provider proof remains blocked until sanctioned credentials and test data
  exist.
- Any lexical-only retrieval preview SHALL be explicit degraded staff preview
  only. It SHALL NOT authorize deterministic autonomous replies, SHALL NOT be
  presented as equivalent to approved retrieval, and SHALL fail closed for
  autonomous policy evaluation.
- No public RPC or UI may expose raw WAHA identifiers, phone-bearing provider
  identifiers, raw amoCRM entity identifiers, private retrieval internals or
  provider secrets.

Validation SHALL require focused schema/RLS/retrieval tests, build/lint/
typecheck, exact-head CI and one fresh independent exact-head read-only review.
Rollback SHALL keep runtime flags off, revert code, and forward-fix additive
schema only.

### P5F2 authority and rollback contract

`P5F2` SHALL add only the Gemini proposal adapter.

- Gemini SHALL be called through stateless Interactions with storage disabled
  (`store=false`). Official provider retention is finite and SHALL NOT replace
  Platform-owned durable memory or audit.
- The model SHALL be runtime-configured through an allowlist. The P5F-specific
  initial sanctioned model is the owner-named `gemini-3.5-flash`. Google's
  current catalog also lists `gemini-3.6-flash` as stable, but the older generic
  target note does not authorize it for P5F without a separate eval and plan
  update. Any later model change requires a decision-log update and fresh
  validation.
- The adapter SHALL use bounded conversation context, bounded retrieval
  evidence, bounded read-only amoCRM context and explicit token budgets. It
  SHALL return JSON-schema-constrained structured RU/EN proposals only.
- Gemini SHALL NOT call WAHA, SHALL NOT own transport retries, SHALL NOT imply
  send success, and SHALL NOT write amoCRM.
- Missing credentials, invalid provider configuration, malformed structured
  output, unsupported language, low confidence, missing evidence or unsafe
  semantics SHALL fail closed to durable human review.

Validation SHALL require focused adapter/contract tests, structured-output
validation, build/lint/typecheck, exact-head CI and one fresh independent
exact-head read-only review. Real provider execution remains honestly blocked
until sanctioned credentials exist. Rollback SHALL keep the adapter disabled
and forward-fix additive audit schema only.

### P5F3 authority and rollback contract

`P5F3` SHALL add only deterministic autonomous reply gating and durable send
intents.

- Deterministic Platform policy SHALL be the only authority that can create a
  WAHA `reply_to` send intent. Gemini SHALL remain proposal-only.
- An autonomous reply SHALL be permitted only for the same conversation and the
  exact inbound trigger, inside the rolling WhatsApp `<=24h` service window,
  with fresh consent/opt-out, approved citations/evidence, known language,
  confidence/risk pass, business-hours pass, cooldown/rate pass, staff
  takeover/pause clear, session-health pass, unused idempotency key, matching
  policy version, explicit autonomous-reply runtime enablement and an emergency
  stop/kill switch that is not engaged.
- The worker SHALL re-check every mutable gate immediately before transport.
  Media-only, unsupported or ambiguous inputs SHALL fail closed to human
  review.
- No cold outbound, campaign/broadcast, autonomous follow-up/re-engagement,
  out-of-window free-form send, direct model send or silent fallback is
  authorized.
- The owner authorized autonomous-reply code only. Production enablement, live
  customer sends, provider credentials and real provider proof remain separate
  blocked events that require explicit later authority.

Validation SHALL require focused policy/queue/worker/idempotency tests,
exact-head CI and one fresh independent exact-head read-only review. Synthetic
local adapter proof does not count as real provider proof. Rollback SHALL keep
autonomous runtime flags off, hold or drain queued intents safely, and
forward-fix additive schema without destructive down migration.

### P6 authority and sequence

Block `EVO-P6-OPERATIONS-PORTAL-PLAN-2026-08-11` decomposes P6 into four
sequential gates. The exact contract is
`docs/platform/p6-operations-portal.md`.

- `P6A` makes existing Platform-owned overdue/attention state explicit in the
  accepted Portal without any notification side effect or read-time write.
- `P6B` wires durable self-only notifications and persisted read state into the
  accepted Student Portal, starts with reviewed negative document outcomes and
  uses private Realtime invalidation rather than polling or public payload.
- `P6C` adds disabled-by-default, idempotent overdue-transition publication
  from explicit Platform task/payment due data. Reading a page never writes a
  notification and no deadline may be inferred from amoCRM.
- `P6D` proves the final two-Student and cross-organization path across
  applications, visa, reasoned close/reopen, private documents, manual finance,
  overdue Portal action and notification/read state.

Migration 043 remains immutable. Its consent-gated individual-WhatsApp intent
is durable state only; P6 does not claim, route or dispatch it. P6 also does not
copy the legacy SQLite staff notification feed or infer sales identity, stage,
responsible Sales, Portal activation or canonical handoff. P6 is complete only
after P6D passes. Individual WhatsApp notification delivery remains a separate
future target; this P6 plan neither cancels nor activates it.

P6A-P6D merged in PRs #148, #149, #152 and #153. Exact-main push run
`31650640795` is green at
`1e53d93d8c70c286e56c5d057928e9f080c58a44`; this completes the repository
and synthetic/local P6 gate without creating managed, provider or production
proof.

### Merged P2R3 acceptance record

- The server verifies the exact access token returned by successful Supabase
  login with `getClaims(accessToken)` before resolving the live database
  authority bundle. Missing/invalid claims, blocked membership or RPC failure
  fail closed and clear the Platform session.
- Protected connected routes hand invalid authority to the exact same-origin
  `src/app/auth/platform-session/route.ts`. That response-writable handler
  independently rechecks claims plus live authority, preserves a recovered
  valid actor, and otherwise expires only the Platform Supabase auth-token
  cookie/chunks before redirecting to a bounded login error. Query parameters
  are not authorization proof; legacy root-auth cookies remain untouched.
- Real local Playwright starts with an authenticated Platform session, makes
  the live authority revoked or version-stale, exercises the connected route,
  and proves the browser no longer holds the Platform auth cookie. A direct
  handler request with valid authority must preserve the session.
- `getSession()` is never a server authorization source; self-registration,
  legacy-account import and root-auth fallback stay disabled.
- The deadline runner executes its child and propagates the true exit code from
  both logical symlink and physical worktree paths.
- The normal real `npm run test:supabase:local` path exits zero after migrations
  001-055 and proves Auth/PostgREST/RLS/browser/Storage/PGMQ behavior. Retries
  remain bounded and transient-only; diagnostic output is redacted.
- Cleanup proves no exact-project lock, container, volume or network remains and
  preserves unrelated Inbox resources. Broad prune and daemon restart are
  forbidden.
- P2R3 owns only the original P2R2 auth/reset files plus
  `src/lib/platform-guards.ts`, `src/proxy.ts`,
  `src/lib/supabase/auth-cookies.ts`,
  `src/app/auth/platform-session/route.ts` and
  `tests/platform-auth/platform-auth.spec.ts`. It owns no migration, provider,
  production, restore or cutover behavior.
  Executor and independent physical-worktree evidence, exact-head CI and a new
  SHA-bound review are all required before controller merge.

### Business-workflow scope

- OP active stages: new, contacting, qualified, meeting scheduled, meeting
  completed, potential and contract signed. No-answer/no-show are follow-up
  outcomes; event/collaboration values are source/deal metadata; closure
  requires an explicit result and reason. amoCRM mappings remain
  account-specific and canonical.
- OZO uses one common admissions lifecycle with independent application,
  document, visa, finance, housing, insurance and travel statuses. China,
  Italy, Czech/Poland, UAE/Turkey and Malaysia are versioned overlays, not
  separate applications.
- Student Profile uses a minimized country-neutral core plus versioned
  country-specific requirements. Sensitive documents use the private document
  path only.
- Requirements/checklists, prompt/knowledge, Q&A decisions, catalogs/imports,
  document templates and generated contracts are versioned, source-aware and
  approval-gated. Generated contracts remain drafts until authorized staff
  approval.
- University import is blocked while the linked Notion workspace is
  inaccessible. Colleges and Accounting/Bema remain discovery gaps rather than
  invented modules.
- AI produces RU/EN structured proposals from approved knowledge and Platform
  memory. Deterministic server policy may auto-send only a qualified inbound
  reply inside the 24-hour window; Kyrgyz, uncertain language, sensitive/media
  input or any failed guardrail requires durable human review.
- Linked Google Docs/Sheets/Drive/PDF/Notion inputs are discovery/import
  sources, never the runtime database or a public dependency. No customer PII,
  folder names or documents may enter Git, fixtures or logs.

### Business-workflow acceptance

- BW1 proves versioned source/provenance and normalized domain contracts
  without PII.
- BW2 proves OP/OZO actions through real repositories, RLS, permissions and
  audit behind the existing frontend, with no localStorage or demo fallback.
- BW3 proves Student Profile and country checklists across staff and portal,
  including cross-student denial and historical overlay-version retention.
- BW4 proves approved prompt/knowledge, Platform memory, structured proposal,
  deterministic send/handoff lifecycle, RU/EN and the manual-language failure
  path.
- BW5 performs no real catalog import until authorized source access exists;
  staging/validation/rejection must not auto-publish.
- BW6 proves typed approved-field contract generation, draft/approval
  separation, immutable versions and audit.
- BW7 proves the complete local/staging Supabase workflow through the accepted
  frontend. It does not imply production/provider readiness without real
  authorized service exercise.

### Merge-order boundary

BW0, P3A-P3C, BW1-BW7, P2R0-P2R4, P4A, PR #128 and P5A are merged history.
This amendment is the only active docs-only block. P4B activation/writes are
preserved/deferred; P4R owns bounded canonical reads, P5 owns real WAHA/
history/media/realtime/AI/ACK proof, and P6-P7 own independent operational/
security scope. No lane may replace amoCRM with a mock, SQLite shim, hardcoded
mapping, fake provider or silent fallback. P10 follows P8; P9 is removed from
the authorized scope and Lead Agent remains deployed/frozen.
Shared migrations are selected only after fetching current main and checking
open ownership; merged migrations are immutable.
- `crm.evoadmissions.com` and `inbox.evoadmissions.com` have no DNS answer.
  The fallback CRM URL responds.
- The original checkout's modified Malaysia knowledge-base document and
  untracked presentation archive are owner work outside this goal.

### Ordered platform blocks

P0–P10, their exact exit evidence, validation commands, protected operations,
remaining owner decisions and the independent-review/merge-controller protocol
are defined in `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`.

- P0: plan/TZ/DOCX/ADR and target architecture, docs-only.
- P1: current-app role/RBAC/handoff correction. P1A-P1D are merged.
- P2: unified Supabase foundation. P2A is merged; P2B–P2H are reusable
  foundation and former P2I restore duties move to a later reliability lane.
- P2R0/P2R1: merged docs-only reliability gate and bounded local Supabase
  proof-path/document lock-order repair in PRs #104/#105.
- P3: thin messaging slice behind the existing unified frontend; P3A-P3C are
  merged with local-only, no-provider evidence.
- P4/P4R: preserve P4B activation/write checkpoint; resume bounded canonical
  reads after the messaging foundation.
- P5: unified Inbox/WAHA/Lead Agent messaging capability with history/media,
  ACK, true realtime, Platform memory and gated inbound-reply autonomy.
- P6: amoCRM-independent Admissions/Portal/Documents/Finance/Notifications.
- P7: security, reliability and operations.
- P8: narrowed real executable P5-P7 plus proved P4R read evidence; P4B
  activation/writes and unavailable provider segments remain deferred, and no
  production action is authorized.
- P9: removed from current execution scope; no soak or Lead Agent retirement.
- P10: authorized-scope evidence audit, with P4R read evidence, P4B activation/
  writes deferred and Lead Agent retained; not a full-Platform completion claim.

Only one implementation PR may be open. The owner removed the scheduled Launch
Auditor and separate merge-controller. After a separate independent read-only
reviewer approves the exact head and every required exact-head CI job passes,
the executor may directly merge that same SHA with a head-matching merge
command. Green exact-main push CI is required before the next implementation
PR. No production deployment, migration, DNS, WAHA session mutation, live
customer send, real amoCRM mutation or service deletion is authorized by this
plan.

### Completed P1D contract: current-root WhatsApp object scope

P1D applies only to the root CRM's current SQLite/custom-auth `/whatsapp`
surface. It is authorization containment before P2-P5, not a substitute for the
unified Supabase/Inbox/WAHA target.

The merged implementation:

- scope list/detail/message reads in SQL to Admin, responsible Sales before
  handoff, assigned Curator after handoff, and a safe summary-only projection
  for the former responsible Sales user;
- deny Finance, Student, unrelated staff, broken links and unlinked rows for
  every non-Admin actor;
- grant lead-only Sales access only when both the conversation and the resolved
  lead have no case link; indirect lead-to-case and conflicting case links are
  Admin-only until reconciliation;
- keep post-handoff Sales away from transcript, phone/message previews,
  provider/amoCRM/WAHA identifiers, draft/reason metadata and send/read/draft
  actions;
- enforce the same object policy in direct routes, lead-page lookups, replayed
  Server Actions and `/api/ai/draft` before protected reads, mutation, AI or
  WhatsApp provider access;
- suppress WhatsApp-derived unread/count/recency/response aggregates at the
  shared query boundary for Sales, dashboard, calls and tasks whenever the
  actor lacks full conversation access;
- make manual conversation creation Admin-only until P4/P5 can prove canonical
  ownership during resolution/linking;
- preserve the accepted frontend structure while hiding inbox and shared
  TopBar controls that cannot succeed for the current actor.

P1D has no database migration and no real-provider proof requirement. It must
not change the WAHA session/webhook, Lead Agent, EVO Inbox Supabase model,
message transport, ACK/outbox/retry/reconciliation behavior, provider
configuration or production state. Full details and the actor matrix are in
`docs/platform/p1d-root-whatsapp-scope.md`.

### P2 plan amendment: canonical Supabase foundation

ADR 0014 remains the unified target decision. ADR 0015 refines its Supabase
implementation boundary:

- root `supabase/` becomes the sole migration authority in P2A;
- legacy migrations 001–039 move byte-for-byte with a checksum manifest and no
  migration 040 in P2A;
- `public` remains the legacy Inbox compatibility schema;
- `platform` is the new exposed schema with explicit grants and RLS on every
  table;
- `platform_private` is backend-only and absent from the Data API;
- browser roles have no `platform_private` or `pgmq_public` access;
- legacy Inbox `owner/admin/agent/viewer` roles never map implicitly to
  Platform `admin/sales/curator/finance/student`;
- target machine role `student` is displayed as Client/Student; the current
  root `client` identifier is not imported or mapped into Platform without a
  later explicit scoped decision;
- the legacy signup trigger may keep legacy Inbox behavior but grants no
  Platform membership.

P2 has the following strict dependency order:

1. P2A establishes the canonical root config/history/test harness without a
   new migration.
2. P2B begins at the next free migration number, expected 040, and establishes
   schemas/grants plus verified legacy secret-bearing-column containment while
   preserving current Inbox compatibility.
3. P2C adds Platform identity, RBAC and base audit.
4. P2D adds cases, assignments/handoff, applications, visa and tasks.
5. P2E adds document metadata, finance and durable notification state.
6. P2F adds communications/provider mappings, raw events, approved knowledge
   and draft-only AI records without a live-provider claim.
7. P2G proves retryable work through real local Supabase Queues/PGMQ, including
   idempotency, dead-letter and reconciliation.
8. P2H proves new private Platform buckets/policies through the real local
   Supabase Storage API.
9. P2R1 repaired only the already-merged local proof path and merged immutable
   migration `055_platform_document_finalization_lock_order.sql` in PR #105. It
   added no production apply, provider call, restore claim or product feature.
10. Former P2I whole-foundation reset/RLS/grant/secret and separate database/
    Storage restore duties are transferred to P7.

Merged migrations are immutable; defects use the next free forward migration.
P2 is additive and does not rename/drop legacy tables, cut root auth over,
copy real secrets, silently privatize legacy `avatars`/`flow-media`, or apply a
production migration. A handcrafted queue or Storage mock is not service
proof. Local service evidence does not prove remote migration-ledger parity,
managed branching, production configuration, paid-plan PITR or managed
restore; those remain blocked by region/plan, credentials and production
authority.

Detailed ownership, negative matrices, rollback and provider boundaries are in
`docs/platform/p2-supabase-foundation.md`.

P2R1 exits only when the real local `npm run test:supabase:local` path proves
admin-provisioned Auth/RLS, private Storage, PGMQ terminal semantics and exact
disposable-resource cleanup under Node 22.23.1. The document finalization lock
repair must be a next-free forward migration with concurrent finalization and
review regression evidence. Local proof is not managed Supabase, provider,
backup/restore or production proof.

### Historical pre-platform blocks

The following A–G record is retained as prior hardening history. It is not the
active merge order; P0–P10 above and the long-run plan now control new work.
Any retirement or full-target completion language below is historical and is
superseded for current execution by ADR 0018.

Every block starts from refreshed GitHub `main`, has one coherent PR, real
validation, and a separate launch-control reviewer verdict of `approved`.
Shared migrations, deployment files, and plan files merge sequentially.

1. **A — critical authorization containment**
   - Prevent profile, account, membership, ownership, or role self-promotion.
     System-owned identity, membership, role, account, and provider/audit fields
     may change only through authorized server paths.
   - Inventory exposed Supabase tables, views, RPCs, grants, RLS/storage
     policies, and `SECURITY DEFINER` functions. Deny cross-account writes and
     remove unnecessary authenticated/anonymous grants.
   - Add disposable PostgreSQL role-policy tests using JWT claims for ordinary
     staff, privileged staff, and `service_role`, including negative
     insert/update/delete/RPC and cross-account cases. Table-owner execution
     does not prove RLS because owners normally bypass it.

2. **B — main CRM sensitive surfaces**
   - Authenticate and admin-gate Transcription Lab plus upload, job, SSE,
     detail, and improvement endpoints, or disable the complete production
     surface when no approved operator role can be proven.
   - Enforce server-side upload type/size/count limits, bounded processing, safe
     names, failure cleanup, retention/deletion, and non-sensitive audit output.
     Edge limits supplement but do not replace application validation.
   - Require production-safe secret encryption and fail closed when secure
     encryption configuration is unavailable.
   - Add negative permission tests for finance, documents, client/portal data,
     AI routes, and transcription routes.
   - Public registration versus invite-only access is an owner decision. Stop
     before changing `/register`, account creation, or invite policy without it.

3. **C — privacy and media truthfulness**
   - Keep customer documents/media in private storage with account-scoped RLS
     and short-lived authorized access. Never expose public bucket URLs or
     service-role keys. Audit upload, access grant, deletion, and retention
     without customer content.
   - Verify real WAHA media receive/send support. Disable unsupported media UI
     instead of storing or displaying simulated capability.
   - Define retention/deletion for CRM files, Inbox media, transcripts, AI
     drafts, outbound attempts/messages, ACK evidence, and logs. Preserve
     #47/#48's append-only delivery evidence; do not recreate or weaken it.

4. **D — Lead Agent minimal containment**
   - Prove whether the production Lead Agent is still an active inbound webhook
     owner. Keep outbound and automatic replies disabled.
   - If active, add bounded replay rejection, atomic crash-claim
     lease/recovery, idempotent amoCRM side effects, deterministic
     phone/contact/lead selection, and non-sensitive liveness/readiness output.
   - If unused or blocked by credentials, freeze it disabled and document the
     exact blocker. Retirement requires a separate future owner decision.

5. **E — runtime and deployment hardening**
   - Build on PR #46 rather than repeating it. Verify third-party images by
     immutable digest and first-party images by Git revision/version labels.
   - Separate liveness from dependency/provider readiness. Validate private
     endpoints, Caddy routing, CSP/cache/security headers, application/edge
     request limits, resource limits, correlation IDs, actionable logs/alerts,
     and rollback evidence.
   - Use current official Docker, Caddy, Next.js, Supabase, WAHA, and amoCRM
     documentation. Validate real Compose/Caddy/runtime state without secrets or
     customer data. Canonical DNS remains an owner-controlled external action.

6. **F — backup and disaster recovery**
   - Inventory main CRM SQLite/files, managed Supabase database and Storage
     objects, retained Lead Agent SQLite/token state, encrypted settings, WAHA
     session/relink material, and release configuration.
   - Define owner-approved RPO/RTO per store. Supabase database backups do not
     include Storage objects, so their recovery procedures are separate.
   - Restore only into isolated disposable destinations, never production.
     Verify integrity, schema/version, application reads, protected-key
     decryption, and the documented WAHA relink procedure.

7. **G — final acceptance and completion audit**
   - Map every requirement to merged PRs, clean Git state, real test/runtime
     evidence, or an exact external blocker.
   - Prove role denials, restart persistence, duplicate/replay behavior,
     provider-outage handling, zero automatic customer reply, isolated restore,
     production image-to-Git mapping, and no open hardening PR.
   - Run a real WhatsApp/amoCRM path only with real credentials, an
     EVO-controlled sender/recipient, and explicit approval for the visible
     manual reply. Missing inputs are blockers; mocks do not satisfy this plan.

### Remaining internal closure lanes

These lanes close newly confirmed internal gaps before Block G can be
re-audited. Each lane starts from refreshed `main`, uses a coherent PR, passes
real validation, and receives a separate launch-control reviewer verdict.

1. **CI enforcement for PostgreSQL authorization**
   - Require the existing real-role harness
     `scripts/test-postgres-authorization.sh` through the
     repository-root `npm run test:security` gate in GitHub Actions.
   - Provision only safe ephemeral/disposable PostgreSQL for CI. Do not connect
     the harness to production or require committed/runtime secrets.
   - Prove the workflow actually executes ordinary-staff, privileged-staff, and
     `service_role` allow/deny cases, including forbidden writes, rather than
     accepting SQL text inspection as equivalent evidence.

2. **Non-disruptive CRM checkout and permission reconciliation**
   - Inventory `/opt/evo-crm` and preserve every dirty or untracked item in a
     recoverable, access-restricted archive before changing the operational
     checkout.
   - Reconcile `/opt/evo-crm` to the exact reviewed source corresponding to the
     currently deployed CRM/Lead Agent revision. Prove the resulting Git state
     and image-to-Git mapping without building, recreating, restarting, or
     otherwise changing running services.
   - Audit legacy environment/configuration file ownership and modes without
     printing values. Tighten permissions only when the target and runtime
     access requirements are proven and the change is non-disruptive; otherwise
     record the exact blocker.

3. **WAHA runtime-limit drift containment**
   - Record the live finding that WAHA has unset `Memory`, `NanoCpus`, and
     `PidsLimit` despite reviewed Compose limits.
   - Do not recreate, restart, relink, or mutate WAHA to apply those limits
     until a QR/relink and session-continuity procedure is ready and the owner
     explicitly approves the user-visible provider risk.
   - Until approval, treat the runtime drift as an explicit Block E/G blocker,
     preserve WAHA privacy, and make no claim that its Compose limits are active
     in the running container.

Owner/external gates remain unchanged: canonical DNS, public registration
policy, monitoring destination and responsible owner, retention schedule and
owner, CSP enforcement, RPO/RTO, provider acceptance inputs/approval, and the
deferred real Supabase database-plus-Storage backup and isolated restore
rehearsal. None may be inferred or marked complete from automated tests.

### Historical write boundaries and merge order

The ownership list below applied to the pre-platform A–G hardening program. It
does not authorize current P2 work; P2A–P2H, later reliability work and the
long-run contract control.

- Plan-only PR: `docs/EVO_LAUNCH_PLAN.md` and append-only
  `docs/PLAN_CHANGES.md`.
- A owns Inbox authorization migrations/helpers/policy tests and merges before
  any later Inbox schema work.
- B owns main CRM guards, transcription, secret handling, and sensitive-surface
  tests.
- C owns private media/storage policy, signed access, truthful media UI,
  retention/deletion, and audit events; it starts after A and B.
- D owns only `evo-lead-agent/**` plus directly required deployment/docs.
- E owns shared Dockerfiles, Compose, Caddy, observability, deployment
  scripts/runbooks, and release metadata.
- F owns backup/restore scripts and runbooks and follows E for shared files.
- G owns audit evidence and plan status. DNS/provider mutation is excluded
  unless separately authorized with required inputs.

### Required evidence

- Real disposable PostgreSQL role-policy execution, not SQL text matching.
- Focused negative tests plus full affected lint/type/test/build/audit gates.
- Real browser allow/deny checks for affected roles and surfaces.
- `git diff --check origin/main..BLOCK_SHA` and redacted secret scanning.
- Real production Compose/Caddy rendering without printing secret values.
- Restart/persistence and isolated restore evidence where applicable.
- Separate independent reviewer approval before each merge.
- No scheduled Launch Auditor or separate merge-controller wait. Direct merge
  is allowed only for the independently approved SHA after exact-head CI, and
  exact-main push CI must pass before continuing.
- The full Codex Security workflow is not required for this run; focused
  authorization/RLS/security tests and scoped secret/PII checks remain gates.

### Stop conditions

- Stop before changing registration/invite behavior without the owner's policy.
- Stop before DNS mutation without authoritative access and owner approval.
- Stop before real outbound WhatsApp without real credentials, a dedicated test
  sender/recipient, and explicit approval for that reply.
- Stop before destructive or production restore actions; rehearsals must be
  isolated.
- Stop Lead Agent expansion if active ownership cannot be proven.
- Stop if architecture, schema, acceptance, or merge-order changes lack an
  append-only `PLAN_CHANGES.md` entry.
- Never print, commit, or copy secrets or customer data into evidence.

## Historical Completed EVO Platform Frontend Slice

Historical slice: `/goal-evo-platform-frontend`.

This section records the then-current runtime and acceptance contract for the
completed frontend work. Its legacy `visa` role matrix is historical evidence
only and is superseded for all P1+ implementation by
`docs/EVO_PLATFORM_LONG_RUN_PLAN.md` and `docs/specs/EVO_PLATFORM_TZ.md`.

This slice ran after its planning-only PR was independently reviewed and
merged. It did not close or weaken `/goal-evo-preplatform-hardening`; the
remaining owner/external gates in that goal stayed open.

### Goal

Turn the reviewed Claude Design handoff into the real, responsive and
accessible EVO Platform frontend inside the root Next.js CRM application.
The result should present one coherent staff workspace and student portal while
preserving the current system ownership boundaries:

- amoCRM remains authoritative for contact/lead identity, responsible manager
  and sales-pipeline stage;
- the root CRM remains the canonical host for staff operations and the student
  portal;
- EVO Inbox remains the current WhatsApp conversation runtime and Supabase
  owner until a later backend/data migration decision;
- AI customer replies remain draft-only and require a human to send;
- the retained Lead Agent remains frozen and backend-only.

One frontend does not imply one physical database or one runtime in this slice.
No schema merge, Supabase consolidation, Lead Agent deletion, live provider
mutation, production deployment or outbound WhatsApp test is authorized here.

### Reviewed design baseline

- Source bundle:
  `docs/design/evo-platform/prototype/`.
- Completion contract:
  `docs/design/evo-platform/COMPLETION_CHECKLIST.md`.
- Browser and static audit:
  `docs/design/evo-platform/AUDIT_2026-07-24.md`.
- The handoff covers the main information architecture, seven staff roles,
  Student Portal, design tokens and eight core flows.
- The handoff is not production code. Its known gaps include broken staff
  tablet/mobile layouts, a phone-shaped rather than native desktop Student
  Portal, incomplete navigable system states, CDN runtime dependencies,
  inaccessible clickable `div` controls and unlabelled/unmanaged overlays.

### Role mapping for this frontend slice

The prototype's seven staff personas are design viewpoints, not permission
records to add to production. This slice preserves the five existing staff
roles in `src/lib/domain.ts`:

| Prototype viewpoint | Existing application role in this slice |
|---|---|
| Руководство | `admin` dashboard/report viewpoint; no new role |
| Администратор | `admin` |
| Продажи | `sales` |
| Куратор | `curator` |
| Визовый специалист | `visa` |
| Финансы | `finance` |
| Оператор Inbox | existing `admin`/`sales`/`curator` WhatsApp access; no new role |

The student remains the existing `client` role. Role switching in the design
bundle is demonstration-only and must not be copied into the real application
as an authorization mechanism. Adding a distinct leadership or Inbox-operator
role requires a later role-policy amendment and server-side authorization
work. The completion checklist's permissions-matrix item means documenting and
testing the current five staff roles plus `client`, not silently expanding
them.

### Inbox data boundary for this frontend slice

The root `/whatsapp` route currently reads and writes the main CRM's local
`wa_*` shadow tables through existing CRM queries/actions. It does not read the
separate EVO Inbox Supabase project. Therefore:

- this slice may redesign `/whatsapp` over the existing root CRM read/action
  path and must label its source truthfully;
- it must preserve all current send/configuration guards and draft-only AI;
- it must not claim that the root view is connected to EVO Inbox Supabase;
- the shell may link to or report the separate EVO Inbox runtime status only
  when that status is available through an already-authorized read path;
- a real Supabase-to-root read bridge, shared Inbox API or data migration is a
  later backend/integration slice with its own authentication, ownership,
  privacy and failure-mode design.

“Unified Inbox” in this frontend slice means one consistent interaction design,
not a hidden cross-database integration.

### Architecture and implementation order

1. **Planning and evidence**
   - Commit the unmodified Claude Design source, completion checklist, browser
     evidence and gap audit.
   - Keep the prototype clearly labelled as reference-only.
2. **Frontend foundation**
   - Implement EVO brand tokens, real logo treatment, typography, primitives,
     semantic tables, tabs, dialogs, drawers, feedback and state components.
   - Keep data-reading pages as Server Components and isolate only interactive
     controls in focused Client Components.
   - Implement keyboard focus, reduced-motion handling and native semantic
     controls.
3. **Unified responsive shell**
   - Rebuild the root staff shell and topbar for desktop, tablet and urgent
     mobile work without replacing existing authentication or role checks.
   - Expose truthful amoCRM, WAHA and AI status labels without implying that a
     provider was exercised.
4. **Staff workspaces**
   - Recreate the reviewed dashboard, sales funnel/list, Lead 360, Student 360,
     applications, documents, visa, finance, tasks/calendar, calls/meetings,
     Inbox, notifications, reports and administration surfaces on existing
     root routes where possible.
   - Add only read-model/UI routes required for missing surfaces; do not change
     provider ownership or create a second source of truth.
   - Keep `/whatsapp` on the existing CRM `wa_*` read/action path and label the
     separate EVO Inbox bridge as deferred.
5. **Student Portal**
   - Rebuild `/portal` as a true mobile-first surface with an actual desktop
     layout, accessible document resubmission and the reviewed progress,
     applications, visa, payments, messages, team and security views.
6. **Validation and handoff**
   - Run lint, type/build, relevant unit/e2e suites and secret scanning.
   - Exercise the critical flows in a real browser at 1440x1024, 834x1194 and
     390x844, save screenshots and audit keyboard/focus behavior.
   - Keep provider-dependent flows labelled blocked or simulated unless real
     credentials and explicit mutation/send approval are separately supplied.

### Named write set

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`,
  `docs/design/evo-platform/**`: contract, source handoff and audit evidence.
- `eslint.config.mjs`: ignore only the immutable, reference-only Claude Design
  export under `docs/design/evo-platform/prototype/**`; application source
  remains linted.
- `src/app/globals.css`, `src/app/layout.tsx`,
  `src/app/(staff)/**`, `src/app/login/**`, `src/app/portal/**`:
  responsive application surfaces.
- `src/components/**`, `src/lib/domain.ts`, `src/lib/i18n*.ts`:
  shared design system, navigation, truthful presentation models and copy.
- `src/lib/queries.ts`, `src/lib/actions.ts` only for presentation/read-model
  adaptation of existing root CRM data and existing guarded actions. No new
  cross-runtime provider write path is included.
- `tests/**`, `playwright.config.ts` only where required for frontend
  acceptance and regression coverage.

Database migrations, provider clients, webhook handlers, Compose/Caddy,
production secrets and deployments are outside this slice unless a later
append-only plan amendment explicitly adds them.

### Acceptance criteria

- Every applicable item in the completion checklist maps to a real application
  route, component state or explicitly recorded provider blocker.
- The permissions matrix covers the current `admin`, `sales`, `curator`,
  `visa`, `finance` and `client` roles; prototype-only leadership/Inbox
  personas do not become production roles in this slice.
- Staff views are usable without horizontal page overflow at 1440x1024 and
  834x1194; Inbox, tasks and notifications have an intentional 390x844 urgent
  mobile experience.
- Student Portal uses native mobile and desktop layouts rather than a device
  frame embedded in a marketing page.
- Navigation, cards, forms, tabs, tables, kanban, drawers and dialogs are
  keyboard-operable with visible focus and appropriate semantics.
- No frontend success state claims a real amoCRM, WAHA, Supabase, AI or
  telephony result unless that real service was exercised.
- Sales stages and operational student stages remain visibly distinct.
- AI auto-send remains blocked unless the currently active owner-authorized MVP
  autonomous-reply slice explicitly permits it under its reply-only,
  policy-gated boundary; outside that slice, the manual-send boundary is
  explicit.
- The root application lint, build and affected automated/browser tests pass.

### Merge order and stop conditions

1. Planning/design-evidence PR, including the narrow lint ignore required to
   store the immutable design exporter source outside the runtime.
2. Design-system and responsive-shell PR.
3. Staff workspace PRs split by non-overlapping route ownership.
4. Student Portal PR.
5. Cross-flow browser acceptance and final integration PR.

Stop before changing backend ownership, merging databases, deleting a runtime,
changing role policy, deploying to production or sending a real message. Those
actions require a separate architecture amendment and, where applicable,
explicit owner approval and real provider inputs.

## Completed Main Production Consolidation Slice

Completed slice: `/goal-evo-main-production-consolidation`.

### Goal

Make GitHub `main` the reviewed source of truth for the complete EVO platform,
then deploy that exact release to `hermes-vps` and prove the real EVO Inbox
WhatsApp path without losing active server configuration or claiming provider
success that was not exercised.

Candidate ancestry at planning time is linear:

- `origin/main`: `c1a00b0a3013946a94677fc0f01838740217b622`
- integration candidate after PR #40:
  `8116aad7c6cc97c3de198e3de1c7cad020105416`
- distance: zero commits behind and 41 commits ahead of `main`

The candidate is not releasable as-is. Current audits find vulnerable runtime
dependencies, no effective repository-root GitHub Actions workflow, three
full-range whitespace failures, dirty production checkouts, missing canonical
DNS, and incomplete real-provider readiness.

### Ordered blocks

Each block requires its own branch, PR, real validation evidence, and
independent launch-control approval. Do not begin a later block before the prior
block is merged or explicitly abandoned.

1. **Security and repository gates**
   - Upgrade both Next.js applications to the current secure stable patch.
   - Remove the shadcn code-generation CLI from production dependencies; invoke
     it through the documented ephemeral package runner when future component
     generation is needed. Preserve the small runtime Tailwind extension
     currently imported from that package as a reviewed, tracked local
     stylesheet so removing the CLI does not alter the rendered UI.
   - Apply safe transitive dependency updates until
     `npm audit --audit-level=moderate` passes for both applications.
   - Fix the three existing `git diff --check` findings without unrelated
     formatting churn.
   - Add repository-root GitHub Actions coverage for the main CRM, EVO Inbox,
     and EVO Lead Agent. A workflow nested under an application directory is
     documentation only because GitHub discovers workflows from root
     `.github/workflows/`.
   - Open a dedicated issue for normalizing the pre-existing EVO Inbox formatter
     baseline without mixing hundreds of unrelated rewrites into this release.

2. **Frozen integration promotion**
   - Open an integration-to-`main` PR from one frozen, fully validated candidate
     SHA.
   - Preserve the 41-commit implementation history with a merge commit; do not
     squash the umbrella promotion.
   - Reconfirm `main` and the candidate SHA immediately before merge. Merge only
     the independently approved unchanged candidate.

3. **Production release reconciliation**
   - Do not deploy from either dirty production checkout.
   - Preserve the active Caddy additions currently routing
     `invite-bishkek.72.62.119.112.sslip.io` and
     `inbox.72.62.119.112.sslip.io` as a separately reviewed infrastructure
     change before replacing the server checkout.
   - Preserve the `/opt/evo-crm/evo-lead-agent.git-backup-*` material until the
     owner explicitly approves archival or removal.
   - Build release images from the merged `main` SHA and add OCI source,
     revision, and version labels so a running image can be mapped back to Git.
   - Back up persistent data and record current image digests before deployment.
   - Move EVO CRM services off `acadis_*` networks onto EVO-owned networks while
     preserving private WAHA access and existing volumes.
   - Validate Compose and Caddy before restart, deploy one service boundary at a
     time, and retain the previous image digests for rollback.

4. **Canonical domains**
   - Create `A` records for `crm.evoadmissions.com` and
     `inbox.evoadmissions.com` pointing to `72.62.119.112` only through the
     authoritative DNS provider.
   - Verify public resolution, valid TLS, the expected login redirect, and Caddy
     routing. If authoritative DNS access is unavailable, record that exact
     external blocker and keep the working sslip.io routes.

5. **Real production proof**
   - Use a dedicated EVO-controlled test WhatsApp sender and the connected
     `evo-inbox` WAHA session.
   - Confirm real Supabase, encrypted WAHA, amoCRM, Gemini, and knowledge-base
     configuration through authenticated production readiness checks.
   - Keep unattended auto-reply disabled.
   - Send one controlled inbound message, verify the persisted message and
     amoCRM contact/lead identity, generate one knowledge-grounded Gemini draft,
     have the operator inspect/edit it, and send one manual WAHA reply.
   - Verify delivery and confirm no additional automatic outbound message
     exists in WAHA, Supabase, or amoCRM.
   - Run the legacy receive-only Lead Agent proof separately only after
     `crm_primary` is relinked and its missing amoCRM OAuth configuration is
      supplied. Do not reuse EVO Inbox credentials or its WAHA session.

6. **Provider-proof audit hardening**
   - Before any real outbound proof, persist every generated AI draft with its
     account, conversation, requesting operator, provider, model, knowledge
     evidence, generated text, and timestamp. Return the draft to the composer
     only after that audit record exists.
   - Carry the generated draft identifier through the editable composer to the
     manual-send request. A manual message may omit that identifier when the
     operator wrote the reply without AI.
   - Require a client-generated UUID for every manual send. Persist the complete
     send intent, operator (`messages.sender_id`), optional AI draft reference,
     and a `sending` provider state before calling WAHA. Enforce a unique
     request identifier so concurrent or repeated requests cannot call WAHA
     twice.
   - Treat a lost/ambiguous WAHA response as an uncertain operation and never
     retry it automatically. WAHA documents `POST /api/sendText`, returned
     message identifiers, `message.ack` events, and message lookup by provider
     identifier, but it does not document a caller-supplied idempotency key:
     https://waha.devlike.pro/docs/how-to/send-messages/
     https://waha.devlike.pro/docs/how-to/events/
     https://waha.devlike.pro/docs/how-to/chats/
   - Subscribe the signed EVO Inbox webhook to `message.ack`, persist
     acknowledgement history idempotently, and advance message state
     monotonically. Add a secret-protected reconciliation path only for rows
     that have a stable WAHA message identifier; do not infer provider success
     by matching message text or timestamps.
   - Keep first-launch automatic reply disabled. This block may create local
     migrations, tests, and reviewed code, but it must not send a real WhatsApp
     message. Apply the migration to the intended Supabase project before
     deploying the corresponding application image.

### Named write boundaries

- Security/gates block: root and EVO Inbox package manifests/lockfiles, the
  EVO Inbox global-style import plus its local shadcn Tailwind extension, the
  three whitespace-only files, root `.github/workflows/`, and plan evidence.
- Promotion block: plan evidence and GitHub PR state only; no runtime feature
  changes.
- Production block: EVO-owned Dockerfiles, Compose/Caddy configuration,
  deployment scripts/runbooks, and release metadata. Provider data may change
  only during the explicitly controlled production proof.
- DNS changes are limited to the two canonical EVO `A` records.
- Provider-proof audit block: EVO Inbox Supabase migrations/schema contract,
  AI draft route/composer state, manual WAHA send service/route, signed WAHA
  acknowledgement handling, bounded reconciliation route, focused tests, and
  implementation/runbook evidence. No provider message or customer record is
  created during implementation validation.

### Required validation

Run under Node `22.23.1`:

```bash
# Main CRM
npm ci
npm run lint
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
npm run build
npm run scenarios
npm audit --audit-level=moderate

# EVO Inbox
cd agent-lead2-inbox
npm ci --include=dev
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=moderate

# EVO Lead Agent
cd evo-lead-agent
uv sync --extra dev
uv run ruff check .
uv run pytest
```

Also require:

- `git diff --check origin/main..CANDIDATE_SHA`
- a redacted Git-history secret scan over the same range
- validated production Compose rendering with real server environment files,
  without printing secret values
- real browser checks of the CRM and Inbox login/operator surfaces
- the authenticated production readiness and provider proof described above

`npm run format:check` currently fails across hundreds of pre-existing EVO
Inbox files. It is not a release gate for this slice because fixing the whole
format baseline would mix unrelated source churn into the security block.
Changed files must still match the repository formatter, and a separate
format-baseline issue must remain visible.

### Rollback and stop conditions

- Stop before DNS mutation if authoritative provider access or the exact zone is
  unavailable.
- Stop before the real message proof if an EVO-controlled test number,
  authenticated Inbox operator, connected WAHA session, or real
  Supabase/amoCRM/Gemini configuration is unavailable.
- Stop deployment if backups, current image digests, Caddy validation, Compose
  validation, or a rollback image is missing.
- Stop if the active dirty Caddy routes cannot be preserved without ownership
  clarification.
- Stop if dependency audit, CI, full-range diff, independent review, or frozen
  candidate checks fail.
- Never print, commit, or copy secret values into logs or repository files.

## Most Recently Completed Goal Slice

Completed slice: `/goal-evo-knowledge-business-context`.

This slice turns the two owner-supplied country drafts into clean text that can
be pasted into EVO Inbox and consolidates the company's business model into one
team-facing context document. The user has explicitly approved the supplied
China and Malaysia content as trusted business input. This slice therefore
cleans and structures that content without external fact-checking or silent
changes to its substantive claims.

Named write set:

- `docs/EVO_LAUNCH_PLAN.md` and `docs/PLAN_CHANGES.md`: execution contract and
  append-only decision record for issue #36.
- `docs/business/knowledge-base/README.md`: upload workflow, document registry,
  ownership, review rules, and current EVO Inbox text-input limitation.
- `docs/business/knowledge-base/ready-to-upload/`: normalized China and Malaysia
  Markdown texts, each intended to be pasted as one separate knowledge document.
- `docs/business/evo-business-context.md`: company, customer, service,
  operating-model, system, data, AI, measurement, governance, and risk context.
- `docs/business/README.md`, `docs/README.md`, and `CONTEXT.md`: discoverability
  and canonical business vocabulary.

Deliverables:

- Preserve the supplied Downloads files byte-for-byte and create reviewed copies
  under stable ASCII filenames in the repository.
- Remove draft labels, warning markers, unresolved transcription notes, open
  questions, broken numbering, and repeated FAQ copies.
- Preserve the owner-approved country claims, prices, routes, service promises,
  office details, and process content while making cost categories and steps
  independently understandable to retrieval.
- Add instructions that keep the assistant inside the approved text, collect a
  minimal admissions profile, avoid requesting sensitive documents in ordinary
  chat, and hand case-specific or uncovered questions to an EVO manager.
- Explain the current upload path accurately: EVO Inbox accepts a title and
  pasted text, then chunks and embeds the saved content; this slice does not add
  binary Markdown-file upload behavior.
- Build the business context from supplied company documents, existing business
  docs, implemented CRM entities, EVO Inbox contracts, Lead Agent contracts,
  and the current data-ownership map. Unknown owners and KPIs remain explicit
  gaps rather than invented facts.
- Do not change runtime code, database schemas, provider settings, deployment,
  DNS, production data, or WhatsApp behavior.

Acceptance evidence:

- SHA-256 checks prove the two supplied source files are unchanged.
- Both upload texts have no `⚠️`, draft/open-question markers, placeholder
  instructions, duplicated FAQ section, secret, or real client personal data.
- A chunk preview using the application's 1,200-character boundary shows both
  documents split into bounded, readable retrieval units.
- Repository links resolve, `git diff --check` passes, and a diff scan finds no
  secrets, bank values, private legal identifiers, or copied customer records.
- Required repository validation passes, or an exact unrelated blocker is
  recorded.
- An independent launch-control reviewer approves the final diff before merge.

Implementation evidence recorded 2026-07-13:

- The supplied China and Malaysia source SHA-256 values still match the values
  recorded in the knowledge registry.
- The real EVO Inbox `chunkText` function produced 14 China chunks with a
  1,197-character maximum and 13 Malaysia chunks with a 1,185-character
  maximum. No chunk exceeded 1,200 characters, ended with an orphan heading, or
  split a handoff lead-in from its trigger list.
- Relative-link, draft-marker, secret/credential, and diff-whitespace checks
  passed with no finding.
- Root lint, Next route generation, TypeScript, production build, all 39
  repository scenarios, and `npm audit --audit-level=moderate` passed under
  Node 22.23.1. The scenario report generated by validation was restored and is
  not part of this slice.
- The two focused EVO Inbox chunk/retrieval test files passed all 16 tests.
- Independent reviewers approved the final China document, Malaysia document,
  business context, data ownership, upload mechanics, privacy controls, and
  named write-set compliance.

## Previous Goal Slice

Completed slice: `/goal-evo-platform-source-of-truth`.

Next major lanes require their own reviewed slice: integration into `main`,
then the real production proofs tracked by GitHub issues #5 and #20.

This slice makes the current repository understandable and usable as the EVO
Admissions Platform source of truth without moving runtime code or changing
production. It is documentation, governance, and controlled source-document
work.

Deliverables:

- Replace the generic root README with a team-facing platform entrypoint.
- Add a complete documentation index, platform/system map, data-ownership
  registry, current-status page, onboarding guide, and business knowledge map.
- Add an EVO company profile based only on supplied real company documents,
  with no bank account values, personal identity numbers, signatures, or home
  addresses copied into tracked Markdown.
- Store the supplied public brand book in a tracked company brand folder.
- Store supplied bank/legal originals in a local Git-ignored private folder
  with restrictive permissions and a tracked safe manifest/checksum registry.
- Add a branded team overview presentation and a concise demo/presenter script.
- Mark historical handoffs and copied issue plans as archived or superseded;
  keep GitHub Issues as the changing work-status authority.
- Correct the active deployment documentation where it still names the Acadis
  proxy instead of the EVO-owned edge boundary.
- Track the safe root `.env.example` while continuing to ignore real `.env*`
  files.
- Do not move `src/`, `agent-lead2-inbox/`, `evo-lead-agent/`, change
  APIs/data models, deploy, alter DNS, or exercise outbound WhatsApp.

Acceptance evidence:

- All four supplied PDFs are identified by page count and SHA-256 checksum;
  the 24-page brand book is tracked and visually reviewed.
- Private source PDFs are present locally, ignored by Git, and not present in
  the staged diff.
- The presentation renders without overflow, overlap, clipping, or unresolved
  placeholders and is visually reviewed slide by slide.
- Repository links and source-of-truth statements are internally consistent.
- `git diff --check`, a staged-diff secret/PII scan, root lint/typecheck/build,
  and an independent launch-control review pass before merge.

Historical implementation material below remains as prior-slice context until
the documentation archive pass is complete.

The EVO Inbox companion lane is specified in
`docs/EVO_INBOX_COMPANION_PRD.md`. It creates a WACRM-derived, fully redesigned
standalone companion app at `agent-lead2-inbox/`, hosted at
`inbox.evoadmissions.com`, using managed Supabase Cloud, WAHA session
`evo-inbox`, WACRM's own draft-only AI assistant, and amoCRM as the identity
source of truth.

Deliverables for the reliable amoCRM sync buffer slice:

- Inbound WAHA `message` webhooks must save the local Supabase contact,
  conversation, and message before attempting amoCRM identity sync.
- Missing amoCRM configuration or temporary amoCRM provider failure must not
  prevent the message from appearing in EVO Inbox.
- Conversations and messages must expose `crm_sync_status` as `pending`,
  `synced`, `not_configured`, or `blocked`, with a safe operator-visible error.
- WAHA must receive HTTP 200 after local save, including the CRM sync state, so
  a saved message is not retried as a failed webhook.
- Add a bounded internal retry endpoint protected by `AUTOMATION_CRON_SECRET`
  to process pending/not configured CRM sync rows and optionally blocked rows
  after operator repair.
- Settings, Inbox UI, public API serializers, readiness, deployment docs, and
  proof checklist must show the new local-save-first behavior truthfully.
- Add migration `036_reliable_amocrm_sync_buffer.sql`.
- Run targeted WAHA/amoCRM/readiness/schema tests plus `npm test`,
  `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`,
  and a PR diff secret scan.
- Commit only this slice with a Conventional Commit.
- Request independent launch-control code-reviewer approval before merge.

Out of scope for this slice:

- Creating the real amoCRM external integration or token in the owner's browser.
- Claiming live WhatsApp, amoCRM, Gemini, Supabase migration, or deployment
  success before the real production services are exercised.
- Auto-reply, broadcast, template, historical import, or `/opt/evo-crm` changes.

Previous Gemini/preflight slice deliverables:

- Update the lead-agent readiness/preflight path so receive-only rollout
  readiness is distinct from outbound WhatsApp readiness.
- Make missing WAHA, amoCRM, CRM sync, Gemini, and admin configuration report
  exact input names.
- Keep local smoke no-outbound and failing when outbound is enabled.
- Update production env examples and deployment docs with Gemini configuration
  and receive-only safety flags.
- For the EVO Inbox companion, add Gemini as an encrypted account-level AI
  provider with a repeatable VPS seed command; keep the assistant draft-only.
- Run lead-agent `uv run pytest` and `uv run ruff check .`.
- Run parent CRM validation because deployment docs and Compose are touched, or
  record the exact blocker.
- Commit only this slice with a Conventional Commit.
- Request independent code-reviewer approval before merge.

Out of scope for this slice:

- Executing the production receive-only proof from issue #5.
- Enabling outbound WhatsApp.
- Claiming live WAHA, amoCRM, Gemini, or CRM sync success without real
  credentials and real provider responses.
- Merging or transplanting the unrelated Kant/Bitrix workspace.
- Rebuilding the CRM UI, role model, student portal, or amoCRM architecture.

The repository snapshot, old write sets, acceptance lists and merge orders below
are retained as historical execution evidence. They do not override the active
goal, immediate execution order or ADR 0019 at the top of this document.

## Execution Rules

- Use the real repo stack and real execution paths.
- Do not claim integration success from mocks, fallback paths, demo modes, sample
  payloads, or synthetic data.
- If a real service or credential is unavailable, the lane must fail clearly and
  name the missing input.
- Prepared AI responses are allowed only for the first presentation because the
  user explicitly requested them. They must not be represented as live Anthropic
  integration success.
- Keep each future lane small enough for review and tied to one mergeable block.
- Every future implementation block needs independent code-reviewer approval
  before merge.

## Repository Snapshot

The current repo is a Next.js App Router application for an education CRM.
Primary stack observed in `package.json`:

- Next.js `16.2.9`
- React `19.2.4`
- TypeScript `^5`
- Tailwind CSS `^4`
- ESLint `^9` with `eslint-config-next`
- SQLite through `better-sqlite3`
- Anthropic TypeScript SDK `@anthropic-ai/sdk`

Important source areas:

- `src/app/`: App Router pages, layouts, and route handlers.
- `src/app/api/ai/*/route.ts`: AI draft and client summary endpoints.
- `src/app/api/webhooks/*/route.ts`: WhatsApp and telephony webhook endpoints.
- `src/lib/db.ts`: SQLite schema bootstrap, seed data, settings, password hash
  helpers, and database access.
- `src/lib/auth.ts`: HTTP-only cookie session handling.
- `src/lib/actions.ts`: Server Actions for auth, CRM operations, WhatsApp send,
  settings, and locale.
- `src/lib/ai.ts`: Anthropic client and prompt execution.
- `src/lib/whatsapp.ts`: WhatsApp Cloud API send/receive integration.
- `src/lib/queries.ts`: read models for dashboard, CRM, WhatsApp, calls, and
  portal views.

## Research Summary

Research was checked on 2026-06-24 against current local and online sources:

- Local Next.js docs in `node_modules/next/dist/docs/` were inspected as required
  by `AGENTS.md`, including App Router route handlers, environment variables, and
  the production checklist.
- Context7 official Next.js docs for `/vercel/next.js/v16.2.9` confirm route
  handlers live under `app/**/route.ts`, supported HTTP methods are exported
  functions, `next build` is the production build gate, and `next typegen && tsc
--noEmit` is the documented route/type validation path.
- Context7 official Anthropic TypeScript SDK docs confirm server-side SDK usage
  through `client.messages.create`, API-key configuration, and message arrays as
  the real request path. Launch validation must use a real configured API key or
  explicitly report `not_configured`.
- Context7 `better-sqlite3` docs confirm direct database opening, prepared
  statements, PRAGMA usage, transactions, and WAL mode as normal production
  patterns for SQLite-backed Node.js apps.
- amoCRM's current developer docs describe `/api/v4/leads` as the deal endpoint
  with pipeline/status IDs, responsible user IDs, custom field values, and
  embedded contacts/companies; `/api/v4/contacts` carries contact custom field
  values; OAuth access and refresh tokens come from `POST /oauth2/access_token`.
- The existing README describes demo accounts, WhatsApp demo mode, IP telephony
  webhooks, client portal, multilingual UI, SQLite backup, and Anthropic-powered
  AI features. Those claims must be verified against the actual app before any
  production or sales-readiness claim.

Current risk surfaced by repo inspection:

- The repo has demo accounts and seeded demo data in `src/lib/db.ts`.
- `src/lib/auth.ts` has a development fallback `AUTH_SECRET`.
- `src/lib/whatsapp.ts` must not return a `demo` send status when WhatsApp
  credentials are missing; missing credentials must produce a visible failed
  send state rather than fake delivery success.
- README must not say missing WhatsApp keys use demo mode. Prepared AI text is
  acceptable only for explicitly labeled presentation behavior, not production
  launch or delivery success.
- AI routes depend on live Anthropic configuration and should fail as
  `not_configured` when no key exists.
- There is currently no explicit `typecheck` script and no test script in
  `package.json`.
- `npm audit --audit-level=moderate` currently fails on an existing PostCSS XSS
  advisory reached through Next.js. The suggested `npm audit fix --force` would
  install an incompatible Next.js downgrade, so this must be handled in a future
  security or dependency lane, not hidden inside this docs-only slice.
- `npm run build` passes after local dependency repair, but Next.js warns that it
  inferred the workspace root from `/Users/iskhak.tazhibaev/package-lock.json`
  because another lockfile exists above the repo. A future config lane should
  either set the documented Turbopack root or remove the stray parent lockfile.

## Acceptance Criteria

### This QA Launch Readiness Slice

- `docs/PLAN_CHANGES.md` has an append-only `/goal-qa-launch` entry before
  runtime or test coding because this lane changes active scope, acceptance
  criteria, file ownership, merge-order status, and validation evidence.
- `docs/QA_LAUNCH_REPORT.md` records the QA method, scored checklist, desktop
  and mobile screenshots paths, pass/fail evidence, changes made, validation
  output, stop reason, and named blockers.
- Browser QA starts from a fresh context with no saved login, cookies, or site
  data, then covers login and critical staff/client flows at 1440x900 and
  390x844 or comparable desktop/mobile sizes.
- The single checklist scores auth/role routing, staff CRM flow, student portal
  flow, integration truthfulness, AI/prepared boundary, i18n/language switching,
  responsive layout, security/secret handling, validation/build readiness, and
  presentation demo clarity.
- Any implementation change is limited to launch-blocking bug fixes, blocker or
  prepared/live copy clarity, validation/scenario coverage, QA report/runbook
  documentation, or small UI polish needed for critical flows.
- Missing WhatsApp, telephony, amoCRM, and Anthropic credentials are reported as
  explicit `not_configured` / `blocked` states or blockers, never as demo or
  hidden mock success.
- Existing staff CRM, student portal, amoCRM settings/status, WhatsApp,
  telephony, and AI boundaries continue to build and smoke successfully after
  the changes.
- Validation is run through the real repo commands for this slice:
  `node node_modules/eslint/bin/eslint.js .`,
  `node node_modules/next/dist/bin/next typegen`,
  `node node_modules/typescript/bin/tsc --noEmit`,
  `node node_modules/next/dist/bin/next build`, `npm run scenarios`, fresh
  browser QA rerun, and `npm audit --audit-level=moderate`.
- Pre-commit security audit is run with `npm audit --audit-level=moderate`; any
  existing advisory is documented rather than bypassed.
- The QA launch commit uses a Conventional Commit message.
- An independent code-reviewer reviews the QA launch diff and evidence against
  this goal before merge and returns `approved` or `changes_requested`.

### Launch Acceptance

The app is launch-ready only when all items below are true and evidenced:

- Auth: no production deployment uses default secrets, demo passwords, or
  unlabeled seeded demo accounts.
- Database: SQLite file path, WAL behavior, schema bootstrap, backup/restore, and
  seed policy are documented and verified on the real runtime target.
- CRM core: staff login, dashboard, sales pipeline, lead-to-client conversion,
  client profile, tasks, finance, reports, and client portal complete real flows
  against the real SQLite database.
- WhatsApp: Cloud API credentials and webhook verification are configured against
  Meta's real service, or the feature is visibly blocked. A `demo` status cannot
  be counted as send success.
- Telephony: webhook authentication and payload handling are validated against a
  real provider configuration or blocked with the missing provider named.
- AI: draft and summary endpoints run through the real Anthropic SDK with a real
  key, or return clear `not_configured`. Prepared responses may be used only in
  the first presentation and must be labeled as prepared content.
- Security: server inputs are schema-validated at API and Server Action
  boundaries, sensitive errors are not leaked, secrets are only environment or
  settings values, and role checks match the feature surface.
- UI: production-critical pages render without broken layout at desktop and
  mobile widths, with Russian/Kyrgyz/English locale switching preserved.
- Validation: lint, typecheck, build, and critical real E2E flows pass. Any
  unavailable credential or external system is a named blocker, not a fake pass.

## File Ownership

Planning and governance:

- `docs/EVO_LAUNCH_PLAN.md`: launch contract owner. Changes require a
  corresponding entry in `docs/PLAN_CHANGES.md` after this slice lands.
- `docs/PLAN_CHANGES.md`: append-only change log. Never rewrite prior entries.

Application architecture:

- `src/app/(staff)/**`: staff-facing CRM pages and navigation.
- `src/app/portal/**`: client portal experience.
- `src/app/login/**`, `src/app/register/**`, `src/app/page.tsx`: auth entry and
  role routing.
- `src/app/api/ai/**`: Anthropic-backed AI endpoints.
- `src/app/api/webhooks/**`: external webhook boundaries.
- `src/components/**`: shared UI and client components.
- `src/lib/db.ts`: schema, connection, seed, settings, password hashing.
- `src/lib/auth.ts`: session token signing and current user resolution.
- `src/lib/actions.ts`: Server Action mutations.
- `src/lib/queries.ts`: read models.
- `src/lib/ai.ts`: Anthropic client and AI generation contract.
- `src/lib/prepared-ai.ts`: deterministic prepared prompt library and response
  scenario generator for the first presentation.
- `src/lib/whatsapp.ts`: WhatsApp Cloud API integration.
- `src/lib/i18n.ts`: locale keys and translations.
- `src/lib/domain.ts`: canonical CRM roles, route map, status values, domain
  entity types, and route access helpers.
- `src/lib/contracts/amo-crm.ts`: amoCRM adapter interface and sync DTOs.
- `src/lib/contracts/student-portal.ts`: client-visible portal contract.
- `src/lib/contracts/prepared-ai.ts`: prepared response boundary for the first
  presentation.
- `src/lib/contracts/index.ts`: public export surface for integration contracts.
- `package.json`, `eslint.config.mjs`, `tsconfig.json`, `next.config.ts`:
  validation and build configuration.

Future lanes must name their write set before coding. If a lane needs to edit
outside its named ownership area, update `docs/PLAN_CHANGES.md` first.

`/goal-evo-inbox-companion` planned write set:

- `docs/EVO_INBOX_COMPANION_PRD.md`: product contract and acceptance context.
- `docs/EVO_LAUNCH_PLAN.md`: lane status, phase plan, write sets, and
  validation gates.
- `docs/PLAN_CHANGES.md`: append-only decisions and scope changes.
- `CONTEXT.md` and `docs/adr/**`: domain language and architectural decisions.
- `agent-lead2-inbox/**`: WACRM-derived EVO Inbox app, Supabase
  migrations, WAHA transport, amoCRM resolver, AI draft surfaces, redesigned UI,
  tests, and MIT license notice.
- `docker-compose.prod.yml`, deployment docs, and Caddy deployment notes only
  when the deployable companion service is introduced.

`/goal-evo-inbox-companion` phase plan:

1. Source setup: create a clean implementation branch from the intended base,
   copy WACRM into `agent-lead2-inbox/`, preserve MIT license notice, and
   establish local install/build/test commands.
2. Product pruning: remove or hide Meta Cloud API, broadcasts, broad
   automations, flow-driven sending, and first-launch-disabled WACRM surfaces.
3. WAHA transport: replace Meta send/webhook/session assumptions with WAHA
   session `evo-inbox`, authenticated webhooks, idempotent inbound persistence,
   and manual outbound send.
4. Supabase foundation: configure managed Supabase, migrations, Auth, storage,
   RLS, service-role server paths, and companion shadow records.
5. amoCRM identity: resolve by phone, create missing contact/lead, store
   `amo_contact_id` and `amo_lead_id`, and block local-only lead presentation
   when amoCRM is unavailable.
6. AI draft and knowledge: keep WACRM's OpenAI/Anthropic draft assistant and
   knowledge base, default auto-reply off, and route manual sends through WAHA.
7. Full EVO Inbox redesign: redesign retained surfaces around admissions
   operators, integration status, lead profile, AI draft, knowledge base, and
   production readiness.
8. VPS deployment: add a separate `hermes-vps` service and Caddy route for
   `inbox.evoadmissions.com`; verify only with real DNS, Supabase, WAHA, amoCRM,
   and AI provider credentials.

`/goal-evo-inbox-companion` acceptance criteria:

- The companion app runs from `agent-lead2-inbox/` without depending on
  Meta Cloud API configuration.
- First launch supports one WAHA session named `evo-inbox`.
- Inbound WAHA messages are authenticated, idempotent, persisted in Supabase,
  and visible in the redesigned EVO Inbox.
- The app resolves or creates amoCRM identity before presenting a lead as real.
- Supabase stores shadow records and app data, not canonical CRM identity.
- AI draft works through the companion app's own assistant; auto-reply is off by
  default.
- An operator can send one manual WhatsApp reply through WAHA after reviewing
  the conversation and optional AI draft.
- Broadcasts, broad automations, flow-driven sending, and Meta templates are
  absent or disabled in first-launch UI and runtime paths.
- `inbox.evoadmissions.com` deployment is only claimed after a real
  `hermes-vps` deployment, Caddy routing, DNS, WAHA, Supabase, amoCRM, and AI
  provider check succeeds.

`/goal-qa-launch` named write set:

- `docs/EVO_LAUNCH_PLAN.md`: current-slice and acceptance update.
- `docs/PLAN_CHANGES.md`: append-only QA launch entry.
- `docs/QA_LAUNCH_REPORT.md`: QA checklist, screenshot paths, validation, stop
  reason, and blockers.
- `docs/SCENARIO_EVALUATION.md`: refreshed only by the required scenario runner
  as validation evidence.
- Runtime, scenario, or copy files only if the QA pass exposes a
  launch-blocking bug, fake-success claim, missing validation evidence, or small
  critical-flow UI issue inside this slice.

`/goal-lead-agent-webhook-ownership` named write set:

- `docs/EVO_LAUNCH_PLAN.md`: append this implementation block.
- `docs/PLAN_CHANGES.md`: append webhook ownership and source-of-truth decision.
- `AGENTS.md`, `deploy/README.md`, `docker-compose.prod.yml`,
  `deploy/env.lead-agent.example`, `.gitignore`, `.dockerignore`,
  `eslint.config.mjs`, `tsconfig.json`: deployment, repo-boundary, and
  validation configuration for the lead-agent sibling service.
- `src/lib/db.ts`, `src/lib/whatsapp.ts`, `src/lib/actions.ts`,
  `src/lib/queries.ts`, `src/lib/i18n-data.ts`,
  `src/app/(staff)/settings/page.tsx`,
  `src/app/(staff)/whatsapp/[id]/page.tsx`, `scripts/bootstrap-admin.mjs`: CRM
  schema, settings, read models, bootstrap schema, and operator-visible
  source-of-truth state.
- `src/app/api/internal/lead-agent/**`: private internal sync endpoint from the
  lead-agent service into EVO CRM.
- `evo-lead-agent/AGENTS.md`, `evo-lead-agent/README.md`,
  `evo-lead-agent/.env.example`, `evo-lead-agent/Dockerfile`,
  `evo-lead-agent/docker-compose.yml`, `evo-lead-agent/pyproject.toml`,
  `evo-lead-agent/uv.lock`, `evo-lead-agent/SECURITY.md`,
  `evo-lead-agent/functional-spec.md`, `evo-lead-agent/technical-spec.md`,
  `evo-lead-agent/implementation-plan.md`,
  `evo-lead-agent/token-cost-estimate.md`, `evo-lead-agent/research/README.md`,
  `evo-lead-agent/*context-report.md`,
  `evo-lead-agent/src/evo_lead_agent/**`, `evo-lead-agent/tests/**`:
  product rename, lead-agent runtime packaging, callback configuration, signed
  CRM sync client, service pipeline, and focused tests.

Acceptance criteria:

- WAHA webhook ownership moves to the lead-agent service. Production/session
  configuration should point WAHA at `http://evo-lead-agent:8000/webhooks/waha`
  on the private Docker network, not the public CRM route.
- The lead-agent resolves or creates amoCRM contact/lead first, then sends a
  signed internal sync payload to EVO CRM.
- EVO CRM persists remote amoCRM identifiers and lead-agent state on the local
  lead/conversation records without making local state the source of truth.
- EVO CRM keeps the staff WhatsApp inbox/operator UI usable by storing inbound
  and outbound message copies linked to the resolved amoCRM lead/contact.
- Both internal CRM sync and WAHA webhooks must be authenticated with shared
  secrets/HMAC-style verification; no public unauthenticated mutation endpoint
  is allowed.
- The first live receive-only test may enable autoreply only for Gemini draft
  review, but must keep outbound disabled until WAHA, amoCRM, CRM internal sync,
  and Gemini configuration are verified with real credentials and a later
  outbound send test is explicitly approved.
- The parent repo owns the EVO-specific `evo-lead-agent` source. Parent CRM
  validation must still avoid scanning lead-agent Python/runtime internals with
  Next.js tooling, and `evo-lead-agent/research/repos` stays untracked so
  unrelated reference snapshots do not become production source.

`/goal-gemini-receive-only-production-preflight` named write set:

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`, `deploy/README.md`,
  `deploy/env.lead-agent.example`, `docker-compose.prod.yml`: parent launch
  contract and production deployment readiness path.
- `evo-lead-agent/README.md`, `evo-lead-agent/.env.example`,
  `evo-lead-agent/PLAN_CHANGES.md`, `evo-lead-agent/implementation-plan.md`,
  `evo-lead-agent/technical-spec.md`,
  `evo-lead-agent/src/evo_lead_agent/readiness.py`,
  `evo-lead-agent/src/evo_lead_agent/preflight.py`,
  `evo-lead-agent/src/evo_lead_agent/cli.py`,
  `evo-lead-agent/tests/test_readiness.py`,
  `evo-lead-agent/tests/test_preflight.py`,
  `evo-lead-agent/tests/test_cli.py`: parent-tracked lead-agent receive-only readiness,
  preflight, local smoke, docs, and regression coverage.

Acceptance criteria:

- Env examples and deploy docs include Gemini configuration and receive-only
  safety flags.
- Readiness and preflight distinguish `receive_only_rollout` from
  `live_whatsapp_outbound`.
- Missing WAHA, amoCRM, CRM sync, Gemini, and admin configuration is reported
  by exact missing input name.
- Local smoke remains no-outbound and fails if outbound is enabled.
- `uv run pytest` and `uv run ruff check .` pass in `evo-lead-agent`.
- Parent CRM validation runs because deployment docs and Compose are touched.

## Merge Order

1. `plan-contract`: docs-only launch contract. Blocks implementation lanes.
2. `brand-research`: docs-only product/domain research for copy and education
   flow realism.
3. `architecture-contract`: role, route, entity, amoCRM adapter, student portal,
   and prepared AI contracts.
4. `crm-baseline`: separate runtime baseline commit required so later slices can
   build from a clean checkout without mixing baseline and prepared-AI review.
5. `prepared-ai-prompts`: user-requested first-presentation prepared response
   layer with explicit prepared/live boundaries.
6. `admissions-crm-core`: core staff CRM surfaces for Command Center,
   Admissions Pipeline, Student 360, tasks, documents, applications, and finance
   overview.
7. `student-portal`: first production-quality authenticated student portal over
   the stable student, application, document, payment, task, and update
   contracts.
8. `amocrm-integration`: runtime amoCRM settings/status/adapter foundation with
   truthful configured/not-configured/blocked behavior. Completed before
   `/goal-qa-launch`.
9. `/goal-qa-launch`: combined release/presentation QA readiness lane covering
   validation-baseline, production truthfulness, security/secret checks,
   CRM-core flow verification, real integration blocker recording,
   presentation-readiness evidence, release-readiness reporting, and clean-tree
   final audit without rebuilding feature architecture.
10. `/goal-lead-agent-webhook-ownership`: make the lead-agent service the
    private WAHA webhook owner, use amoCRM as source of truth, and sync local
    CRM shadow state for the operator UI.
11. `/goal-gemini-receive-only-rollout`: replace Anthropic drafting with
    Gemini 3.5 Flash draft review in the EVO lead-agent, then prove receive-only
    production WhatsApp rollout on `hermes-vps` with real WAHA, amoCRM, CRM sync,
    and Gemini credentials while outbound WhatsApp remains disabled.

Each lane must be merged or intentionally abandoned before the next lane starts.

## Required Validation Commands

Current baseline commands for this repo:

```bash
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build
npm run scenarios
npm audit --audit-level=moderate
```

Future implementation lanes should add real integration and E2E checks to this
list rather than replacing these gates.

## Dependency Audit Hardening And Frontend Merge Readiness

Active slice: `/goal-evo-dependency-hardening`.

This slice restores a truthful green dependency gate after two advisories were
published against the already-merged frontend dependency graph. It must merge
before the independent design-polish PR is rebased and merged.

### Scope

- Update the root CRM and `agent-lead2-inbox` PostCSS resolutions to a current
  patched release and regenerate both lockfiles under the repository Node 22
  runtime.
- Keep `npm audit --omit=dev --audit-level=moderate` blocking for both deployed
  Next.js applications.
- Add a repository-owned development-audit verifier that accepts only
  `GHSA-mh99-v99m-4gvg` and only the known ESLint/minimatch package chain.
- Give the temporary allowlist an explicit owner, reason, and review deadline.
- Keep every other direct or transitive advisory blocking, including any new
  advisory that appears after this plan is written.
- Do not use `npm audit fix --force`, unsupported transitive major overrides,
  broad `continue-on-error`, or an unbounded audit exception.

Named write set:

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`: launch contract and
  append-only decision record.
- `package.json`, `package-lock.json`,
  `agent-lead2-inbox/package.json`,
  `agent-lead2-inbox/package-lock.json`: patched PostCSS resolution and locked
  dependency graphs.
- `.github/workflows/evo-platform-ci.yml`: separate blocking production and
  constrained development audit gates.
- `scripts/check-npm-audit-allowlist.mjs`,
  `config/npm-audit-allowlist.json`: real npm audit execution and the
  time-bounded exception contract.

### Acceptance criteria

- Root CRM and EVO Inbox production audits return zero vulnerabilities.
- Full development audits may contain only the known
  `brace-expansion -> minimatch -> ESLint/Next lint plugins` chain recorded in
  the allowlist.
- The verifier fails closed on malformed npm output, an expired allowlist, an
  unknown advisory URL, or an unknown affected package.
- Root CRM and EVO Inbox install, lint, type-check, test and production build
  gates pass from their committed lockfiles.
- The hardening PR passes GitHub CI and receives an independent launch-control
  `approved` verdict before merge.
- After the hardening PR merges, PR #72 is rebased onto current `main`, reruns
  the complete CI workflow, receives an independent freshness/correctness
  confirmation, and only then merges.
- No deployment, provider mutation, production database change, live WhatsApp
  send, or amoCRM write occurs in this slice.

### Current primary sources

- npm audit supports separate omitted dependency classes and severity-based
  exit thresholds:
  <https://docs.npmjs.com/cli/v11/commands/npm-audit/>.
- `brace-expansion` advisory:
  <https://github.com/advisories/GHSA-mh99-v99m-4gvg>.
- PostCSS advisory:
  <https://github.com/advisories/GHSA-r28c-9q8g-f849>.

## EVO Platform Post-Design Review Polish Slice

Historical completed slice: `/goal-evo-platform-design-polish`.

This slice applies the independent Claude Design review dated 2026-07-25 to
the already-merged unified frontend. It is a frontend refinement pass, not a
rebuild. The reviewed baseline is `origin/main` at
`3dd571bf302bd46dd020e029eb5ab40da5a1a277`.

### Product and technical boundaries

- amoCRM remains canonical for lead/contact identity and sales stage.
- For this historical design-polish slice, AI customer replies remained
  draft-only and required explicit operator send.
- Provider status remains honest; no WAHA, amoCRM, AI, telephony, storage or
  payment connection may be presented as verified without a real exercise.
- Existing roles and server-side authorization are unchanged.
- This slice changes frontend presentation and frontend regression coverage
  only. It does not change database schemas, webhook/provider contracts,
  Compose/Caddy, secrets, deployment or production state.

### Public test seams

The agreed seams for test-first changes are browser-visible behavior and
accessible DOM on existing routes. Tests should assert what an operator or
student can see and operate at `1440x1024`, `834x1194` and, where applicable,
`390x844`; they should not assert private helper implementation.

- WhatsApp: bubble semantics by delivery state, honest context summary,
  compact mobile source disclosure, useful empty state and non-duplicated
  composer guidance.
- Staff navigation: distinct application/visa destinations, discoverable
  icon-rail labels on hover and keyboard focus, and no horizontal overflow.
- Dashboard: one attention heading and an action-first queue that handles
  zero-count/all-clear states.
- Student 360, permissions and portal: collapsed data-entry affordances,
  semantic permission indicators, useful desktop density and brand-consistent
  system copy.

### Implementation waves

1. **P1 isolated refinements:** F1 outgoing WhatsApp bubbles, F2 distinct visa
   icon and F4 useful Inbox empty state.
2. **P1 responsive navigation:** F3 tablet icon rail with durable
   hover/focus-visible labels and explicit active state.
3. **P2 dashboard and Inbox:** F5 duplicated dashboard eyebrow, F6 zero-first
   priority queue, F7 repeated unverified-sync values, F8 oversized mobile
   source banner and F10 duplicated composer label/placeholder.
4. **P2 structure and polish:** F9 Student 360 anchor/form density, F11
   permission glyphs, F12 portal desktop lower-zone utility and F13 system
   update emoji.

### Acceptance

- Three consecutive outgoing messages do not create a red wall; red is
  reserved for `failed`, and all supported delivery states retain their exact
  mapping.
- `/applications` and `/visa` are visually distinct at 834px, every icon-rail
  destination has an accessible label, and that label becomes visible on
  hover and keyboard focus.
- The no-selection Inbox state explains the next action and repeats that AI
  only creates a draft.
- Dashboard attention content leads with real actions; when every count is
  zero it shows the all-clear copy from the design review.
- At 390px at least two messages are visible without scrolling while provider
  source detail remains available.
- Student 360 keeps deep links and mutations available without showing all
  add forms by default.
- Portal desktop uses existing data to reduce the empty lower zone and does
  not invent a provider result.
- Lint, TypeScript, production build, scenarios, security checks, Playwright
  and automated accessibility checks pass under Node 22.
- Fresh screenshots cover affected routes at required viewports, including
  both light and dark WhatsApp message treatment where supported.
- An independent reviewer checks the final diff against this contract before
  the pull request is offered for merge.

### Named write set

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`,
  `docs/design/evo-platform/COMPLETION_CHECKLIST.md` and frontend screenshot or
  audit evidence under `docs/design/evo-platform/**`.
- `src/app/globals.css`, affected routes under `src/app/(staff)/**` and
  `src/app/portal/**`.
- Shared presentation components under `src/components/**` and existing
  presentation/query copy under `src/lib/**` only when needed for F1-F13.
- Focused public-behavior regression coverage under `tests/**`.

## Stop Conditions

Stop and escalate when:

- Required real credentials, provider accounts, data, or deployment targets are
  missing.
- A lane would need hidden mocks, demo paths, or fake success to pass.
- Scope, architecture, acceptance criteria, file ownership, or merge order needs
  to change and `docs/PLAN_CHANGES.md` has not been updated first.
- Independent reviewer approval is unavailable and the user has not explicitly
  waived the launch-control gate.
- Validation fails for reasons outside the lane's scope and cannot be fixed
  without changing the contract.

## Historical Final EVO Platform Technical Specification Slice

Completed predecessor slice: `/goal-evo-platform-final-tz`.

This slice turns the completed frontend, the audited repository, the
owner-supplied OZO technical brief, current production boundaries, business
process documentation, ADRs and design evidence into the implementation
contract for the unified EVO Admissions platform. P0 now corrects its remaining
role, ownership, environment, retention and release-gate gaps. Repository
implementation starts only after P0 merges; production mutations still require
their own explicit authorization.

### Scope

- Produce one canonical Russian-language specification covering business
  outcomes, actors, roles, workflows, data ownership, integrations,
  non-functional requirements, migration, release gates and acceptance tests.
- Treat the owner-supplied OZO brief as contextual input, not as automatically
  correct architecture or product truth. Preserve useful process requirements,
  record corrections, and expose unresolved decisions explicitly.
- Keep amoCRM canonical for lead/contact identity, responsible manager and
  sales stage. Keep operational admissions stages separate from the sales
  pipeline.
- Define one dedicated Supabase production project for all EVO-owned platform
  data. Keep local/dev, persistent staging and preview branches/projects
  physically isolated with the same migrations and no production-data copy by
  default. Do not create separate production projects for Inbox and CRM.
- Define one WAHA/WhatsApp ingress, idempotent event handling, durable message
  history, draft-only AI, manual outbound confirmation and delivery/read audit.
- Specify how useful Lead Agent responsibilities move into the unified backend.
  Retirement is allowed only after a controlled real end-to-end proof,
  reconciliation, rollback window and owner approval.
- Reuse the accepted EVO frontend and brand evidence as the interaction
  contract. Figma or prototype files are supporting design evidence, not a
  substitute for this technical specification.
- Distinguish verified current behavior, target requirements, assumptions,
  external blockers and future options throughout the document.

### Named write set

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`: launch contract and
  append-only decision record.
- `docs/specs/EVO_PLATFORM_TZ.md`: canonical reviewable specification source.
- `docs/specs/EVO_PLATFORM_TZ.docx`: editable owner-facing specification.
- `docs/specs/EVO_PLATFORM_TZ_VALIDATION.md`: reproducible validation and
  page-inspection ledger.
- `scripts/generate-evo-platform-tz.py`: deterministic DOCX builder.
- `scripts/verify-evo-platform-tz.py`,
  `scripts/requirements-evo-platform-tz.txt`: isolated dependency, real
  LibreOffice/Poppler render and accessibility/traceability verification
  contract.
- Existing brand and implementation screenshots under `docs/company/brand/**`
  and `docs/design/evo-platform/**` may be read and embedded; they are not
  modified by this slice.

### Acceptance criteria

- Every `FR`, `NFR`, `INT`, `DATA`, `SEC`, `ACC` and `DEC` ID is listed
  individually in a provenance matrix that points to repository evidence,
  official provider documentation, the OZO brief or an explicit owner
  decision. Every requirement also has an explicit priority and verification
  method.
- Data ownership and synchronization rules prevent two independently writable
  lead/contact/sales-stage sources of truth.
- Roles and permissions cover both server-side authorization and visible UI,
  including denial, audit and privileged-action rules.
- The current plan keeps the production path reversible and leaves Lead Agent,
  the legacy webhook/session and rollback path deployed/frozen only as
  current-state cutover inputs. It does not authorize their retirement in this
  slice and does not preserve them as separate target products.
- The original full-target journey remains explicit but deferred with P4:
  `WhatsApp -> amoCRM -> EVO Platform -> AI draft -> manual send ->
  delivery/read status -> audit history`. Current P8 accepts only the real
  executable amoCRM-independent P5-P7 portion and records the amoCRM segment as
  deferred, never passed.
- Unknown provider states, missing credentials and unverified integrations
  remain visibly blocked; no mock or configured flag is described as production
  proof.
- The DOCX uses the EVO brand, has a real heading hierarchy, marked table
  headers, meaningful image alt text and no secret or applicant personal data.
- A fresh Python environment installs the pinned DOCX dependency manifest, the
  repo-owned verifier builds the DOCX, renders it through real
  LibreOffice/Poppler, validates item-level traceability and writes structured
  accessibility evidence. The packaged document renderer is also used for the
  final owner-facing render.
- Every final page is visually inspected at original resolution and recorded in
  `docs/specs/EVO_PLATFORM_TZ_VALIDATION.md`; the automated accessibility audit
  has zero unresolved high, medium or low findings.
- All substantive owner-facing content comes from
  `docs/specs/EVO_PLATFORM_TZ.md`; the generator adds only presentation
  mechanics such as the branded cover, footer and Word TOC field.
- An independent reviewer checks the final specification against source
  evidence, architecture boundaries and acceptance criteria before merge.
- No production deployment, provider mutation, database migration, live
  WhatsApp send or amoCRM write occurs in this slice.

## Current P8D Disabled Deployment Slice

The first P8D attempt stopped safely before CRM or Inbox recreation because the
retained P8B images were `linux/arm64` while Hermes is `linux/amd64`. Lead Agent
was restored healthy and all production configuration was rolled back. The
P8B2 under issue #188 produced the exact platform-bound `linux/amd64`
candidate. P8C2 then bound its real retained manifest, evidence, SBOM/smoke
identities and current environment reconciliation. P8D2 under issue #202 loaded
the verified archives but stopped without restarts because its contract compared
platform-manifest digests with their parent OCI-index digests. P8B3 under issue
#205 then bound both identities and the exact portable archive graph. The active
next slice is staging-only P8D3 under issue #209 and
`docs/platform/p8d3-portable-amd64-staging.md`.

Current accepted release-control main:
`81ef7a6cb6d16404fbba53af695a80b04140cfa3`. Its exact-main CI run
`31894158294` completed successfully. P8C2 reconciled the real environments
without mutation, retained P8B application provenance at `050514...`, bound
the exact AMD64 image identities, and truthfully returned `blocked` because
portable identity, fresh staging, provider prerequisites, and deployment remain
incomplete.

The owner-authorized P8D2 attempt is closed as failed-safe evidence. All running
CRM, Inbox, Lead Agent and WAHA identities, start times, health and zero restart
counts remained unchanged; no provider call occurred. P8B3 now binds both the
OCI index and its portable AMD64 manifest plus archive/config/layer bytes. It is
local evidence generation only and grants no Hermes retry.

The current preflight records Inbox WAHA as `SCAN_QR_CODE`, canonical DNS as
absent and amoCRM credentials as incomplete. P8D must preserve those external
blockers truthfully rather than silently fixing or relabelling them. P8D3 may
reuse only the freshly hash-proven P8D2 transfer/load checkpoint, creates a new
rollback/evidence boundary and may not change a running service. Application
activation remains a later separately approved block. Current main now includes
migration `073` and updated future-candidate inventory; P8D3 does not relabel or
rebuild the frozen pre-`073` P8B3 application candidate. P8D4 must reconcile
that database/application compatibility before any deployment authorization.

## EVO Knowledge Launch Finalization

Block-ID: `EVO-KNOWLEDGE-LAUNCH-FINALIZE-2026-08-15`.

The owner authorizes finalizing the current Obsidian knowledge bases for first
AI use without making semantic Gmail processing or missing WhatsApp media a
launch blocker. Those archived sources remain preserved for later incremental
improvement. This block does not deploy an AI, send messages, inspect applicant
documents, process Gmail, retry WhatsApp media, or expose raw/sensitive content.

### Delivery blocks

1. Resolve the remaining manually created review notes by archiving status-only
   checklists and promoting only current, non-personal, sourced facts.
2. Create the client-vault marker `.evo-vault.json` with the closed object
   `{"kind":"evo_client_knowledge","canonical_path":"<resolved exact path>"}`.
   Publication rejects a missing, malformed, extra-key, symlinked or path-
   mismatched marker and any destination outside that exact marked vault.
3. Add a deterministic client-publication command that reads only approved
   internal Markdown, requires an explicit Russian allowlist, rejects sensitive
   or unresolved material, preserves provenance, and writes only beneath the
   marked client vault.
4. Publish a useful Russian client set covering EVO, services, admissions,
   countries, universities, prices and response policies. Mutable external
   facts must carry an official source and verification date; otherwise the
   client note must instruct staff to verify before quoting it.
5. Add a deterministic local retrieval check for both marked vaults and run
   real Russian control questions against the actual published Markdown. This
   proves the local knowledge artifacts are retrievable; it is not proof of a
   deployed model or provider integration.
6. Record an operational readiness report with exact counts, exclusions,
   deferred Gmail/WhatsApp work and remaining risks.

### Closed publication contract

- Allowlist path: `<client vault>/.Публикация клиентской базы.json`. It is a
  closed version-1 object with only `version` and `entries`. Every entry has
  exactly: `source_relative_path`, `source_sha256`, `destination_relative_path`,
  `content_class`, `personal_data_reviewed`, `authority`,
  `authority_reference`, `official_url`, and `verified_at`.
- `content_class` is only `stable_evo_policy` or `mutable_official_fact`, and
  `personal_data_reviewed` must be the JSON boolean `true`. Stable policy accepts
  only `owner_decision`; mutable facts accept only `official_source`. A source
  containing an email address or phone-like sequence is rejected regardless of
  the review flag. The publisher does not infer or downgrade a content class
  from keywords.
- `authority` is only `owner_decision` or `official_source`. Owner decisions
  require a non-empty internal decision-note reference; their `official_url`
  and `verified_at` are JSON null. Official-source entries require an HTTPS URL
  and ISO `YYYY-MM-DD` verification date; their `authority_reference` names the
  internal verification note. No missing/extra fields or mixed authority form
  is accepted.
- Source paths are normalized relative paths beneath the exact approved
  internal vault, must name regular non-symlink Markdown files and must match
  `source_sha256`. Destination paths are normalized Russian `.md` paths beneath
  the exact client vault and may not overwrite unmanaged files.
- The approved source is accepted only at the exact non-symlink path
  `<marked internal root>/Утверждено для внутреннего ИИ`; raw CLI path
  components are checked before canonicalization. Authority references are safe
  relative regular non-symlink Markdown paths in that approved vault. Owner
  references require exact frontmatter `тип: решение_владельца` and
  `статус: решено`; official references require `тип: протокол_проверки` and a
  valid `дата_проверки` ISO date.
- Published frontmatter contains exactly traceable fields for publication:
  `тип: клиентское_знание`, `управляется: evo_client_publisher`, source relative
  path/SHA, authority/reference, official URL and verification date. Null
  provenance remains explicit for owner decisions.
- Managed state lives at `<client vault>/.Манифест клиентской публикации.json`,
  a closed version-1 object containing the exact generated destination paths
  and their source/output SHA values. Stale deletion is restricted to paths in
  the prior valid manifest whose current file still has the managed marker.
- The publisher validates marker, allowlist, all sources, all destinations,
  provenance and the existing managed manifest before any write or deletion.
  It also resolves and reads every stale managed candidate before mutation.
  Missing/malformed/traversal/symlink/hash/provenance errors fail with zero
  mutation.

### Deterministic retrieval gate

- CLI: `scripts/knowledge_ingestion/check_retrieval.py`; committed cases:
  `scripts/knowledge_ingestion/retrieval_cases.json`; report:
  `<internal vault>/Панель управления/Отчёт проверки поиска.json`.
- Cases use a closed version-1 schema with `vault` (`internal` or `client`),
  Russian `query`, `top_k`, and one or more exact expected relative paths. A
  case passes only when an expected path is in the deterministic top-k result.
- The initial fixed cases cover client questions about EVO, result wording,
  China documents, study price and admissions; internal cases cover client
  handoff, source authority, review flow and China working data.
- The checker accepts only the two exact marked roots, walks regular non-symlink
  Markdown beneath the selected root and records result paths/scores. It rejects
  any case/path resolving into `Сырой архив ЭВО` or `Секреты и доступы ЭВО`,
  any root/marker mismatch and any unexpected fixture field. Exit is non-zero
  if any expected top-k result or forbidden-root assertion fails.

### Acceptance criteria

- Gmail semantic processing and 396 failed WhatsApp media downloads are marked
  deferred, not complete and not required for first launch.
- Raw exports, correspondence, applicant files, credentials, contracts with
  personal fields, and internal-only process notes never enter the client vault.
- Client publication is allowlist-only, fail-closed, repeatable and tested for
  traversal, unmanaged-file preservation, sensitive-content rejection and
  deterministic stale cleanup.
- Marker tests reject missing, malformed, symlinked and canonical-path-mismatched
  client markers; allowlist tests reject unknown fields, wrong SHA, invalid
  provenance and destinations outside the exact client vault before mutation.

## Active slice: `/goal-evo-platform-knowledge`

### Outcome

Connect the two approved Obsidian knowledge layers to the production EVO Inbox
without exposing raw archives or internal notes to client-reply generation.
Obsidian remains the owner-edited source; Supabase is the account-scoped runtime
index; Gemini produces operator-reviewed drafts only. No autonomous WhatsApp
send is authorized.

### Delivery blocks

1. `K1` records this architecture and its closed publication, database,
   retrieval, deployment and real-evaluation contract. It changes no runtime.
2. `K2` adds an explicit `client` / `internal` audience to knowledge documents,
   chunks and retrieval RPCs; existing unclassified production documents become
   `internal`. Client draft and playground paths request only `client` chunks.
3. `K3` adds deterministic bundle construction from the two exact marked local
   vaults and a one-shot server-side importer. The client bundle contains all
   regular non-symlink Markdown in the exact client vault except `.obsidian`,
   publication journals and hidden control files. The internal bundle contains
   only regular non-symlink Markdown under `Утверждено для внутреннего ИИ`.
4. `K4` adds an authenticated staff-only internal assistant surface. It retrieves
   only `internal` chunks, calls the account's existing active Gemini config,
   returns a draft plus source-note identities, records the same provider and
   retrieval audit metadata used by client drafts, and cannot send WhatsApp.
5. `K5` deploys only after reviewed PRs, green exact-head/main CI and the current
   release gate. It applies the migration, imports both real bundles, reindexes,
   runs fixed Russian retrieval cases and executes one explicitly authorized
   real Gemini draft for each audience. Automatic reply remains disabled.

### Closed data and sync contract

- `ai_knowledge_documents.audience` and `ai_knowledge_chunks.audience` are
  required text values restricted to `client` or `internal`. Chunk audience is
  copied from its parent document; retrieval RPCs require an audience argument
  and filter it together with `account_id` before ranking.
- Managed documents also carry `source_path`, `source_sha256` and
  `managed_by = 'evo_obsidian_sync'`. A closed check constraint requires all
  three to be non-null for managed rows and all three to be null for manual
  rows. The unique partial managed identity is
  `(account_id, audience, source_path)`. Existing/manual documents remain
  preserved but migrate to `internal`; they are never silently promoted to
  client knowledge.
- A bundle is UTF-8 canonical JSON (`sort_keys=true`, compact separators, one
  final LF) named `evo-knowledge-<audience>.json`. It is a closed version-1
  object with `version`, `account_id`, `audience`, `vault_kind`, `marker_sha256`,
  and `documents`; it contains no clock-derived field. Each
  document has exactly `source_path`, `source_sha256`, `title`, and `content`.
  `source_path` is NFC-normalized POSIX syntax relative to the exact marked
  client root for `client`, and relative to the exact approved child for
  `internal`. It must be a non-empty visible `.md` path with no absolute form,
  backslash, dot segment, hidden segment or symlink component and must resolve
  to a regular file strictly inside that lexical root.
- Its manifest is exactly `evo-knowledge-<audience>.sha256.json`, canonicalized
  the same way, with only `version`, `account_id`, `audience`, `bundle_file`,
  and `bundle_sha256`; the SHA covers the exact bundle bytes. The importer
  requires exact account/audience/file agreement and re-hashes before parsing.
  `marker_sha256` binds the exact local `.evo-vault.json` bytes; the server does
  not treat the workstation absolute path inside that marker as authorization.
  Generation time belongs only to the unhashed operational report. Rebuilding
  the same account/audience/vault bytes produces byte-identical bundle and
  manifest files and the same SHA.
- Bundle creation validates the exact non-symlink vault marker and every path,
  rejects symlink components, invalid UTF-8, non-Markdown files, duplicate
  paths, wrong hashes and any path containing raw/secrets roots. Both audiences
  unconditionally reuse `contains_email()` and `contains_phone()` from
  `scripts/knowledge_ingestion/review.py`; either match aborts the entire bundle.
  Tests include formatted/international phones, continuous 10/16-digit runs,
  email case variants, invalid UTF-8 and symlinked parent components.
- The importer runs inside the private EVO Inbox execution boundary with the
  existing service-role credential. It requires an explicit account id, validates
  the complete bundle before mutation, upserts only managed identities for the
  declared audience, rebuilds their chunks, and deletes stale documents only
  when they are still marked `evo_obsidian_sync` for that audience. Manual and
  opposite-audience documents are never deleted.
- Before database mutation, the importer deterministically chunks every document
  and obtains/validates every required embedding in memory. It then calls the
  single service-role-only Postgres function
  `public.sync_ai_knowledge_bundle(uuid,text,text,jsonb)`, passing account,
  audience, bundle SHA and the fully materialized documents/chunks. The function
  revokes `PUBLIC`/`anon`/`authenticated`, grants only `service_role`, validates
  the closed payload again, takes `pg_advisory_xact_lock` on the account/audience
  identity, upserts documents, replaces their chunks, deletes only stale managed
  rows for that audience, records the bundle SHA, and returns counts in its one
  database transaction. Any exception rolls back every write. The existing
  delete-then-insert `ingestDocument()` is not used by this importer.
- The fourth RPC argument is a closed JSON object with exactly `version: 1` and
  `documents`. Each document has exactly `source_path`, `source_sha256`, `title`,
  `content`, and `chunks`. Each chunk has exactly `chunk_index`, `content`,
  `content_sha256`, and `embedding`; indices are consecutive integers from zero,
  content is non-empty and SHA-256 matches its UTF-8 bytes, and embedding is an
  array of exactly 1,536 finite JSON numbers. Document identity is the managed
  `(account_id,audience,source_path)` row; chunk identity is that document plus
  `chunk_index`. Empty documents/chunks, duplicate paths/indices and extra keys
  reject the whole RPC. The lock is exactly
  `pg_advisory_xact_lock(hashtextextended(account_id::text || chr(31) || audience, 0))`.
  The RPC returns exactly `version`, `account_id`, `audience`, `bundle_sha256`,
  `documents_upserted`, `documents_deleted`, and `chunks_replaced`; counts are
  non-negative integers and are committed in the same transaction.
- A failed validation, embedding/provider error or database error is reported as
  failure. There is no keyword, mock or partial-success fallback during import.

### Security and behavior invariants

- Client reply generation, playground evaluation and any later auto-reply path
  can retrieve only `client` knowledge. Internal retrieval is available only to
  authenticated EVO staff and never enters a client reply prompt.
- `owner`, `admin` and `agent` are staff for this slice; `viewer` has no direct
  document/chunk/RPC or assistant access. Direct table SELECT and retrieval RPCs
  require `is_account_member(account_id, 'agent')`; document mutation remains
  admin/owner-only. Retrieval RPCs remain `authenticated` but are SECURITY
  INVOKER and RLS-bound. The sync RPC is service-role-only. Client draft and
  playground routes require `agent` and hard-code `client`; the internal route
  requires `agent` and hard-codes `internal`; manual knowledge CRUD requires
  `admin`, always creates/updates `internal` manual rows, and cannot accept an
  audience override. Negative route/RLS tests cover
  anonymous, viewer, cross-account, client-to-internal parameter injection and
  direct internal table/RPC reads.
- `Сырой архив ЭВО`, `Секреты и доступы ЭВО`, WhatsApp originals, Gmail MBOX,
  applicant files and unapproved review notes are rejected at bundle creation
  and absent from runtime storage.
- Gemini credentials stay encrypted in the existing account configuration.
  Logs, reports, bundles, Git and chat output never contain keys, message bodies
  or customer personal data.
- All generated answers are drafts. No endpoint in this slice calls WAHA or
  changes the existing disabled automatic-reply state.

### Assistant API and immutable audit contract

- Existing `POST /api/ai/playground` remains agent-or-higher and accepts only
  `{messages,evaluation_case_id?}`. `messages` contains 1–20 exact objects with
  only `role` (`user` or `assistant`) and trimmed `content` (1–4,000 characters).
  The optional id is only `client_china_documents`; unknown/extra fields return
  HTTP 400. It hard-codes `client` retrieval.
- New `POST /api/ai/internal-assistant` is agent-or-higher and accepts only
  `{message,evaluation_case_id?}` with trimmed `message` of 1–4,000 characters;
  the optional id is only `internal_malaysia_handoff`. It hard-codes `internal`.
  Both success responses contain exactly `reply`, `handoff`, `sources`, and
  `audit_id`; each source has only UUID `chunk_id` and normalized `source_path`.
  Errors contain only `error` and stable `code`, with 400 validation/config,
  401 unauthenticated, 403 insufficient role, 429 limit, or 502 provider/audit
  failure. A generation is never returned if its audit insert fails.
- `ai_assistant_audits` has UUID `id`, required account FK, audience check,
  nullable evaluation-case id restricted to the case matching its audience,
  provider/model text, and non-empty closed JSONB `knowledge_sources`; every
  element has exactly UUID `chunk_id` and normalized `source_path`, chunk ids
  are unique and repeated source paths are allowed. It also has 64-lowercase-hex
  `response_sha256`, boolean
  `handoff`/`success`, required actor FK, `created_at`, and `expires_at` fixed to
  `created_at + interval '90 days'`. It stores no prompt or response body.
  Account agents may SELECT through RLS. `anon`/`authenticated` cannot
  INSERT/UPDATE/DELETE; server routes insert with service role after role checks.
  UPDATE always raises; DELETE raises before expiry. A service-role-only
  `purge_expired_ai_assistant_audits()` deletes only expired rows and returns a
  count. Existing conversation-bound `ai_drafts` remains unchanged.

### Bundle transport and retention

- The builder writes the bundle, manifest and body-free generation report to a
  fresh `mktemp -d` directory under local `/private/tmp`, directory mode 0700
  and files 0600. It never writes them to Git, an Obsidian vault or an image.
- The operator transfers exactly the bundle and manifest over the existing SSH
  host `hermes-vps` into a collision-free
  `/opt/evo-inbox/knowledge-imports/<UTC>-<bundle-sha-prefix>/` directory owned
  by root mode 0700 with files mode 0600. The import id is strict UTC basic time
  plus the first 12 lowercase bundle-SHA characters; no glob is accepted.
  Host SHA and manifest/account/audience are verified before `docker cp` copies
  the two exact files into `/tmp/evo-knowledge-import/<import-id>/` in the exact
  Inbox app container with the same modes. The importer re-verifies before RPC.
- A trap runs on success and failure and removes only the two exact files and
  their now-empty exact staging directory from container, host and local temp;
  cleanup failure makes K5 fail. Bundles never persist in an image or volume.
  Only a root-owned 0600 redacted report containing hashes, counts, statuses and
  no note body remains under `/opt/evo-inbox/evidence/knowledge/`.

### Acceptance and real proof

- Migration/RLS/grant tests prove account and audience isolation, required
  audience filtering and fail-closed invalid values.
- Unit/integration tests use the real local Supabase stack on OrbStack; no mocked
  database/provider result counts as acceptance. UI/build/type/lint checks pass.
- Real vault bundle reports include exact document counts and hashes while
  excluding raw, secrets, hidden controls and symlinks. Repeated import is
  idempotent; a removed managed note is deleted only from its own audience.
- Production proof records image/revision, migration state, managed document and
  chunk counts per audience, retrieval case results, active provider/model,
  auto-reply disabled state and source identities for two real Gemini drafts.
  Fixed committed cases live in
  `scripts/knowledge_ingestion/platform_eval_cases.json`: client case
  `client_china_documents` asks in Russian which China-admission documents to
  prepare and requires exact source `Страны/Китай/Документы для поступления — порядок уточнения.md`;
  internal case `internal_malaysia_handoff` asks in Russian how sales hands a
  Malaysia student to the overseas-education team and requires exact source
  `Процессы/Передача студента из ОП в ОЗО по Малайзии — 68fe88af5a26.md`.
  Both run through authenticated admin playground/assistant routes with synthetic
  non-customer messages, never a real conversation. Each route writes an
  immutable `ai_assistant_audits` row containing account, audience, case id,
  provider, model, closed knowledge sources, response SHA-256, success, actor and
  timestamp but no prompt or draft body. Rows are retained 90 days. The report
  `docs/evidence/evo-platform-knowledge-k5-eval.json` contains only those safe
  fields plus HTTP status, expected-source match, cross-audience-source count
  (must be zero), auto-reply state and send-endpoint-call count (must be zero).
  Draft text and private source contents are neither committed nor logged.
- Any missing credential, migration drift, account ambiguity, provider failure,
  retrieval leakage, unexpected production image, failed CI or release-gate
  conflict stops deployment and is reported plainly.
- Tests also reject symlinked approved/client roots or path components,
  misclassified stable/mutable material, false personal-data review flags,
  email/phone content and unreadable stale candidates with zero mutation.
- Every published client note is Russian, has provenance and is either stable
  owner-approved EVO knowledge or has an official URL plus verification date.
- Actual internal and client vault retrieval checks pass every committed case's
  expected-path-in-top-k assertion and the machine-readable report confirms
  that neither raw nor secrets roots were searched.
- Focused tests pass, an independent reviewer approves the exact PR head, CI is
  green and the final report does not claim a live AI/provider deployment.

### P8D4I deterministic knowledge report correction

Issue #238 corrects only the deterministic knowledge report comparison used by
the production runner. Canonical bundle and manifest bytes must match exactly
across the two builds. The reports must validate as closed objects and match on
all stable fields; only their deliberately different generation time and
temporary output directory are excluded. Reports remain UUID-bearing temporary
validation artifacts and must be removed before deployment under P8D4H. This
does not add provider, production, customer-data or outbound authority.

### P8D4J merged-runner execution control

Issue #239 requires P8D4G to remain blocked after the implementation merge
until a separate reviewed control artifact binds that merged implementation's
commit, tree, exact-main CI and exact runner-file hashes. A production preflight
must additionally prove a clean checkout at current GitHub `main` with green
required checks and record the actual execution commit/tree/CI. This prevents a
later or dirty runner from claiming the earlier reviewed identity and grants no
production authority by itself.

### P8D4K live Inbox pilot fallback correction

Issue #242 corrects the pre-deployment connectivity gate discovered after the
P8D4J control merged. `inbox.evoadmissions.com` currently has no DNS record,
while the already-configured and TLS-valid EVO edge fallback
`evo-inbox.72.62.119.112.sslip.io` reaches the same Inbox application. The two
authorized draft-only staff pilot POSTs must use that exact fallback origin;
all paths, cookie handling, call limits, body-free audit verification,
side-effect checks and rollback rules remain unchanged. This correction makes
no DNS, Caddy, WAHA, Supabase, container, customer-data or candidate change.
Its merged operations hash must be rebound by a separate reviewed execution-
control metadata update before a fresh preflight or production execution.

### P8D4L Hermes preflight source-mode correction

Issue #245 records the first real P8D4G preflight's safe stop before any
provider or production mutation. The corrected preflight keeps the four secret
environment sources at exact `root:root 0600`, accepts only the observed exact
retained Compose modes (CRM `0644`, Inbox `0644`, Lead Agent `0600`), and keeps
regular-file, non-symlink, ownership, path, root-absence and candidate-tag
checks fail closed. The failed result remains preserved. A retry uses the new
collision-free release/evidence identity `2026-08-16.p8d4l.1` and release
version `p8d4l-20260816`.

No candidate, migration, knowledge, secret, Supabase, Gemini, WhatsApp/WAHA,
amoCRM, DNS, Caddy, container or autonomous-reply boundary changes. The
corrected implementation and then its separate execution-control metadata must
each be independently reviewed, merged and green on exact main before a fresh
read-only production preflight.

### P8D4M Hermes container-row protocol correction

Issue #248 records the P8D4L preflight's second safe stop. All five named
production containers were independently observed with their expected images,
healthy state and restart count zero; only the verifier failed because Docker
printed `\t` literally while the parser expected tab bytes. P8D4M uses one
closed literal `|` row protocol with behavioral coverage and advances the retry
to collision-free release ID `2026-08-16.p8d4m.1` and release version
`p8d4m-20260816`.

No application image, migration, knowledge, secret, provider, Supabase,
Gemini, WhatsApp/WAHA, amoCRM, DNS/Caddy, container or autonomous-reply
boundary changes. The verifier fix and its later execution-control rebind must
each pass independent review, merge and exact-main CI before another read-only
production preflight.

### P8D4N optional Docker image Variant correction

Issue #251 records the P8D4M staging stop. The read-only P8D4M preflight was
green, but Hermes omitted the optional Docker image `Variant` key for the exact
`linux/amd64` CRM candidate. Docker's Go template treated the missing key as an
error, so execution stopped before configuration, migrations, knowledge,
deployment or Gemini. All five running production containers remained healthy
on their prior images with restart count zero.

P8D4N parses full inspect JSON and accepts only `linux/amd64` with either an
omitted or empty variant. Any other or malformed platform remains blocking.
The P8D4M failure roots and result remain immutable. The already-loaded exact
CRM source tag may be reused only after its frozen image ID, candidate revision
and `linux/amd64` missing/empty-variant platform verify; the CRM Compose tag and
all Inbox/Lead candidate tags must remain absent. The next attempt uses
collision-free release ID `2026-08-16.p8d4n.1`, release version
`p8d4n-20260816`, and confirmation
`EXECUTE-P8D4N-2026-08-16.P8D4N.1`.

Candidate images, `001-076`, frozen 11/291 knowledge, disabled outbound state,
two staff-only draft pilots, cleanup, rollback and privacy boundaries do not
change. Implementation and its separate execution-control metadata must pass
independent review, merge and exact-main CI before another read-only preflight.

### P8D4O Hermes runtime image identity correction

Issue #254 records the safe P8D4N preflight stop. No staging, configuration,
migration, knowledge import, Gemini call, application deployment, WhatsApp
send or amoCRM write occurred. All five production containers remain on the
prior exact images, healthy, with restart count zero.

The immutable portable identity contains two distinct identities per image:
the OCI index digest used by OrbStack/archive provenance and the selected
`linux/amd64` platform-manifest digest used as Docker's runtime image ID on
Hermes. P8D4O keeps both and checks them at their actual boundaries. Archive
evidence remains bound to the OCI index; Hermes tag/container/importer/deploy
evidence is bound to CRM `34c0f380...`, Inbox `dfc1aae9...`, and Lead Agent
`a50289ff...`. Revision, platform, tag absence, rollback and disabled-state
checks remain mandatory.

The prior P8D4N local failure result is immutable. The next collision-free
identity is release ID `2026-08-16.p8d4o.1`, release version
`p8d4o-20260816`, and confirmation
`EXECUTE-P8D4O-2026-08-16.P8D4O.1`. Implementation and its separate
execution-control metadata must pass independent review, merge and exact-main
CI before another fresh read-only preflight.

### P8D4P named non-root importer correction

Issue #257 records the real P8D4O `knowledge_failed` stop. The exact 11-client
and 291-internal production-account bundles rebuild twice with byte-identical
frozen hashes, so neither the live account identity nor the knowledge vault is
the failure. The isolated Inbox importer was created from exact runtime image
`sha256:dfc1aae9743e2b6bf6d7e174933c36cd89e03e5d769b859f2aaaa557a7a68af3`,
but Docker reports its configured user as the Dockerfile name `nextjs`; the
adapter incorrectly required the literal string `1001`.
That image creates `nextjs:nodejs` with UID/GID `1001:1001` before switching to
`USER nextjs`.

P8D4P must verify both layers: exact `.Config.User=nextjs`, then an actual
container command proving username `nextjs`, UID `1001`, GID `1001`, and a
non-root process. Empty, numeric-only, root, wrong-name, wrong-UID/GID, command
failure, wrong image, platform or revision all fail closed before bundle copy.

P8D4O staging left the exact source and Compose tags for CRM, Inbox and Lead
Agent on Hermes while all running application containers remained unchanged.
P8D4P therefore requires one exact inventory record for each of those six tags,
full image/revision/platform validation, and performs no image load or retag.
It still transfers and verifies the four reviewed portable artifacts under its
new absent release root so the new result remains independently auditable.

The P8D4O local and Hermes failure results remain immutable at SHA-256
`35720cbdc88a9d4407d734c62a10f75f31dcaa6b58d88675a9a25587e1b87ce0`.
The retry uses release ID `2026-08-16.p8d4p.1`, release version
`p8d4p-20260816`, importer name `evo-p8d4p-knowledge-import`, and confirmation
`EXECUTE-P8D4P-2026-08-16.P8D4P.1`. A separate execution-control rebind and
fresh successful preflight are mandatory before requesting the new action-time
confirmation.

### P8D4Q bounded knowledge transfer retry

Issue #260 records the real P8D4P stop. P8D4P completed preflight, exact
candidate staging, rollback capture, disabled configuration and a verified
`001-076` migration no-op. It also resolved exactly one active production
account, rebuilt both frozen 11/291 audiences twice, and verified the isolated
`nextjs|1001|1001` importer. The first client knowledge `scp` failed before a
remote audience pair was recorded. Finally-style cleanup removed every created
local bundle root and the importer; no database import, deployment, restart,
Gemini pilot, WhatsApp send or amoCRM write occurred.

A later read-only diagnostic repeated the real client build and the same two
SSH/SCP transfers without importing. Both remote hashes matched the locally
built bytes and cleanup verified absence. P8D4Q therefore changes only that
transport seam: each of the four unchanged knowledge bundle/manifest `scp`
operations may be attempted at most three times, within the existing operation
deadline. The source path, destination path and bytes cannot change between
attempts. The existing remote and container SHA-256 comparisons remain
mandatory before either import.

The immutable P8D4P evidence remains retained. The retry uses release ID
`2026-08-17.p8d4q.1`, release version `p8d4q-20260817`, importer
`evo-p8d4q-knowledge-import`, and confirmation
`EXECUTE-P8D4Q-2026-08-17.P8D4Q.1`. Independent review, merge, exact-main CI,
a separate reviewed execution-control rebind, fresh successful preflight and
new action-time confirmation are required before execution. No provider,
deployment, send, customer-data, credential or knowledge-content authority is
added.

### P8D4R time-spaced knowledge transfer retry

Issue #267 records the real P8D4Q stop. The run verified preflight, exact
candidate staging, rollback capture, disabled configuration and the
`001-076` migration no-op, then stopped with `knowledge_failed`. Cleanup
removed all four local build roots and the isolated importer. No complete
remote audience pair, database import, application deployment, restart,
Gemini pilot, WhatsApp send or amoCRM write occurred. Its closed local result
is retained at release identity `2026-08-17.p8d4q.1` with SHA-256
`233d69ad88664500354be880e328a1618dffbd646085c08a1f5cb28f4064e90a`.

The later bounded transfer-only diagnostic succeeded with the same live
account resolution, frozen client input, builder, SSH route and exact remote
hash checks, then removed every diagnostic artifact. This proves that a later
transfer can succeed; it does not prove an import or deployment. P8D4R keeps
the same maximum of three attempts per bundle or manifest, but schedules them
at 0, 10 and 40 seconds from the start of that file's transfer sequence. Before
each attempt it recomputes the source SHA-256 and the remaining authorization
time. It must stop before sleeping or copying if the next pause cannot fit, and
must recheck the deadline after the pause. Only the exact `scp` operation has
this behavior; no build, import, migration, deployment, provider or pilot call
gains retries. Node's documented promise-based timer is the implementation
primitive, while `scp` remains the same SFTP-over-SSH command whose nonzero
exit is treated as failure:
https://nodejs.org/api/timers.html#timers-promises-api and
https://man.openbsd.org/scp.1.

The retry advances to release ID `2026-08-17.p8d4r.1`, release version
`p8d4r-20260817`, importer `evo-p8d4r-knowledge-import`, and confirmation
`EXECUTE-P8D4R-2026-08-17.P8D4R.1`. P8D4Q and all prior local/Hermes release,
rollback and evidence roots remain immutable. The exact candidate, six staged
image tags, portable artifacts, 11/291 knowledge contents, `001-076` migration
boundary, disabled outbound state, two-call pilot cap, cleanup, rollback,
privacy, no-WAHA-change, no-amoCRM-write, no-autonomous-send and
no-customer-send boundaries are unchanged. Independent review, merge,
exact-main CI, a separate reviewed execution-control rebind, fresh successful
preflight and a new action-time confirmation are required before execution.

### P8D4S truthful partial knowledge failure evidence

Issue #270 records the real P8D4R stop and the independent review finding. The
P8D4R result is retained unchanged at release identity
`2026-08-17.p8d4r.1`, locally and on Hermes as a regular mode-`0600` file with
SHA-256
`9217322cf48f96daadd8ef780732b8c29cc54e9234bc4c6e2b8ecfbe4c459577`.
It truthfully proves preflight, staging, disabled configuration and the
`001-076 -> 001-076` migration no-op, plus `knowledge_failed`, verified
cleanup, no deployment and no pilot. It does not truthfully preserve partial
knowledge progress: `cleanup.local_roots_removed=4` proves both deterministic
audience build paths created their two independent roots, while
`knowledge.account_resolution`, `knowledge.deterministic_builds` and both
audiences are recorded as `not_run`.

P8D4S makes partial progress part of the closed result contract. The
production adapter reports a UUID-free snapshot after singular account
resolution, after every deterministic audience build, before each transfer
attempt and after each completed audience import. On terminal knowledge
failure the result retains only safe status, document counts, bundle/manifest
SHA-256 values already approved for evidence, a fixed failure-step enum and a
bounded attempt number when the failed step is an `scp` transfer. It never
retains the account UUID, customer/staff content, command text, stderr,
credentials, cookies, provider payloads or private filesystem paths. A
successful result still requires two fully verified database revisions and no
failure marker.

The retry advances to release ID `2026-08-17.p8d4s.1`, release version
`p8d4s-20260817`, importer `evo-p8d4s-knowledge-import`, and confirmation
`EXECUTE-P8D4S-2026-08-17.P8D4S.1`. P8D4R and all prior local/Hermes release,
rollback and evidence roots remain immutable. The exact candidate, portable
artifacts, staged image identities, frozen 11/291 knowledge, migrations
`001-076`, disabled outbound flags, cleanup, rollback, no-WAHA-change,
no-amoCRM-write, no-autonomous-send, no-customer-send and maximum two fixed
staff-only draft calls do not change.

Another production attempt remains blocked until this implementation has an
independently approved exact-head PR, merge and exact-main green CI; a separate
reviewed execution-control metadata PR is merged and green; a new real
read-only preflight passes; and the owner provides the exact new action-time
confirmation. P8D4S grants no new production, provider, customer-data,
knowledge-content, outbound or billed-resource authority.

## P8D4T transfer evidence correction

Issue #273 and Plan Block-ID
`EVO-PLATFORM-P8D4T-TRANSFER-EVIDENCE-2026-08-18` close the final two
read-only review findings before an owner token is requested. Every
client/internal bundle/manifest transfer now distinguishes four safe states:
backoff, authorization deadline, local bytes and the real `scp` attempt. Only
the real `scp` failure may retain an attempt number. The adapter publishes the
UUID-free knowledge progress projection at each retry-state boundary, so a
terminal failure retains the exact safe step rather than an inferred one.

P8D4T uses release ID `2026-08-18.p8d4t.1`, version `p8d4t-20260818`, importer
`evo-p8d4t-knowledge-import` and confirmation
`EXECUTE-P8D4T-2026-08-18.P8D4T.1`. The schema and behavioral tests pin the
new deadline enum, null attempt on every non-`scp` state and ordered progress
callbacks. P8D4S preflight SHA-256
`27bcb7e425b991051c462523414c46091f960f90abe8155cba5beadabbfc3a26`
and every earlier artifact remain immutable.

Candidate images, `001-076`, frozen 11/291 knowledge, disabled outbound state,
cleanup, reverse rollback, maximum two staff-only draft calls, no WAHA change,
no amoCRM access and no customer send remain unchanged. Implementation review,
merge, exact-main CI, a separate execution-control rebind, fresh read-only
preflight, process-only staff-session verification and a new owner token remain
mandatory before execution.

## P8U1 root-owned staff knowledge seam

Issue #278 implements the first repository block under the merged P8U private
single-UI contract. The root CRM owns one protected
`POST /api/platform-ai/staff-assistant` seam for the reviewed `client` and
`internal` audiences and packages the deterministic knowledge importer in the
root candidate. It does not copy, proxy or expose the companion UI.

Auth activation remains deferred, not bypassed. Anonymous, invalid, Finance and
Student actors fail before repository/provider access; only Admin, Sales and
Curator may use the future configured route. Exact organization-to-knowledge
account binding is server-owned, never supplied by a browser. Missing or
conflicting configuration fails closed.

The future enabling set is exact and deliberately absent now: public Supabase
URL plus publishable key for the existing request-scoped Auth client, separate
server secret for knowledge/audit access, configured Platform organization and
knowledge account UUIDs, the Gemini server key and the sole `=1` feature flag.
P8U1 freezes a `65,536`-byte request, `20` turns, `4,000` bytes per text,
`32,000` transcript bytes, five lexical matches, `12,000` excerpt bytes,
`60,000` prompt bytes, a `15,000` ms single Gemini call and `2,048` output
tokens. Success and error bodies are closed; no runtime choice remains.

Retrieval stays audience-scoped and source-bound. A Gemini response remains a
staff-triggered draft, is returned only after body-free immutable audit
storage, and has no send, WAHA, amoCRM, memory-write or autonomous authority.
The root importer preserves the reviewed canonical bundle/manifest/account
contract, materializes 1536-dimensional `gemini-embedding-2` vectors before one
atomic sync RPC, and prints only the UUID-free safe result projection. It
requires the CLI account to equal `EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID` and caps
work before Gemini at 16 MiB bundle, 16 KiB manifest, 512 documents, 256 KiB
per document, 12 MiB total content and 8,000 chunks.

P8U1 is repository-only. Tests inject local seams and make no provider or
production calls. Independent exact-head review, 4/4 CI, merge and exact-main
CI are mandatory before P8U2 may build the private `linux/amd64` candidate.

## P8U2 private root candidate

Issue #280 and `docs/platform/p8u2-private-root-candidate.md` freeze the next
repository/local-only block. The application identity is P8U1 merge
`b798c7d36be8e3325a9621d96e496ec0a2bb624f`, tree
`eb3a8a863e014606e707bd279f67d9194663e30a`, parent
`42dc877b6ce3a2c5c8f7f42c6adc192399322d07`, with successful exact-main CI
`32072948258`. P8U2 produces exactly one private root image tagged
`evo-crm:b798c7d36be8e3325a9621d96e496ec0a2bb624f-p8u2-linux-amd64` on OrbStack.

The reviewed runner must prove exact `linux/amd64` identity, OCI labels,
non-root execution, a fresh image-bound SPDX SBOM, network-none liveness and
the exact `503 assistant_disabled` staff-route response with Auth and enabling
configuration absent. All evidence stays under a new local mode-`0700` ignored
root with a closed result schema and mode-`0600` files. Provider credentials,
customer data and external networks are absent.

P8U2 stops after independent evidence review. It does not transfer, route,
deploy or expose the image and does not mutate production or providers. Later
Auth activation still requires real Supabase URL/publishable key, authority,
sign-in, RLS/object-scope, refresh and logout proof, followed by a separate
release contract, fresh preflight and owner token.

## P8U3 canonical SPDX namespace correction

Issue #282 and `docs/platform/p8u3-spdx-namespace-correction.md` preserve the
failed P8U2 evidence and local image unchanged. The sole observed blocker was
the standard Syft UUID in top-level SPDX `documentNamespace`; no secret,
contact, private path, provider, database or production effect occurred.

P8U3 adds only an exact image-bound namespace exception while retaining the
untouched credential/private-path scan and rejecting every other or duplicate
UUID. A collision-free P8U3 tag/container/evidence root permits one new private
OrbStack build only after review, merge and exact-main CI. All no-Auth,
network-none, no-provider and no-production boundaries remain unchanged.

## P8U4 root staff-assistant proxy correction

Issue #284 and `docs/platform/p8u4-root-assistant-proxy.md` preserve the
immutable P8U2 and P8U3 stopped attempts. P8U3 proved that the reviewed route
handler was unreachable in the real candidate because the root proxy returned
the generic disconnected-API `403` before the handler could return its exact
disabled `503` contract.

P8U4A connects only `/api/platform-ai/staff-assistant` to its existing repeated
configuration, same-origin, actor, role, organization, retrieval, provider and
audit checks. Auth and the enable flag remain absent, so the expected behavior
is still fail-closed before actor, database or provider work. Descendants,
siblings and every unrelated disconnected API stay blocked.

P8U4A is repository-only. After its independently reviewed merge and green
exact-main CI, a separate P8U4B contract must freeze the new application
commit/tree/parent/CI and collision-free local candidate identities. Only then
may one new private OrbStack `linux/amd64` candidate attempt run. No production,
provider, customer-data, import, routing, Auth activation or deployment
authority is granted.

P8U4A is now merged as `93d07740e15b05067af31b4aa03c865b6b1cebda`,
tree `6ef0aea5eedaa26bd4d7de857bfa9bee9ff4e888`, parent
`a63236838964542f712639aae83597747fee639f`, with successful exact-main CI
`32081894062`. P8U4B freezes that exact application source and a new private
tag/version/container/evidence root. It must verify the immutable P8U2 and
P8U3 roots, file hashes, tags and image IDs before and after every effect.

The one permitted post-merge P8U4B attempt remains local to OrbStack, builds
`linux/amd64`, uses immutable-image SBOM and network-none UID/GID-1001 smoke,
and proves `/api/health` plus exact `503 assistant_disabled`. It does not enable
Auth, import knowledge, call Gemini, transfer or deploy an image, change public
routing, access customer data, or mutate Supabase, WAHA, WhatsApp or amoCRM.
Smoke injects only the exact P7B observability enabled flag and a fresh random
process-only HMAC required for startup; the HMAC is never retained, and all
staff-assistant/Supabase/Gemini/WAHA/amoCRM settings remain absent.

## P8U single-UI private preparation

Issue #276 and `docs/platform/p8u-single-ui-private-preparation.md` supersede
P8D4T as the active next block. The owner deferred Auth activation and asked to
prepare the product first. Preparation means repository implementation and a
private candidate; it does not mean a public unauthenticated CRM.

The accepted root EVO CRM remains the sole Platform UI. P8U ports only the
remaining staff knowledge-assistant/importer capability still owned by the EVO
Inbox companion into the root Platform boundary, then builds a private
`linux/amd64` root candidate. It does not embed, proxy or revive the companion
as a second UI. The current public CRM, companion Inbox, Lead Agent, WAHA,
amoCRM, managed Supabase data, knowledge revisions, Gemini and outbound state
remain unchanged.

P8D4T's preflight is retained as no-effect evidence, but its action-time token
is retired because the candidate and release contract change. A later Auth
block must configure and prove the real Supabase sign-in/authority/RLS path.
Only a new reviewed release contract, fresh preflight and new owner token may
then authorize production mutation.

## P8V v1 production closure

Issue #287 and `docs/platform/p8v-v1-production-closure.md` supersede local-only
P8U preparation as the active rollout contract. The read-only baseline confirms
that repository capability is substantially ahead of Hermes: production CRM,
Inbox and Lead Agent images are old; root Platform/Auth/Gemini configuration is
absent; managed knowledge is only 2 internal documents / 26 chunks with no
bundle revision or assistant audit; amoCRM has no runtime token; and the
durable manual-send authorization has no real sending worker.

P8V closes the engine first, then freezes production artifacts/config/rollback,
deploys one application boundary at a time and finally proves the real staff
journey. The frozen public seams preserve Lead-Agent-owned WAHA intake with
amoCRM-first identity and signed CRM sync, durable manual-send execution,
protected staff-assistant HTTP route, authenticated browser workflow and
redacted reconciliation evidence. The only manual-send trigger owner is the
private `evo-crm-manual-send-worker` Compose service from the reviewed CRM
image: one in-flight claim, five-second cadence, ten-second route deadline,
thirty-second heartbeat health and a dedicated process-only HMAC. Pre-route
transport failure affects only sidecar health; the CRM transaction alone owns
durable claim/lease state, and a lost response is recovered through lease
expiry plus reconciliation. Real services are mandatory for live
claims; an unavailable independent boundary is recorded and skipped rather
than replaced by a mock or weakened credential contract.

The start identity is main `8dfeb7b8cc85588b1d886e61fb843a14122f5b16`,
tree `879c9fcdedca442c1bad750ae485f850aa8c5e90`, parent
`93d07740e15b05067af31b4aa03c865b6b1cebda`, exact-main CI
`32084838298`. P8U4 evidence remains immutable preparation evidence. Every P8V
implementation/release block still requires independent PR review, exact-head
and exact-main CI, closed evidence, safe rollback and a fresh action-time
production gate. Autonomous/customer sending remains disabled; only one later
owner-approved non-customer manual-send proof is in scope. Production authority
remains closed until the exact four P8V Draft 2020-12 result schemas and runtime
validators merge; success requires complete ordered records, while blocked or
failed evidence permits only a truthful prefix with no later effects.

### P8V2 exact production-preparation slice

Issue #290 advances only Block V2 from the merged core-engine application
commit `0f1454d014bbc9eca9d7381dfe557e980965543e`, tree
`19599bcf043dc4a555c8996c21e7801934b64633`, parent
`a7c589c2c735d4ef2d15ab5153eb07dba07d6286`, and exact-main push run
`32093566626`. The three immutable local linux/amd64 source tags are
`evo-crm:0f1454d014bbc9eca9d7381dfe557e980965543e-linux-amd64`,
`evo-inbox:0f1454d014bbc9eca9d7381dfe557e980965543e-linux-amd64`, and
`evo-lead-agent:0f1454d014bbc9eca9d7381dfe557e980965543e-linux-amd64`. Their image,
OCI-index and platform-manifest identities are observed only after the reviewed
OrbStack build and then frozen into the implementation/result schema.

V2 preserves the five current production containers and seven exact
Compose/env sources recorded in the active P8V contract. It prepares three
portable archives, rollback/config capture, migration/config identity proof,
and deterministic production-account-bound bundles from the unchanged
11-client/291-internal vaults. A missing current credential or singular
account/organization proof blocks only the dependent record; independent image,
rollback and vault-integrity work continues and is retained as component
evidence. The final V2 result is `preparation_verified` only when every ordered
record, including final evidence publication, is verified. A normal prerequisite
gap is `preparation_blocked`; an atomic-write, privacy, graph or cleanup failure
is the distinct `evidence_failed` result. Both are truthful prefixes, contain no
later effect, and grant no V3 authority.

The observed production configuration does not currently satisfy the new
Platform contract: root CRM lacks the new publishable/secret Supabase keys,
organization/account, Gemini, staff-assistant and worker settings, and Lead
Agent lacks its configured amoCRM token file/OAuth refresh material. Legacy
anon/service-role JWTs are not substituted. V2 may prove and report these
absences but may not create, rotate, print or weaken credentials. There is no
image transfer, database migration/import, provider call, container change,
restart, WAHA/amoCRM mutation, customer send or public-route change in V2.

### P8V2 final frozen-vault path correction

Issue #294 corrects the local source binding before the first V2 execution.
The obsolete `EVO_Knowledge_Vault` paths are not valid inputs. The exact
read-only frozen sources are:

- client: `/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Клиентская база знаний ЭВО` (11 Markdown documents);
- internal: `/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Внутренняя база знаний ЭВО/Утверждено для внутреннего ИИ` (291 Markdown documents).

Each source must be a real non-symlink directory and must pass the existing
canonical `.evo-vault.json`, path, PII and forbidden-root checks before any
bundle is accepted. The vaults remain read-only. This correction changes no
candidate, evidence, authorization, production, provider or rollout identity;
the merged P8V2 preparation token remains unconsumed until the correction is
reviewed, merged and green on current main.

### P8V2 executable CLI import correction

The first exact-main P8V2 invocation on `2a34408d115fa1daa94b85c5b419e453d73a18d5`
stopped before any preparation operation because the executable module
dynamically imported the operations module while that module imported the
still-evaluating preparation library. Node reported an unsettled top-level
await. No evidence root, candidate tag, Docker build, SSH call, provider call,
database call, migration, knowledge import, deployment, restart, WAHA action,
amoCRM action or customer-data action occurred; the P8V2 preparation
authorization is unconsumed.

Issue #296 separates the executable CLI from the pure preparation library and
keeps the existing `npm run p8v2:prepare -- --application-root <path>` operator
interface. The CLI statically imports the acyclic library and operations graph.
A real child-process negative must prove missing authorization returns the
closed `p8v2_failed:operation_failed` result with exit status `2` and never
emits the unsettled-await warning. The correction must pass independent review,
exact-head CI, merge and exact-main CI before the same collision-free P8V2
preparation may be retried. All P8V2 authority and evidence boundaries remain
unchanged.

### P8V2A nested OCI-index retry

The first effectful P8V2 preparation stopped safely at candidate-image
verification after producing only local CRM build/SBOM/smoke/archive artifacts.
The immutable failure result SHA-256 is
`c57ffdd2b572d42d52c5106f7c926dbd89596690f557e4113e45cdd494110c1b`;
no production, provider, database, knowledge, deploy, restart, WAHA, amoCRM or
customer-data operation ran.

Issue #298 corrects the portable verifier for the current Buildx archive graph:
the tagged top-level descriptor is an OCI index containing one linux/amd64 image
manifest and one exactly bound provenance attestation. The retry keeps the
frozen application and production contract but advances every writable identity
to P8V2A: release `2026-08-18.p8v2a.1`, version
`p8v2a-0f1454d0-20260818`, authorization
`PREPARE-P8V2A-2026-08-18.P8V2A.1`, `-p8v2a-linux-amd64` tags/archives,
`p8v2a-` local evidence roots and a `p8v2a-rollback-` remote root. Historical
P8V2 evidence and its CRM tag remain immutable. Retry requires independent
review, merge, exact-main green CI and a fresh exact owner token.

### P8V2B bounded Lead Agent smoke readiness retry

The exact P8V2A preparation on merged main
`df29599da8ca7f85354f233c6333d5e018d94977` stopped safely in
`candidate_images` with result SHA-256
`cc902099b2864327897ca278d656f5180c81235cfb0b71f2b1ffb0b5a6401acc`.
All three local images built; CRM and Inbox completed smoke, SBOM and archive;
Lead Agent completed build and SBOM but stopped before smoke/archive. Production
baseline, SSH, migration, identity resolution, knowledge build/import, provider,
deployment, restart, WAHA, amoCRM and customer-data operations were `not_run`.
Every P8V2A root, artifact and tag is immutable.

A real isolated diagnostic against the retained immutable Lead Agent image
proved that the image is healthy but its HTTP process is not ready at the
runner's immediate first probe. It returned the exact frozen response after
approximately one second. Issue #300 changes only the release-tool readiness
seam: Lead Agent smoke polls at most 30 times, waits 500 milliseconds between
failed attempts, and accepts only HTTP 200 with exact JSON
`{"frozen":true,"ok":true,"ready":false,"status":"live"}`. Each probe has a
one-second request timeout. Any response drift, container exit, deadline
exhaustion, Docker/context drift, restart, ownership drift or cleanup failure
remains blocking. CRM and Inbox retain their existing exact smoke contract.

P8V2B is collision-free: release `2026-08-18.p8v2b.1`, image version
`p8v2b-0f1454d0-20260818`, authorization
`PREPARE-P8V2B-2026-08-18.P8V2B.1`, tags/archives suffixed
`-p8v2b-linux-amd64`, local roots prefixed `p8v2b-`, and remote rollback root
prefixed `p8v2b-rollback-`. It adds no production/provider/import/deployment
authority. Retry requires reviewed implementation, exact-head CI, merge,
exact-main CI and a fresh exact owner token.

### V2.6 P8V2C read-only production-baseline template correction

P8V2B retained all three verified local candidates but stopped before any
production effect. Its immutable mode-0600 result SHA-256 is
`855ed075be872550322d273f9fb36da0dffccec39b9331e921579e704399779d`.
The five real production containers still match their exact frozen IDs/images,
are healthy, and have restart count zero. The blocker is solely the invalid
read-only Docker Go template used to collect those rows.

P8V2C replaces that template with Docker's supported inline `if/else/end`
actions. One shared producer renders the byte-checked production command and a
real local five-container OrbStack fixture in canonical order. One guarded
executor checks OrbStack `Running` and context exactly `orbstack` immediately
before every Docker command, including cleanup; no fallback is allowed.
Fixtures use collision-free names, a cryptographic owner label, one already-present immutable
image ID, no network/mount/restart/pull, and verified-ID finally cleanup with
foreign-name refusal and absence proof. It advances every writable retry
identity to `p8v2c` / `2026-08-18.p8v2c.1` /
`PREPARE-P8V2C-2026-08-18.P8V2C.1`; P8V2B evidence remains immutable. It
changes no application candidate, production boundary, provider permission or
deployment authority. A retry is blocked until implementation review, exact-head
CI, merge, exact-main CI and the new exact token required after this code change.

### V2.7 P8V2D CRM/Inbox smoke readiness correction

P8V2C retained fail-closed result SHA-256
`b22ab4614f893a0577d42976612e00cc4b74466886d27c31cf49f03d41642c2a`.
It stopped during candidate images before any production baseline or later
phase. The exact Inbox image subsequently passed six real OrbStack smoke
starts, proving an initial cold-start timing defect in the single immediate
CRM/Inbox health probe.

P8V2D keeps the exact health response contract and adds at most 30 probes with
a one-second request timeout and 500-millisecond waits only for the explicit
transient connection/startup result. Exact owned container/image/running state
is rechecked before every probe. Wrong HTTP/JSON, exit, identity, ownership,
restart, OrbStack/context, exhaustion or cleanup drift stays fail-closed. All
writable retry identities advance to `p8v2d` /
`2026-08-18.p8v2d.1` / `PREPARE-P8V2D-2026-08-18.P8V2D.1`; P8V2C evidence is
immutable. No production/provider/import/deployment authority is added.

### V2.8 P8V2E independent-readiness supplement

P8V2E preserves the immutable P8V2D result SHA-256
`a050cd16b1d48fa089031bc3a4240b8e55f3b492c89addc7376d8016de5e63b7`,
all P8V2D roots/tags and the Hermes rollback root. It performs no candidate
build, smoke, SBOM, archive, rollback capture or production effect.

The supplement closes the P8V2D evidence gap with four independent read-only
records: exact retained-result validation; UUID-free source-vault validation
for frozen client `11` / source-set SHA
`c8dcfdd7911fdf2b97204c5d843dbf45f701d5dbee72e78cfaea17ea7ab18689`
and internal `291` / source-set SHA
`1bd7458ff70c0a31fde9f6bb1abfb7ec0152c1f286caf2a1de48081860121f9f`;
schema-qualified bounded identity observation through the Supabase Management
API read-only SQL endpoint; and UUID/value-free configuration observation.
Missing identity or settings remain blockers, but cannot suppress independent
vault/configuration evidence. No account-bound bundle is built unless the live
account is singular; no identity is invented.

Source-set bytes are the source-path-sorted array of exact
`{source_path,source_sha256}` records, using NFC POSIX-relative paths,
lexicographically sorted keys, UTF-8 JSON with `ensure_ascii=false`, compact
comma/colon separators and one final LF. Management API verification requires
separate exact-project HTTP 200/`ACTIVE_HEALTHY` and read-only-query HTTP 201
responses. The bounded official project object is validated through exact
`ref` and `status` fields; unrelated official fields are ignored. Any singular
UUID reaches Hermes only through bounded three-line SSH stdin to one fixed
`bash -seu` command; output/evidence remains UUID-free. Malformed/duplicate env
input, unsafe amoCRM token files and remote transport/parse failure have closed
blockers. Retained-result,
source-vault, identity/project and configuration drift each has a closed
`readiness_blocked` code; only unsafe result publication/removal is
`evidence_failed`.

The only writable path is a new local mode-`0700`
`p8v2e-readiness-0f1454d014bbc9eca9d7381dfe557e980965543e-20260818`
root containing one closed-schema mode-`0600` result. Authorization is exactly
`PREPARE-P8V2E-2026-08-18.P8V2E.1`. It grants no Docker, SSH write, migration,
import, provider, deployment, restart, WAHA/amoCRM, outbound, Auth or
customer-data effect. After reviewed merge and exact-main CI, one P8V2E run may
precede the single minimal production preflight and one deployment-plus-rollback
authorization.

### V2.9 P8V2F Supabase connection and first-organization bootstrap

The reviewed P8V2E result and a fresh 2026-08-19 read-only audit establish one
healthy managed project, one Auth user, one active knowledge account, zero
Platform organizations, a contiguous production ledger through `076`, and a
Data API configuration that exposes only `public,graphql_public`. Hermes has a
real root-owned mode-`0600` `/opt/evo-crm/.env.production`, but none of the
Platform Supabase settings are present. This is a missing Platform connection,
not a reason to create or migrate to a second Supabase project.

P8V2F is one bounded configuration operation. It may add `platform` to the
existing PostgREST exposed-schema set while preserving `public` and
`graphql_public`; call the existing service-role-only,
advisory-lock/idempotency/audit protected
`platform.bootstrap_organization_admin` routine exactly once for organization
name `EVO Admissions` and the singular existing Auth user; and atomically add
only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`EVO_PLATFORM_SUPABASE_SECRET_KEY`, `EVO_PLATFORM_ORGANIZATION_ID`, and
`EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID` to the existing Hermes CRM environment.
The secret and both UUIDs are process-only and enter Hermes only through SSH
stdin. They never enter argv, stdout, stderr, Git, PR text or retained safe
evidence.

Before effects, require exact project health, exact pre-state cardinalities,
exact `001-076` migration ledger, exact current PostgREST configuration, valid
new-format publishable/secret keys, successful bounded project-URL probes for
both keys, and a safe Hermes environment source. Every HTTP body is streamed
under its fixed byte ceiling rather than buffered before the limit. The
remote write first captures the exact original environment in a new
Hermes-only root-owned mode-`0700` rollback root, then uses a temporary regular
mode-`0600` file plus atomic rename and verifies exact values in process. A
remote write failure restores and verifies the original bytes. P8V2F does not
apply migration `077`, import knowledge, deploy/restart a container, enable the
staff assistant, enable manual-send/lead-sync/autonomous behavior, call Gemini,
touch WAHA/amoCRM, or send customer/outbound data.

Post-state must prove one active `EVO Admissions` organization, one Admin
membership linked to the same singular Auth user, one bootstrap audit event,
one active knowledge account, `platform` Data API access through the secret
server key by deterministic replay of the service-role-granted bootstrap RPC,
unchanged `001-076` migration ledger, and the five exact Hermes
settings. Evidence is one closed-schema, UUID/secret/private-path-free JSON in
a new local mode-`0700` root with a regular mode-`0600` result. Failure after
the database bootstrap is reconciliation-required rather than destructive
database rollback. The exact action-time token is
`CONFIGURE-P8V2F-2026-08-19.P8V2F.1`; implementation review, exact-head CI,
merge and exact-main green CI must precede its use.

An exact already-prepared database state is a supported reconciliation entry:
the runner revalidates the same Auth user, account, organization, Admin,
bootstrap audit and deterministic RPC result, skips the PostgREST patch and
creation effect, then completes or verifies Hermes and evidence. The rollback
copy must reconstruct the current configured environment exactly when the five
target settings are reapplied; any tamper or failed read-back restoration is
blocking. Publication failure is a distinct `evidence_failed` terminal attempt,
not a configuration success or a swallowed error.

### P8V2G — bounded PostgREST readiness correction

The first authorized P8V2F attempt is complete and failed closed. Preserve its
exact result SHA-256
`706dc7f9cdfb88b383a0e6e3314925bfdec7fe741f74acbfcbb700fdb7eddf6c`,
its local and remote roots, and its consumed token. The retained result and
fresh read-only checks prove the old exposed schemas were restored and no
database identity, Hermes setting, migration, import, deployment, restart,
provider or outbound effect occurred. Supabase logs show the only runtime
blocker: the first Platform RPC received HTTP `406` while the newly accepted
schema exposure had not yet propagated to PostgREST.

P8V2G adds no feature and changes no production target. After the official
Management API returns the exact requested schema set, the bootstrap seam may
make at most 12 byte-identical deterministic RPC attempts under one 30-second
readiness deadline, waiting exactly 1 second only after a bounded valid JSON
HTTP `406` whose exact PostgREST code is `PGRST106`. No other status/code,
malformed/oversized body, timeout or transport error is retryable. Every such
failure immediately enters the existing potentially-committed readback before
any restoration. Exhaustion is blocking and cannot reach Hermes.

All writable identities advance to collision-free P8V2G values, including
authorization `CONFIGURE-P8V2G-2026-08-19.P8V2G.1` and new local/remote result
roots. Issue #309, behavioral negative coverage, independent review,
exact-head and exact-main green CI, and a final read-only preflight must precede
the new owner token. P8V2G retains P8V2F's singular Auth/account checks,
`EVO Admissions` application organization, migration `001-076`/pending `077`,
project-key probes, process-only UUID/secrets, Hermes atomic write/rollback,
closed evidence and zero unrelated effects.

## P8V2H: explicit PostgREST reload

P8V2G is an immutable failed attempt with result SHA-256
`63049414f61ba895e20ebf5900d2badcf0b306635f574fad7fddb77aebc89514`.
Independent review proves restored original schema exposure, zero Platform
identity rows, zero Hermes settings and zero unrelated effects. Its token is
consumed.

P8V2H adds one fixed cache-reload operation after every successful PostgREST
schema PATCH: official Management API `POST /v1/projects/{ref}/database/query`
with exact parameter-free SQL `NOTIFY pgrst, 'reload config'; NOTIFY pgrst,
'reload schema';` and exact `read_only: false`. Only bounded valid JSON HTTP
`201` is accepted. No caller-supplied SQL or additional statement is possible.
The reload must complete before the first deterministic bootstrap RPC attempt.
When zero-state rollback restores `public,graphql_public`, the same fixed reload
must complete before restoration is reported.

All P8V2G request-byte, PGRST106-only retry, deadline, ambiguous-response
readback, prepared-state replay, Hermes rollback, evidence, privacy and
zero-unrelated-effect boundaries remain. P8V2H advances only collision-prone
version/token/evidence/temp identities to `p8v2h` and requires issue #312,
independent review, exact-head/exact-main green CI and a fresh read-only
preflight before the exact token `CONFIGURE-P8V2H-2026-08-19.P8V2H.1` may be
requested.

## P8V3: one-boundary first-version production rollout

Tracking issue: #314.

P8V3 deploys the already reviewed application candidate
`0f1454d014bbc9eca9d7381dfe557e980965543e` without rebuilding it. One
temporary 30-minute preflight verifies the exact three portable archives and
their OCI index/platform identities, exact candidate Compose rendering on
OrbStack, required production secret names without values, production ledger
`001-076`, five exact healthy zero-restart containers, network/disk readiness
and the exact retained P8V2D rollback collection. The rollout retains the
preflight SHA-256 and requires identical execution commit/tree/CI plus
unchanged volatile container/ledger state before its first effect.

One 90-minute authorization `EXECUTE-P8V3-2026-08-20.P8V3.1` covers ordered
configuration installation and rollback, migration `077`, deterministic
11-client then 291-internal knowledge publication, knowledge-artifact cleanup,
and one-at-a-time CRM, Inbox and Lead Agent recreation. CRM includes the
manual-send worker; Inbox supplies the audited staff knowledge route; Lead
Agent keeps autonomous reply and outbound disabled. Both WAHA containers must
retain their exact container/image identities and are never recreated,
restarted or reconfigured.

The account UUID is resolved singularly and remains process-only except for
the immutable importer's transient matching `--account-id` process argument.
The two allowed Gemini embedding operations contain only frozen approved
knowledge; no applicant/customer content, staff draft call, amoCRM write,
WhatsApp send or WAHA mutation is authorized. UUID-bearing local, remote and
container knowledge artifacts are finally-cleaned before CRM deployment and
on every failure path.

A failed application boundary is included with all earlier attempted
boundaries in reverse rollback. Configuration is restored before old
application Compose is recreated from exact retained config/image bytes.
Migration `077` and completed knowledge imports are forward-only and make
later failures reconciliation-required even when application rollback
succeeds. A lost migration response with exact ledger readback `001-077` is
retained as `observed_applied`, never `not_run`. The single final result is
closed-schema, UUID-free, secret-free and
uses only `rollout_verified`, `rollout_failed_rolled_back`,
`rollout_failed_reconciliation_required`, or `evidence_failed`. Real login,
WhatsApp intake, amoCRM binding, retrieval/draft, manual approval/send, ACK and
audit verification belong to the post-deploy V4 staff proof.

### P8V3A final-preflight Compose env correction

The first final P8V3 preflight made no production or provider change and
stopped during disposable local candidate Compose validation. The validator
did not bind the Compose selector for the newly reviewed manual-send worker,
so Compose searched the archived application tree for the intentionally absent
default `.env.manual-send-worker`.

The only authorized correction is to add a disposable regular mode-`0600`
validation env for that service and pass its path through exact variable
`EVO_CRM_MANUAL_SEND_WORKER_ENV_FILE`, alongside the existing five validation
env selectors. The file carries only the inert local validation marker and is
removed with the existing temporary validation directory in the same
finally-style cleanup. All P8V3 candidate identities, release effects,
rollback rules and the exact owner authorization remain unchanged. A fresh
read-only preflight after reviewed merge and exact-main green CI is mandatory.

### P8V3B inert Inbox Compose build-value correction

The next fresh preflight also made no production or provider change and stopped
during disposable local candidate Compose validation. After P8V3A supplied the
manual-worker env selector, the archived Inbox Compose reached its required
public build-variable checks and correctly rejected the empty disposable env.

The only authorized correction is to populate the disposable mode-`0600`
Inbox validation env with fixed inert non-secret values for
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`NEXT_PUBLIC_SITE_URL`. The URLs use the reserved `.invalid` domain and the key
is an explicit non-credential sentinel. They are used only by local
`docker compose config -q`, are removed in the existing finally path, and may
never be used to build, run, deploy, reach Supabase, or enter evidence. All
P8V3 candidate identities, release effects, rollback rules and the exact owner
authorization remain unchanged. A fresh read-only preflight after reviewed
merge and exact-main green CI is mandatory.

### P8V3C canonical production container-name correction

The next fresh preflight also stopped before every release effect. Its remote
read-only inventory confirmed the exact expected images, networks, healthy
states and zero restart counts, but Docker inspect rendered `.Name` with its
API-leading slash while the closed verifier correctly expected the canonical
unprefixed Compose container name.

The only authorized correction is for the inventory producer to emit the
already fixed shell-loop name as the first field and use Docker inspect only
for the immutable container ID, image ID, health, restart count and networks.
The parser remains strict and must reject slash-prefixed or otherwise drifted
names. All candidate identities, production effects, rollback rules, provider
boundaries and the exact owner authorization remain unchanged. A fresh
read-only preflight after reviewed merge and exact-main green CI is mandatory.
### P8V3D — resume from the forward-only migration-077 boundary

The first P8V3 execution is immutable failed-attempt evidence at SHA-256
`d38283828f3b2d51c063e85617b6732be7a2a44f4cb00bd36d2aaa8051467db7`.
Production reconciliation proves migration ledger `001-077`/count `77`, the
original five containers healthy with restart count zero, restored CRM
configuration, no release root, no imports and no deployment/provider effects.
The retained rollback root `/opt/evo-release-rollback/2026-08-20.p8v3.1` is
preserved byte-for-byte.

P8V3D corrects only the validator/reconciliation seam. A fresh preflight must
accept exactly `001-077`. The rollout migration step is a read-only verified
no-op: it revalidates the exact contiguous ledger and migration-077 database
objects/grants and records before/after `001-077`, count `77`, with no applied
version. It must not run Supabase link, dry-run, push, SQL, or migration repair.
All later import, cleanup, deployment, rollback and safety boundaries are the
same as P8V3.

The collision-free runtime identity is release `2026-08-20.p8v3d.1`, version
`p8v3d-0f1454d0-20260820`, importer `evo-p8v3d-knowledge-import`, evidence root
`/opt/evo-release-evidence/p8v3d-20260820.1`, and final result
`p8v3d-rollout-result.json`. After reviewed merge, final CI and one fresh
preflight, the only valid new owner authorization is
`EXECUTE-P8V3D-2026-08-20.P8V3D.1`. The old P8V3 token is consumed.

### P8V3E — public knowledge schema and idempotent pre-stage cleanup

The P8V3D execution stopped at `client_import` with immutable result SHA-256
`d6c7174de9a56d53e9c30d498a1423cb3ad698869c1845155934d826fa90cfc3`.
Read-only reconciliation proves no client revision/document/chunk was written,
configuration was restored, staging/importer are absent, the migration ledger
remains exact `001-077`, and all five production containers are unchanged and
healthy with restart count zero.

P8V3E corrects only two coupled seams. Account resolution and bundle-revision
verification use exact PostgREST schema `public`, matching migrations 029 and
074. Cleanup treats an absent not-yet-created staging directory/importer as
verified clean, while continuing to block every unsafe replacement, remnant or
removal failure. Behavioral tests bind the exact request profile and the
pre-stage failure cleanup.

The retry advances to release `2026-08-20.p8v3e.1`, version
`p8v3e-0f1454d0-20260820`, importer `evo-p8v3e-knowledge-import`, evidence root
`/opt/evo-release-evidence/p8v3e-20260820.1`, result
`p8v3e-rollout-result.json`, preflight `p8v3e-production-preflight/v1`, and
authorization `EXECUTE-P8V3E-2026-08-20.P8V3E.1`. The P8V3D token is consumed.
Candidate bytes, frozen knowledge, migration no-op, ordered deployments,
rollback and provider/customer-effect boundaries remain unchanged.

### P8V3F — verified process-only Gemini key retry

The owner-authorized P8V3E attempt is immutable failed-attempt evidence with
result SHA-256
`328dd56efc616b1492b42c399651733186a5167e8214798b8e21eef5f60fa185`.
It stopped at the client knowledge embedding request with Gemini HTTP `429
RESOURCE_EXHAUSTED`. The atomic knowledge sync RPC was not called: live
read-only reconciliation proves zero client revisions/documents/chunks, the
existing two internal documents/26 chunks unchanged, migration ledger
`001-077`, restored configuration, no application/WAHA recreation, no amoCRM
write, no WhatsApp send and no staff draft call. The P8V3E release, rollback
and evidence roots remain immutable and its authorization is consumed.

P8V3F changes only the knowledge-import helper, Gemini credential delivery and
its readiness proof. The
owner-approved working key is accepted from exact process-only environment
name `GEMINI_API_KEY` through the encrypted Personal Secrets Vault. It is
forbidden in Git, CLI arguments, local plaintext files, stdout, stderr and
retained evidence. The final short preflight makes exactly one neutral
`gemini-embedding-2` request with output dimension `1536` and one neutral
structured `gemini-3.5-flash` request. Neither request contains knowledge,
customer, applicant or staff content; neither retries. Only closed boolean
success evidence is retained. Any HTTP, timeout, response-shape or vector
drift blocks before production effects.

The reviewed import helper removes the unsupported Embedding 2 `taskType`
field and formats every document chunk as exact `title: {title} | text:
{content}`, as required by current official Embedding 2 retrieval guidance.
The final execution checkout builds this single bundled importer twice;
byte-identical SHA-256/size become part of preflight evidence. Execution
rebuilds the same artifact, requires exact equality to preflight, transfers it
to the new release root, verifies its bytes in the importer container, and
uses only that immutable helper for both audience imports. The three deployed
application images remain unchanged.

During configuration the same process-only key is delivered over fixed SSH
stdin, never argv, and atomically replaces both `GEMINI_API_KEY` in the Lead
Agent root-only environment and `EVO_PLATFORM_GEMINI_API_KEY` in the CRM
root-only environment. Exact pre-change bytes for both files and the existing
manual-worker prestate are retained under the new rollback root. Any later
failure restores and read-back verifies both original environment files plus
the worker prestate before reporting rollback success. On rollout success the
new key remains only in those root-owned mode-0600 production secret files.

Writable identities advance collision-free to release
`2026-08-20.p8v3f.1`, version `p8v3f-0f1454d0-20260820`, importer
`evo-p8v3f-knowledge-import`, evidence root
`/opt/evo-release-evidence/p8v3f-20260820.1`, result
`p8v3f-rollout-result.json`, preflight `p8v3f-production-preflight/v1`, and
authorization `EXECUTE-P8V3F-2026-08-20.P8V3F.1`. Issue #331, one independent
review, one final CI, one fresh minimal preflight and the new exact owner token
remain mandatory. All application/image, frozen 11-client/291-internal
knowledge, migration-no-op, ordered deployment, provider/customer-send,
rollback and privacy boundaries are otherwise unchanged.

### P8V3F — Gemini 3.5 Flash readiness budget correction

The first real P8V3F preflight proved the new process-only credential can
produce the exact 1536-dimension `gemini-embedding-2` vector, then stopped
before effects because the neutral `gemini-3.5-flash` response exhausted the
old 32-token ceiling during default medium thinking and returned truncated
non-JSON. P8V3F therefore keeps the same collision-free release and unconsumed
authorization identity while correcting only that no-effect readiness call.

The draft request must use exact `thinkingConfig: { thinkingLevel: "MINIMAL" }`
and `maxOutputTokens: 128`; it must omit explicit `temperature`. All existing
prompt, schema, candidate, no-tools/no-store/no-retry, timeout, byte-ceiling,
privacy and exact-result checks remain mandatory. Tests must freeze the exact
request and reject `finishReason: MAX_TOKENS` with truncated JSON. Issue #335,
independent review, merge/final CI and one fresh real minimal preflight remain
required before requesting `EXECUTE-P8V3F-2026-08-20.P8V3F.1`.

### P8V3G — Hermes strict-shell startup correction

The consumed P8V3F attempt is retained immutably at result SHA-256
`02af7782d0ed7020c900109725f8b681504f68479cf90727127fd70d2aeb9f4d`.
It stopped at configuration, restored exact pre-change configuration, left all
five containers healthy on their prior IDs/images and produced zero migration,
knowledge, deployment, WAHA, amoCRM, WhatsApp or draft effects.

Hermes Bash reads its startup file on the `sshd` path. Starting it with `-u`
already active makes the startup file's unset `PS1` reference emit stderr
before the reviewed body runs. P8V3G therefore invokes fixed remote Bash with
`-e` only and requires literal `set -u` as the first reviewed command, before
stdin or effects. Empty stderr, sole process-only stdin, redaction, atomic
configuration writes, readback, cleanup and rollback remain mandatory. This
matches GNU Bash's documented remote-startup and `set -u` behavior:
<https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files> and
<https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html>.

P8V3G uses release `2026-08-21.p8v3g.1`, version
`p8v3g-0f1454d0-20260821`, importer `evo-p8v3g-knowledge-import`, evidence root
`/opt/evo-release-evidence/p8v3g-20260821.1`, result
`p8v3g-rollout-result.json`, preflight `p8v3g-production-preflight/v1`, and
authorization `EXECUTE-P8V3G-2026-08-21.P8V3G.1`. P8V3F roots and token are
immutable/consumed. Issue #338, independent review, final CI, fresh minimal
preflight and the new owner token gate execution. No product or production
authority is otherwise changed.

### P8V3H — final remote-command parity and pre-mutation readiness

The consumed P8V3G attempt is immutable failed-attempt evidence at SHA-256
`ce4f9d4b0c96cc6cbddbf3a7d759a84c4f2b806155d4b3f5bda6d1f033207243`.
It stopped at `client_import/knowledge_failed`, restored the exact prior
configuration, left migration `001-077` unchanged, and ran no deployment.
Live reconciliation found no new managed bundle revision: the observed two
documents and 26 chunks predate P8V3G. All five prior production containers
remain healthy with restart count zero. The P8V3G token is consumed.

P8V3H closes the environment-discovery gap as one final correction. Every
remote `bash -c` operation uses one shared argv renderer: Bash starts with
`-e` only, while literal `set -u` is the first command in the reviewed body.
Every operation still requires empty stderr and must not echo process-only
input. The no-effect preflight executes every structurally distinct remote
command form with the same argv and stdin mechanics used by rollout, including
the one-line stdin form used by knowledge import. This follows GNU Bash's
documented remote-startup and `nounset` behavior:
<https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files> and
<https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html>.

Before configuration can mutate production, the same preflight completes all
read-only migration-ledger/readiness, account/provider, frozen 11/291 vault,
deterministic importer/build, archive/Compose, current-container, remote-path,
rollback, evidence and deployment-readiness gates. No later phase may discover
one of those facts for the first time. Import retains the reviewed bounded
retry only for fully received HTTP 429 responses. The two audience bundle
revisions are each replaced by the existing single transactional
`ai_knowledge_managed_bundle_sync` RPC; a failed embedding sequence therefore
cannot publish a partial revision.

Writable identities advance to release `2026-08-21.p8v3h.1`, version
`p8v3h-0f1454d0-20260821`, importer `evo-p8v3h-knowledge-import`, evidence root
`/opt/evo-release-evidence/p8v3h-20260821.1`, result
`p8v3h-rollout-result.json`, preflight `p8v3h-production-preflight/v1`, and
authorization `EXECUTE-P8V3H-2026-08-21.P8V3H.1`. All P8V3G roots remain
immutable. Issue #340, one independent review, one final CI, one short real
preflight, and one new owner token covering deployment plus rollback are the
only remaining launch gates. Product scope and provider/customer-send
authority are unchanged.

## P8V3I safe knowledge-import diagnostic gate

P8V3I supersedes P8V3H only after the latter's immutable failed result SHA-256
`52710d73b6308db1d1e62af9a1a25cae0cc58c3ddfa67d40e84326c960933f04`.
P8V3H's token is consumed and its safe post-stop facts are not relabeled.

Before implementation, one no-production capacity diagnostic rebuilt the
exact frozen client sources and ran the shipped chunker and formatter. It
produced 11 documents and 17 chunks in one batch. The same process-only key,
`gemini-embedding-2`, and dimension 1536 returned exactly 17 valid embeddings
in one provider call. No database RPC or production effect occurred. The
result distinguishes current provider capacity from structural importer/RPC
failures without claiming what historically caused P8V3H.

Every expected client/internal import failure is classified at source into one
of exactly seven codes:

- `provider_rate_limited`: a fully received bounded HTTP 429;
- `provider_rejected`: any other provider rejection or invalid embedding
  response shape/cardinality/dimension;
- `bundle_invalid`: invalid canonical bundle bytes, document schema, limits or
  chunk construction;
- `manifest_mismatch`: invalid canonical manifest or bundle file/hash/audience
  mismatch;
- `account_binding_failed`: configured, argument, bundle or live account
  identity mismatch;
- `rpc_rejected`: managed-sync rejection or impossible RPC result; and
- `transport_failed`: fetch/read/timeout/SSH/SCP/output transport failure.

The importer emits expected blocked outcomes only as closed JSON with empty
stderr. The rollout maps that record to `failure.reason_code`. P8V3I requires
that field exactly for `client_import` or `internal_import` failures and
forbids it elsewhere. Historical D-H evidence remains schema-valid without it.
No raw error, response body, UUID, key, path, embedding, customer text or
private diagnostic enters stdout or evidence.

Tests must execute all seven classifications, including fully consumed 429,
non-429/malformed provider response, canonical bundle vs manifest vs account
separation, RPC rejection, and transport failure. They also prove that a
blocked importer produces one closed record, empty stderr, non-success rollout
evidence with the exact safe code, and no later phase.

New writable identities are release `2026-08-21.p8v3i.1`, version
`p8v3i-0f1454d0-20260821`, importer `evo-p8v3i-knowledge-import`, evidence root
`/opt/evo-release-evidence/p8v3i-20260821.1`, sole result
`p8v3i-rollout-result.json`, preflight `p8v3i-production-preflight/v1`, and
future authorization `EXECUTE-P8V3I-2026-08-21.P8V3I.1`. Issue #344 and the
single review/final-CI/preflight/owner-token sequence remain mandatory. This
block authorizes repository work only.

## P8V3J — importer network parity correction (2026-08-21)

P8V3I stopped at `client_import` with the closed reason
`transport_failed`. Its retained result remains immutable at SHA-256
`1709094ba438286f00d9ebb83ae6a7377f8cd7fdb2f2d4a72e1ef3eb08698e26`.
Cleanup and rollback were verified, the knowledge sync had no effect, and all
five production containers remained on their prior healthy identities. The
P8V3I authorization is consumed and must never be reused.

Read-only Hermes inspection found a concrete execution mismatch: the importer
was created without `--network`, while `evo-crm-app-1` is attached to
`evo_crm_private` and `evo_public_web`. The host resolver is
`127.0.0.53%lo`; the application container uses Docker's embedded resolver at
`127.0.0.11`. Docker documents that containers on the default bridge receive a
copy of the host resolver configuration, while containers on a user-defined
network use the embedded DNS server:
<https://docs.docker.com/engine/network/#dns-services> and
<https://docs.docker.com/engine/network/drivers/bridge/#differences-between-user-defined-bridges-and-the-default-bridge>.
The historical low-level exception was not retained, so P8V3J records this as
a confirmed network/DNS-path mismatch compatible with `transport_failed`, not
as proof of an exact historical `ENOTFOUND` message.

Before any mutation, preflight must require the existing network named exactly
`evo_crm_private` to be a local, non-internal bridge. Importer creation must use
exactly `--network evo_crm_private`. After start and before copying or running
the importer, the runner must bind the exact container ID, image ID, owner
nonce, name, running state, sole attached network `evo_crm_private`, and sole
resolver `127.0.0.11`. Any missing network, extra network, resolver drift,
ownership drift, or inspection failure blocks before provider or database
work. Each predicate must carry an explicit nonzero exit and must not rely on
`set -e` to interpret a standalone `[[ ... ]]` test. Existing exact-ID cleanup
and absence proof remain mandatory.

Tests must first reproduce the missing-network contract, then prove the exact
create argument, preflight network inspection, post-start sole-network and
resolver checks, and fail-closed behavior for network/resolver drift. A real
OrbStack check may exercise the reviewed image on a collision-free disposable
user-defined network; it is local-only and must clean up by verified identity.

Writable identities advance to release `2026-08-21.p8v3j.1`, version
`p8v3j-0f1454d0-20260821`, importer `evo-p8v3j-knowledge-import`, importer file
`p8v3j-platform-knowledge-import.mjs`, evidence root
`/opt/evo-release-evidence/p8v3j-20260821.1`, sole result
`p8v3j-rollout-result.json`, preflight `p8v3j-production-preflight/v1`, and
future authorization `EXECUTE-P8V3J-2026-08-21.P8V3J.1`. Issue #348, one
scoped PR, one independent review, final CI, a fresh short read-only preflight,
and a new owner token remain mandatory. This block authorizes repository work
only; it does not authorize production, provider, import, deployment,
WhatsApp, WAHA, amoCRM, or customer-data effects.

## P8V3K — Compose-native knowledge import runtime (2026-08-21)

P8V3J remains immutable audit history. Its reviewed result SHA-256 is
`45b67745d808333b74af8feeb7c1d213e2a018ac1690c0154212341591753486`; it stopped
at `client_import` with `transport_failed`, verified rollback and cleanup, and
left migrations `001-077`, managed client knowledge, the pre-existing internal
2 documents/26 chunks, and all five deployed containers unchanged. Its token is
consumed and is never accepted by P8V3K.

The prior helper container assembled a runtime with separate `docker create`,
`start`, `cp`, `exec`, network and cleanup steps. P8V3K replaces that lifecycle
with one foreground `docker compose run` job against service `app` in the exact
production Compose file. Docker documents that `compose run` uses the service
configuration, that `--no-deps` suppresses dependency startup, that `--rm`
removes the one-off container, and that `--pull never` forbids a pull:
<https://docs.docker.com/reference/cli/docker/compose/run/>.

The candidate image is intentionally still the reviewed linux/amd64 image from
application commit `0f1454d014bbc9eca9d7381dfe557e980965543e`, image ID
`sha256:fc3487ce079663694aee583891c3939296915634bea61dd293db235b57e748f3`.
It predates later importer retry and safe-diagnostic fixes. P8V3K therefore does
not execute the stale importer baked into that image. The final checkout builds
the current importer twice, binds its byte-identical SHA-256/size in preflight,
rebuilds and rechecks it for execution, transfers only that file, and bind-mounts
it read-only with each exact frozen bundle and manifest.

The frozen command seam is `docker compose --ansi never --progress quiet
--project-name evo-crm -f /opt/evo-crm/docker-compose.prod.yml --env-file
/opt/evo-crm/.env.production run --rm --no-deps --pull never -T`, followed by
the exact reserved name `evo-p8v3k-knowledge-import`, a fresh owner label,
process-only environment-name forwarding, read-only individual file mounts,
`--entrypoint /bin/sh`, service `app`, and a fixed shell that validates the
configured account against the separately resolved expected account before
executing the mounted importer with Node. No secret or UUID value appears in
argv, stdout, stderr or evidence. Build, pull fallback, port publication, extra
networks, `docker cp`, and the old sleep/start/exec lifecycle are forbidden.

Before any configuration, migration reconciliation or knowledge effect, the
short production preflight builds the same importer and runs its
`--verify-provider` mode on Hermes through the same Compose service, reviewed
image, environment, network, shell/output and cleanup seam. The probe makes one
non-retrying `gemini-embedding-2` batch with fixed neutral text, requires the
exact 1536-dimensional response, emits one closed JSON line with empty stderr,
and writes no Supabase, amoCRM, WAHA, application-volume or customer data. The
preflight also requires the exact production Compose hash/render, exact loaded
image, healthy current containers, migration ledger, capacity, rollback files,
absent reserved name/owner, and cleanup after the probe. Any mismatch blocks
before the owner token.

Execution keeps client before internal. The importer accepts only the existing
closed success/blocked JSON contract with empty stderr. After each audience,
the runner rereads the single managed revision and requires the exact bundle
SHA-256/document count and a positive chunk count before continuing. The RPC
remains the sole atomic database publication. A failed knowledge boundary keeps
all application deployment boundaries `not_run`, restores configuration, and
cleans only files/containers proven to belong to this attempt. `--rm` is primary
container cleanup; final inventory must prove both reserved name and owner label
absent, while a foreign occupant is never removed.

Writable identities advance to release `2026-08-21.p8v3k.1`, version
`p8v3k-0f1454d0-20260821`, importer file
`p8v3k-platform-knowledge-import.mjs`, result `p8v3k-rollout-result.json`,
evidence root `/opt/evo-release-evidence/p8v3k-20260821.1`, preflight
`p8v3k-production-preflight/v1`, and future authorization
`EXECUTE-P8V3K-2026-08-21.P8V3K.1`. Issue #350, one coherent PR, one independent
exact-head review, one final CI, one short real preflight, and one fresh owner
authorization covering import, deployment and rollback remain mandatory. This
block authorizes repository work only.

## P8V3K live Compose baseline correction (2026-08-21)

The first real P8V3K preflight stopped before its provider probe or any
production effect because `/opt/evo-crm/docker-compose.prod.yml` hashes to
`51b6a19cdf4797f7e882d4638c12177030fcb3e0258311a7682db7d959c28988`, while
the initial contract incorrectly required the not-yet-deployed candidate
Compose SHA-256
`ae3689f60d14c1463a77512afbe8d24db59d079473435e9c8b2d01c222eb7a6f` at
that live path. Read-only comparison proves the `app` service used by
`docker compose run` is unchanged between those files. The only observed
differences are the candidate's new `manual-send-worker` service and its WAHA
healthcheck path; neither participates in the knowledge-import job.

Issue #352 therefore binds the preflight and both knowledge-import jobs to the
exact observed live Compose SHA `51b6a19c...` at the existing canonical path.
The later deployment boundary remains bound to the reviewed candidate Compose
SHA `ae3689f6...` under the staged release repository. Preflight must still
validate the live file before the single provider probe, and execution must
revalidate it before each import. Deployment must still validate and invoke
the staged candidate file; no copy or replacement of the live Compose file is
authorized before the owner token.

No successful P8V3K preflight artifact, remote preflight root, import,
configuration change, deployment, restart or provider retry was retained.
Accordingly the existing collision-free P8V3K release, preflight format and
future authorization `EXECUTE-P8V3K-2026-08-21.P8V3K.1` remain unconsumed.
This correction requires one scoped review/CI and one fresh short preflight
before that single deployment-plus-rollback authorization may be requested.

## P8V3K Docker 29 OCI runtime-identity correction (2026-08-21)

Issue #354 records a second no-effect preflight observation. Docker Engine
`29.4.0` with its containerd image store loads each exact reviewed OCI archive
as the archive's top-level OCI index. For CRM, the exact source tag resolves to
index `sha256:711535e0d1216663e42b2d2dd4e2b042812d8bce8ebe82a5c3eb6ae866d60a45`;
the reviewed linux/amd64 manifest
`sha256:fc3487ce079663694aee583891c3939296915634bea61dd293db235b57e748f3`
remains a descriptor inside that index and is not a separately inspectable or
taggable Docker image. A container created from the loaded tag reports the
index digest as `.Image`. The same result was reproduced with
`docker image load --platform=linux/amd64`.

Docker documents that Engine 29 uses the containerd image store, which supports
multi-platform image indices and attestations, and that `docker image load`
restores the archive's images and tags:
<https://docs.docker.com/engine/storage/containerd/>,
<https://docs.docker.com/build/building/multi-platform/>, and
<https://docs.docker.com/reference/cli/docker/image/load/>. P8V3K therefore
separates three identities instead of treating them as interchangeable:

- the archive SHA-256 and size bind transferred and rollback file bytes;
- `platform` remains the exact offline-verified linux/amd64 manifest descriptor
  and revision/config provenance inside the archive;
- `index` is the Docker-inspectable runtime image ID used by the source tag,
  Compose tag, provider/import containers, deployed containers and candidate
  cleanup on the frozen backend.

Execution must load each exact archive, require `sourceTag -> index`, tag the
verified source tag to the fixed Compose tag, require `composeTag -> index`,
and compare every candidate container `.Image` and deployment
`after_image_id` to that same index. It must never tag or inspect `platform` as
a standalone Docker image. Historical rollback image IDs remain the exact
Docker runtime IDs already frozen in the rollback evidence.

The short final preflight may temporarily load only the CRM archive so the
neutral provider probe exercises the exact candidate runtime. Inbox and Lead
remain archive-only until the owner-authorized execution. Before the temporary
transaction, preflight must prove Docker `29.4.0`, API `1.54`,
`linux/amd64`, DriverStatus exactly
`[["driver-type","io.containerd.snapshotter.v1"]]`, candidate
source/Compose/nonce-tag state, candidate-index
visibility and container references, plus the unchanged five production
containers. It then loads only the exact CRM archive, proves
`sourceTag -> index`, creates the fixed Compose tag from that index, and runs
one two-phase owner-labelled `--pull never --no-deps` provider job. The
detached job initially runs only a fixed bounded wait shell. Preflight captures
and validates its exact ID, reserved name, owner label, `.Image == index`,
network, UID/GID and running state before an exact-ID gate release allows the
single neutral provider command. A wrong identity never opens the gate. The
non-auto-removed job is then waited, its closed output/exit verified, and its
exact owned ID removed in finally.
The accepted prestate is closed: either source tag/index are both absent with
no candidate reference, or the exact source tag is the sole tag on the exact
visible index; the Compose and nonce tags and all candidate-index containers
must be absent. Cleanup restores that exact prestate.

Finally cleanup is container-first and may remove only tags and the index that
were absent before this transaction, still resolve exactly to the reviewed
index, and have no foreign tag or container reference. No force, prune, pull,
build, broad deletion or offline conversion is allowed. A collision, repoint,
foreign reference, ambiguous inspection/removal or incomplete cleanup blocks
execution and requires reconciliation. Final evidence records the archive,
index and platform descriptor for all three portable files, plus a separate
CRM-only runtime-probe record with backend identity, runtime index, exact
provider container identity, pre/post state, cleanup and unchanged production.
Inbox and Lead records must not claim runtime verification before execution.
No UUID, credential or private path is retained. The proof covers
Docker-visible restoration; it does not claim byte-identical restoration of
unreferenced containerd blobs.

No provider probe or Docker-cache mutation is authorized by this repository
change. After one independent review, one final CI and merge, a fresh explicit
preflight authorization
`PREFLIGHT-P8V3K-2026-08-21.P8V3K.1`, supplied process-only as
`EVO_P8V3_PREFLIGHT_AUTHORIZATION`, gates the bounded temporary CRM
transaction. Absence or mismatch must stop before its first Docker/provider
effect. The retained canonical preflight evidence is the launch-control
consumption record and reuse is forbidden. A single later owner authorization
may then cover the defined import, one-boundary-at-a-time deployment and
rollback window. P8V3K release/result/execution-token identities stay unchanged
because no successful preflight artifact or execution was retained.

## P8R1 — Fast app-only release control (2026-08-22)

P8R1 adds a reusable fast lane for ordinary CRM application releases after the
controlled P8V3K first rollout succeeds. It does not amend, authorize, replace,
or bypass the frozen P8V3K knowledge import, migrations or one-boundary rollout.
The first production use of P8R1 requires its own activation and deployment
authorization after the repository change is reviewed and merged.

The operator supplies an exact 40-character commit that must equal current
`origin/main` and have green CI for that exact tree. GitHub Actions then builds
one linux/amd64 CRM image from that immutable commit, records its exact digest
and OCI release labels, and enters the protected `production` Environment.
That Environment supplies the dedicated SSH key, pinned Hermes host key and
non-secret deployment variables; none is stored in the repository. Production
concurrency permits only one deployment or rollback at a time.

The fast lane is deliberately narrow. A fail-closed changed-scope gate rejects
database migrations and schema, knowledge bundles/importers, provider or
credential configuration, authentication/authorization/security boundaries,
WhatsApp/WAHA, amoCRM, Lead Agent, Inbox, Compose/proxy/infrastructure and the
release controller itself. Rejected work must use the existing controlled
release path. Passing the path gate is necessary but not sufficient: exact-main
identity, exact CI, immutable artifact identity, current health, Compose
validation, required secret-name presence without values, disk capacity and an
immediate app-image rollback reference are all checked before mutation.

Deployment changes only the CRM `app` service. The reviewed image is imported
under the exact commit tag, the current app image and deployment metadata are
retained, and Compose starts only `app` with dependencies, builds and pulls
disabled. The controller requires Compose health, zero restart regression, the
exact running image and OCI labels, and an external health response. Failure
automatically restores only the prior app image and release metadata; it never
rewinds migrations, databases, volumes, knowledge, WAHA, amoCRM or customer
data. Evidence contains only release identities, timestamps and closed result
codes.

The application reads release metadata from validated runtime variables. Every
authenticated staff shell shows the deployed version and abbreviated revision,
and an authenticated version endpoint returns the same closed metadata. Public
`/api/health` stays minimal. Missing or malformed metadata is shown as
unavailable; no repository SHA, IP address, credential, account identifier or
environment-specific fallback is hardcoded.

The controller is tested first against a disposable OrbStack Compose project
using the real CRM image, including deploy, health failure and rollback. The
repository change then follows one PR, one independent review and one final CI.
GitHub Environment activation and the first real production deployment remain
separate, explicit operations.

References: [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[manual workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency),
[Docker Compose app-only update](https://docs.docker.com/reference/cli/docker/compose/up/).

## 2026-08-22 all-in-one Platform architecture authority

This decision supersedes older target-language that treats Main CRM, EVO Inbox,
or EVO Lead Agent as separate products or permanent boundaries. Historical
deployment facts, rollback controls, and provider cutover gates remain valid,
but their purpose is to reach one EVO Admissions product safely.

The target is one entry point, one accepted UI shell, one Supabase Auth/RBAC
organization model, and one cross-module workflow. Admissions/CRM,
communications/Inbox, and Lead Agent/orchestration are internal modules. They
must not expose competing staff applications or maintain competing operational
truths. The root `supabase/` migration chain and the Platform schemas are the
only forward data authority. Supabase Postgres stores Platform state, Auth owns
identity, private Storage owns applicant/media objects, Realtime may invalidate
authorized UI state, and Edge Functions may implement appropriate short-lived
integration boundaries. Those capabilities all serve the same domain model.
The target staff entry remains the unified CRM shell rather than a preserved
second Inbox application or separate Lead Agent UI.

WAHA transports WhatsApp, amoCRM supplies its explicitly owned sales fields,
and approved AI providers generate bounded proposals. Each is an adapter at the
Platform boundary. Provider identifiers and observations are normalized into
the Platform model; providers do not become separate products. No new SQLite
path, legacy-schema feature, dual-read, dual-write, fallback UI, or compatibility
layer may be added. Existing separate runtimes and legacy objects are frozen
cutover inputs to retire, not architecture to extend.

The unified Platform remains not live-ready until its real managed Supabase
Auth/RLS/Storage/data path and required provider adapters are exercised in the
authorized environment. Repository, local database, and UI checks prove only
their stated layers.

Research basis: [Supabase architecture](https://supabase.com/docs/guides/getting-started/architecture),
[Auth architecture](https://supabase.com/docs/guides/auth/architecture),
[Database overview](https://supabase.com/docs/guides/database/overview),
[Realtime authorization](https://supabase.com/docs/guides/realtime/authorization),
and [Edge Functions](https://supabase.com/docs/guides/functions).

## P8R2 — Connected Platform reliability repair (2026-08-22)

P8R2 repairs four connected-runtime defects verified on exact `origin/main`
`6f4041c2a82a8fd2b663322553a6e5035de8105f`. It is one bounded reliability
change: two implemented private APIs must reach their own handlers; the Lead
Agent probe must distinguish that handler from a generic proxy denial; staff
queues and message history must remain reachable beyond the Data API row cap;
and connected `/sales` must show a real read-only Platform work queue instead
of an unconditional empty result.

The private-route contract is an exact-match allowlist. Lead Agent sync and the
Gemini proposal route bypass staff-cookie handling but retain their handler-owned
HMAC, bearer-secret, configuration and disabled-state checks. Near paths remain
blocked. The deployment probe accepts only the Lead Agent handler's documented
unsigned-request response (`403` with `error=invalid_signature`); status alone
is never sufficient proof that the request reached the handler.

Admissions queues, communication queues and message history use bounded,
deterministically ordered server-side pages. Filters are applied before the
page window, record pages use stable tie-breakers, detail screens use direct
authorized snapshots, and older messages remain navigable. Each surface moves
to one canonical bounded read contract. Obsolete unbounded RPCs are removed
after repository callers move; no additive compatibility RPC, dual read, or
fallback remains. The UI must not download an entire queue and then filter or
locate one record in memory.

Connected `/sales` remains read-only and does not manufacture amoCRM deals
from Platform records. It may show the real Platform sales-intake work queue
with links to its native records, but it must label that queue as operational
work rather than the canonical pipeline. amoCRM remains authoritative for deal
identity, stage, amount and responsible sales manager until its real read-only
mapping is exercised and verified. `/sales` is a module of the same EVO UI and
uses the same Supabase identity and role model; it is not a second CRM.

This repository change does not authorize a provider call, production probe,
database migration, deployment, WAHA/WhatsApp write, amoCRM write or autonomous
reply. It also excludes a security scan at the owner's request. Validation is
local and evidence-based: focused repository tests, route-handler/proxy
contracts, a real disposable Supabase migration run, connected Playwright
coverage and the production build. Any unavailable runtime is reported as an
explicit blocker rather than replaced by fixtures or mocks.

The pre-change audit baseline remains approximately 55% code/UI readiness
(reasonable range 50–60%). No maintained repository source for the earlier 76%
claim was found. P8R2 fixes named defects but does not publish a higher readiness
percentage; that requires a fresh screen-by-screen acceptance audit after the
change is merged and exercised in its authorized environment.

Research basis: [Next.js proxy execution and testing](https://nextjs.org/docs/app/api-reference/file-conventions/proxy),
[Supabase range pagination](https://supabase.com/docs/reference/javascript/using-modifiers-range),
[PostgREST table-valued functions](https://postgrest.org/en/latest/references/api/functions.html),
and [PostgreSQL deterministic LIMIT/OFFSET](https://www.postgresql.org/docs/current/queries-limit.html).

## 2026-08-22 exact-main audit correction

The exact current `origin/main`
`ee8a825ebc72f84449636e3feaefab7a330913d4` no longer matches the full
pre-change P8R2 defect baseline. On this SHA, the repository already contains
bounded Supabase page/snapshot read models for communications, student cases,
applications and message history, and the lead-agent route probe requires the
exact handler denial `403|invalid_signature` rather than accepting an arbitrary
`403`.

The still-active remediation target is narrower and architectural. The forward
all-in-one EVO product remains Supabase-native, but the root CRM runtime still
ships legacy SQLite execution paths and `EVO_DB_PATH`-based production wiring.
Connected `/sales` also remains functionally incomplete: in connected mode it
switches away from the admissions lead board/list and renders only the
read-only sales-intake conversation queue. That queue is valid unified module
work, but it does not satisfy the unified sales surface by itself.

Implementation and validation after this audit must therefore focus on:
1. removing or quarantining live forward-runtime SQLite dependencies from the
   connected Platform path;
2. making `/sales` a coherent all-in-one staff surface on the bounded Supabase
   contracts;
3. preserving the exact existing bounded read-model behavior instead of
   reintroducing unpaged RPCs, dual reads/writes or fallback UI.

## P8R3 — Bounded catalog review and truthful Student 360 preview (2026-08-23)

P8R3 closes two exact-main scale gaps without changing the database schema or
provider boundaries. Catalog import candidates remain authorized and ordered
by the existing `admin_catalog_import_candidates` table-valued RPC, but the
server repository applies an explicit range with one look-ahead row. The
Applications page reads a bounded page number from its `searchParams` prop and
renders batch-scoped previous/next navigation. It never downloads the complete
batch to paginate in memory.

Student 360 keeps a bounded embedded application preview. If the canonical
application page reports more rows, the active-application number is rendered
as a lower bound rather than an exact total, and the applications section
visibly explains that only the newest bounded page is shown. The existing link
to `/applications?student_case_id=<case>` is the route to the complete,
server-paginated case queue.

Acceptance requires focused tests for inclusive RPC ranges, look-ahead trimming,
batch-isolated links, lower-bound metrics and visible disclosure, followed by
the non-security unit suite, lint, typecheck, production build, independent
exact-head review and normal exact-SHA CI. No database migration, provider
request, production operation, WhatsApp/WAHA send, amoCRM write, autonomous
reply, DNS/TLS change or dedicated security scan is authorized by P8R3.

Research basis: [Supabase range pagination](https://supabase.com/docs/reference/javascript/using-modifiers-range),
[PostgREST table-valued functions](https://postgrest.org/en/latest/references/api/functions.html),
[PostgREST pagination and count](https://postgrest.org/en/stable/references/api/pagination_count.html),
[PostgreSQL deterministic LIMIT/OFFSET](https://www.postgresql.org/docs/current/queries-limit.html),
and [Next.js search parameters for server data loading](https://nextjs.org/docs/app/getting-started/layouts-and-pages#rendering-with-search-params).

## P8R4 — Supabase-owned WAHA runtime binding for manual send (2026-08-23)

Exact-main audit on `7e99eff6c1890f234eabb9d18217fbe2dd43f500`
confirms that staff authorization, queue leasing, provider-result binding and
audit for manual WhatsApp send are already canonical Supabase contracts. The
remaining forward-runtime break is the transport adapter: it dynamically opens
legacy SQLite settings for `waha_base_url` and `waha_api_key`, while the worker
and migration 077 hard-code the retired `crm_primary` session.

P8R4 replaces that seam rather than layering another fallback over it. A new
Supabase migration owns one private, organization-scoped manual-send WAHA
runtime binding. Non-secret endpoint/session metadata stays in
`platform_private`; the API key is referenced from Supabase Vault and may be
resolved only by one service-role RPC. The accepted forward session is exactly
`evo-inbox`. The Next.js manual-send module loads that resolved binding through
its existing Supabase adapter, creates the WAHA adapter from it, and no longer
imports `src/lib/db.ts` or reads SQLite settings.

The migration must fail closed if historical manual-send provider bindings for
another session already exist. It must not rewrite provider provenance or keep
a dual-session compatibility branch. Migration 077 remains immutable history;
the new migration replaces only the active claim/finish and binding invariants
with the `evo-inbox` contract. Missing, disabled, duplicated, malformed or
undecryptable runtime configuration leaves the worker unavailable before it
claims queue work.

Acceptance requires runtime tests for Vault-binding parsing, exact private WAHA
transport serialization, fail-closed configuration and the absence of any
manual-send import of SQLite. A disposable local Supabase reset must prove the
new migration, service-only grants, Vault resolution, exact `evo-inbox` claim
and finish path, and refusal to migrate non-target provider history. Then run
the full non-dedicated-security unit suite, lint, route type generation,
TypeScript, production build, independent exact-head review and normal
exact-SHA CI.

P8R4 does not seed a real secret, create/start/restart/delete a WAHA session,
scan or mutate production, send WhatsApp, write amoCRM, enable autonomous
replies, change DNS/TLS or authorize a dedicated security scan. Provider and
production readiness remain unproved until a separately authorized cutover
seeds the Vault binding and verifies the real `evo-inbox` session without a
customer send.

Research basis: [Supabase Vault](https://supabase.com/docs/guides/database/vault),
[Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[PostgreSQL safe `SECURITY DEFINER` functions](https://www.postgresql.org/docs/current/sql-createfunction.html),
[WAHA session lifecycle](https://waha.devlike.pro/docs/how-to/sessions/), and
[WAHA private API-key configuration](https://waha.devlike.pro/docs/how-to/security/).

Implementation evidence on 2026-08-23: migration 080 adds the private
Vault-backed binding and its service-only resolver, rejects non-target provider
history or live queued work, and replaces the active claim/finish contract with
the exact `evo-inbox` session. The worker now resolves configuration through
Supabase before leasing work and has no SQLite settings fallback. The SQL audit
also exposed and closed a pre-existing role mismatch: `admin` and `curator`
could authorize a send, but finish previously resolved only a `sales`
participant. Claim now verifies active staff authority and records the sender
participant before any provider request; finish accepts the same three staff
roles.

Disposable-local proof passed: migration reset and the conflict guard, Vault
resolution/grants, real SQL claim/finish, 651 unit tests, root and Inbox
typechecks/builds, lint, and the complete local Supabase/browser gate. An
independent diff review found no high- or medium-severity correctness issue.
Exact committed-head CI passed and PR #372 merged as
`d4d3272fcf730a4a273d52422d854e15c3b01a50`. No provider, production,
WhatsApp, amoCRM, DNS/TLS or dedicated security-scan action was performed by
P8R4.

## P8R5 — Provision and verify the Supabase-owned WAHA binding (2026-08-23)

Post-merge audit on `d4d3272fcf730a4a273d52422d854e15c3b01a50`
confirms that migration 080 deliberately creates no real Vault secret or
enabled runtime row. That is correct for a source-controlled migration, but
the repository has no supported provisioning path: only the disposable SQL
test creates the secret/binding. The worker therefore returns
`manual_send_unavailable` in every real environment until an operator performs
an undocumented direct database write. Historical P8V3 release scripts are
also exact evidence for migration 077 and must not be edited or reused as a
current-main gate.

P8R5 adds one forward migration with two service-only functions. Provisioning
creates or rotates the organization-specific Vault secret, enables the exact
`evo-inbox`/private-URL binding, records only a SHA-256 identity plus version in
Platform metadata and appends a secret-free audit event. Configuration status
returns one bounded non-secret row and proves that the stored Vault plaintext
still matches that hash; it does not call WAHA and must never claim provider
health. Both functions use a fixed empty `search_path`, validate the active
organization and request identity, revoke default execution, and are reachable
only through a dedicated server-side Supabase client.

Two small operator CLIs become the supported current-main path: one accepts the
WAHA key only from process environment and prints non-secret metadata; the
other checks the safe configuration-status RPC for release gating. Neither CLI
reads SQLite, writes a seed/migration secret, sends a message, changes a WAHA
session, or contacts the WAHA provider. The opaque `sb_secret_...` credential
is sent only in the Supabase `apikey` header; it is never misused as a bearer
JWT. The migration and SQL acceptance must
prove create, idempotent replay, rotation, hash agreement, audit redaction,
browser-role denial and resolver compatibility. Historical P8V3 artifacts stay
immutable and are explicitly ineligible for a migration-081 release.

Acceptance requires focused CLI tests with mocked Supabase HTTP, the disposable
Postgres authorization suite, migration inventory/schema-contract updates, the
full non-dedicated-security unit suite, lint, typecheck, builds, local Supabase
gate, independent exact-head review and normal exact-SHA CI. P8R5 authorizes no
managed migration, production change, real secret injection, WAHA request,
WhatsApp send, amoCRM write, DNS/TLS work or dedicated security scan.

Research basis: [Supabase Vault secret creation and rotation](https://supabase.com/docs/guides/database/vault),
[Supabase Database Function privileges](https://supabase.com/docs/guides/database/functions),
[Supabase server secret-key boundary](https://supabase.com/docs/guides/getting-started/api-keys),
[Supabase migration deployment](https://supabase.com/docs/guides/deployment/database-migrations),
and [PostgreSQL safe `SECURITY DEFINER`](https://www.postgresql.org/docs/current/sql-createfunction.html).

Implementation evidence on 2026-08-23 (+06): migration 081 and its exact-tip
SQL acceptance passed a fresh `001-081` reset and the complete disposable
Postgres authorization harness. The focused operator contract passed 55 tests,
P8V1 passed 85 tests, the complete ordinary unit suite passed 651 tests and the
Inbox schema contract passed 32 tests. Root and Inbox typechecks/builds passed;
root lint passed and Inbox lint completed with seven pre-existing warnings and
zero errors. The complete local Supabase/Auth/PostgREST/Storage/PGMQ/browser
gate passed and confirmed 81 contiguous applied migrations. Independent
correctness review found no high- or medium-severity P8R5 runtime issue; its only
initial docs concern used UTC instead of the authoritative Asia/Bishkek
workspace date and did not apply. Exact candidate CI run `32607745769` passed
all four checks and PR #373 merged as
`4aff8350eb4f2f839cf85f8a138828c913a76356`. No managed migration, real secret
injection, provider call, WhatsApp send, amoCRM write, DNS/TLS change or
dedicated security scan was performed.

## P8R6 — One active WAHA session authority (2026-08-23)

Exact post-merge audit on
`4aff8350eb4f2f839cf85f8a138828c913a76356` found one remaining contradiction:
the unified ingress, manual-send and autonomous-reply paths use only
`evo-inbox`, but the signed Lead Agent sync, current Supabase projection and
operator examples still use `crm_primary`. Because WAHA includes the created
session name in webhook payloads and session-scoped API paths, treating those
names as aliases would preserve two runtime truths.

P8R6 makes `evo-inbox` the only accepted forward session and
`waha:evo-inbox` the only new Lead Agent provider-account reference. Migration
082 replaces the active message/session-status projection and limits current
staff health selection to `evo-inbox`, while retaining old `crm_primary` rows
unchanged as historical provider evidence. Application types may distinguish
historical provenance from the current runtime session, but no fallback or
translation may turn legacy evidence into current health.

The Lead Agent runtime/deploy examples and fixture-only legacy settings guidance
must also name `evo-inbox` and the Platform webhook boundary. The old public CRM
webhook source remains frozen for the still-running old release and remains
blocked by connected Platform routing; deleting or switching the real session
is a later controlled production operation, not part of this repository slice.

Acceptance starts red-first and covers exact session/provider identity,
`crm_primary` rejection for new sync/current health, replay and grants,
historical-row preservation, Lead Agent emitted payloads and source/config
guidance. It then requires the disposable Postgres and full local Supabase
gates, ordinary unit and Lead Agent tests, typechecks, lints, builds,
independent review and exact-SHA CI.

No production session/webhook mutation, managed migration, real credential,
provider request, WhatsApp send, amoCRM write, autonomous activation, DNS/TLS
work or dedicated security scan is authorized. A later cutover must inspect
both per-session and global `WHATSAPP_HOOK_*` webhooks, retain HMAC verification
and require the canonical session to report `session.status=WORKING` before
ownership changes.

Research basis: [WAHA sessions](https://waha.devlike.pro/docs/how-to/sessions/),
[WAHA events](https://waha.dev/docs/how-to/events/),
[WAHA security](https://waha.dev/docs/how-to/security/), and
[WAHA quick start](https://waha.dev/docs/overview/quick-start/).

Implementation evidence: migration 082 and its acceptance test enforce exact
`evo-inbox` / `waha:evo-inbox` forward evidence and preserve old
`crm_primary` rows only as unchanged provenance. Current TypeScript, the frozen
Lead Agent, deploy examples and the release runbook now share that authority;
the dormant legacy QR/session-start/secret-write controls were removed rather
than retained as a compatibility path. A red-first source-contract test also
separates immutable migration-077 `crm_primary` evidence from the current-tip
P8R6 wrapper, which explicitly selects `evo-inbox`; both fresh-reset boundaries
now pass without treating the historical name as current authority.

Final local proof passed a fresh `001-082` Postgres authorization harness, the
complete local Supabase/Auth/RLS/Storage/Realtime/browser gate, 655 root unit
tests, 842 Inbox tests plus 32 schema-contract tests, 126 Lead Agent tests,
root/Inbox typechecks, lints and builds, Lead Agent Ruff, safe Compose rendering
and independent correctness/release review with no remaining high or medium
finding. This is repository/disposable-local evidence only. Exact-head CI and
merge remain mandatory; no managed migration, real provider/session/webhook,
WhatsApp, amoCRM, autonomous, deployment, DNS/TLS or security-scan action was
performed.

The first exact-head CI run `32610716487` on
`d21c60f5007fa6359580334f77d2dbc9fe771936` passed the changed-range, Inbox and
Lead Agent jobs. Its Main CRM job reached the scenario stage after the full
local Supabase gate, then correctly failed because the legacy S28/S28B/S29
fixtures still searched for WAHA/Meta controls removed by this slice and the
amoCRM S32/S36 action selector depended on one of those removed fields. The
scenario contracts now assert the server-managed `evo-inbox` boundary, the
retired QR route and a stable amoCRM check-form identity. A disposable SQLite
copy with an isolated report path passed the five safe affected scenarios
5/5. S36 is now explicitly fixture-only and records
`blocked:fixture_external_calls_disabled` before the adapter can run, so the
full CI suite cannot contact amoCRM. The regenerated full CRM scenario suite
then passed 39/39 with `provider calls 0`; the revised exact head must still
pass CI before merge.

The revised exact head
`9f7901d7cf2c434819b86d634fd26af102302615` passed all four required jobs in
run `32611834420`, and PR #374 squash-merged as
`2db8810213c7944aaf2f1b8e52ef4c0ab7824aa5`. A post-merge comparison proved
the merged tree equivalent to the reviewed head. This closes repository P8R6
only; no managed Supabase/provider or production proof was performed.

## BH1 — Repository branch and worktree hygiene (2026-08-23)

The current GitHub and local Git inventories contain historical delivery
residue: 96 GitHub branches, 273 pre-audit local branches, 150 pre-audit
worktrees, 16 draft PRs and 9 dirty worktrees. This is an operational hygiene
problem, not evidence of multiple supported EVO product versions. GitHub
`main` remains the only shared source of truth and production remains on its
separately recorded older release.

The exact audit, open-PR disposition and proposed deletion batches are recorded
in `docs/audits/git-branch-worktree-hygiene-2026-08-23.md`. Squash-merged work
must be classified by GitHub PR/head evidence and patch/recoverability checks,
not only by Git ancestry. The original dirty checkout, all dirty worktrees,
open PR branches, the changed-after-close document branch, the no-PR P4B
checkpoint, and every unreachable detached commit remain preserved.

BH1 first merges this docs-only contract through exact-head review and CI. A
later execution may delete only an owner-approved itemized batch, after a fresh
state check proves every name and SHA still matches the audit. Remote removal,
clean worktree removal, and safe local `git branch -d` happen as separate
verified stages. Force deletion, global prune/garbage collection, deployment,
DNS/TLS changes, live provider calls, WhatsApp sends, amoCRM writes, WAHA
session changes and the dedicated security scan are outside this lane.

## V1 staff rollout and isolated V2 continuation (2026-08-27)

Block-ID: `EVO-V1-STAFF-V2-STAGING-ROLLOUT-2026-08-27`.

### Owner outcome

The accepted target is one stable Version 1 used by EVO staff and one isolated
Version 2 derived from that accepted release for continued development. The
currently active production application is replaced only after the new V1 has
passed real managed acceptance, the owner has completed at least one hands-on
staging feedback/fix round and the owner then gives a separate explicit
production approval. Until that message, V1 stays outside production. The old
production release is retained as rollback inventory during the later cutover
and is not kept as a second active product.

This block starts the separately authorized post-Long-run-1 preparation. It
does not reinterpret repository evidence as managed or production proof and it
does not skip U11/#388, U12/#389 or the U13/#390 pilot evidence sequence.
Staff use begins with the approved net-new or explicitly allowlisted pilot
cohort. Existing legacy cases and history are preserved but are not broadly
migrated, silently copied or used as a runtime fallback; #391 remains the
post-pilot historical/archive boundary.

### Frozen identities and current blockers

The exact feature baseline completed by Long-run 1 is
`2ea92ac547d7f526f0e886a81f871936af456635`. That commit is the immutable
business-feature floor for V1, not yet the final release tag. The final
`V1_RELEASE_REVISION` is the protected exact-main commit after the U11
readiness/release work is reviewed and merged. No unrelated feature may enter
between the feature baseline and that release revision.

The read-only preflight on 2026-08-27 observed:

- production CRM is healthy on older application revision
  `ee8a825ebc72f84449636e3feaefab7a330913d4`;
- the last retained managed Supabase ledger evidence is `001-077`, while the
  V1 feature baseline requires the contiguous repository history `001-092`;
- the canonical hostname `crm.evoadmissions.com` does not resolve. A
  VPS-origin request with certificate verification bypassed returned HTTP
  `200` from the technical `sslip.io` fallback, a verified local TLS request
  failed its issuer check and a separate reviewer path returned HTTP `403`.
  Therefore that fallback is neither canonical nor stable acceptance proof;
- the newest visible logical SQLite backup predates later live WAL/SHM state;
- GitHub has no configured deployment Environments, repository deployment
  secrets or deployment variables;
- current main already contains the exact-SHA immutable fast app release
  workflow/controller. Its deliberately presentation-only scope correctly
  rejects the migration-bearing `ee8a825...` to V1 range, and GitHub has none
  of its required Environment secrets or variables configured;
- the managed Auth and settings endpoints respond, but provider-level email
  signup is still enabled and no real V1 staff login has been proved;
- the installed `/opt/evo-crm` checkout is stale and does not contain the
  current-main controller files or a configured migration-bearing cutover
  mode. The existing repository controller is the release authority to extend
  and install; its server configuration gap does not authorize a parallel
  controller.

Every observation is time-bound and must be re-read immediately before an
effect. These blockers prohibit a direct application-only production update.

### Two-environment topology

| Boundary | Stable V1 production | V2 staging and V1 acceptance |
| --- | --- | --- |
| Git | protected `main` plus immutable `v1.0.0` tag | protected long-lived `v2` branch created from `v1.0.0` |
| Public URL | `https://crm.evoadmissions.com` | temporary owner test URL `https://staging-crm.72.62.119.112.sslip.io`; canonical `https://staging.crm.evoadmissions.com` deferred |
| GitHub Environment | `production` | `staging` |
| Server root | `/opt/evo-crm` secrets plus immutable `/opt/evo-releases/<sha>/repo` source | `/opt/evo-crm-staging` secrets plus a distinct immutable release root |
| Compose project | `evo-crm` | `evo-crm-staging` |
| Private network and volumes | existing production-owned names | staging-owned names; no production volume mount |
| Supabase | dedicated production project | distinct managed project or persistent branch with distinct URL and keys |
| Auth | approved real EVO staff only | separately provisioned staging staff identities |
| Providers | receive-only gates remain explicit | external writes disabled; no production WAHA session or amoCRM mutation |
| Data | live production authority | no blanket production-data clone; only approved minimized acceptance records |

The same staging environment first runs the exact V1 release candidate for
acceptance. After that exact artifact is promoted to production and passes its
smoke gate, staging is re-baselined from tag `v1.0.0` and becomes Version 2.
Acceptance evidence is retained before the re-baseline.

Docker Compose project names, container names, networks, volumes, paths,
domains and environment files must all be distinct. Sharing the public edge
network for Caddy routing is permitted; sharing a mutable database, private
network, volume, Auth tenant, WAHA session or provider credential is not.

### Ordered execution blocks

#### R0 - freeze the plan and feature boundary

1. Merge this docs-only plan through protected exact-head and exact-main CI.
2. Record `2ea92ac...` as `V1_FEATURE_BASELINE`.
3. Permit only U11 readiness, truthful health, backup/rollback, environment
   isolation and fixes required by real acceptance before the final V1 tag.
4. Reject unrelated product features from the V1 release range.

R0 changes no server, DNS, provider, managed database, user or live data.

#### R1 - implement and close U11/#388

1. Implement truthful Admin readiness/audit visibility and explicitly blocked
   states; configured-only or generic HTTP success is not healthy.
2. Extend and harden the existing `.github/workflows/evo-fast-release.yml` and
   `scripts/evo-fast-release.sh` release authority with a reviewed
   migration-bearing mode for the V1 range. Keep the current presentation-only
   fast lane as a constrained mode; do not create a parallel second
   controller. The migration-bearing mode must pin exact current main, exact
   green CI, immutable linux/amd64 images, environment identity, managed
   migration ledger, app health and rollback inputs.
3. Add a staging deployment contour whose source, Compose project, paths,
   network, volumes, environment and Supabase identity cannot resolve to
   production.
4. Exercise backup and restore in non-production using the real managed schema
   and a real staging application path. Do not claim that a file merely exists;
   restore it and verify the restored service and authorization boundary.
5. Require an independent launch-control reviewer, protected merge and
   exact-main CI before infrastructure configuration.

R1 remains repository and non-production work. Its output defines the exact
`V1_RELEASE_REVISION` candidate; it does not yet deploy production.

#### R2 - provision isolated managed staging

1. Create protected GitHub `staging` and `production` Environments with
   environment-scoped secrets, branch restrictions, concurrency and owner
   review before secrets become available.
2. Select an owner-approved staging Supabase project or persistent branch.
   Record only non-secret project/environment identities in evidence.
3. Apply repository migrations `001-092` to staging through the reviewed
   migration path, then prove the exact ledger, exposed schemas, Auth hook,
   RLS, private Storage and negative cross-organization cases.
4. Configure staging Auth Site URL and redirect URLs for the staging hostname;
   disable public signup and provision only approved staging staff identities.
5. Deploy the exact release-candidate image as Compose project
   `evo-crm-staging` with separate secrets, network and volumes. Keep WhatsApp
   outbound, autonomous replies and amoCRM writes disabled.

Creating a billed Supabase project/branch stops until its expected cost and
exact target are approved. If an existing staging project is offered, its
ownership, data classification and current ledger must be proved before use.

#### R3 - complete real managed acceptance under U12/#389

1. Sign in through the real staging URL with an approved EVO Admin account and
   prove the live organization/membership/JWT/RLS authority chain.
2. Provision and verify approved `sales`, `curator` and `admin` staff roles;
   prove inactive, unauthorized and cross-organization denials.
3. Exercise the critical staff path through canonical Sales, contract/payment
   gate, Admissions handoff/case, finance control, human-reviewed Gemini state
   and pilot-cohort visibility using approved controlled acceptance records.
4. Prove blocked integrations are shown blocked, not healthy.
5. Exercise the one real receive-only inbound WhatsApp acceptance required by
   #389 only after the exact EVO-controlled sender/session/message is approved.
   Record zero outbound WhatsApp and zero amoCRM writes.
6. Exercise the staging backup/restore controller and repeat the login and
   tenant-isolation smoke after restore.
7. Give the owner a real staging URL and approved Admin login for at least one
   hands-on exploratory round. The owner may report both defects and places
   that feel wrong or need product/UI adjustment.
8. Record every accepted owner report, fix it through reviewed code, redeploy
   the new exact candidate to staging and repeat affected automated, security
   and hands-on checks. Any changed commit or image invalidates the earlier
   acceptance evidence for that surface.
9. Keep this feedback/fix loop open until the owner explicitly accepts the
   exact staging revision as Version 1. Silence, a green CI run or technical
   acceptance alone is not owner acceptance.

As of 2026-08-27, the app-only staging contour, approved Admin login and a
read-only smoke of `/sales`, `/clients`, `/applications`, `/whatsapp` and
`/settings?tab=staff` succeeded against the live staging app without fatal or
console errors by using a temporary SSH loopback path. That is operator smoke
evidence, not owner-network acceptance. Public owner testing through
`https://staging-crm.72.62.119.112.sslip.io` remains open, and certificate
warnings must never be bypassed. Local Fortinet interception previously caused
`ERR_CERT_AUTHORITY_INVALID` even though the sslip route answered HTTP 200 with
valid VPS-origin TLS.

Fixture-only, local-only, configured-only or synthetic provider evidence does
not close R3.

#### R4 - promote the exact accepted V1 to production

R4 has an additional owner gate: it is unauthorized until, after the staging
feedback/fix loop, the owner sends a separate explicit instruction that the
exact accepted V1 may replace production. The earlier instruction to make and
follow this plan does not satisfy that later production gate.

1. Freeze a maintenance window and recheck exact main, release-candidate image,
   CI, staging evidence, production containers, disk, DNS, managed project,
   migration ledger and all provider kill switches.
2. Capture a fresh logical SQLite backup, a consistent snapshot of every
   production volume, exact prior images/configuration and the provider-backed
   Supabase recovery point available on the approved plan. Verify backup
   readability before the first change.
3. Apply only missing reviewed forward migrations from the observed production
   ledger through `092`; re-read the exact ledger and stop on any drift or
   ambiguous response. Database migration rollback is forward reconciliation,
   never an unreviewed destructive down migration.
4. Configure production Auth hook, URLs and signup policy; provision the
   approved real staff identities through the reviewed bootstrap/admin path.
5. Deploy the exact image already accepted in staging. Change only the minimum
   required service boundaries and retain the prior `ee8a825...` images,
   configuration and backup evidence.
6. Verify production health, exact revision, real staff login, role/RLS
   negatives and critical staff pages on the technical route. Then establish
   canonical DNS/TLS and repeat the same checks on
   `https://crm.evoadmissions.com`.
7. Tag the exact deployed commit `v1.0.0` only after the protected production
   smoke passes. A changed commit or image invalidates staging acceptance.

If application verification fails before an irreversible database effect, the
controller restores the exact prior application image. If migrations have
already committed, the controller must not pretend the old application plus
new schema is a verified rollback: it stops in reconciliation-required state
and follows a reviewed forward fix or a proved provider recovery procedure.

#### R5 - run the U13/#390 internal staff pilot

1. Run the approved net-new/allowlisted cohort for ten consecutive working
   days and at least five real cases.
2. Keep receive-only, no-amoCRM-write and human-review constraints active.
3. Record critical blockers, workarounds, fallback pressure, revision changes
   and each case's inclusion basis without exposing client data in GitHub.
4. Finish with an evidence-backed go, hold or rollback recommendation.

Version 1 is the active staff system during this controlled pilot. The old
runtime is rollback inventory, not a second user-facing production version.

#### R6 - fork and operate Version 2

1. Create the protected `v2` branch from exact tag `v1.0.0`, not from a moving
   local branch or the pre-U11 feature baseline.
2. Re-baseline the isolated staging database from reviewed migrations without
   importing production customer data, then deploy `v2` through the staging
   Environment.
3. Keep `main` as the stable V1 release line. Production hotfixes branch from
   `main`, merge through the normal gates and are forward-ported to `v2`.
4. V2 changes reach staff production only through a later explicit promotion
   plan and never by pointing staging at production secrets or data.

### Effect-specific approval gates

The owner's instruction authorizes this plan, issue/PR preparation and safe
read-only preflights. Before the named external effect, the execution record
must also identify:

- staging resource creation: exact Supabase target, owner and expected billing;
- DNS: provider/account, exact `A`/`CNAME` record, TTL and rollback record;
- staff Auth: approved work email(s), role(s) and secure password-delivery path;
- real WhatsApp acceptance: dedicated sender, private `evo-inbox` session and
  one bounded inbound message;
- production cutover: maintenance window, exact release revision and named
  owner available for go/rollback.

Missing any input is a truthful blocked state, not permission to invent a
value, clone production data, create a billed resource or weaken a gate.

### Completion evidence

The program is complete only when all of the following are retained and tied
to exact revisions and dates:

- protected planning, U11 and any required correction PRs plus exact-main CI;
- distinct hashed production/staging environment and Supabase identities;
- staging and production migration ledgers through the exact release tip;
- real managed staff login and negative authorization evidence;
- staging backup/restore and fresh production backup readability evidence;
- immutable production release result and preserved prior-release manifest;
- canonical DNS/TLS and production health evidence;
- zero outbound WhatsApp and zero amoCRM-write evidence for acceptance/pilot;
- `v1.0.0` tag identity and protected V2 branch/staging deployment identity;
- U13 duration/case evidence and final go, hold or rollback decision.

Old images, paths and backups are not deleted by this program. Cleanup is a
later itemized, separately approved and recoverability-checked operation.

### Current official implementation basis

- GitHub Environments, protection rules, environment secrets and concurrency:
  <https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments>.
- Supabase separate staging/production projects and migration promotion:
  <https://supabase.com/docs/guides/deployment/managing-environments>.
- Supabase persistent branches and their isolated Database, Auth, Storage and
  API credentials: <https://supabase.com/docs/guides/deployment/branching>.
- Supabase production checklist and RLS/backup guidance:
  <https://supabase.com/docs/guides/deployment/going-into-prod>.
- Docker Compose project-name isolation:
  <https://docs.docker.com/compose/how-tos/project-name/>.

## Completed V2-11 — Staff frontend truth and journey completion (2026-08-31)

V2-11 was the frontend completion contract for the private local V2 product
contour. It remains accepted UI/product evidence, but ADR 0024 supersedes its
local-runtime and frozen-production assumptions.

### Outcome and evidence baseline

The frontend is complete only when one root Next.js application presents the
three fixed staff roles — Admin, Sales and Admissions — and the complete core
journey works against the real local PostgreSQL V2 authority:

`Sales pipeline -> Lead 360 and qualification -> contract/payment gate ->
audited handoff -> Student 360 -> tasks/documents/applications/visa/minimal
finance stop or release -> WhatsApp with a human-reviewed Gemini draft`.

Finance is a module available to Admin and Admissions, not a fourth role.
Marketing and Student Portal remain outside this active staff slice. The
Claude Design lineage committed under `docs/design/evo-platform` and the
2026-08-29 UX/UI evidence package are visual references only; no EVO-owned
Figma file is verified, and historical images never count as current runtime
or provider proof.

The exact starting baseline is `origin/main` commit
`f87bd37fa4ed2b88b35fc2a263459f5d1bcff0a0`, whose exact-head EVO Platform CI
was green when this block began. The live audit uses the root application and
the preserved local PostgreSQL V2 contract without
`EVO_UI_CONTRACT_FIXTURES`, demo seed, mock provider or fallback repository.
The route and state inventory is maintained in
`docs/frontend/V2_FRONTEND_COMPLETION_MATRIX.md`.

### Product and safety invariants

1. Keep exactly one staff product, one shell, one fixed-role policy, one active
   route per capability and PostgreSQL as the only V2 business authority.
2. Admin is the functional superset and may preview the exact Sales or
   Admissions interface. Sales cannot cross the audited handoff boundary;
   Admissions cannot perform Sales work before handoff.
3. `/applications`, `/documents`, `/visa` and `/finance` are operational queues;
   Student 360 remains the canonical case write surface. `/tasks` is the shared
   operational task queue. `/whatsapp` is the one role-scoped staff inbox.
4. Loading, empty, error, access-denied, blocked and not-configured states must
   be explicit. A configured provider is not described as verified; a provider
   previously accepted in a separate run is not described as available in a
   runtime that lacks its current server-side configuration.
5. Gemini is advisory. It may create a draft, but only a staff member may edit,
   approve and explicitly send the final text. No autonomous send, blind retry
   or fallback provider exists.
6. Preserve the accepted EVO visual language, responsive shell and semantic
   status treatment. Do not preserve stale Supabase/U2/PR copy, fixture labels,
   duplicate active routes or legacy runtime behavior for compatibility.
7. Keyboard navigation, visible focus, semantic headings, descriptive document
   titles, contrast, reflow and target sizing are release criteria, not polish.
8. Browser proof may read the real local V2 data and select Admin role previews.
   It must not send WhatsApp, request Gemini, write amoCRM, alter provider
   settings, deploy, or mutate real customer data.

### Delivery blocks

#### V2-11A — current-main matrix and implementation contract

- Record every core page, role, active route, code owner, runtime state and
  responsive/accessibility/provider observation.
- Attach only screenshots captured from the current no-fixture runtime.
- Separate verified defects from desired future work and from proof that is
  blocked by an absent external credential or service.

#### V2-11B — truthful shell, roles and navigation

- Make the visible navigation match the server-enforced fixed-role contract,
  including Visa and Finance for Admissions and Admin.
- Replace hard-coded global provider badges with runtime-derived,
  non-secret disclosure that distinguishes `not configured`, `configured but
  not verified here`, and a real blocked result.
- Remove stale active V2 references to Supabase, U2 delivery slices, old PRs or
  fixture-only behavior, without rewriting historical evidence.
- Give each core route a descriptive document title and one clear main heading.

#### V2-11C — core workflow usability, states and responsive access

- Make the Sales queue usable without a single unbounded mobile page while
  preserving cursor/query validation and one canonical read path.
- Keep Lead 360 and Student 360 information dense but navigable, with the
  required gate, owner, next action, blockers and linked work surfaces visible.
- Make a selected WhatsApp conversation reachable before or independently of
  a long mobile queue, while preserving the one-inbox authority.
- Add missing loading/error/not-found coverage at the closest useful route
  boundary, and verify safe recovery actions.
- Correct confirmed focus, target-size, contrast, label or heading defects using
  the existing design tokens and components.

#### V2-11D — real completion audit

- Run type checks, lint, focused outcome tests and a production build on the
  exact PR head with the repository Node 22 runtime.
- Start the real root app against the real local PostgreSQL V2 database with no
  fixture, demo, mock or fallback flag and verify Admin, Sales and Admissions.
- Check desktop (1280x720), tablet (834x1194) and mobile (390x844) for navigation,
  reflow, blocked/not-configured disclosure and the complete core journey.
- Capture fresh final screenshots and an explicit negative inventory for stale
  active frontend references. Record separately: code correctness, local real
  runtime proof, real provider proof and production proof.

### Merge and completion gates

Each V2-11 block is a small conventional-commit PR. A separate reviewer must
return `approved` for the exact PR head before the controller may merge it with
an exact-head guard. Exact-main CI must be green before the next block begins.
The long run must not claim frontend completion while a verified core route,
role, state, viewport, keyboard path or current-runtime provider disclosure is
unproved. An absent external provider credential blocks only that provider
proof; it does not block finishing the remaining local frontend work.

### V2-11 local frontend completion result

The implementation audit closed the verified local staff-frontend gaps on
current main `638a027fd9904e67105d2de51f559b2153752bc0`. PRs #509 through
#514 delivered the matrix, truthful shell, fixed-role navigation, bounded
mobile Sales and WhatsApp flows, nearest route states, Student 360 navigation,
mobile control sizing and dark-theme normal-text contrast. The accumulated
current-main implementation was then exercised through the root application
against the real local PostgreSQL V2 database without fixture, demo, mock or
fallback paths.

The real browser audit covered Admin, Sales and Admissions, direct negative
permissions, the contract/payment handoff evidence, Student 360 operational
modules, human-reviewed WhatsApp, safe empty and real database-error states,
light/dark themes and the required 1280x720, 834x1194 and 390x844 viewports.
Fresh current-main screenshots and the exact role/page/state measurements are
recorded in `docs/frontend/V2_FRONTEND_COMPLETION_MATRIX.md`.

This result proves code correctness and the sampled local real-runtime journey.
It does not prove Gemini, WAHA or amoCRM provider behavior and does not prove a
production deployment. No provider call, send, CRM write, customer-data
mutation or production change was attempted. Those external gates still
require their exact credential, authorization and resolvable target, while a
production check additionally requires separately authorized deployment.

### Current official implementation basis

- Next.js error boundaries and expected-error handling:
  <https://nextjs.org/docs/app/getting-started/error-handling>.
- Next.js route announcements, lint accessibility checks and semantic titles:
  <https://nextjs.org/docs/architecture/accessibility>.
- Next.js loading and navigation behavior:
  <https://nextjs.org/docs/app/getting-started/linking-and-navigating>.
- React action-state and form-status patterns:
  <https://react.dev/reference/react/useActionState> and
  <https://react.dev/reference/react-dom/hooks/useFormStatus>.
- Playwright accessibility testing and screenshots:
  <https://playwright.dev/docs/accessibility-testing> and
  <https://playwright.dev/docs/screenshots>.
- WCAG 2.2 reflow, target size and focus requirements:
  <https://www.w3.org/WAI/WCAG22/Understanding/reflow.html>,
  <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html> and
  <https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html>.

## 2026-09-20 — KB: уточнение фактической координации и обслуживания

Дополнение к сохранённой записи Portal #914: перед применением KB schema
в #912 были опубликованы передача владельца выпуска (5745678648, 22:13:39Z)
и резерв 201–204 (5745702031, 22:17:32Z). Выпуск/перенос подтверждены владельцем
в задаче Astra. Миграции применены одним координатором и проверены по ledger
и исходным SHA-256; детали — в KB execution receipt.

`evo-knowledge-maintenance.timer` установлен, active/enabled; service завершился
с Result=success и ExecMainStatus=0. Независимый reviewer повторно подтвердил
это read-only через SSH, включая успешный запуск в 22:47:08 UTC, отмеченный в его квитанции.
Таким образом, отсутствие уведомления до apply и ещё не установленный timer
не являются текущими незавершёнными пунктами KB. История записи #914 сохранена.

Реальный защищённый перенос завершён (32 оригинала + 25 записей), обычный
перенос и полная сверка ZIP продолжаются. Завершение всего плана не объявляется.


## AST-5 portal functional parity — 2026-09-20

Owner explicitly approved closing the four reported gaps. Execution contract:
1. iPhone admission: display the real operational stage, with the same RU/KY meanings as web, honest empty/error states.
2. iPhone Home: real lesson/test continuation, favorites with nearest intakes, application status, and assisted next actions; preserve native navigation and private read contracts.
3. Web notifications: Atlas UI, RU/KY, authoritative access tier, and refresh for current operational routes; preserve runner state.
4. Web new catalogue entries: server-owned first-publication timestamp derived from immutable publication history, preserved through subsequent revisions; at most four universities first published in the past 30 days. Migration 207 adds a Student-scoped read RPC, with no timestamp backfill or content writes. The current catalogue has no unpublish operation; any future lifecycle change must retain first-publication history and update visible-catalogue filtering.

Each block is a separate PR with independent exact-head review and focused real-path evidence. Use existing authenticated QA identity and real catalogue/learning data; no fabricated fixtures or writes to customer records. Read-only Student checks and local Simulator/browser builds are authorized. Production schema application/release requires the existing coordination/authority; do not silently deploy. Final product-wide E2E, content expansion and App Store remain deferred. Record limitations, never infer full acceptance from CI.

Official implementation references: [SwiftUI task lifetime](https://developer.apple.com/documentation/swiftui/view/task(id:priority:_:)), [SwiftUI refreshable](https://developer.apple.com/documentation/swiftui/view/refreshable(action:)), [PostgreSQL triggers](https://www.postgresql.org/docs/current/trigger-definition.html). Context7 documentation lookup was unavailable (monthly quota); official documentation used directly.


## AST-5 iPhone Home clarity — 2026-09-20

Execute `docs/design/portal/ios-home-refinement.md`: surface genuine unfinished
work, keep admission actions/errors first, clarify module progress, and enlarge
the native continuation button. Preserve the user's selected EVO appearance.
Acceptance: Xcode build, real QA Home/continuation/lesson paths, RU/KY and
dark/large-text inspection, then independent exact-head review and short CI.
No production migration/release or deferred final E2E/content/App Store work.


## 2026-09-20 — EVO product-wide UX refinement

Owner-authorized additive execution contract:
[`EVO_UX_REFINEMENT_PLAN_2026-09-20.md`](EVO_UX_REFINEMENT_PLAN_2026-09-20.md).
Analyze the entire CRM, product web (desktop/mobile), and iPhone experience against
real tasks and the existing CRM/admissions functional plan. Preserve EVO/Atlas/native
identity and useful functions; improve CRM composition, density, typography,
navigation and state handling. Dedicated page agents may analyze in parallel with
explicit ownership; one coordinator integrates shared contracts and components.
The scope includes an inventory before removing/moving controls and a truthful
per-page evidence matrix. Final E2E, content expansion, App Store and release remain
separate. The first documentation pass is not a completed all-page runtime audit.


## Parallel A/B execution — 2026-09-20

Owner dispatched two agents for items 1–36 only; items 37–50 remain deferred.
Lane A contract: `docs/EVO_PARALLEL_A_CRM_PLAN_2026-09-20.md`. First block A-1
(items 4/34) adds an exact-path lead-agent dependency CI lane: locked Python 3.13
installation and real local HTTP smoke, with unknown paths still fail-closed.
This unblocks assessment of #847, not production release or provider acceptance.
Root coordinates main/schema/release; A owns these shared planning appendices.

B-1 (item 26): validate migrated photo objectPath against the existing manifest
contract `<photoKey>.(avif|gif|jpg|png|webp)`; otherwise retain library hotlink.
No Storage writes, license/catalog changes or broader bundle refactor. Validate
resolver, all real manifest entries and read-only public URL/hash; authenticated
render is not claimed. B owns its runtime files and detailed lane plan.

B-1 merged as PR #937 into main `22404da81ab9398a28fdca99d879dc9f0b15a0d6`
after independent review of `20229d1915ffd99d18e2caccc1fe3e0cd6634330` and
required CI. This records source integration, not production delivery.

B-5 (item 26): production-build analysis found the full photo audit manifest
in browser JavaScript. Resolve photo URLs and attribution on the server; retain
a minimal client image-error boundary for portal and staff catalogue images.
Preserve photos, attribution, RU/KY, styles, no-referrer, lazy loading and retry
when the source changes. B owns `UniversityPhoto.tsx` and its photo boundary for
this block. Verify bundle removal and real read-only catalogue rendering.
No content, authentication, schema or Storage writes are included.

### Parallel checkpoint and portal background — 2026-09-20

A-1 PR #938 merged at `7b0cfc7e1c603952e3cf44e77aa4c1943ece74f9` after
independent exact-head review and CI. Dependency PR #847 then merged at
`d2452b6876ef38ccbf6934b82a4bbf34e0c4543c`; the new required dependency lane
and real isolated HTTP smoke passed. GitHub alerts 15/16/17 became `fixed` at
2026-09-20T16:40:17Z. PR #905 merged at
`b38c6f166b404fc6c0a1083db6b96cecef17dedc`: its three affected Node test files
passed 50/50 checks on the reviewed head, with independent review and scoped CI.
These are source/CI results; no production deployment or business-write acceptance.

B-5 clarification: the client FavoritesView imported the photo-bearing Catalog.
The server favorites page now supplies card nodes; selection, comparison and
favorite actions retain their existing contracts. This is a direct dependency of
the approved photo boundary, detailed in PR #939's receipt.
PR #939 merged at `87514d276b439fa45b75664d8194ed48415dabb1` after independent
review and scoped CI. Reused real UI evidence remains bounded by that receipt;
source integration does not claim production deployment.

B-4: observed portal dark-theme foreground tokens paired with the light background inherited
from `pt-content v3-world`. B owns a scoped background override for
`.pt-content.v3-world` to `var(--pt-bg)` in `src/app/(portal)/portal.css`.
Retain the legacy class and staff tokens/components. Validate real authorized
Student catalogue, favorites, detail and one compatible home/documents screen in
light/dark themes and at 390 px, with computed contrast and screenshots.
No authentication, schema, business writes, content expansion or redesign.

## Shared local acceptance for CRM-02a and B-2 — 2026-09-20

A owns one disposable local Supabase project and its schema/bootstrap. Apply the
immutable PR #929 migration 207 before the PR #935 migration 208 inside that
project; keep 207 out of the PR #935 source diff. B owns recent-university
Student RPC and Home verification against its current #929 source. Separate
Next dev origins serve A and B; local Auth permits both callback origins.

Use real local Auth, PostgREST and Postgres, ordinary logins, supported product
provisioning/publishing and only the minimum explicitly marked QA records.
Begin with an empty local Student catalogue, then publish local QA universities
through supported Admin commands and verify the bounded recent list. Verify
no-session and wrong-role denial. A second local Student tenant may be added
for tenant isolation if supported onboarding allows it. Preserve publication
history; do not fabricate timestamps or bypass access checks.

This reversible local verification is authorized within development. Do not
copy managed identities, credentials or customer records, forge JWTs, mock RPCs,
or send external provider messages. Source/local acceptance remains separate
from the deferred, separately authorized managed frontend and SQL rollout.

### CRM-02a local manager role binding

Migration 208 deliberately leaves new organizations without an implicit manager.
Root approved a narrow reproducible local setup helper after supported bootstrap
and role publication. Bind exactly the newly created QA role, guarded by the
owned disposable project/workdir, exact organization/role IDs, active role,
current published bundle containing sales.register.manage, and a one-row
transaction. Reject managed/remote Docker endpoints and mismatched ownership.
Do not change the production role editor/API or migration 208, copy production
IDs, seed a completed sale, or bypass the runtime authorization gate. Subsequent
sales operations use ordinary Auth and genuine application/RPC persistence.

### B-2 local public intake binding

The disposable database applies migration 177 before the first organization
exists, leaving its private intake singleton empty. After the ordinary Admin
command creates the QA review department, A may run B's reviewed guarded local
helper to bind exactly that new organization and department. Require the owned
local project/container, active same-organization department, empty singleton,
and one-row transaction; retain intake owner NULL. No second tenant, Student
row, case or application is inserted directly. Subsequent signup, submission
and approval use current product paths (migration 180 approval signature).

## B-2a public approval own-case scope — migration 209

Local ordinary public signup, submission and approval produced an active Student
and portal-activated pending case, but no case membership scope assignment.
The fresh Student session therefore cannot read that case. Root reserved 209
for B's separate minimal correction; A remains the sole local schema applier.

In the current five-argument approval path, after creating/activating its exact
case, append one scope assignment for the newly created Student membership via
the existing append_scope_event contract, using a deterministic child request
and the actual Admin audit identity. Preserve organization, case, revision,
replay checks and the existing access-version bump. Keep RLS, JWT, access-tier,
email and program-registration contracts unchanged. No historical backfill,
regrant after a prior revocation, or repair of the already failed QA case.
Assess existing affected records read-only in a separate plan.

Validate a NEW ordinary signup, submission and approval on composed local
207/208/209: fresh Auth reads exactly its own pending case and Home; replay adds
neither a second case nor grant; another Student/case, staff and anonymous
requests cannot cross Student boundaries; pending documents/help stay denied.
A applies exact reviewed 209 locally after review; managed SQL and production
release remain separately authorized and deferred. Earlier #935 evidence from
001–208 remains explicitly bounded to its original schema and runtime.

## 2026-09-20 — CRM-01 current sales funnel (migration 210)

Source base: main `f5198c3789f88606177788e0a2ceb3d7202f4607`, after PR935.
Root reserves 210 for A. This implements accepted CRM-01; it does not alter
sales workflow, admissions rules, report amounts or historical cohort dynamics.

The present funnel uses a lead-creation cohort and treats a linked Student case
as a handoff. Public approval can create a case without a sale. Replace only
the current funnel with six existing canonical stage counts over the complete
current open-lead set authorized by the existing `lead.read` record resolver.
No lead creation-date filter, pagination truncation, conversion or new KPI.
A zero stage is genuine only after a successful complete read. Geometry may
expand between stages; do not force independent counts into a decreasing shape.

One read-only snapshot RPC returns stage counts and a separately labelled count
of sales visible in the actor's report for those same leads. A sale means an
unarchived `pipeline` row in `platform_private.sales_register`, linked to an
actual lead and authorized by `sales.register.read` for that record. This follows
the working report's `archived = false` contract (144); manual/import rows with
no lead are excluded. Preserve archived rows and all history. Report visibility
does not follow implicitly from `lead.read`; absence of report permission is
`denied`, not zero. RPC/read/shape failure is `unavailable`, not an empty dataset.

The six stage counts and report sales are different observations, not seven
mutually exclusive stages. Keep report sales separately labelled “Продажи в
вашем отчёте” / “По лидам текущей воронки”; do not add them to stage totals.
Return no report fields, amounts, hidden IDs or per-lead hidden-sale classification.
Resolve current identity/tenant in SQL; preserve Student/anonymous denial,
record scopes and current access-version checks. Use one database snapshot
without a row limit; preserve the existing full-read/truncation guard for the
unchanged period dynamics. A failed report section must not erase stage counts.

Keep “Воронка продаж” visible even when the neighbouring period has no newly
created leads. Place that period control with its cohort metrics/dynamics.
Reuse EVO type, colours, spacing and accessible native links; show a readable
connected stage path at desktop and 320/390 CSS px, with no forced page overflow.
Impeccable refinement preserves the product's existing identity.

Validate against authorized existing real records and actual services/paths:
stage counts, period independence, a case without sale, accessible active sale,
archived sale policy, denied report access and empty/unavailable states when
those inputs actually exist. Do not manufacture records to satisfy the matrix.
No synthetic/demo datasets, mock successes, SQL business-row seeds or forged
sessions. Missing data/authority for a real scenario is an explicit verification
blocker. Static checks are not RPC/UI acceptance. Prior local QA receipts retain
their original source/schema/local-only limits. Managed schema/business writes
and release remain outside current authority.


## 2026-09-20 — B-3 stable intake selection and country decision

Direct owner decision: document preparation is supported only for CN, MY, AE,
TR, IT and CZ (China, Malaysia, UAE, Turkey, Italy, Czechia). Other countries
remain available in the catalogue and favourites; both UI and server reject
preparation outside this list. Never substitute a country or use NULL to bypass
it. Existing assisted Students with an active, activated, authorized case start
preparation immediately after selection in that same case; no extra approval,
new sale, external submission, second case or arbitrary programme cap.

Use existing institution UUID, stable program.id and immutable publication
UUID/version. Add optional stable intake.id to compatible TS/SQL/Swift readers;
legacy JSON remains readable. A canonical UUID is generated once for a new
intake or an explicitly reviewed legacy transition and is retained across edits,
retries and uncertain responses. A genuinely new intake gets a new ID. No new
identity registry or duplicate revision store. Do not infer identity from name,
date, array index or a new publication version. Keep diploma as its own level;
explicit doctorate-to-phd vocabulary adaptation retains exact catalog_level and
source in the selection snapshot and does not rewrite the original degree.

Before B runtime code, its transition contract covers platform-university-catalog
TS parsing, SQL valid_university_content, Swift UniversityIntake, UniversityEditor
and the existing protected stage/review workflow. New selectable publication
writes require IDs; old drafts/readers need an explicit compatible transition.
The server checks ID uniqueness and immutable institution/program parent binding
against all published history, including removed entries, at publish under one
consistent lock order. New preparation is unique by org + case + institution +
program.id + intake.id; publication/version records the chosen facts rather than
creating duplicate identity. Replays/new requests for an existing preparation
return it; terminal applications are not silently reopened.

Legacy rollout is part of completion: read current real publication/version/hash,
prepare one persisted manifest adding only missing intake IDs, preserve existing
IDs, and prove structural equality after removing only the added ID fields.
Recheck the exact base after locking before publish; a changed base or content
requires renewed review. Never rewrite immutable snapshots, sort/deduplicate
entries, refresh verifiedOn, invent dates or claim fresh official-source research.
Technical ID-only review must state the actual comparison performed, and SQL
must enforce exact-content equality against that base. A reason, checkbox or
external manifest alone is not proof. Any factual change uses ordinary content
review. New reviewed_at/version does not reset the first-publication date from207.

Deploy compatible readers/writers/SQL before publishing ID-bearing content.
The ordinary authenticated stage/review/readback and final real Student selection
need their own authority; this architecture decision grants none. Report supported,
already identified, transitioned, still legacy and blocked/stale/error counts.
A legacy entry without ID remains visible but cannot be selected until transitioned;
UI must explain the state. B-3 is not complete until existing supported entries
and the actual web/iPhone selection path are covered. No synthetic/demo datasets
or substitute success checks; missing access/records is a concrete blocker, while
old isolated receipts remain technical history. B owns runtime/catalogue/native
files; A alone maintains these shared launch/decision contracts; root coordinates
migration allocation, integration and production authority.

## 2026-09-20 — B3a/211: совместимость списка drafts и порядок публикации

Продолжение согласованного B-3 контракта `8bd96f2dfc23dc7fc574ecee2591383e05ba311c`
(общие intake IDs, шесть стран подготовки, неизменяемые snapshots).

B3a/211: действующий legacy `admin_university_catalog_drafts` сохраняет прежний
exact DTO и скрывает технические drafts. Новый UI обязан использовать новый
guarded `admin_university_catalog_drafts_with_review_kind` и требовать валидный
`reviewKind`; без PGRST202 fallback (этот код также означает stale signature/schema
cache и нельзя показывать неполный список как успешный).

Managed release gates требуют ledger211 до нового runtime. Применение211 само
не меняет published content. Публикация `intake.id` разрешается отдельным решением
только после нового reader; rollback на старый web image после ID-publication
может быть несовместим из-за strict parser, поэтому нужен заранее проверенный
совместимый rollback image/forward recovery; snapshots не переписывать.

Source/read совместимость и сохранение outer draft DTO не являются доказательством
полного rollout. Этот контракт не разрешает применение миграций, публикацию
контента, новые QA inputs или production release.

## 2026-09-20 — B3b / 214: выбор программы и существующая подготовка

Владелец подтвердил: выбор программы сразу открывает подготовку документов,
без ожидания одобрения сотрудника. Root согласовал узкий следующий срез B3b
после B3a/#944 и выделил миграцию214; A владеет212/213. Порядок main/local:
211 →212 →213 →214, A — единственный local schema applier, root — merge/release
coordinator. Параллельная работа веток не разрешает менять этот порядок.

Реализация214 ограничена service/domain-контрактом выбора, идемпотентной связью
с подготовкой в существующем деле, immutable snapshot выбранных фактов и общим
reader/DTO для web/iPhone/staff. Узкая навигация в сохранённую подготовку допустима.
Это не завершение всего B3 или §11.4–11.6: редакции требований, начальные
Фото/Загранпаспорт, semantic mapping требований программы к existing/custom slots,
черновики загрузок, отдельная отправка и review пакетов — обязательные следующие
срезы. Не менять маршрут/degree всего дела и не использовать case-wide seeding
043/179 для произвольной программы. Существующие applications, documents, slots,
revisions и файлы сохраняются. Отсутствие ещё не настроенных требований не
означает «всё готово»; UI не обещает готовность, отсутствующую в этом срезе.

Контракт выбора:
- Student действует только со своим существующим делом. Для НОВОГО выбора нужны
  active + portalActivatedAt и свежая server authority; case ownership проверяется
  сервером. Student не получает `application.manage`. Отдельные Student/staff
  wrappers используют действующие полномочия и одну закрытую domain-операцию.
- Вход содержит case/institution/program/intake/publicationVersion/requestId;
  остальные факты берутся сервером из точной immutable опубликованной карточки.
  Новый выбор сверяется с текущей публикацией, принадлежностью intake программе
  и направлениями CN/MY/AE/TR/IT/CZ. Legacy без intake.id остаётся читаемым, но
  не получает выдуманный ID из названия, даты или позиции массива.
- Уникальность org + case + institution + program + intake, без версии.
  После свежей проверки текущего доступа, под locks, exact replay и существующая
  связанная preparation проверяются до новых eligibility-ограничений. Replay
  возвращает первоначальный результат; новый request к уже выбранному варианту
  открывает ту же запись. Другой intent с тем же requestId отвергается. Новая
  публикация/истечение срока не уничтожают прежний выбор; terminal application
  не переоткрывается и не перепривязывается обычными staff-командами.
- Хранить exact catalog_level; doctorate отображается в существующий application
  phd, diploma сохраняется самостоятельным значением. Не подменять страну,
  не разрешать NULL bypass и не вводить новый лимит программ.
- Общий reader показывает сохранённые выбранные факты и настоящий статус,
  независимо от доступности финансового блока. Не добавлять продажу, новое дело,
  внешнюю подачу или новую auth-сущность как побочный эффект выбора.

Сроки — явно принятое координатором допущение, не новый ответ/checkbox владельца:
явно closed запрещает НОВУЮ подготовку; unknown/needs_reconfirmation либо спорная
прошедшая дата допускают подготовку с «Срок уточняется». Подтверждённо open/announced
становится просроченным только при достоверной дате и authoritative IANA timezone;
date-only deadline действует до конца местного дня. Отсутствие timezone означает
неопределённость, а не автоматический UTC. Server eligibility общая для web/iPhone;
позднее решение владельца заменяет это допущение. Подготовка не равна внешней подаче.

Impeccable: сохранять EVO identity/tokens, текущую навигацию iPhone, SF и RU/KY.
Не добавлять глобальную вкладку, второй Docs, выдуманный процент готовности или
скрытый fallback success. Различать saving, confirmed, uncertain/retry exact intent,
stale publication, unavailable case, unsupported country и legacy without ID.

Доказательства и ограничения: существующие доступные local Student accounts пока
не имеют active+activated eligible case. Не активировать pending case, создавать
фиктивную продажу, выдавать auth/role grant или переносить production data ради
положительной проверки. Завершить reviewable code и реальные доступные readonly/
denial пути; positive selection/readback/replay/staff visibility остаются pending
до подходящего разрешённого входа. Отсутствие doctorate в реальном manifest также
фиксируется без synthetic fixtures. Требуются два независимых exact-head review,
scope-local checks и ограниченный визуальный проход для затронутых UI. Финальный
E2E, контент, App Store, managed writes и production deployment сюда не входят.

## 2026-09-21 — B215: согласовать handoff продажи с защитой identity дела

Root выделил `215_platform_sales_handoff_owner_guard.sql` как узкую зависимость
приёмки B214. Основание stacked #946 `36f4b440`; до этого append код215 не менялся.
Обычный Auth208 вызов завершился `40001 portal_identity_conflict`: pending-ветка
208 синхронизирует seller с canonical lead, а guard126 запрещает изменение seller.
Read-only before/after подтвердили полный rollback20 таблиц, scopes/access versions,
продажи и receipt. Owner assignment и conditions revision1 выполнены раньше и
сохраняются. Это исправление обнаруженного продуктового дефекта, не ремонт QA-данных.

Контракт до кода, подтверждённый root:
- Одна forward migration215; исторические001–214 неизменны. Новая private
  append-only таблица разрешений owner-sync; изменить только две существующие
  функции: `create_sales_report_handoff` и `guard_student_case_identity_e1`.
  Общий curator helper и публичные RPC/grants не менять.
- Receipt связывает UUID, текущий xid8, org/request/case/canonical lead,
  actor membership/profile/Auth identity, nullable old seller, new seller,
  прежний scope/version и curator. Old/new различаются; tenant-aware составные
  ссылки, unique org/request, FORCE RLS, REVOKE ALL для PUBLIC/anon/authenticated/
  service_role/supabase_auth_admin. Deferred initially-deferred FK org/request
  на окончательный handoff receipt запрещает commit незавершённого разрешения.
- Первым взять org row FOR UPDATE вместо KEY SHARE. Это явно одобренная root
  поправка после выявленного cross-case lock cycle: сериализация handoff внутри
  одной организации предотвращает поздний upgrade и взаимное ожидание profile
  locks с sibling KEY SHARE handoff. Late upgrade и sorted-profile prelocks
  не добавлять. Затем сохранить request advisory → canonical lead advisory/row
  → case row ordering; независимо проверить compatibility и предел tradeoff.
- После ожидания locks повторить fresh actor authority/scoped permission,
  canonical current owner и его действующие права на lead. Сохранить caller/
  manager checks, idempotency, seller/month snapshot, no-existing-sale/handoff,
  curator validation и прежний exact replay до создания нового context.
- Только pending-ветка создаёт private receipt и transaction-local GUC pointer
  перед единственным seller UPDATE. Guard проверяет private receipt и текущую
  транзакцию, exact OLD/NEW owner, org/case/canonical lead/scope, pending state и
  свежую actor authority. Сравнить весь OLD/NEW row кроме seller и updated_at:
  simultaneous Student/tenant/source/contract/lead/curator/state/scope mutation
  запрещена. Прежнее отдельное E1 Student-binding исключение сохранить; нельзя
  совмещать его с owner-sync. Сам GUC не является authority, прошлый receipt
  не работает в следующей транзакции. Сразу после UPDATE очистить pointer.
- После прежнего curator helper отозвать прежнего non-NULL seller из old scope
  через append_scope_event(FALSE), с детерминированным derived request ID;
  bump его profile access_version только если helper ещё не затронул тот же
  PROFILE через new seller/Student/curator. Не сохранять лишний доступ бывшему
  seller и не делать double bump. Любая следующая ошибка откатывает весь handoff.

Проверка: реальные существующие local inputs и bounded rollback-only SQL probes
для отсутствующего/поддельного/stale/неподходящего context, combined identity,
не-pending case и downstream rollback. Эти SQL probes root разрешены только
в собственном local QA и являются технической проверкой guard, не Auth acceptance.
Не создавать entities, не менять Auth/роли и не производить data repair. Existing
Student/anon/cross-case RPC denials не выдавать за достижение trigger, если ACL
отказал раньше. Non-NULL old-seller ветка отдельно source-reviewed; NULL-case
не доказывает её выполнение. Полный UI/native/E2E этим блоком не заявлять.

A — единственный local schema applier: после SQL review и root GO применить215
к001–214, сверить прежний ledger, точные functions/ACL и business parity. Затем B
получает отдельное writer окно и повторяет исходную frozen команду208 с прежним
request ID/payload и новым append-only attempt receipt, связывающим первоначальный
FAIL/rollback и SQL215 SHA. Удалять FAIL/started markers нельзя. После успешного
handoff проверить same case, seller/month, sale/receipt, activation/scope effects;
затем выполнить исходный214 selection/readback/replay/denials. Не расширять packet.
Техническая приёмка B214 указывает фактическую схему001–215.

Работа в isolated `evo-sales-handoff-owner-guard`, PR stacked на946. Merge order
948→946→215, затем retarget/rebase215 на main с повторным independent exact-head
review/CI. A пишет только эти shared appendices, B runtime/QA; root merge/release.
Managed DB, provider, production release и следующая функциональность не включены.
PostgreSQL основание: [xid8](https://www.postgresql.org/docs/current/functions-info.html#FUNCTIONS-PG-SNAPSHOT),
[transaction-local context](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SET),
[SECURITY DEFINER](https://www.postgresql.org/docs/current/sql-createfunction.html).

## 2026-09-20 — CRM-05: подтверждённая передача на рабочей доске (212)

Основание: main `1795bf2380344bdca059868aba57d033fa13a259` после #943.
При реальной локальной проверке210 доска `/v3/pipeline` отправила все7
case-linked лидов в «Переданы»: `pipeline-source.ts` использует наличие любого
связанного дела. В существующих данных лишь4 имеют completed handoff; ещё3 —
дело кабинета без передачи. Root согласовал этот срез и выделил212.

Доменный контракт:
- Сохранить терминальную колонку «Переданы». Её основание — durable completed
  `platform.sales_admissions_handoffs` (088/174), либо точное доказательство
  ветки pending-case activation из208: append-only create receipt, та же
  pipeline-запись с `source_snapshot.activation=pending_case`, тот же связанный
  student_case и lead в одной организации. Само дело или imported/manual sale
  не доказывают передачу. Не добавлять новые записи для конструирования proof.
- Передача остаётся фактом истории при архивировании финансовой записи,
  изменении куратора/состояния дела; отсутствие текущего report permission не
  должно менять операционный этап. Не раскрывать суммы, snapshot, request IDs,
  case IDs или другую финансовую/Student-private информацию.
- Новая readonly staff-проекция212 возвращает только lead ID, признак и время
  подтверждённой передачи для текущих разрешённых открытых лидов. Проверять
  fresh actor/organization/lead.read/record scope, запретить Student/anonymous,
  отказать целиком при недоступном запрошенном lead. Старые RPC/DTO не менять.
  Preview/неполный или ошибочный ответ не превращать в «не передан».
- На доске подтверждённые передачи отделяются от канонических этапов. Остальные
  лиды сохраняют canonical stage и управление следующими действиями. Сохранить
  owner/search/due/stage filters, terminal protection, mobile controls и
  существующий сигнал усечения чтения. Не переоткрывать закрытый lifecycle.
- 210 намеренно считает все разрешённые открытые canonical stages: completed
  handoff оставляет lead open и прежний stage (в QA new3/qualified1). Поэтому
  новая доска ожидает new3/handed_off4, а210 остаётся new6/qualified1 + sales4.
  Это разные группировки; stage-parity и sale=handoff не утверждать. Соседнюю
  cohort-динамику и workflow commands в этом срезе не менять.

Порядок и доказательства: работа в отдельном A-worktree параллельно B211,
но local apply и main merge строго211→212; A — единственный local schema applier,
root — единственный merge/release coordinator. Перед кодом сохранён этот контракт.
UI сохраняет EVO и существующий Operate-контекст Impeccable; новых визуальных
систем/полной переработки доски здесь нет. Проверка на тех же разрешённых
существующих local QA-входах: raw queue/projection/board, stage filters, terminal
controls, mobile и denied actors. В текущем QA нет208 activation, archived/closed
или второго tenant; соответствующие ветки остаются source-only, без fixtures.
Новые business writes, managed SQL, provider actions и production не разрешены
этим контрактом. После212 очередь A: сначала сохранение соседних блоков условий
продажи (#30), затем CRM-02b search/read-detail и остальные согласованные1–36.

## 2026-09-20 — пункт35 / issue #42: форматирование EVO Inbox

Root принимает исполнение пункта35 из очереди A и работает в отдельном
`evo-inbox-format-baseline`, ветка `izzhackt/inbox-format-baseline`, от main
`1e03c6bede4e368fb895b0b81863289670d9632d`. Этот контракт записан до исходных
правок formatter; A сохраняет приоритет213 и остальных CRM-срезов.

Объём — привести существующие tracked форматируемые файлы `agent-lead2-inbox/`
к действующему Prettier baseline issue#42. Это форматирование: сохранить
семантику, существующие конфигурацию и exclusions, dependency versions/lockfile,
публичные интерфейсы, auth/tenant/secret boundaries. Generated/vendor не трогать.
Не изменять CRM runtime, lead-agent, БД/миграции, provider settings, sessions,
DNS, deploy или данные; не добавлять runtime-изменений под видом форматирования.

Приёмка issue: Node22, `format:check`, `lint`, `typecheck`, `test`, `build`
в companion по его реальным scripts. До запуска проверить точные команды и
игнорирования. Использовать существующие входы; ошибки и пределы исполнения
указывать прямо, не создавать success fallback. Нужен независимый semantic-diff
review точного head, защищённые CI-проверки и итоговая scoped receipt. Production,
WhatsApp/provider acceptance и публикация сервиса этим срезом не разрешаются.
Root добавит собственную квитанцию и статус очереди после проверки; слияние
координируется последовательно с другими ветками, исходные append-only записи
общего плана и журнала сохраняются.

## 2026-09-20 — issue #42: узкий CI predecessor перед форматированием

Read-only baseline показал347 форматируемых файлов companion вместо старого
счётчика338 в issue. Действующий classifier признаёт только отдельные Inbox
maintenance/edge paths; массовое форматирование source закономерно остаётся
unknown и блокируется. Root назначил необходимый отдельный CI predecessor;
до его контракта runtime/formatting source не менялись.

Сначала отдельный PR добавляет fail-closed путь проверки format-only кандидатов:
только изменения M существующих tracked regular файлов в явно поддерживаемом
formatter scope `agent-lead2-inbox/`. Add/delete/rename, mode changes, symlinks,
dependencies/lockfiles, formatter config, exclusions, vendor/generated и
миграции исключаются. Для каждого кандидата обязательна точная побайтовая
проверка: head равен результату существующего locked Prettier над base blob
с неизменными formatter/config/exclusions. Одна классификация пути не является
доказательством форматирования и не даёт общий allowlist для Inbox source.
Неподдерживаемые или непроверенные изменения сохраняют unknown/fail-closed.

Выбранная lane выполняет именно issue42 `format:check`, `lint`, `typecheck`,
`test`, `build` на Node22, без credentials, provider actions и deployment.
В CI predecessor не смешивать код нового gate с механическим форматированием
347 source-файлов или runtime-изменениями. Нужны реальные проверки classifier/
byte-proof границ, независимый review точного head и защищённый CI. Root проводит
read-only независимую design-проверку и вправе переименовать эту ветку в
`inbox-format-gate` до кода; это не меняет product/runtime scope.

Только после merge этого predecessor — отдельный механический formatter PR
по исходному контракту, с повторной проверкой фактического числа файлов и
semantic-diff review. Issue42 не объявлять выполненным на одном CI gate. Это
обслуживание существующего companion, не возобновление отдельного продукта,
provider acceptance или разрешение изменять production.

## 2026-09-20 — #42: bounded formatter и обслуживание трёх legacy guards

Основание: main `79624c2f821b9aa9082108eb8d9684d37db41179` (#947).
Первый CI prerequisite смержен. Реальная formatter-проверка выявила два
дополнительных основания для отдельного узкого prerequisite PR перед347-файловым
format-only PR. Старый formatter WIP сохраняется отдельно; этот срез его не
подменяет и не закрывает #42.

1. Существующий locked Prettier для двух файлов цепочек
   `deal-form.tsx` и automations engine достигает стабильных байтов после двух
   применений (третье не меняет результат). Canonical output определяется
   ограниченным fixed-point проходом: максимум3 преобразования плюс отдельная
   проверка стабильности. Не сошедшийся результат, неподдерживаемый путь или
   неравенство head canonical bytes отклоняются. Не менять Prettier version,
   plugins/config/exclusions. Сохранять все guards из#947: только existing regular
   tracked supported files, без add/delete/rename/mode/symlink и смешанной
   семантической правки; configuration/proof выполняются до допуска.
2. На unchanged main три существующие проверки уже падают: текущий shared Caddy,
   устаревшее требование последней миграции105 и устаревший список buckets.
   Зафиксировано3FAIL/47PASS в трёх тестовых файлах. После форматирования ещё
   три assertions зависят от кавычек; отрицательная проверка disabled navigation
   тоже должна проверять запрещённый href при обоих стилях кавычек.

Разрешённый test-maintenance allowlist ровно:
- `agent-lead2-inbox/src/components/first-launch-ui.test.tsx`;
- `agent-lead2-inbox/src/lib/deployment-config.test.ts`;
- `agent-lead2-inbox/src/lib/supabase/schema-contract.test.ts`.

Семантика guards сохраняется/усиливается: quote-agnostic exact values и forbidden
hrefs; текущие crm/app в shared Caddy и отсутствие retired Inbox route при прежних
private boundaries; историческая105 присутствует, containment остаётся, текущим
реестром владеет root migrations; точный allowlist четырёх private buckets из
`supabase/config.toml:65–87` с прежними MIME literals и лимитами:
platform-documents25MiB, platform-document-exports50MiB,
platform-company-files25MiB, platform-whatsapp-media50MiB.
Сохранить существующие ограничения browser upload (включая разрешённый exact
reserved INSERT), server-only чтение/signing, без расширения доступа. Не «лечить» проверки
изменением текущих продуктовых конфигов/миграций или ослаблением assertions.

Для этих ровно трёх файлов добавить отдельный закрытый CI selection flag с
обязательным maintenance job/result. Legacy50 проверок относятся к этому lane;
полный legacy suite842 — к последующему actual formatted PR. Эти UI-тесты имеют
старые mocks и не являются pure helpers: не включать их в обычный dependency
lane, где остаются прежние три pure helpers. Не пропускать падающие проверки и
не вводить широкий source allowlist. Новые Git/classifier/workflow checks должны
доказать закрытость маршрутизации и formatter fail-closed.

Последовательность: этот contract до кода → минимальный отдельный prerequisite
PR → targeted verification + независимый exact-head review + protected CI →
root merge → отдельный pure formatter PR с исходными пятью acceptance checks
format:check/lint/typecheck/test/build и semantic review. Результат legacy tests
явно отделять от реального provider/business proof. Ни deployment, ни revival
Inbox, ни managed DB/provider actions/миграции этим контрактом не разрешаются.
A владеет только двумя shared docs; root выполняет код и merge.

## 2026-09-21 — CRM-09: понятные состояния CRM Inbox

Владелец реализации — root после передачи пункта9 от A; A пишет только этот
контракт. Основание main6cc5590f после #951. Это действующий `/v3/inbox`,
не retired Inbox companion и не командный чат. Student messages (пункт11)
остаётся у A. Узкий срез не закрывает все возможности каналов или весь пункт9.

Фактический baseline на собственном localhost33220: существующий ordinary Sales
видит0 разрешённых диалогов, «Диалогов нет» слева и лишнее «Выберите диалог»
справа. Authenticated DB GET `staff_waha_session_health(crm_primary)` вернул
200/0rows/errorsnull (20.09 20:21:59Z). Это unknown, не disconnected/ready.
Private receipt `/private/tmp/evo-inbox-health-read.json`. Health читает БД с
organization + communication.read.full, не вызывает WAHA/provider. Наличие
пустой доступной очереди не доказывает отсутствие диалогов во всей организации.

Контракт до кода:
1. Empty state отражает текущую навигацию в строгом порядке: cursor →
   search/waiting filters → пустая доступная очередь. Cursor даёт действие
   «К новым»; поиск/ожидание — ясный текст и сброс обоих фильтров. Не путать
   «нет совпадений», «на этой странице пусто» и «доступных диалогов пока нет».
   Reply-needed не равен unread; не менять расчёт ни одного показателя.
2. При0 queue rows и отсутствии selected показывать одну полезную область
   вместо пустой правой панели «Выберите диалог». Если selected открыта,
   сохранять её transcript/действия даже при пустой отфильтрованной очереди.
3. Для unselected queue либо selected crm_primary выполнить не более одного
   optional health-read. Его отдельная ошибка → explicit unavailable; null →
   unknown; только fresh WORKING → ready; остальное → attention. Прежний
   freshness helper и timestamp semantics сохраняются. Для исторической иной
   session не переносить статус crm_primary. Health не предоставляет право
   отправки и не подменяет command/provider availability guards.
4. Optional fallback ограничен этим health-read. Queue/thread/context/proposals/
   reviews и остальные прежние обязательные failures остаются fail-closed
   через существующий boundary. Не превращать permission/auth/read failure
   в пустую очередь или успешный provider status.
5. Сохранить tenant/current actor/permissions, Admin preview guards,
   keyset cursors и50+1 pagination, фильтры, открытую selection, media/private
   paths, snippets, provider/amoCRM controls и их ключи/историю. Это точечное
   улучшение EVO по Impeccable, не замена дизайна или удаление функций.

Реальные проверки: existing ordinary Sales empty queue, search/waiting/reset,
«К новым» при настоящем допустимом cursor; desktop и actual390px, читаемость и
отсутствие overflow. Чистую decision logic разрешено проверить scoped tests;
они не заменяют реальный Auth/UI path. Состояния selected/history/channelerror/
freshready, для которых нет разрешённых реальных данных, не фабриковать и не
объявлять пройденными. Назвать фактические proof и ограничения в QA receipt.
Не создавать новые диалоги/fixtures, не send/mark-read, не менять provider
configuration, identities/roles/Auth, migrations или managed DB/production.
Scope-local lint/typecheck и независимое exact-head review/CI перед root merge.

## 2026-09-21 — CRM-06/10: сброс выбранного сотрудника в воронке

Независимый малый остаток исходных пунктов6/10 после rootCRM09/#952. База
`f97122e83ca65013eeac3eb51919477b9b0e16bd`; root реализует в отдельном
`evo-pipeline-filter-reset`, A владеет только двумя shared contract docs.
Не переносить pending948/946 и не связывать исправление с их positive QA.

Фактическая проблема повторно доказана ordinary local Sales на33218:
ownerLocalAdmin → Найти:1 карточка; «Сбросить всё»: URL безowner,7 доступных
карточек, reset link исчезла, но select всё ещё Local Admin. Следующий поиск
снова отправляет устаревший owner. Поиск q при reset очищается правильно;
full reload возвращает «Все сотрудники». Pipeline source на tested35ce5c0,
A52a00103 и mainf97122e8 побайтно одинаков
(SHA256bb023c771c04c950caaef9e0ad96e99339a9fe7de0d720c6c45851e4dc55d2d0).
Private observed evidence: `/private/tmp/evo-owner-filter-reset-baseline.json`,
`evo-owner-filter-reset-baseline.png`, `evo-owner-filter-reset-followup.json`.

Контракт до кода: синхронизировать только видимый owner select с нормализованным
применённым URL owner при client navigation/reset/history. Минимальный вариант
— remount самого select при изменении committed owner; не всей страницы, формы
поиска, доски или карточек. Не менять рабочую семантику q, stage/due/assignment/
handed, URL parameter names/validation/404, permission-gated owner options и
placeholder недоступного в первой сотне выбранного сотрудника.

После reset controls/URL/выдача должны согласоваться, последующий submit не
должен заново отправлять сброшенный owner. Сохранять разрешённые board rows,
counts/handoff grouping, текущие search/filter links и ограничения tenant/role.
Не затрагивать unsaved business drafts/manual lead/decision forms, layout,
existing actions, SQL/readers/API/migrations или provider paths. Исправление
не создаёт/не меняет клиентов, продажи, назначения, Auth или данные QA.

Scope-local реальная приёмка через GET и обычный existing Sales:
- owner apply→reset: label «Все сотрудники», URL безowner, исходная полная
  разрешённая выдача; следующий поиск не возвращает staleowner;
- Back/Forward и stage/due links сохраняют согласованность с committedURL;
  q очищается как прежде, другие фильтры и handed mode не переосмысляются;
- не remount unrelated forms и не терять их незаписанные поля; только ввод
  и навигация допустимы, никаких submit mutation commands;
- desktop и actual390px: control доступен, нет нового overflow. Изменённый
  source проходит scoped lint/typecheck, diff review и независимое exact-head
  review/protected CI. Не вводить mock data или тест, просто зеркалящий JSX.

Это подготовленный контракт, не утверждение исправления. Production/provider/
managed mutations и завершение всех пунктов6/10 этим срезом не заявляются.

## 2026-09-21 — CRM-16: явный выбор дела при создании задачи

Root принял этот независимый срез от A после merge#953; base
`498c99bf7aa482d9e902d82f457d0312c3c2ac6e`, отдельный worktree
`evo-task-explicit-case`. A пишет только shared contract docs до кода.
Pending948/946 и их положительные QA-пакеты остаются отдельными и не завершены.

Основание: ordinary existing Sales, local001–214, реальный read-only baseline
двух consumers в `/private/tmp/evo-task-case-choice-baseline.md`. Calendar
открывает4 существующих дела с автоматически выбранным первым; поиск тоже
автоматически выбирает первый результат. Global TaskComposerDialog в staffmode
держит закрытый required select с disabled=false/willValidate=true/valueMissing;
открытие пустого case panel оставляет staffmode и enabled create, поскольку
caseMode сейчас зависит от непустогоcaseId. Submit не выполнялся.

Разрешённые продуктовые файлы с прямой зависимостью:
`src/components/v3/tasks/TaskCasePicker.tsx`,
`src/components/v3/calendar/TaskControls.tsx`,
`src/components/v3/tasks/TaskComposerDialog.tsx`.

Контракт:
- Без явно переданного pinned/selectedCase обе формы начинают с «Выберите дело».
  Наличие SSR initialCases или результата поиска не означает выбор первого
  студента. Существующий pinned case сохраняется, его hidden ID и eligible
  assignees остаются привязаны к этому делу.
- Поиск сохраняет ПОСЛЕДНИЙ явный выбор, если он есть в актуальных results;
  иначе очищает выбор и сообщает пустойcaseId consumer. Никогда не выбирать
  next[0]. Pagination, server-provided rows, query/cursor validation, ошибки
  и sequence guard остаются. In-flight callback не должен использовать старый
  selected из closure, чтобы подменить более позднее решение пользователя.
- Explicit case intent определяется разрешённым выбранным режимом/open panel,
  а не наличиемcaseId. В case mode без выбора или без проверенного eligible
  assignee создание заблокировано и на кнопке, и в client submit guard; такой
  intent не должен попадать в staff command. Права caseAllowed/staffAllowed,
  preview, task.assign и серверные проверки не расширяются.
- Закрытый optional picker disabled и не участвует в native required validation,
  не блокирует обычную staff task. При pending/saved lock выбор/поиск тоже
  заблокированы. Открытие/закрытие не должно создавать скрытую смену назначения.
- Прямая зависимость сохранности черновика: результат старого поиска после
  закрытия/блокировки picker не меняет выбранное дело через onCaseChange.
  Source TaskComposer draftContext зависит отcaseId, поэтому такой late callback
  мог бы переключить ключ draft в staffmode. Это выявленный source risk, не
  заявление о воспроизведённой race. Защитить текущие query/sequence/active intent
  и latest selection; не перестраивать политику хранения/ключей черновиков.
- Сохранить title/description drafts и их current-context isolation, explicit
  assignee/eligibility, deadline/timezone/priority, command/request IDs и retry
  semantics, source lead/message context, закрытие/повторное открытие, старые
  server commands и failure states. Не добавлять schema/API/provider actions.

Проверки только существующего разрешённого UI и read/search RPC:
calendar open безавтовыбора → search → explicit selection → refinement/empty
results; latest selection при in-flight search; global dialog closed staffmode
без скрытой required-blocking control → open empty case mode blocked → choice
с правильными candidates → close/reopen; pinned context через существующий
вход создания задачи без открытия чата. Проверять disabled/value/validity,
сохранность локальных черновиков и отсутствие unexpected mode change, НЕ
отправлять create/save command. Desktop и actual390px обоих consumers.
Сценарии, которые нельзя реально проверить на доступных данных, назвать
непроверенными; не выдавать source-only review за actual race proof.

Scope-local lint/typecheck/необходимые существующие проверки и независимый
exact-head review/CI. Никаких новых entities/fixtures/назначений/Auth writes,
mark-read, бизнес-записей, managed DB/provider/deployment. Успешное создание
задачи этим read-only срезом не доказывается и не заявляется. Это контракт
для улучшения существующего EVO по Impeccable, без смены visual identity.

Уточнение того же контракта16: если staffAllowed=false, разрешённый case intent
не превращается в staffmode даже при collapse optional panel. Pending search
теряет право менять selection при committed disabled transition или unmount;
latest explicit selection должна читаться актуально, включая её очистку.
Существующие query sequence/cleanup guards сохраняются/расширяются только
для этой прямой зависимости; политика draft storage не меняется.

## 2026-09-21 — CRM-11 subset: надёжный поиск списка сообщений

Root владеет только этим переданным A срезом пункта11; остальная работа11
остаётся у A. Base после#954: `aa663b3d151462e6a7bac6249c459b7ef4e8899e`,
изолированный `evo-case-chat-search`. A записывает только shared contract до
кода; pending948/946 и их положительная приёмка не затрагиваются.

Фактический baseline root: existing ordinary Local QA Sales, owned local33222,
`/v3/messages` безcase. Видны4 существующих QA rows; запрос
`zz-no-matching-student` во время ожидания оставляет прежние4 строки без
loading, затем показывает «Переписок пока нет» и «Выберите переписку слева».
Никакая переписка не открывалась и mark-read не выполнялся. Source
`src/components/v3/case-chat/CaseChatThread.tsx`, CaseChatWorkspace494–502:
250ms debounce, без response sequence/catch/retry/unmount cleanup. Это source
race risk; фактически доказаны прежние rows/loading gap и misleading empty,
а не перестановка двух ответов или отказ настоящего RPC.

Контракт до кода:
- Latest query владеет результатом. Новое значение немедленно инвалидирует
  старую работу, включая промежуток250ms debounce. Только ответ текущего
  запроса может менять rows/loading/error; одинаковый guard нужен и для
  success, typed failure и rejected promise. После unmount clear debounce и
  invalidate pending callbacks. Не менять существующий read-only action/RPC.
- Явно различать loading, ready, error и filtered-empty. Не представлять старые
  строки без пометки как результаты нового запроса. Ошибка не превращается
  в «переписок нет» или успешную выдачу. Использовать существующие failure
  semantics, не обходить permission/tenant/current actor проверки.
- Retry повторяет текущий query и состояние фильтра, не stale closure query.
  Очистка поиска возвращает существующий обычный список. Debounce/empty retry
  не создают новые очереди или альтернативный источник данных.
- При отсутствии совпадений говорить об отсутствии совпадений и давать понятный
  способ очистить запрос. Unfiltered empty — отдельное состояние. Когда нет
  строк для выбора, не показывать вводящее в заблуждение «Выберите переписку».
  Это уточнение существующего EVO по Impeccable, без смены visual identity.
- Существующая selected conversation остаётся смонтированной при поиске,
  loading/error/empty; не менять её key/selection/URL или пересоздавать workspace
  при изменении query. Сохранить draft/reply/attachment, source-message context, back link,
  существующие private scopes, badges/unread/await-state и truncation hint.
  Изменение списка не вызывает open conversation/send/mark-read.
- Сохранить SSR initial data/query, row URLs и выбранный case, доступные
  permissions, текущий max/range/ordering. Не добавлять schema, queues, новые
  server commands, сообщения/fixtures, provider calls или записи в базу.

Реальная проверка только `/v3/messages` БЕЗcase под существующим Sales:
initial4rows → поиск существующего имени → loading/ready → no-match/empty →
clear/retry current query; desktop и actual390px. Не нажимать строки, не
открывать дело/переписку для проверки: этот путь автоматическиmark-read.
Последовательность async responses/errors/unmount допустимо проверить отдельно
на decision logic; это не заменяет реальный Auth/RPC/UI и не считается proof
реального provider failure. Недоступные actual error/reordering/selected-draft
состояния честно указать как непроверенные, без подставных успешных ответов.
Scope-local lint/typecheck/релевантные проверки + независимый exact-head review
и protected CI. Никаких business/Auth/provider/managed/production mutations.
Завершение этого subset не означает завершение всего пункта11.

## 2026-09-21 — CRM-07 subset: просмотр продажи до редактирования и возврат

Root владеет этим независимым срезом исходного пункта7 после#955. Base
`fe26526c547ef2579f6c324da0edd8f8e024d57b`, isolated
`evo-sales-record-preview`. A пишет только shared contract до кода.
Основание — CRM-02 / §4 «Продажи» функционального плана: сначала краткий
просмотр записи, отдельное исправление, сохранение контекста возврата.
Не включать server search, новую мобильную таблицу или закрытие всего пункта7.

Source: `SalesRegisterView.tsx` всегда ведёт строки на ?record, но selected
показывает только внутри canManage form. Read-only reader получает список и
сообщение о запрете исправления вместо самой записи. Общий href теряетoffset.
Данные selected уже возвращает действующий read_sales_register_v1 с текущим
actor/org/scoped record gate; новая миграция или RPC для просмотра не нужна.
Source files неизменны относительно inspected A52a00103 и mainfe26526c.

Реальная readiness до кода: ordinary existing local QA Admin и Sales вошли
через Auth и прочитали4 продажи2026/3месяца, offset1 даёт3строки и selected
existing record. Admin имеет sales.register.read и coarse manage permission,
НО sales_register_write_access=false; Sales=true. Это подходящий существующий
read-but-no-sales-write actor без создания роли/изменения permissions.
Private receipt `/private/tmp/evo-sales-readonly-readiness.json`. Это RPC proof,
не выполненная UI-приёмка нового preview. Root подтвердил обычный Sales UI:
в сентябре1 существующая продажа, USD1000 и неизвестное оплаченное.

Контракт до кода:
- ?record открывает краткий read-only preview выбранной доступной записи для
  всех readers. Только явное ?record&edit=true при canManage открывает прежнюю
  форму исправления. Denied/unavailable write никогда не раскрывает edit/archive
  controls; чтение сохраняется при разрешённом selected read. Ошибка/нет selected
  остаётся честным unavailable/forbidden состоянием, без fallback на чужую запись.
- Показать достаточно данных записи: человек/контакт/договор, программа/услуга,
  продавец, дата продажи и report month, суммы и валюты, уточнения/комментарий,
  понятное происхождение. Использовать прочитанный snapshot отчёта и егоversion.
  Не подменять его текущими lead conditions, не пересчитывать исторические
  дату/месяц/суммы, не скрывать неизвестные значения под нулём. Нулевые суммы
  отличаются от неизвестных; исходные raw значения при неразобранной сумме
  сохраняют смысл. Разные валюты не складывать.
- Source/history marker — понятная безопасная подпись. Не выводить raw JSON,
  технические payloads/source snapshots, секреты или посторонние персональные
  сведения под видом истории. Этот срез не добавляет отдельный audit reader.
- Сохранить year/month/archive/manager/direction/review/offset в переходах
  row→preview→edit→cancel/back. Фильтр/смена периода по-прежнему начинает
  соответствующую выдачу с её начала, pagination явно задаёт свойoffset.
  Не переноситьrecord/edit/new/saved как случайные постоянные фильтры.
  ?new flow, после-save banner/навигация, существующие commands/request IDs,
  права Sales Manager и прежние form safeguards остаются без изменения.
- Preview имеет явный возврат к отчёту и исправление только по canManage.
  Сохранение позиции списка — отдельное исходное требование: подтвердить
  фактическое возвращение к прежней позиции/строке, а если узкий срез доказывает
  только filters+offset, явно оставить scroll restoration открытым. Не объявлять
  весь CRM-02/pункт7 завершённым по одной URL-проверке.
- Существующая EVO типографика/светлая и тёмная темы/контраст/компактность по
  Impeccable; телефон может использовать отдельный читаемый экран preview.
  Не редизайн всей таблицы/отчёта и не перенос создания/коррекции в новый backend.

Проверки без business writes: actual ordinary Admin list→preview (selected
read успешен, sales editing отсутствует), прямойedit URL не даёт форму;
Sales list→preview→явноеedit→cancel/back, НИ ОДНОГО save/archive/create submit.
Desktop и actual390px, известная сумма/unknown payment/date/month согласованы
с тем же read DTO. Реальный nonzerooffset1 с3existingrows позволяет проверить
контекст возврата; dataset<50, поэтому это НЕ proof полноценной второй страницы
50+ или поиска до LIMIT. Проверить фильтры/архив/период только на имеющихся
данных, не делать фиктивные записи. Negative/unavailable path не выдавать за
проверенный без фактического ответа; scoped checks отделять от real-path proof.

Основные source boundaries: `src/components/v3/SalesRegisterView.tsx`, при
необходимости отдельный presentation component рядом; существующие
`SalesRegisterForms.tsx`, `src/lib/v3/sales-register-source.ts` и
`src/app/(v3)/v3/main/page.tsx` — сохранить совместимыми. Нет зависимостей от
213/214 commands, новыхschema/RPC/actions/roles/provider/managed mutations.
A948 и B946 положительная приёмка остаются HOLD; их код не cherry-pick сюда.
Scope-local lint/typecheck/релевантные проверки, независимый exact-head review
и protected CI. Source/UI proof не является подтверждением новой записи продажи.

## 2026-09-21 — CRM-02: фильтры отчёта продаж и выход из пустого результата

Основание до кода: main `0c3dfb86770b6663d8cffe893e13b14eff99ece2`.
В `SalesRegisterView.tsx` отсутствует сброс дополнительных фильтров; пустой
результат фильтра ошибочно описывается как отсутствие продаж за весь период.
При пустом offset есть совет вернуться, но нет прямого перехода к началу.
Форма без ключа может сохранять прежние uncontrolled values при client navigation;
выбранный manager, которого нет в options, визуально превращается в «Все».
В строках годового отчёта не показан существующий DTO `reportMonth`.

Контракт этого среза пункта 7, до реализации root:
- «Сбросить фильтры» очищает manager/direction/review/archived и offset,
  сохраняет валидные year/month, включая «Весь год». Не переносить record/new/
  edit/saved в ссылку сброса и не превращать неверный период в корректный молча.
- Ключ только GET-формы строится из отправленных URL-значений, чтобы сброс,
  client navigation и browser history показывали фактически применённые фильтры.
  Не менять ключи форм записи продажи, их drafts, commands и права.
- Выбранный manager, отсутствующий в текущих options, остаётся явным option
  с тем же значением. Не выдавать неизвестное имя за «Все» и не подменять фильтр.
- Пустой offset: «К началу списка» сохраняет все фильтры и период, сбрасывает
  только offset. Пустой результат дополнительных фильтров: честное сообщение
  о несовпадении и действие очистки с сохранением периода. Пустой период без
  дополнительных фильтров: предложение выбрать месяц или весь год в controls.
  Failed/invalid read сохраняет отдельное состояние ошибки.
- Для «Весь год» показать месяц отчёта каждой строки из её `reportMonth`.
  Дату продажи и финансовый snapshot не пересчитывать; не выводить report month
  из signingDate и не менять сортировку, DTO, суммы или смысл неизвестной оплаты.

Root владеет только `SalesRegisterView.tsx` и свидетельствами этого среза.
A сохраняет остальную часть пункта 7; общие документы записывает A.
Существующие parsing/validation, read RPC, права, finance, поля и бизнес-команды
сохраняются; новых SQL, поиска, записей, providers или migrations нет.
Проверить actual Sales UI на существующих local данных: сброс и browser history,
годовой месяц строки, unknown manager, filtered empty и offset-empty → start,
desktop и фактические 390px. Формы записи не отправлять, данные не создавать.
Scope-local checks, независимый exact-head review и protected CI перед merge.

## 2026-09-20 — CRM-30: независимое сохранение блоков карточки (213)

Основание: main `285e784e2a97aa42339cae1ca1d5aa6e465a3c7e` после #945;
213 выделена root для A, 214 — B. При чтении настоящей карточки Sales обнаружены
две связанные ошибки: три блока отправляют скрытые соседние поля из старого SSR,
хотя shared revision уже обновлена; «Условия продажи» отправляет12 полей,
а общий action требует29 и отказывает до RPC. SQL181 заменяет весь fields.

Контракт до кода:
- Добавить отдельный grouped-patch RPC с четырьмя закрытыми группами: sale9,
  wishes6, education5, conditions6. Требовать ровно все собственные ключи
  выбранной группы; чужие/лишние/пропущенные ключи отклонять. Старые v1 RPC,
  fingerprint, full-replacement API и reader DTO сохраняются.
- Новый action и четыре формы отправляют только command metadata, group и свои
  поля. Сервер берёт остальные поля из актуальной строки под тем же lead lock,
  проверяет expected revision и использует существующий normalizer184.
  Никакие поля из старого SSR не могут заменить соседнюю сохранённую группу.
- Fresh actor/org/admin-or-sales и scoped lead.sales.workflow.manage обязательны,
  в том числе до выдачи исторической квитанции и после ожидания блокировки.
  authenticated-only SECURITY DEFINER, пустой search_path; прежние права не расширять.
- Fingerprint включает original patch, group, actor, lead, expected revision и
  отдельный operation discriminator, вычисляется до объединения с текущей БД.
  Exact replay возвращает исходную immutable receipt даже после других saves;
  changed-intent/request reuse конфликтует; stale revision не пишет. Общая
  таблица receipts и её уникальность остаются; ошибка конфликта откатывает
  всю транзакцию, включая предварительное обновление строки.
- Сохранять существующие receipts/audit, tenant и Student-private границы,
  sales register, handoff, case/docs и финансовые snapshots. Формы сохраняют
  расположение/состав/читаемость EVO, видимые labels, controls и несохранённые
  sibling drafts. Shared revision растёт монотонно: поздняя старая receipt
  не понижает ожидаемую версию. Не добавлять автоматический refresh/remount.
- Impeccable Operate применяется к сохранению предсказуемого поведения формы;
  визуальный redesign/перестановка сводки студентов сюда не входят.

Проверки: typegen/TypeScript, scoped lint, реальные формы с exact own-key payload,
existing-input ordinary Auth read/denial. Положительная local UI/API проверка
требует отдельного конкретного решения после reviewable реализации: один уже
существующий lead, два временных технических текста в wishes/education, четыре
сохранения включая восстановление исходных пустых значений, без новых сущностей,
продаж, Auth-изменений или удаления audit. Проверить sibling draft/persisted
preservation, exact replay, changed-intent conflict и stale, unchanged financial
snapshot/case/docs. До разрешения эта часть не выполнена и не заявляется PASS.
A — единственный local schema applier; local/main порядок212→213→214.
Два независимых exact-head review и protected CI перед root merge обязательны.
Managed DB/providers/production этим контрактом не разрешены.

Архитектурная сверка20.09: PostgreSQL [row/advisory transaction locks](https://www.postgresql.org/docs/current/explicit-locking.html)
удерживаются до конца транзакции, а exception откатывает эффекты; Supabase
[database functions](https://supabase.com/docs/guides/database/functions)
рекомендует задавать search_path для SECURITY DEFINER и ограничивать EXECUTE.

## 2026-09-20 — CRM-30: custom staff authority и локальная correction213

Реальный ordinary Auth существующего custom SalesManager успешен; его
platform_role=NULL, а scoped lead.sales.workflow.manage и редактирование карточки
доступны. Новый213 ошибочно скопировал из181 literal admin/sales и возвратил42501
на заведомо неполный patch. Никаких положительных saves не было, business hashes
не изменились. Это уточняет первоначальный пункт admin-or-sales: действующая
модель156 разрешает custom staff через per-record permission, исключая Student.

Разрешённый source delta: ровно два actor predicates нового213 заменить на
IS DISTINCT FROM 'student'. Оставить оба fresh actor/org checks, membership
continuity, точный staff_can_access(...,'lead.sales.workflow.manage','lead',id),
locks, replay, ACL/SECURITY DEFINER/empty search_path. Старый v1/181 и208 неизменны;
208 уже использует permission/workflow identity. Никаких новых grants/ролей.

213 ещё не merged и не применена в managed DB. По правилу5
`docs/platform/p2-supabase-foundation.md` неизменяемость начинается после merge.
Root отдельно разрешил только одну bounded correction в owned local QA после
двух независимых exact-head source/script reviews;214 сохраняет B,215 не занят:
- доказать exact old213 SHA7b507099bd5433a507457e17f19b86374c201ab32b7fad00f6cd4977ed0c6ee7,
  body, ACL/owner/OID/signature/attributes и полный ledger row; schema001–213,
 214 отсутствует,001–212 byte/ledger unchanged; проверить draft/main состояние;
- сохранить original file/ledger/function и before business hashes в отдельном
  create-only private receipt; initial apply receipt не переписывать;
- одна guarded transaction: CREATE OR REPLACE только этой функции и явный
  UPDATE statements ровно одной local ledger row213 с full-old-row CAS;
  version/name и остальные ledger rows неизменны, no delete/reinsert/repair/reset;
- проверить exact new body, все function attributes/ACL и business parity внутри
  transaction; при различии ROLLBACK. После commit обновить только owned local
  candidate file/config, записать append-only receipt exact DDL/ledger delta и
  old/new hashes. Новый SQL SHA7e7e1fe8148f3cba4705d30f9fae25e45fa6e3c7f92b43c065a13b6be01e3e4d;
- если old state не доказан,213 уже merged/применена вне owned local, есть214
  или параллельное изменение — STOP и координация, без повторной починки ledger.

Это разовая local candidate correction, не общее разрешение править историю.
Original apply остаётся доказательством old hash, отдельная correction — нового.
Затем обычный Auth read/denials с permission-based проверкой custom identity.
Четыре положительных saves/restore, новые entities, Auth/provider/managed writes
по-прежнему не разрешены этим решением; owner packet остаётся HOLD.

## 2026-09-21 — A213/B214: совместная локальная проверка сохранения условий

Владелец одобрил подготовленный B214 QA-пакет для существующего
QA B209 Student 1; root подтвердил его границы. §2 файла
`EVO_B214_LOCAL_QA_AUTHORIZATION_PACKET_2026-09-20.md` повторно используется
для части acceptance A213. Основание A — reviewed head
`52a00103449d703d2f675e98770a9fbb21e95075`, локальная схема 001–214.
Согласованные девять полей группы `sale`, включая буквальные raw-значения,
не меняются: стоимость 1 KGS, оплачено 0 KGS, дата 2026-09-20 и отметки LOCAL QA.

После review этого docs delta root открывает одно локальное окно: B — единственный
исполнитель бизнес-команд, A — единственный наблюдатель сверки данных.
Свежий baseline для A фиксируется после согласованного назначения владельца
лида, до сохранения условий. Все следующие проверки A заканчиваются до
`create_sales_report_handoff` из миграции 208, чтобы не смешивать их с разрешёнными
изменениями продажи, дела и областей доступа:

- Один `save_lead_sale_conditions_group_v1`, `sale`, revision0 и фиксированный
  request R создаёт строку revision1, одну receipt и один audit. Readback сверяет
  все девять полей и неизменность остальных 17 полей относительно свежего baseline.
- Exact replay R/revision0 с теми же полями возвращает исходную receipt.
  R/revision1 с теми же полями отвергается как request conflict22023.
  Новый заранее фиксированный R2/revision0 с теми же полями отвергается PT409.
  После каждого повтора/отказа revision, receipts, audit и данные неизменны.
- Несовпавший baseline, неожиданный ответ или эффект останавливает окно.
  Дополнительных успешных сохранений, полей, дел или cleanup не добавлять.

Планируемое покрытие: INSERT/readback/replay/conflict/stale и сохранность
17 исходно пустых соседних полей. Он не доказывает UPDATE существующей строки,
сохранность непустых данных другого блока или несохранённых UI-черновиков,
две формы из общего SSR и обновление shared revision в интерфейсе. Буквальный
RPC payload B не подменять UI-значениями и не выдавать за React/action/UI proof.

Меняется только порядок локальной acceptance: согласованный B QA на reviewed
A213 и B214 может пройти до merge #948. Merge #948 остаётся HOLD до полного
UPDATE/cross-group/UI acceptance; merge #946 остаётся после #948.
Исходный A-пакет четырёх saves/restore на SaleCurrent — отдельный HOLD.
Новый runtime-блок, расширение QA-пакета, managed DB или production не разрешены.
На момент записи этого delta указанные положительные проверки не выполнены.

## 2026-09-21 — CRM-30: исправление избыточного ожидания разрешения на локальный QA

Root отменяет введённый агентами HOLD исходного A-пакета четырёх saves/restore.
Это исправление нашей интерпретации действующего поручения владельца продолжить
и завершить работу, а не новое точечное подтверждение владельцем этого пакета.
Прямого запрета владельца на необходимую обратимую проверку существующих local
QA-данных не найдено. AGENTS отдельно требует authority для production/providers;
проверка настоящего UI → Auth → owned local DB не подменяет поведение mock-ответом.

Разрешён только ранее подготовленный пакет `a213-validation-packet.json`:
существующий SaleCurrent, поля `wishes_countries` и `education_english`,
два явных временных QA-текста и четыре успешных сохранения с восстановлением.
Перед работой перечитать обычным Auth revision3, оба пустых поля, все26 исходных
полей и связанную финансовую запись. Любое расхождение — остановка для чтения и
анализа, не разрешение выбрать другой record, поле или расширить изменения.
Обновить устаревшие source/schema labels пакета: reviewed runtime A213,
действующая локальная схема001–214; request IDs UI фиксировать из actual requests.

До первого submit ввести оба черновика; сохранить wishes, убедиться в сохранности
education draft, затем сохранить education с обновлённой shared revision.
Проверить оба значения, остальные24 поля и неизменность finance/case/docs.
Exact replay первого запроса после второго save возвращает прежнюю receipt без
записи; другой intent с тем же ID конфликтует, новая команда со старой revision
отклоняется. Возвратить исходные пустые значения обычным API, предварительно
сверив текущую revision и совпадение именно наших маркеров; чужие изменения
не перезаписывать. Ожидаются revision3→7 и ровно4 receipts/audit; история остаётся.

B сохраняет единоличное выполнение своего окна. A готовит проверку, но запускает
её только после завершения/сдачи B write-окна и отдельного сигнала root.
Новых сущностей, Auth identity/ролей, реальных клиентских, managed/provider
изменений, direct SQL writes или удаления истории пакет не включает.
Merge #948 остаётся после фактического UPDATE/cross-group/UI acceptance,
финального QA-документа, независимого exact-head review и protected CI.
Частичный B INSERT proof не подменяет эту проверку; merge #946 следует за #948.


## 2026-09-21 — CRM-05: мобильная воронка с переключением этапов

До кода: main `3500fa8b4ef708358cc4a240656be9dbd43415b6`; root владеет
этим изолированным срезом и двумя appendices только в worktree
`evo-sales-mobile-stages`. A948 и B946/215 продолжаются отдельно.

На телефоне текущая доска последовательно показывает все семь колонок,
включая пустые. Контракт: при URL stage=all один мобильный переключатель
меняет видимую колонку без навигации и размонтирования карточек/форм.
Изначально выбран первый непустой этап, иначе первый. Доступны все этапы,
счётчики относятся к текущей загруженной и отфильтрованной выборке; при
truncated это явно подписано. Не менять read RPC, cap4000 или серверные фильтры.
При отдельном URL stage показать только выбранный этап и явную ссылку
«Показать все этапы», снимающую только stage; остальные счётчики неизвестны
и не показываются как нули. Эта ссылка меняет запрос и не обещает сохранение
черновика при навигации. Desktop-фильтр стадии и полная доска сохраняются.
Срок/назначение свернуть на mobile в один раскрываемый блок с числом активных
фильтров, сохранив единственные DOM-экземпляры и desktop-доступность.
Поиск/owner/reset953, q/due/assignment/owner/handed сохраняют контракт.

Server Pipeline передаёт содержимое колонок небольшому client viewport:
скрытие только responsive CSS, без selected ? mount : null, key=stage или
router navigation. Полный stages продолжает задавать доступные workflow-переходы.
Не менять ключ leadId:workflowVersion, request IDs, права, drafts/results,
заметки, задачи, preview и links. Handed_off остаётся производным; terminal
limit20 и show-all/latest прежние; счётчик не обрезать до20. Без SQL/команд,
сохранений business data, смены ролей, fake data или deployment.

Impeccable adapt/Operate: сохранены EVO/Golos/tokens, явное выбранное состояние,
44px touch targets, keyboard/focus и reflow320/390. Actual owned local Sales UI:
desktop и mobile одним inspection pass; все этапы, пустой этап, deep-stage URL
с фильтрами, раскрытие фильтров, unsaved draft+requestID до/после переключения.
Никакого submit. Scoped lint/types/существующие pipeline checks, independent
exact-head review и protected CI. >20 terminal и cap4000 не заявлять как real
proof без соответствующих настоящих данных. Это мобильный срез CRM-05,
не завершение всего плана36 или production acceptance.

## 2026-09-21 — B3b/214: актуализация локального доказательства после 215

Исходный контракт B3b выше сохранён как решение до реализации. Его прежний
блокер pending-дела снят в отдельно согласованном frozen QA packet: после
исправления215 обычный Sales handoff активировал то же существующее дело.
Обычный Student Auth создал одну подготовку; Student и Admissions прочитали
её через продуктовые readers. Exact replay не изменил состояние; новый
request того же выбора вернул ту же preparation и добавил только audit команды.
Changed-intent и чужое дело отклонены. A подтвердил ожидаемые изменения и
неизменность прочих строк, функций, ledger и числа Auth users на21 таблице.

Подробности, исходный failed handoff, точные reviewed revisions и границы
доказательства: [локальная QA-квитанция B3b](qa/b3b-catalog-preparation-2026-09-20.md).
Текущая локальная схема001–215. Это изолированные QA Auth/RPC проверки и
декодирование реальных ответов; полный web/iPhone UI-путь, требования и пакет
документов, managed rollout и production release ещё не завершены. Порядок
слияния #946 →215 →216 →217 и root как единственный merge/release coordinator
сохраняются. Эта запись не разрешает новые бизнес-записи или deployment.


## 2026-09-21 — CRM-22: клавиатурный переход к содержимому

До кода, base main011c0e49: в общей CRM AppShell нет skip-link, поэтому
клавиатурный путь каждый раз проходит повторяющуюся боковую навигацию и header.
Root владеет только этим изолированным срезом и его двумя appendices в
`evo-crm-skip-navigation`; runtime после merge959, независимо от217calendar.

Первый focus-visible элемент оболочки — ссылка «К содержимому». Она переносит
фокус на стабильную программно фокусируемую цель непосредственно у page children,
минуя Sidebar и global header. Не добавлять второй main/landmark и не менять
маршрут/данные/права/navigation builder/preview/actions. Не менять keys или
пересоздавать page children. Сохранить размеры страниц сообщений/календаря и
контейнерные breakpoint; EVO/Golos/tokens, видимый focus и44px цель. Ссылка
остаётся скрытой до keyboard focus, не создаёт постоянного визуального баннера.

Реальная read-only ordinary Sales localQA: desktop и390px на pipeline/messages,
первый Tab раскрывает ссылку, Enter переносит реальный document.activeElement,
следующий Tab достигает рабочего элемента. Back и unsaved search input без
потери; не открывать диалоги/не отправлять сообщения/не создавать задачи.
Admin preview только при существующей доступной сессии, иначе source-only.
Scoped lint/types/существующие navigation/brand checks, independent exact-head
review, protectedCI. Это один обоснованный срез22, не изменение всех экранов
или доказательство screen-reader/live-device acceptance. Без SQL/DDL/release.

## 2026-09-21 — CRM-02b: серверный поиск продаж (216, до кода)

Основание main `011c0e49e7a95b845eb52d34e10cc2bfa00f9f1f` после принятого #948.
Root утвердил q-only срез и выделил `216_platform_sales_register_search.sql`;
изолированный worktree `evo-sales-register-search`, исполнитель A. Общий план
CRM-02 уже задаёт поиск по имени, телефону и договору. Новых продуктовых решений
от владельца не требуется. Private анализ: /private/tmp/evo-crm02b-search-brief.md.

Доказанный пробел: SalesReportQuery/source/RPC не принимают строку поиска.
Существующий scoped reader144+156 УЖЕ фильтрует manager/direction/review/period/
archive до count/totals и LIMIT50/OFFSET; это сохранить. #956/#958 preview/reset/
back/context/annual reportMonth не переделывать. Direction facet и остальная
компоновка отчёта остаются явными следующими срезами; root CRM-05 mobile отдельно.

Контракт:
- Новые private/platform `read_sales_register_v2` с p_query, без изменения bytes
  v1 или overload c ambiguous defaults. Сохранить sales_register_actor, fresh
  scoped per-record authority, независимую проверку selected record и прежние
  owner/target/manager projections. Пустой q возвращает dataset/count/totals v1.
- Trim, максимум200 символов, control characters запрещены. Literal substring
  имени/договора без учёта регистра; %/_ не wildcards. Для телефонного запроса
  с цифрами и телефонной пунктуацией — поиск непустой цифровой части по digits
  сохранённого phone. Не извлекать телефонный поиск из произвольного текста.
  Нормализация только чтения; fuzzy/ranking/provider и новые индексы вне среза.
- Единственный query predicate входит в серверный filtered набор до count/
  currency totals/LIMIT/OFFSET. Архивные итоги и неизвестные суммы остаются
  прежними; план отдела не пересчитывается по найденным строкам. Не фильтровать
  первые50 rows в JS и не выгружать весь отчёт ради клиентского поиска.
- TS сохраняет строгий DTO; q проходит в обычный RPC и URL списка/preview/edit/
  back/pagination. GET submit сбрасывает offset; reset снимает q/фильтры,
  сохраняя период. Invalid query, unavailable, empty filter и empty period
  различимы. Не подменять ошибку пустым успехом.
- Impeccable Operate: существующие EVO/Golos/tokens/native controls, один явно
  подписанный поиск «Имя, телефон или договор»,44px, обычная клавиатурная отправка.
  Без autosubmit/анимации/нового декоративного контейнера. В этом срезе не менять
  финансовые записи, creation/edit authority, shared shell и соседние формы.

Приёмка: ordinary local Sales/Admin readonly21:38:20Z на001–214 дали4 строки,
4 имени,2 manager labels; phone/contract/direction пусты, hasMorefalse. Поэтому
реально проверить name-query, регистр, empty/zero, сочетания фильтров/count/totals,
selected/back/reset/offset1 и actual desktop+390 UI. После B215 продажи изменятся —
использовать свежий baseline. Positive phone/contract/>50 данных нет: pure predicate
checks или source review не называть таким DB/Auth proof; fake fixtures/новые
записи/правки фактов ради демонстрации не создавать. Существующий name-path достаточен
для принятого root search-path proof с явно указанными оставшимися ограничениями.
Сохранить tenant/record-scope и отказ unauthorized actor; отдельно проверить v1 parity.

216 local apply только после завершения215 и освобождения B writer window,
reviewed SQL + root GO; A единственный applier. Сверить ledger/business/Auth counts,
permissions/functions; scoped checks + независимый exact-head review + protected CI.
Managed DB, provider, production release и финальный E2E сюда не входят.
Основание SQL17: [строковые функции](https://www.postgresql.org/docs/17/functions-string.html)
и [function signature/security](https://www.postgresql.org/docs/17/sql-createfunction.html).

## 2026-09-21 — CRM-16: серверный источник личного календаря (217)

Основание: принятый UX/admissions-план §10 и
`docs/design/ux-refinement/calendar.md`. База `011c0e49`, отдельная ветка
`izzhackt/calendar-personal-source`. Root выделил
`217_platform_personal_calendar.sql` и временно передал авторство этого
календарного контракта исполнителю; чужие A/B-контракты не изменять.
Сначала review этого плана; runtime начинается только после merge #959 и
явного root GO. A остаётся единственным applier: 217 после 215/216, по сигналу
координатора. Этот контракт не разрешает business/Auth/provider/managed writes.

Текущий разрыв: календарь читает все разрешённые case-задачи; server predicates
119/124 с authority-поправками156 не ограничивают assignee. Общий target156 тоже
шире личного экрана. Staff-задачи отсутствуют, а admissions deadlines смешаны с
задачами. #954 уже исправил явный выбор дела — его формы и команды сохраняются.

Один функциональный срез, без переустройства всей оболочки:

- Добавить только календарную read-проекцию над существующими case/staff tasks.
  В каждой ветке требовать текущие actor/org/membership, собственное назначение
  и прежнюю object authority: case — task.manage + active/closed handed-off case;
  staff — staff.task.read. Ни creator, ни admin не заменяют assignee=current actor.
  Все исходные статусы сохраняются, completed/cancelled не исключать.
- Два новых public read-RPC в platform, без caller-supplied actor/assignee:
  `staff_personal_calendar_page_v1(p_mode TEXT, p_due_from DATE DEFAULT NULL,
  p_due_to DATE DEFAULT NULL, p_limit INTEGER DEFAULT 100,
  p_after_sort_at TIMESTAMPTZ DEFAULT NULL, p_after_kind TEXT DEFAULT NULL,
  p_after_task_id UUID DEFAULT NULL) RETURNS JSONB`;
  `staff_personal_calendar_target_v1(p_kind TEXT, p_task_id UUID,
  p_student_case_id UUID DEFAULT NULL) RETURNS JSONB`.
  Mode — dated/undated; kind — case/staff. Проверять конечные даты, from<=to,
  полную тройку курсора и limit1..100. Dated требует обе границы; undated —
  отсутствие date bounds и канонический null-deadline sentinel в курсоре.
- Page DTO: `{ rows, total_count, next_cursor }`. Отбор по authority, владельцу,
  mode и датам предшествует count/keyset/LIMIT; total_count относится ко всему
  этому отбору, не только оставшейся странице. Next cursor возвращается только
  при наличии дополнительной строки за p_limit. Порядок
  (sort_at, kind, task_id) детерминирован; в undated sort_at — прежний sentinel.
  Dated sort_at — due_at либо due_on в Asia/Bishkek; диапазон сравнивает
  канонический Bishkek day. Все проверки/count/page одного RPC видят один snapshot.
- Общая строка содержит kind, task_id, organization_id, version, title,
  description/details, status, priority, неизменные due_on/due_at, sort_at,
  assignee и created/updated timestamps. Case-ветка дополнительно содержит
  student_case_id/name/state, task_type и student_visible; у staff этих полей нет.
  TS использует discriminated union; UI-key `kind:task_id` отдельный от UUID
  команды, без коллизий между таблицами и без выдуманного studentCaseId.
- Target возвращает ту же личную строку независимо от первой страницы.
  Case target дополнительно использует текущие canonical assignees/capabilities
  общего task target внутри того же STABLE вызова, после personal guard.
  Staff target — собственная разрешённая задача с переходом к существующим
  действиям в Tasks, без вызова case-команд. Чужой/недоступный target возвращает
  одинаковую unavailable/42501 ошибку; общие Tasks/дело readers не урезаются.
- STABLE SECURITY DEFINER, SET search_path='', квалифицированные ссылки.
  REVOKE PUBLIC/anon/service_role и узкий EXECUTE новых двух RPC для authenticated
  в одной migration transaction. Private helpers/tables не открываются.
  Новых business permissions, assignments, ролей, task rows или write API нет.
- Ветка без соответствующей permission не выполняется и не раскрывает данные;
  если нет ни task.manage, ни staff.task.read, RPC возвращает42501.
  Sales с staff.task.read вправе читать staff-ветку даже без case-permission.
  Настоящий сбой разрешённого reader не подменяется пустым результатом.
  Route/section hints учитывают staff.task.read, сохраняя preview limitations;
  Auth/RPC остаются источником реальных прав.
- Calendar source/contracts читают новый page/target; выбранный dated диапазон
  исчерпывается страницами, undated остаётся ограниченной страницей с честным
  count. Старые case/task ссылки и case-only cursor URL поддерживаются; новый
  staff target явно различается по kind. View/date и undated cursor сохраняются
  при открытии/закрытии target; UUID и машинные ключи в интерфейс не выводятся.
- Убрать загрузку/рендер admissions deadline projections только из личного
  календаря. Дело, поступление и сами deadlines сохраняются. Минимальная
  адаптация Calendar/types/grids: union-key, staff detail/link, собственный
  count и корректные empty/unavailable states. Текущие case controls, expected
  version/request IDs, создание, черновики, Golos/EVO tokens и прочие views
  сохраняются. Полная side-panel/mobile-композиция — отдельный будущий срез.

Фактическая readiness21.09: ordinary owned-local Auth/RPC подтвердили Admissions
12 own/open/undated case tasks; Admin12 other/open/undated, доступный чужой target;
Sales case readers403/42501. Staff-list у всех трёх пуст. Undated keyset при
limit2: две страницы2+2 без повторов и собственный target за первой страницей.
Это исходная сверка, не proof новой217; секреты, task IDs/тексты не публикуются.

Проверки после source review и отдельного разрешения root на применение A:
ordinary Admissions сохраняет12 своих, Admin исключает чужие из list/target,
их прежний общий reader продолжает работать; Sales читает только разрешённую
staff-ветку. Проверить count/cursor/own target, desktop/390px, period/back,
честные empty/error states и отсутствие новых admissions-deadline reads.
Новых задач/ролей/фикстур не создавать. Dated/timezone-boundary, положительные
staff-task, иные статусы, creator scenarios и полный UI page100 overflow не
объявлять real-path PASS без существующих данных. Узкие TypeScript/lint,
parser/cursor/source-contract checks дополняют, но не подменяют ordinary UI/RPC.
Изменённый permission/deep-link путь проверяется в пределах имеющихся inputs.
Независимое exact-head review и protected CI перед root merge; без release.

Официальная сверка: PostgreSQL описывает общий snapshot для
[STABLE read-функций](https://www.postgresql.org/docs/current/xfunc-volatility.html),
[безопасный search_path и явные EXECUTE grants](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)
и необходимость [уникального ORDER BY перед LIMIT](https://www.postgresql.org/docs/current/queries-limit.html).
Применение здесь: стабильный read, закрытые private объекты и составной keyset;
не утверждение о выполнении будущей миграции.


## 2026-09-21 — B3c/218: требования выбранной программы (до реализации)

Root зарезервировал218 для B;216 — A sales search,217 — root calendar.
Направление принято root; runtime ждёт main946+960 и review этого контракта.
B владеет только этими двумя appendices в isolated evo-application-requirements-b;
параллельные worktrees и старый dirty checkout сохраняются. Исходники изучены
на941a42ae, contract branch основан на215 integration32f53535.

[Полный контракт B3c](platform/b3c-application-requirements-contract.md):
неизменяемая редакция требований preparation214 и обязательность каждого пункта,
явная идемпотентная инициализация и read-only Student/staff readers, TS/Swift DTO.
Данные документов остаются в существующих same-case slots/versions; двух приватных
append-only таблиц достаточно для первой редакции и её состава. GET не пишет.

Для новой простой подготовки — Фото и Загранпаспорт как старт EVO, оба required.
needs_confirmation сообщает о неподтверждённой полноте перечня вуза; не вводит
одобрение выбора сотрудником и не блокирует начало подготовки. Existing app/full
case checklist не заменяется двумя пунктами: needs_configuration без изменений,
до отдельного явного принятия полного состава. Автоматическое reuse только для
типизированных218 совместимых материалов; одинаковое название старого файла
не доказывает совместимость. Файлы, review и binary не копируются/переписываются.

Старые113 unlink/108 soft-delete остаются доступны; immutable обязательный пункт
reader сохраняет видимым как unavailable, не исключает из состава. Старые179
whole-case route binding и137 approved gate не служат новым программным checklist
или готовностью к первой Student-отправке. Staff documents требуют read.full/
manage в действующем scope; case.read.full недостаточно. Student — только своё
active portal-eligible дело; authority повторно проверяется после блокировок.

В218 нет UI, upload/draft/submit separation, пакета/очереди/review, external
submitted, новых ролей/Auth, провайдеров или production. Последующее принятие
полных перечней и сопоставление прежних файлов остаются частью принятого плана.
Проверка — обычный Auth в существующей local QA, реальные RPC/TS/Swift, replay/
duplicate/conflict и границы доступа, точный before/after. Нет подходящего случая
для положительного init — явно непроверенный результат, не замена его отказом.
Сначала scoped source review, затем согласованное DB writer window; runtime218
этой документацией ещё не заявляется выполненным.

Независимое pre-code review уточнило: fresh authority до replay, existing receipt/
revision до active/preparation/legacy eligibility; unique application revision и
item key, case-level сериализация reuse между программами; повтор не восстанавливает
удалённые links/slots. DTO разделяет required, slotStatus, reviewDecision, technical
availability/reasons и nullable configuration revision без фиктивной revision0.


Уточнение B218 до кода: [wire-контракт](platform/b3c-application-requirements-contract.md)
фиксирует immutable receipt/current reader, поля/nullability/decimal versions и
именованные причины отказа. Case legacy gate исключает уже доказанные218 typed
slots других программ того же дела. Изменённые108 metadata сохраняются, но
несовпадение с immutable label/group/intent возвращает needs_configuration,
без молчаливого reuse/retyping/replacement. Новый113 link сохраняет aggregate
slot-version bump. Root согласовал правила legacy/reuse/metadata; runtime
ждёт main946+960. Wire фиксирует детали принятого API-контракта.


### B3c /218 — локальное подтверждение RPC и DTO, 2026-09-21

[QA B218](platform/b3c-application-requirements-qa.md): exact source `bf52b38a`,
SQL `b20efabd…18f9d`, два независимых source review, schema-only apply и13 фаз
обычного Auth на прежнем QA-деле — PASS. Exact/new-request replay, staff existing
revision, foreign/conflict denials, metadata/unlink/no-auto-repair и явное
восстановление проверены с read-only before/after. Реальные TS-ответы и59 Swift
payloads декодированы; новое UI не заявляется. Root/A/B окна разделены, B writer
освобождён. Старые перечни и функции сохранены, Фото/Паспорт — только EVO starter.
Полный перечень/mapping старых файлов, draft/submit/package/review и UI остаются
обязательными следующими срезами; весь admissions-план не завершён.


## 2026-09-21 — B3d: интерфейс выбора программы и подготовки (до реализации)

После merged #964 (`c803d393`) следующий B-срез подключает214/218 к настоящим
Student web, staff CRM и iPhone: [контракт](platform/b3d-program-preparation-ui-contract.md).
Выбор сразу открывает подготовку, сохраняет same-case документы; существующая
подготовка открывается повторно независимо от текущего набора. Staff получает
каталоговый вход214 с сохранением прежнего ручного создания заявки. Selection и
инициализация218 — только явное действие, отдельные frozen intents, честное
восстановление частичного успеха; render/refresh не пишут. Права application и
documents раздельны; список подготовок не зависит от Finance.

Impeccable shape/operate уточняет иерархию, действие у конкретного набора, ошибки
и truthful starter-docs copy; до правок нужен реальный UI baseline, после —
ограниченная desktop/mobile/native проверка. Текущая загрузка сразу отправляет
на проверку: UI не называет её черновиком. Полный редактор требований/mapping,
upload≠submit, versioned packages/review остаются обязательными следующими блоками.
Миграции/роли/данные не меняются. Это pre-code на freshmain; UI implementation,
QA Auth/DB window и native isolation ещё не подтверждены. Root согласовал
направление; независимое review и принятие точного контракта предшествуют runtime.


## 2026-09-21 — item29: необязательные поля legacy-заявок CN/MY (219)

До кода: base main `5adce46e`; root закрепил миграцию219 за этим срезом.
Временное владение — только worktree `evo-cn-my-optional-fields`, ветка
`izzhackt/admissions-optional-fields`, и эти два приложения к контракту.
Runtime начинается после merge217 и отдельного root GO по этому контракту.
A/B и другие номера миграций не занимать; применять схему и координировать
общую локальную QA-базу может только назначенный root исполнитель.

Подтверждённая причина: guard137 проверяет admissions_details заявки, если
дело закреплено за admissions playbook. Его validator отвергает четыре
snake_case ключа из184 как неизвестные, даже когда форма полностью заполнена.
RPC184 всегда объединяет эти четыре поля с существующим JSON. В результате
legacy-заявка не сохраняется; unpinned-дело обходит этот guard и уже работает.
Это не запрос на переделку формы, данных или правил поступления.

Единственное runtime-изменение —
`supabase/migrations/219_platform_admissions_optional_partner_fields.sql`:
`CREATE OR REPLACE` существующей
`platform_private.admissions_validate_fields(TEXT, JSONB) RETURNS JSONB`.
Сохранить PL/pgSQL, STABLE, SECURITY INVOKER, пустой search_path, сигнатуру,
владельца и ACL; не добавлять public wrapper, EXECUTE, таблицы или роли.
137 и184, admissions_field_schema, guard, UI/action/RPC184 остаются неизменными.

После общего ограничения object/non-null/65536 bytes и до старой проверки
rule добавить только application-ветку для точных ключей `partner_contact`,
`external_link`, `decision_reference`, `decision_note`. Для каждого вызвать
существующий `application_partner_detail_fields(jsonb_build_object(key,value))`
через PERFORM и продолжить цикл. Его результат не подставлять вместо исходного
JSON: validator возвращает прежний `p_value`, включая все camelCase факты.
Нормализация blank/null остаётся обязанностью существующего RPC184.

Повторное использование helper184 сохраняет уже принятые значения: строка,
blank или JSON null; максимум300 символов contact/reference и2000 link/note,
проверка запрещённых control characters и непустой HTTPS-ссылки. Неизвестный
ключ, число/массив/object и остальные нарушения по-прежнему отклоняются.
Старые application-поля сохраняют непустую строку, точные date/enum проверки;
case/visa вообще не получают эту optional-ветку. Общая проверка размера остаётся
перед циклом; ограничение отдельного helper не заменяет общий предел.

Все caller paths учтены: guard applications/visa, case facts update и legacy
application/visa details command из137. Новые четыре application-ключа допустимы
последовательно в этих application-входах, а не только через RPC184; validator
не получает country argument и не вводит новых правил страны. Snake_case
`decision_reference` не заменяет `decisionReference`/`decisionEvidence`.
Submission/offer/visa evidence, closed-case denial и case cross-field gates
остаются прежними. Tenant/case authority, live recheck после locks, optimistic
version, request replay, audit и исторические записи не изменяются. Без rename,
backfill, pin/unpin, удаления или нормализации уже сохранённых фактов.

Проверки после runtime GO: diff функции должен отличаться только узкой веткой;
точечный source guard и независимое exact-head review; затем реальное выполнение
SQL validator/helper в согласованной локальной базе без business writes.
Проверить все четыре optional ключа: отсутствует/blank/null/допустимое значение,
предельную длину, неверный тип/control/link; сохранение смешанного legacy JSON,
unknown key, legacy blank, неверные date/enum, case/visa запрет optional ключей,
case evidence и общий размер. Это запросы к реальным SQL-функциям с граничными
аргументами, не fake entities и не замена persistence/UI acceptance. Сверить
ACL/owner/function attributes и неизменность остальных функций/истории.

Последняя readonly readiness-инвентаризация owned QA показала7 дел,0 playbook-
pinned дел и1 существующую application; подходящих pinned CN/MY applications0.
Это предыдущий snapshot, перед реальной приёмкой требуется новая проверка.
Ordinary Auth read существующей unpinned application проверит незатронутый
путь и доступ, но не докажет исправление legacy-сохранения. Нельзя создавать
fixture-заявку, pin существующее дело, менять Auth/роли или имитировать ответ,
чтобы объявить PASS. Если подходящей записи нет, итог явно разделяет source,
local SQL proof, unaffected Auth parity и отсутствующий changed-path Auth/UI.

Когда существующая подходящая owned запись действительно доступна и её writes
разрешены root-пакетом: через обычный application.manage Auth сохранить одно
поле при остальных blank, очистить, проверить legacy JSON, version/replay/stale,
authority/tenant denial, evidence gates и неизменность прочих бизнес-фактов.
Такой пакет не исполняется в pre-code и не разрешается самим этим документом.
Managed/prod apply, release и внешние провайдеры сюда не входят; item29 нельзя
объявить полностью принятым только по unaffected-пути или тестам функции.

Проверено по [официальному PostgreSQL CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html):
CREATE OR REPLACE сохраняет owner/permissions, но остальные атрибуты задаются
заново, поэтому они должны быть явно сохранены в219. Source: migration137
`admissions_validate_fields`/`admissions_guard_related` и migration184
`application_partner_detail_fields`/`update_application_partner_details_v1`.


## 2026-09-21 — item29: forward fix for discovered HTTPS validator dependency

The actual owned-local219 function run failed with `invalid regular expression:
invalid repetition count(s)` in the existing184
`platform_private.application_partner_detail_fields(JSONB)`.219 applied correctly;
its SQL stays immutable and its receipt remains `APPLIED_QA_FAILED`. No business
or Auth data changed. The failed run will not be relabeled or silently repeated.

The old HTTPS predicate uses `{1,1990}`. PostgreSQL bounds allow at most255:
[official pattern matching reference](https://www.postgresql.org/docs/current/functions-matching.html#FUNCTIONS-POSIX-REGEXP).
The required repair is part of the current item29 dependency, not new product
scope. Allocate new forward migration220; the unapplied A queue moves220→221,
root reason guard pre-code221→222, and future B schema starts223 if needed.

Before implementation, preserve the complete184 helper except the HTTPS
predicate: a nonempty value must have length9..1998 and match
`^https://[^\s<>"]+$`. This preserves the intended1..1990 suffix bound after
`https://`, optional blank/null normalization, four-key allowlist, per-key length
and control-character checks, signature, STABLE/invoker/search_path and ACL.
Keep all historical migrations,219, caller authority/replay/version/evidence
rules and stored fields unchanged. No backfill or synthetic candidate records.

After exact-head independent review, designated A may apply the frozen220 only
to the existing owned local project under an exclusive schema window. Compare
all existing business/Auth/ledger/function metadata; only this helper and the220
ledger entry may change. Run the already-reviewed real-function QA once against
the changed dependency, retain the original failure, and report both revisions.
Extend direct boundary checks only if the original packet omits a demonstrated
risk. Suitable pinned legacy Auth/UI data is still absent; successful pure SQL
validation is not authenticated persistence or browser acceptance. Production,
provider, customer and Auth-identity mutations remain outside this block.


## 2026-09-21 — item29 UI prerequisite: canonical profile without legacy handoff

The actual ordinary-Admin route on owned-local001–220 failed before any save:
`V3 profile handoff lead does not match the canonical case link`. Four existing
Auth reads confirm the authorized canonical case→lead link and readable lead,
but no case handoff and a null lead handoff case. Migration181 explicitly allows
this pending-case activation branch without a `sales_admissions_handoffs` row.
Absent optional legacy context must not be treated as a contradictory context.

Before code, scope the fix to `src/lib/v3/profile-source.ts`. Both explicit case
and direct lead routes must resolve the same authorized case. An explicit case
has already passed full case access and the105 canonical link reader. For direct
lead routing, reuse the existing184 cabinet discovery read as a candidate only:
it may return a different lead's same-client case, so require an exact105
case→requested-lead match before adopting it. Keep nonnull legacy handoff case
and lead consistency checks, authorization/read errors, tenant boundaries,
section permissions and the original handoff snapshot; never synthesize a
handoff, expand permissions or change stored records. No new SQL migration.

This is a demonstrated dependency of the current real save path, also needed by
A221 queue navigation and B3d staff UI. Root owns this file; parallel UI edits
must avoid it. Impeccable `harden` advice applies: a lawful missing optional read
must not blank the whole working screen, while contradictory or failed reads
must remain visible errors. No visual redesign or new copy is part of this fix.

Verify real existing case and direct-lead URLs through the same ordinary Auth
and existing data after exact-head independent review. Confirm the same case,
application and available tabs, and preserve role/section access. The local220
save packet remains separate and must bind to the corrected source revision;
no business save has happened yet. No synthetic handoff, Auth/role mutation,
provider/customer/managed writes, deployment, or claim of full product E2E.

## 2026-09-21 — CRM-03 / 220: полная очередь заявок (контракт до кода)

Root разрешил предварительную документацию в isolated `evo-requests-queue`
(base5adce46e) и выделил220 A. Runtime начинается только после merge A216/#962
и review этого контракта координатором; затем свежая интеграция main.218 остаётся
B,219 — root optional fields,217 — personal calendar. Порядок общей схемы и
main координирует root, A — sole local schema applier. Текущая локальная схема
001–217; эта запись не разрешает220 apply или новый business write.

Основание CRM-03/§6 принятого функционального плана: фильтр source в
requests-source.ts применяется после slice100; «Все» не включает consultations;
счётчик pending подменён длиной ограниченного массива, техническая ошибка анкет
объявляется отсутствием прав. Эти дефекты подтверждены исходниками, не
воспроизведённым положительным >100 runtime. Relevant source/page files на
A5572f288 идентичны main5adce46e. CRM-02 direction facet, compact totals и mobile
vertical rows остаются отдельными незавершёнными пунктами.

### Результат и границы

Один read-contract и /v3/requests объединяют три существующих kind:
lead(sourcewebsite/whatsapp), application(sourceplatform_application),
consultation(sourceportal_consultation). «Все» объединяет только разрешённые
актеру виды; наличие вкладки не создаёт доступ к строкам. Kind+canonicalID
являются идентичностью строки; связанные lead/application не дублируются под
придуманным source. Нового комплекта документов EVO и новых business entities нет.

Одна forward220 добавляет новую read-проекцию/RPC и закрытый helper при
необходимости. Старые migrations/readers и pipeline/dashboard consumers не
переписывать. Фильтрация source/kind/статуса и actor scope выполняется до LIMIT;
строки, matched count и pagination берутся из одного snapshot/filtered relation.
Не собирать результат из прежних capped page readers и не увеличивать100cap.

В новой очереди сохраняются существующие действия: открыть canonical карточку
lead; действующая approve/reject application команда; действующая handled
consultation команда. Не менять их permissions, optimistic revision/status,
request IDs, reason, idempotency, audit/history или последствия для Student.
ApplicationDecision доступна только подходящей pending строке и не в preview.

### Порядок, состояния и возврат

Root принял хронологический порядок timestamp DESC, kind DESC, canonicalID DESC
с детерминированным tie-breaker, без скрытого общего приоритета open/pending.
Для lead использовать created_at, consultation — created_at/requestedAt,
application — submitted_at текущей подачи. Это явное изменение прежнего lead
updatedAt order. submitted_at стабилен во время pending, но existing
rejected→resubmit обновляет его и revision у того же ID; не называть его
неизменяемым за весь срок жизни application. Не обещать snapshot между
переподачами, обработкой обращений либо сменой прав. Каждое чтение применяет
актуальную authority; изменившийся набор честно перечитывается.

Фильтры состояний типизированы по виду, как согласовано root: application
pending(default, прежняя очередь)/all; consultation all(default, прежний охват)/
requested/handled. Их текущие значения видны в UI и включены в cursor binding;
не придумывать новый lead pending/handled и сохранять canonical lifecycle=open.
Consultation history не теряется. Фильтры source сохраняют прежние URL значения.

Курсор versioned, bounded и строгий: complete timestamp/kind/id tuple и echo
активного source/status/limit, никакого частичного NULL cursor. Предусмотреть
next/previous и возврат из карточки без offset-based сдвига; граница сравнения
совпадает с ORDER BY и направлением обхода. При новом фильтре cursor очищается,
при retry и back сохраняется. Return target только валидированный внутренний
/v3/requests route. Cursor не является authority; чужой/устаревший доступ
не возвращает данные. Не обещать стабильность при изменении самого набора.

### Проверенная authority и сохраняемые защиты

11 актуальных функций прочитаны readonly из local001–217, exact definitions/ACL
сохранены в приватном crm03a-live-read-contracts.json. Перед runtime пересверить
их against freshmain, не копировать исторический177/197 как якобы current.

Lead путь: current_actor_authority + staff_has_permission(lead.read), затем
lifecycle=open и staff_can_access(org,membership,lead.read,lead,id). Сохраняется
также111-integrity guard receipt/audit/current workflow state, который выполняет
нынешний private.staff_sales_lead_page ДО выдачи строк. Предлагаемый способ
повторного использования: вызвать этот существующий reader с limit1 только
для полной guard-проверки, не использовать его ограниченный результат, затем
собрать минимальные поля новой проекции с теми же scope predicates. Root принял
направление при условии отдельного SQL review; не ослаблять guard и не трогать
shared reader ради новой страницы. Не раскрывать лишние stage/owner/workflow поля.

Application путь: student_application_staff_org / student_application_visible /
current can_manage с независимой triad profile.read.full, profile.manage,
case.curator.assign и направлениями; DTO через current student_application_json
и существующий строгий decoder. Новые signup/анкета поля не добавляются; item29
принадлежит root219. Consultation сохраняет текущий non-Student staff guard
с private.platform_has_permission(lead.read) и org-bound membership/profile joins.
Расширение роли Sales не является решением общей очереди.

DTO различает ready, forbidden, unavailable, not-requested perkind; forbidden
или unread часть не превращаются в count0 либо полное «нет заявок». Данные
и count недоступной части не раскрываются. Неожиданная integrity/SQL/transport
ошибка должна быть явно unavailable; нельзя подавлять её как успешный empty.
Если целиком read не удаётся, показывать общий error, сохранив выбранные фильтры.
Для частично доступного набора явно назвать ограниченный охват и не суммировать
unknown. Полная Student/private tests/docs информация в новый DTO не попадает.

### UX и владение

EVO/Golos/PartShell и текущие business actions сохраняются. Различать вид
обращения и source, показывать корректное основное действие; precise labels
«На странице», «Анкет ожидают решения», «Открытых консультаций» не выдаются
за один общий pending total. Initial empty, filtered empty, forbidden, unavailable
и partial имеют разные тексты/восстановление. Использовать существующие UI
patterns, не строить новый shell/design system; разрешённые действия доступны
с keyboard, длинные названия переносятся, mobile controls минимум44px.

A owns requests source/page, новый strict queue contract/SQL220, необходимые
узкие presentation/return adaptations и профильные tests/QA; A shared docs.
B/root файлы соседних flows не менять; broad рефакторинг, full product E2E,
контентная волна, AppStore и production release сюда не входят.

### Реальная проверка и нынешний пробел данных

Read-only inventory existing owned QA001–217 на20.09UTC22:13:04: lead other4/
platform_application3, website0/whatsapp0; application approved3/pending0;
consultation0. Это техническая инвентаризацияpostgres, не actor acceptance.
Нельзя заявить positive3kind/cursor/>100 acceptance на пустом наборе. Не создавать
fixtures/entities, не менять source/status/Auth/roles ради демонстрации.
Source-reviewed implementation и ordinaryActor empty/denial проверки могут
продвинуть срез, но он не полностью принят без подходящего positive path.
Отдельно зафиксировать разрешённый existing populated источник либо missing proof.

Требуются meaningful strict cursor/DTO tests, scoped types/lint, независимые
exact-head source/SQL reviews и protectedCI. Actual ordinary Sales/Admissions/
Admin чтения по реальным правам, Student/anon/tenant denials; filter-before-limit,
counts, next/back при одинаковом timestamp; retry/error/preview/action visibility.
Desktop+390/320CSS одной собранной проверкой, затем не более одного confirm-pass
после пакета UI исправлений. No fake totals/fallback success. Read-only QA
before/after сверяет затронутые business tables, Auth count, прежние functions и
ledger. Managed writes/provider actions/release требуют собственной authority.

Основание cursor: [PostgreSQL17 LIMIT/OFFSET](https://www.postgresql.org/docs/17/queries-limit.html),
[row comparisons](https://www.postgresql.org/docs/17/functions-comparisons.html#FUNCTIONS-COMPARISONS-ROW),
проверены20.09.2026UTC. Уникальный порядок и non-null tuple важны для предсказуемой
страницы; сами по себе они не дают snapshot всей изменяющейся очереди.


## 2026-09-21 — CRM-03: резерв очереди220 →221 до применения

Координатор перенёс неприменённую requests queue с220 на221. Реальная function QA
после schema-only219 выявила в существующем184 application_partner_detail_fields
ошибку PostgreSQL regex repetition count. Применённая219 сохраняется без изменения
ledger/hash; root выполняет её необходимое forward исправление новым220. Это
изменение порядка, не новая продуктовая функциональность очереди. Предыдущий
контракт CRM-03/220 выше остаётся историей первоначального выделения номера;
все его runtime/authority/UX/QA условия теперь относятся к221. Source candidate
7b4e6cd7 и correction abab969e ещё не применялись. Файл SQL переименован
221_platform_requests_queue.sql с сохранением байтов, роли и данные не меняются.

Актуальный порядок local219(APPLIED_QA_FAILED) → root220 → A221. A остаётся
единственным local schema applier, root — координатором и владельцем releases.
root task-reason переносится221→222, следующий B резерв223 при необходимости.
Новое применение только после exact-head review и root GO; production сюда не входит.

Независимое review очереди также выявило stale uncontrolled status selects при
Back/Forward. Форма получила identity key по source/applicationStatus/
consultationStatus/limit. Actual URL/history/visible-controls parity включена в
ожидающий реальный UI проход; существующие business commands не менялись.

## 2026-09-21 — CRM-03/221: shared presentation helper after real UI failure

Actual ordinary Admin UI on integration b3b04d95 (main44092c57/#966) failed before
rendering the populated requests list: server RequestsPage invoked submittedDate
exported by the use-client StudentApplications entry. SQL221/Auth35 proof remains
valid; UI is not accepted. Typecheck and source unit tests did not exercise this
RSC boundary. Preserve the failure in the slice QA rather than substituting RPC
success for the actual page.

Minimal direct dependency: move the existing unchanged date formatter and status
labels to the already shared pure src/lib/student-application-presentation.ts;
server page and affected client consumers import from it directly. No new DTO,
SQL, role, command, date locale/timezone or visual-world change. Impeccable
Operate/craft-floor guidance preserves familiar controls and the existing text.
Next.js documents use-client as the server/client module boundary:
https://nextjs.org/docs/app/api-reference/directives/use-client and
https://nextjs.org/docs/app/getting-started/server-and-client-components.
Repeat only affected lint/types and the actual positive page/navigation/mobile
path after this correction; final exact-head reviews must include the fix.

## 2026-09-21 — CRM-03/221: restore native filter state with browser history

Actual Chrome Back after submitting pending returned the saved all-status URL
and its positive row while the native select still showed pending. The earlier
form identity key alone did not reset the browser-restored form document; a
second submit therefore sent stalepending. Keep this failed UI evidence.

Move only the existing native GET status form into a small client component.
Keep defaultValue and ordinary controls, and reset the form to the canonical
server selection on navigation/props and pageshow restoration. Do not alter
filters/cursors, SQL, authority, commands or visual layout. MDN pageshow covers
returning to a document with browser Back/Forward, including bfcache:
https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event.
Actual Back/Forward plus resubmit must pass before acceptance.


## CRM-33 / SQL221 — причина изменения срока и приоритета case task — 21.09.2026

Pre-code контракт на main `5adce46e`; отдельная ветка
`izzhackt/task-change-reason`. Root выделил221 и остаётся единственным
координатором миграций и назначения applier. Сейчас разрешены только эти docs;
реализация начинается после merge219 и отдельного root pre-code GO.

Цель: закрыть остаток пункта33 / issue687 — прямой Admin RPC сейчас может
менять срок/приоритет case task без причины, хотя действующие UI/action уже
требуют её. Portal v1 уже удалён152; его повторное удаление и staff tasks
не входят. Исторический rollback prerequisite issue687 учитывается root
при принятии текущего поручения и delivery; этот контракт не означает
managed применение или production acceptance.

Изменение: новая forward221 изменяет только каноническое
`platform_private.coverage_change_task_body` с существующими11 аргументами.
В актуальном теле после133/156 удалить protected-Admin исключение из условия
`p_reason IS NULL ... AND (priority/due_at/due_on IS DISTINCT FROM ...)`.
Остальные bytes тела сохранить; перед заменой проверить точную текущую
сигнатуру/definition и единственное совпадение. Не копировать старое129 поверх
scoped authority, не редактировать исторические миграции, не вводить overload.

Инварианты:
- Причина обязательна только при фактическом изменении priority/due_at/due_on.
  Сохранить прежнюю проверку явно переданной причины1..1000 после btrim,
  статусные/no-op правила, API/default NULL и protected audit.
- Сохранить wrapper assignment/coverage locks, request lock, row lock, tenant,
  fresh task.manage/task.assign/task.visibility.manage и assignee authority.
- Guard остаётся после authority, replay и version check на прежнем месте.
  Исторический успешный request с прежней причиной возвращает прежнюю receipt
  после fresh authority check; новый NULL-reason change отклоняется22023.
  Stale остаётсяPT409; same-request changed payload/reason не создаёт запись.
- Не менять отдельные lifecycle/closed-case правила Admin, transitions,
  reason visibility, DTO, UI, staff-task API или данные. Deadline-only change
  остаётся audit event, а не выдуманным status transition.

Приёмка: existing LOCAL217 receipts показывают12 доступных Admin canonical
case tasks и12 own Admissions; Admin personal calendar0 не препятствует
проверке через общий Tasks. Сначала свежий read существующей задачи и версии.
В выделенное root writer window допустим ограниченный обратимый owned-QA
сценарий: новый request с реальным priority/deadline change и NULL/blank reason
отклоняется без row/version/audit mutation; обычный Admin с осмысленной причиной
сохраняет изменение, readback/audit подтверждают его; replay не дублирует,
changed request/stale отклоняются. Проверить обе ветки priority и deadline.
Вернуть исходные значения отдельной reasoned versioned командой только при
совпадении ожидаемого post-write version/state; при чужом изменении остановить
restore, не перезаписывать его. Audit/version историю не удалять.

Проверить существующий UI required reason и обычные authority denials в рамках
этого пути. Не создавать задачи/пользователей/роли/фикстуры; не менять provider,
Auth или Storage. Existing reversible owned-QA continuation не превращать
в повторный общий запрос; непосредственный applier/window назначает root.
Исторические129 test assertions оставить как provenance; новые scoped checks
проверяют forward exception removal и сохранение остального тела. Source tests
не подменяют actual Auth/RPC. Независимое exact-head review, protected CI,
точная local receipt с ограничениями; managed rollout и общийE2E вне среза.


## 2026-09-21 — CRM-33 reservation and implementation clarification

The earlier221 reservation is superseded: root219+220 repair optional fields;
A221 owns the requests queue; this reason-only forward migration is222. Runtime
starts after root219+220 merge and uses a fresh main. Local apply follows221
under the root-coordinated single schema writer; no managed authority is added.

Use a guarded `pg_get_functiondef` replacement of the exact eleven-argument
`platform_private.coverage_change_task_body` as it exists after156. Require
the source-derived body hash and exactly one known Admin exception anchor.
Replace only its obsolete rollback comment and predicate with a current comment
and `IF p_reason IS NULL AND (`; fail on source drift and assert exact resulting
body and unchanged pg_proc metadata apart from prosrc.
Keep the rest of the function, signature, attributes/owner/ACL and all wrappers
unchanged. Do not reintroduce removed student_portal_overview_v1 or modify the
separate Admin lifecycle exception. Current official PostgreSQL documentation
states that pg_get_functiondef reconstructs a complete CREATE OR REPLACE command:
https://www.postgresql.org/docs/current/functions-info.html.

The reason is required for a NEW effective priority/due_at/due_on change by
Admin as for other staff. Existing replay ordering, status-only/no-op behavior,
nonblank1..1000 validation, stale-version and authority gates remain unchanged.
The accepted item33 continuation authorizes this source/local slice; issue687's
managed deployment and owner acceptance exit conditions remain separately
unfulfilled, so a local PASS alone must not close that issue.

Use the existing owned task and approved scope-local QA packet only after fresh
readiness. No new entity/identity/role or synthetic response. Check isolated
NULL-reason changes for all three fields, explicit blank/length validation,
current Sales/Student denials, existing UI reason blocking, reasoned priority
and deadline changes, exact replay/conflicts/stale behavior, and guarded reasoned
restoration of original business values. Keep every audit/version increment;
no history deletion or claimed exact raw-state restoration. Existing UI is
unchanged; Impeccable harden advice is to keep clear required-reason feedback,
and actual UI inspection covers that existing behavior.


## 2026-09-21 — case-task reason guard: local QA complete

Source9f63/SQL222f2e0c8bd applied once to owned-local only after reviewed local
Docker/source/ledger guards. Existing ordinary Auth actors:8 denial commands,
4 reasoned writes plus exact replay/conflict/stale; business fields restored,
version+4 and4audits retained. Actual existing Tasks form rejected empty/blank
reason with0network commands.279other tables/Auth/schema/functions/ledger stable.
Local release receipt0c029bc4; original preAuth observer failure and offline
handover aggregate correction preserved. UI successful writes and managed rollout
not claimed. Details: docs/qa/case-task-change-reason-2026-09-21.md.
PR968 is merged43bd20c8; source222 remains separate until exact-head review/CI/merge.
Issue687 owner/managed exit and all remaining accepted1–36 work stay open.


## 2026-09-21 — A / item15a: remove automatic task actions from staff chat (precode)

Contract: `docs/EVO_CRM_UX_AND_ADMISSIONS_PLAN_2026-09-20.md` §9,
«Задачи из чата убираются». Previous A block CRM-03/221 merged as PR#968,
main `43bd20c802ef2e9789463548ef1a1e3c3cbcf09d`. This is a bounded first slice
of item15, not completion of the whole chat redesign.

Source was freshly checked at that main: the three target files, canonical chat
repository/type and Tasks route are identical to the previously inspected
583bd631. `readV3TeamChat` enriches each canonical page through
`team_chat_task_links` in batches of100. An auxiliary error/malformed response
currently throws unavailable for the entire snapshot. Every query mode uses
this adapter. `renderMessageAction` has no caller outside the two chat
components; `linkedTaskIds` is optional in the type and canonical decoder.

### Owned implementation

Only these three runtime files may change for this slice:

- `src/lib/v3/team-chat-source.ts`: return the existing canonical page with the
  same channels/participants and channel filtering; remove task-link RPC,
  batching/enrichment and dead imports. Preserve real errors from canonical
  readers; no fallback empty snapshot.
- `src/components/v3/team-chat/TeamChatMessageRow.tsx`: remove generated task
  links and Create task entry, plus its unused callback/ReactNode type.
- `src/components/v3/team-chat/TeamChat.tsx`: remove only the now-dead callback
  argument/type/forwarding. Keep all state and existing interactions.

No migration, DTO rewrite, package change or provider operation. Preserve
Tasks and all existing message history, IDs, bodies, authors, timestamps,
versions, reply relationships, deleted markers, mentions and plainTextLinks.
Preserve reply/edit/delete/moderation, direct message links, pagination/search,
realtime, channel authority and periodic recheck, current read state, drafts,
immutable uncertain retry payload and request identity. Existing Tasks
source/back URLs and command authority remain unchanged; older optional
linkedTaskIds payloads remain valid. Student case chat is outside this slice.

### Impeccable decision and verification

Operate/refinement guidance was consulted without rerunning session context:
familiar controls and consistent EVO/Golos/tokens stay; removing task actions
must not become an unrelated visual rewrite. This accepted functional reduction
also removes the source-observed auxiliary read failure coupling; no measured
latency improvement is claimed. Inspect incumbent actual UI before runtime
edits and read craft-floor immediately before the UI edit. After implementation,
inspect desktop/mobile together once; correct observed issues in one batch and
confirm at most once. Record advice → decision → actual result in slice QA.

Actual inspection waits for the coordinator's local QA window (B currently
owns it). Use existing ordinary staff Auth and authorized populated history;
do not create messages/accounts/tasks to obtain positive evidence. No Send,
Edit, Delete, Moderate or Mark read commands in this read-only check. Compare
canonical/rendered message identity/version/parent/body and channel metadata;
verify task actions absent, ordinary body links retained, and existing Tasks
source/back paths when suitable real history exists. Exercise query modes only
where history supports them; report absent coverage explicitly. Check business,
read-state/Auth-count and schema/function parity before/after. Runtime secrets
and raw message data stay private, outside Git/chat.

Run scoped lint/typecheck and the existing chat-mute, runtime-public-config and
staff-task-context checks for direct risks; these are source/unit evidence,
not real Auth/UI acceptance. Reuse the recorded unrelated knowledge failures
in v3-supabase-integration unless this diff demonstrates a new dependency;
do not broaden into fixing them or rerun unchanged failures to obtain green.
Do not add a test that merely repeats the deleted strings. Independent exact-head
reviews and protected short CI remain required; ROOT routes reviewers/merge.

Precode must be approved before runtime changes. Full item15's flat chronology,
quotes/old reply and draft compatibility, search context, channel previews,
autosize/scroll and sparse seen-message tracking remain separate work.


### A15a menu acceptance clarification before implementation

Fresh exact82c800 source, TeamChatMessageRow.tsx:48–60: the menu includes an
unconditional «Ссылка» deep link at line58. After Create task is removed, that
useful action remains for other-author/non-moderator and deleted messages.
Therefore this slice does not create an empty menu, and must not hide it based
only on edit/delete/moderation authority. Keep the current menu and Link action,
plus unchanged edit/delete/moderation conditions and focus refs. Actual UI
verification includes another author's menu where existing history allows it.
No conditional-menu rewrite is added to the three-file scope.


### A15a execution and evidence boundary

Runtime10aa2617 implements the approved three-file removal; scoped13 tests,
lint/types and diffcheck passed. Actual ordinary staff empty-history SSR/action
reads and desktop/mobile channel navigation passed. Full281/Auth/schema parity
held before/after both coordinated read-only windows. Local history is globally
empty, so populated menu/manual-link/task-link acceptance remains unverified;
no fake messages or mutations were introduced to fill that gap. Exact widths
and evidence limits are in docs/qa/crm-team-chat-task-actions-2026-09-21.md.
Final reviews/CI and merge remain separate; broader item15 is unfinished.


## 2026-09-21 — CRM-09b / item12: иерархия договора и оплаты (до кода)

После объединения #969 (`d3ceed4078`) root выполняет узкий presentation-срез
[контракта](design/v3/finance-hierarchy-slice-2026-09-21.md): стоимость услуг EVO →
договор → транши → оплаты/чеки → остаток. Вторичные общие обязательства и
дополнительные операции остаются доступными с прежними формами и правами.

Пять owned-файлов: Profile.tsx (только Money props), profile/tabs.tsx (только Money),
CaseAgreementBlock.tsx, CaseAgreementForms.tsx (только summary),
FinanceEntryWorkspace.tsx. Reader/DTO/SQL/команды/финансовые значения не меняются.
Не переносить весь contract workflow и не удалять вкладку: полный item12 остаётся
открытым. Доступный переход «Подготовка договора и отчёты» ведёт в существующий
workflow только при разрешённой вкладке. Preview не показывает write controls.

Impeccable Operate: существующие Golos/токены/компоненты, короткие предметные
подписи, раскрываемые вторичные разделы без unmount форм, минимум44px для действий.
До UI-правок — actual ordinary QA baseline и craft-floor; затем bounded
desktop/320/390 проверка, доступность и сохранность несохранённого ввода.
Сохранения финансовых операций/загрузки/production не нужны и сюда не входят.
Недоступные реальные финансовые варианты фиксируются как непройденные.
Scoped checks и independent exact-head review перед merge; managed delivery отдельно.


### CRM-09b: UI-срез проверен локально

Actual existing Admin Money/Contract,1280/390/320px; явные денежные подписи,
разделы и secondary disclosures, сохранность draft fields и правильные ссылки.
48scoped tests/lint/typecheck PASS;281business/schema/functions/ledger/Authcounts
без изменений. См. [QA](qa/crm-finance-hierarchy-2026-09-21.md) для runtime/proof
и отсутствующих финансовых datasets. Полный item12 и managed delivery открыты.


## 2026-09-21 — A / item15b: composer autosize precode

After A15a/#970, source analysis of main686b7f41 is recorded in
`docs/EVO_TEAM_CHAT_REMAINDER_ANALYSIS_2026-09-21.md`. Flat feed requires changing
the root-only reader, reply-to-reply/rollback contract and old draft recovery;
removing the thread UI alone would lose visible history. Sparse seen cannot
reuse the whole-channel read_sequence command. No migration number is reserved.

The next minimal accepted §9 slice is automatic composer height: currently
rows1 with manual resize and CSS44..160; no autosize effect exists. A owns only
TeamChatComposer.tsx and its existing team-chat.module.css textarea sizing.
Grow/shrink from actual current body and width, keep the existing limits and
internal overflow, restore saved drafts at proper height, clean up observers,
and preserve every draft/request/command/IME/focus/authority behavior. No new
history, SQL, message writes, DTO or stylesheet redesign.

Impeccable Operate/refinement preserves EVO and space for conversation; no
height animation. Official React/MDN sizing references, the complete invariants,
real unsent-input QA steps and known empty-history limits are in the analysis.
Source/doc work only while B owns the writer window. Precode approval precedes
runtime changes; actual UI needs a separately coordinated read-only window.
Independent exact-head review and protected short CI remain required. This
slice does not claim flat chronology, shared quoted composer or sparse seen.


### A15b offline implementation and incumbent evidence reuse

ROOT approved implementation on reviewed precode918c6edd while B211 owns the
shared QA writer. Reuse A15a actual staff composer evidence at10aa2617: both
TeamChatComposer.tsx and team-chat.module.css are byte-identical in this
precode. This replaces the earlier reopen-before-edit sequence for this block;
no DB/Auth/UI is accessed during B211. Verify the changed actual composer in
the next coordinator-released QA window, with calibrated CSS viewport widths.
Existing empty-history limits on edit/reply/saved-path proof remain unchanged.

## 2026-09-21 — CRM-09c / item12: перенос договорного workflow (до кода)

После #971/#972 выполняется [контракт](design/v3/contract-payment-workspace-2026-09-21.md):
единая вкладка «Договор и оплата», старый contract alias, независимые finance/contract
gates, все девять договорных actions и amoCRM section сохранены. Техническая
вкладка снимается только вместе с переносом полного workflow. SQL/readers/actions
не меняются. Impeccable Operate и существующее visual proof #971 задают компоновку;
новый actual read-only UI после освобождения окна B211. Ограничения populated
данных и managed delivery остаются явными. Scope-local checks, independent
exact-head review и protected CI обязательны; contract-only не получает finance RPC.

### CRM-09c — локальная проверка общего раздела

Runtime5b49a9c7: actual ordinary Admin old contract link/new money tab, сохранность
несохранённой формы и её фактического request UUID, secondary/service controls,
keyboard focus и1280/390/320 без переполнения после одной коррекции.281business,
schema/ledger/Authcounts без изменений; см. [receipt](qa/crm-contract-payment-workspace-2026-09-21.md).
Lint/types PASS; scoped92/93 и40/41 содержат одно подтверждённое прежнее
source-assertion падение. Full item12/managed delivery и отсутствующие populated
сценарии не объявляются завершёнными. Финальное review/CI остаются merge gates.


### 2026-09-21 — KB-31/32: reconciliation и два одобренных материала

После CRM-09c (#973, main925cf199) root выполняет ограниченный остаток31/32.
Проверить328 внутренних позиций сентябрьского плана по метаданным: каждую
учесть ровно один раз, различить служебные результаты и содержательные
кандидаты, сопоставить SHA/provenance с реестром5183. Файлы/позиции/факты —
разные единицы; generic reviewQuestion не означает вопрос директору. Тела
сырого архива, закрытых производных, applicant originals, trash и secrets
не читаются; статусы approval автоматически не меняются.

Для наполнения подготовить ровно два уже approved client output: «Обзор EVO
Admissions» и «Как EVO сопровождает клиента». Проверить source/output SHA,
owner-decision и audience; сохранить исходники и происхождение. Company files
берут точные approved bytes; предлагаемые snippets — дословные разрешённые
абзацы без технического frontmatter. Не добавлять цены, сроки и обещания.
До canonical writes сверить реальные доступные объекты через обычного staff
actor и исключить дубликаты. Прикладной пакет отдельно фиксирует actual IDs,
expected versions, аудиторию и допустимые эффекты; shared local окно только
после освобождения B. Этот offline срез не разрешает managed/provider/Auth
мутации, не публикует AI bundles и не закрывает весь31/32.

Приёмка подготовки: детерминированная приватная карта328/328 с исходными
статусами, публичная сводка без частных source paths/персональных данных,
пакет двух материалов с проверяемой цепочкой и точной областью использования.
Следующая фактическая canonical проверка и её ограничения учитываются отдельно.


## 2026-09-21 — item27: подтверждение почты, согласованный web/native контракт

До кода принят [контракт](design/signup-email-confirmation-2026-09-21.md).
27a добавляет только неактивные AEAD capability и строгие pure fragment/POST
валидаторы с реальными проверками этих функций; ни один существующий consumer,
Auth flag, маршрут, шаблон или UI не меняется. 27b согласует web и iPhone:
pending сохраняет анкету, очищает пароль, не создаёт Student authority;
старый native contract отклоняется до create. 27c — отдельная проверка
Auth2.196/Mailpit с конкретным разрешённым identity/template packet до включения.

Impeccable Operate/harden/clarify: существующие EVO/Golos/tokens, один pending
panel, понятные accepted/confirmed/saved состояния, RU/KY, focus/status и
320/390/desktop. Новый дизайн и provider-доставка из pure tests не выводятся.
Для27a достаточно actual crypto/parser tests, types/lint, independent exact-head
review и protected CI; UI/Auth ещё не включены. Полный item27 остаётся открыт.

## 2026-09-21 — B3e: полный список требований и явное сопоставление (pre-code)

После merge #967 (`17c60966`) следующий срез §11 — требования конкретной
подготовки214 и явное принятие подходящих113/137/179 документов дела.
[План B3e](platform/b3e-full-requirements-and-mapping-plan.md) сохраняет immutable
program/publication/intake/deadline, прежние файлы/решения и отсутствие approve
gate для самого выбора. Новый staff-save создаёт редакцию, не отправляет пакет.
Строгие starter-only218 DTO требуют v2-first перехода web/CRM/iPhone: старый v1
не выдаёт прежние два пункта как текущий полный список; historical receipt replay
сохраняется после проверки текущей authority. Полные upload/submit/packages/review
остаются следующими обязательными блоками, не отменены этим ограничением.

Это docs-only pre-code: root принял направление, runtime ещё не реализован,
номер SQL не зарезервирован, DB/Auth/UI/production действий нет. A подтвердил
отсутствие пересечения с каталогом в текущем team-chat223; root27b signup sections
и shared i18n/Swift keys согласуются перед runtime-правками. Независимое review
и CI этого плана фиксируются в отдельном PR, без заявления функциональной приёмки.


### A15c precode — additive flat timeline reader, 2026-09-21

After A15b merged in6d01bc81/#974, select the next coherent read foundation from
`docs/EVO_TEAM_CHAT_FLAT_READER_PLAN_2026-09-21.md`. Accepted product plan§12
requires old replies AND new unread accounting before thread removal. Add a
separate bounded timeline/context reader over original message rows, safe parent
quote projections, strict DTO/decoder and authenticated repository access.
Preserve all v1 readers/commands/URLs/drafts/read cursors and current UI.

The plan fixes latest/before/after/context semantics, sequence vs change-watermark
separation, current156 scoped authority, tombstone redaction, index/rollback and
real Auth validation limits. It does not allocate migration223 or authorize SQL,
Auth or QA writes. Independent precode review and ROOT migration reservation/GO
precede implementation; populated QA requires a separately reviewed packet.
The existing flat-feed/quote/shared-composer/sparse-seen dependency analysis is
retained; this foundation does not claim full item15 delivery.


### A15c precode approval and migration reservation before code

Independent inventory_plans approved exact55109f62. ROOT reserved223 exclusively
and authorized offline implementation of the additive reader/types/decoder/server
repository and scoped tests. Clarify UUID uniqueness with monotonic sequence only;
channel authority must reject NULL (`IS NOT TRUE`). Preserve every v1 path and
current UI. Migration apply/Auth/positive controlled QA still await a separately
reviewed local packet and coordinator window; B currently owns that environment.


### A15c local223 apply and bounded QA account limitation

Migration223 applied once from reviewed source9c589938 with the independently
approved v2 packet; existing281 business tables/Auth counts and old schema
metadata/ledger are preserved. Positive QA stopped before any command because
existing `salesOther` credentials fail ordinary sign-in. No fixture history was
created, no account/role was changed, and postfailure parity is confirmed.

Prepare a separately reviewed QA-only revision on already-installed223 using
only positively resolved ordinary Sales and Student. Preserve the original
failure and disclose unavailable second-employee unread coverage; do not create
an identity or relabel historical credential failure as a new HTTP observation.
Exact retained56-message/58-command scope is unchanged. New coordinator GO is
required for the revised exclusive window; never reapply223. See the223 QA packet
for immutable receipt hashes and validation boundaries. This does not change
runtime behavior, authorize production, or complete the flat-feed UI block.


### A15c implemented and actual local Auth QA passed

Additive223 flat history/context reader, bounded current parent quotes, strict
TypeScript decoder/repository and9 pure contract checks are implemented in#976.
Runtime9c589938 remains unchanged after integrating mainc5d9a4cf. Existing v1
commands/URLs/drafts/read markers/composer/UI remain unchanged.

223 applied exactly once; independently reviewed v5 normal-Auth QA passed on
sourceHEADc37d8628 with19 decoded actual pages and17 pre-write negative cases.
Approved retained56 local QA messages produced58 effective commands and one
same-input replay with zero additional effects. Every prior row and277 other
business table hashes are preserved; schema/ledger, stored read markers and
notifications remain equal. Writer released; final receipt SHA256
8f6966b71e8e94da55d80510cfb349a10936b9628b747ad6da8b8495304f3379.

Three earlier pre-command harness stops are retained, not relabelled as passes.
Other-Sales observer and real other-tenant coverage remain unproved. Final exact
PR-head review/short CI and merge are separate; no production apply/release or
flat UI cutover is claimed. See docs/qa/crm-team-chat-flat-reader-223-2026-09-21.md.


### A15d precode: sparse seen before flat UI cutover

A15c PR#976 merged at03068e1f; additive223 is already installed locally and must
not be reapplied. A bounded actual Sales read-only UI critique at1280x900/390x844
confirmed excessive message spacing, missing channel previews, separate thread
composer and history-position loss after search. Full281-table/data/schema and
Auth user/identity-count parity passed; ordinary sessions changed. Own browser
and dev server are closed. Receipt7c2da6de7ebb35611d49bf6f022164260278fbcb29eaa96dd92634bcc735e3bf.

The next proposed code slice is A15d only: private per-actor seen IDs, additive
idempotent mark_seen and compatible unread calculation, preserving historical
read_sequence and all current UI/commands/drafts. Later quote compatibility,
draft recovery, flat-feed/search/scroll integration and density/previews remain
separate dependent slices. Do not remove thread UI before these prerequisites.
See docs/EVO_TEAM_CHAT_FLAT_UI_PLAN_2026-09-21.md and its actual QA receipt.

This append is precode only, awaiting independent exact-head review.224 remains
B-reserved; A has no new migration number or apply/Auth-write window. Production
release and new QA identities are not authorized by this planning slice.

## 2026-09-21 — B3e-1 / 224: read-only v2 protocol (до реализации)

После #979 root выделил224 для authenticated v2 requirements readers.
[Точный контракт](platform/b3e1-requirements-v2-read-contract.md) сохраняет
initializer/receipt/pending v1, добавляет строгую flat v2 проекцию текущего218
и переводит CRM/web/iPhone reader consumers. Схема/полные редакции/editor/write
ещё не включаются; reserved full DTO decoding не означает working full backend.
Новые private/public functions без business writes; apply/QA только после
проверки точного пакета и отдельного root writer window. Старые slots/files/review,
214 publication/intake/deadline и последующие §11 submit/packages сохранены.


### A15d precode accepted;225 reserved before implementation

PR#981 exact54fb718c passed independent review and CI35551960705 and merged
at67934327d. ROOT reserved225 exclusively for A15d (224 belongs to B) and
authorized offline implementation of the accepted sparse-seen contract.

Implement private per-actor seen IDs, an additive idempotent mark_seen RPC with
bounded batch acknowledgement, compatible channel unread counts, strict
types/decoder/repository/action and scoped checks. Keep current UI, read command,
message history, root/quote semantics, drafts and legacy read_sequence unchanged.
No local apply/Auth/browser window or new QA identity authority is included.
Other-author unread coverage requires an independently reviewed real-actor packet.


### A15d offline implementation; real225 QA still pending

Runtimefb12146e implements225 private sparse seen, additive mark_seen with
strict complete-set acknowledgement and existing channel unread exclusions.
Current command/UI/parent links/drafts/timeline223 remain unchanged. Published
custom-staff authority is retained; own/deleted/legacy-read IDs are no-ops,
unknown/cross-scope IDs reject the whole batch. No seen cursor compaction.

Seven pure contract tests, scoped ESLint, TypeScript and SQL parser checks pass;
these do not prove actual SQL/Auth behavior.225 is not applied,224 must precede
it, and ROOT currently owns shared Auth/DB/browser. Other-author unread proof
requires positive ordinary existing-observer Auth and a separately reviewed QA
packet/window; no staff provisioning or retry of unavailable salesOther.
See docs/qa/crm-team-chat-sparse-seen-225-2026-09-21.md for hashes and limits.


### A15d source review accepted; bounded225 QA proposal remains offline

PR#983 exact63dfdb00 independently approved; CI35552439001 passes, including
migration boundary. Runtimefb12146e is unchanged. The separate QA proposal
uses existing Admin/Sales/Student only after positive ordinary Auth/authority,
15negative mark_seen cases,10positive acknowledgements, exactly5retained seen
rows and one legacy read plus its replay. No history/provider/identity writes.

QA-only executable is syntax checked but not run; its manifest deliberately
has no future225 apply/release bindings.224 source/release, fresh baseline,
separate apply driver/packet review and ROOT window GO still precede execution.
See docs/qa/crm-team-chat-sparse-seen-225-packet-2026-09-21.md.


### A15d QA transport guard correction — offline only

Independent packet review found one P2: bind credentialed HTTP to the pinned
local Kong/project before login. The proposed helper now disables ambient
proxies and freshly checks pinned DB/Kong, Kong image, project/workdir, common
network ID and port57495 before every API request. Expected topology comes
from saved ROOT27c evidence; no current environment claim or execution.
Runtime/decoder/business QA sequence remain unchanged. Python syntax and docs
diff checks only; final224 release/apply packet/review/ROOT GO remain required.


### A15d local225 window — actual224 baseline accepted, apply pending

B applied224 once and released the shared local environment. ROOT transferred
the exclusive225 window to A. A ran a fresh READ ONLY full281/catalog snapshot;
it exactly matches B final state, ledger001–224 and Auth8/8, including ROOT27c
retained QA. Sessions are outside that equality claim. No225 apply/Auth yet.

The prepared single-use driver preserves all old data/metadata/ACL and verifies
new table/RLS,4 table+4 PK index catalog columns,3 constraints,8 internal FK
triggers, one RPC and only the reviewed channels body. Full282 SQL/state will
be retained for ROOT32. Independent driver review and exact source224/main
integration/manifest binding still precede apply and the approved scoped QA.


### A15d source224 integrated; reviewed225 driver awaiting final binding

Merged main2b23285d (PR982) into225 with all five A runtime hashes unchanged.
SQL224 equals B's actual reviewed/applied source. Append-only journals preserve
both branches. Independent apply driver review APPROVED f68bc2bb; observer
ea5a52df and catalog2520542a unchanged. Final integration-head/manifest review
and protected checks remain; no225 apply/Auth run has occurred yet.


### A15d local225 applied and sparse seen QA accepted; window released to ROOT32

Exact actual source3fc9ef34 integrates accepted224 and preserves all A runtime
hashes. Reviewed local CLI applied225 once: old281 data/metadata/ACL and ledger
preserved, new seen empty. Ordinary Admin/Sales/Student Auth passed;15 negative
calls and2 own/deleted no-ops completed before a retained harness SQL NULL stop.
Fresh full282 reconciliation proved0 business writes. Independently reviewed
bounded continuation reused those17 actual proofs and executed only previously
unstarted legacy read/replay and8 remaining mark_seen calls. No rerun/reapply.

Actual outcome:5 scoped seen rows, one Admin/general preference, one legacy
receipt; repeated/reordered/subset/concurrent calls add no extra rows. Unread
54→53→51→50→48; gaps remain unread. All10 actual acks decoded,279 other tables,
old prefs/receipts, full postapply catalog and ROOT27/B224 data unchanged;
ledger001–225/Auth8/8 preserved, sessions not claimed equal. Release2d7c943d
contains full282 after_state and exact SQL19076b91, handed to ROOT32. No own
server/browser/background process. A now docs/PR only; CI35555819344 passed
at3fc9ef34; final docs exact-head review/checks still required before merge.
No production/UI/server-action journey or whole-item15 completion claimed.


### A15e precode: additive direct quotes while preserving v1 root replies

A15d merged in main439a66de. New bounded contract at
docs/EVO_TEAM_CHAT_DIRECT_QUOTES_PLAN_2026-09-21.md proposes one private quote
map, post_v2 and timeline_v2. Existing command171 (with156 scoped rights),
reader223, seen225, messages and frozen v1 requests remain unchanged. V2 keeps
server-derived root-parent separately from direct target and stores an explicit
versioned canonical receipt identity so same-root/different-target retries
conflict safely. Current quote text is projected, never copied into the map.

This step is prose-only. ROOT confirmed reservation227 before SQL implementation;
226 belongs to B and ROOT32 owns local DB/Auth/UI. The plan bounds future QA to
four new labelled messages plus edit/delete of its own new reply, with no old
message/seen/preference changes. Future apply waits226 release and a fresh
coordinated packet. No runtime, Auth, DB, browser or production action here.

## 2026-09-21 — KB32: ограниченная локальная запись approved материалов

После merged #975 продолжается существующий независимый KB-поток: два
дословных snippets и две company file versions через обычный Admin UI,
реальный ClamAV и private Storage. Owner content approvals сохраняются;
новой фактической политики и AI-публикации нет. Новый runtime-код не нужен.
Перед записью — fresh baseline/dedup после B224→A225, после — exact readback,
два download hashes и scoped data reconciliation. Production не разрешён.
Пакет: `docs/qa/knowledge-approved-materials-local-2026-09-21.md`.
Подготовка scanner завершена; actual canonical write ещё не выполнен.

## 2026-09-21 — KB32 actual local evidence и ограниченная UX-коррекция

На frozen63e8ef9a реально сохранены2 approved snippets и2 scanned private files.
Первый audited download307 остановлен Chrome ERR_BLOCKED_BY_CLIENT; второго
не было, byte-download proof остаётся открытым. Actual budget8 receipts/10audit,
1grant/consume;184 прежних audit,271 посторонняя таблица и схема сохранены.
Student RPC403 и staff API401 проверены с тем же cookie positive /portal200.
См. docs/qa/knowledge-approved-materials-local-2026-09-21.md. Не full32 complete.

До следующей UI-правки принят малый scope по actual screenshots/computed style
и Impeccable clarify/harden: устранить override primary bg/text в KnowledgeLibrary
и столкновение breadcrumb/search на320px в FileManager. Сохранить EVO/Golos,
подписи, все actions/forms/rights и внутреннюю прокрутку таблицы. Только local CSS
и responsive layout; без новых бизнес-записей/миграций/provider/production.
Проверка одной общей партией desktop+390/320, включая create/update contrast,
поиск/очистку, breadcrumb и table actions; максимум одно подтверждение после
правки. Первоначальный content proof остаётся привязан к63e8ef9a, UI proof
получит отдельный новый SHA. Это исправление наблюдённых дефектов, не redesign.

### KB32 — локальная UX-коррекция проверена

Source547f7897 исправляет только подтверждённые primary contrast и mobile
breadcrumb/search. Actual desktop1440+390/320, search/clear, внутренний table
scroll и раскрытие file actions пройдены без бизнес-записей. Scoped lint/tsc/
diff-check PASS, independent source review APPROVED. Full282/Storage/Auth
равны завершённому content snapshot. Download-byte proof остаётся BLOCKED;
не весь32 и не1–36 complete. Production и clientAI не публиковались.


## 2026-09-21 — B3e-2 / 226: редактор требований (до реализации)

#982 merged2b23285d: v2 readers уже в main, полный backend ещё не реализован.
Root резервирует226 после A225 для полного staff editor/immutable revisions/
explicit legacy mapping. [Точный контракт](platform/b3e2-requirements-editor-contract.md)
закрепляет scoped document права, стабильные IDs, полный inventory113/137/179,
точное idempotent intent и совместимость v1; не ослабляет mandatory gates.
Новый согласованный editor-read и один atomic save расширяют таблицы218 без
backfill старых строк, upload/submit/package процесса или правки214 binding.
Impeccable Operate сохраняет EVO/Атлас и функции, максимум две visual rounds.
Source work разрешён; DB/Auth/UI queue A225→root32, B226 window ещё не выдан.
Перед реализацией independent exact precode review; перед apply/QA отдельный
reviewed effects packet. Production и публикация старым native clients отдельно.

## 2026-09-21 — CRM-09d: сохранить местную дату оплаты

В рамках пункта12 найден отдельный дефект: `recordCasePaymentAction` получает
время Бишкека из формы, переводит его в UTC и отрезает дату UTC. До06:00
местная дата становится предыдущей; на границе месяца меняется и месяц.
Исправить только получение DATE для `record_case_payment_v1`, сохранив
проверку календаря/времени, права, request ID и существующий timestamp-путь
общего финансового журнала. Миграция и изменение прежних записей не нужны.
Проверить чистый parser на границах дня/месяца/года и invalid input; после
окна KB32 проверить существующий ordinary UI путь без подмены hidden времени.
Финансовый CRM→Student путь остаётся отдельной фактической приёмкой;
чистый тест даты не выдаётся за исполнение оплаты или production release.

### CRM-09d — точная локальная QA перед исполнением

После root32 повторно связать existing Student1 case→membership→profile→Auth.
Прежний09c экран1000USD относится к другому делу; он не доказывает баланс
Student1. Сохранённые receipts целевого fictional QA дела показывают1KGS
условий и отсутствие obligations/events; это требует fresh readiness.
При совпадении через обычный Admin UI создать один явноLOCAL QA tranche1KGS
и записать fictional payment0.50KGS без реальных денег/провайдера. Точный
request UUID и at берутся из реальной формы без подмены hidden времени.
Проверить actual local DATE и событие вCRM, затем тем же Student портал:
1KGS начислено,0.50 оплачено,0.50 осталось. Portal DTO не содержит даты события.
Бюджет: +1obligation,+1event,+1evidence,+2audit; обновляется только новый
obligation. Все прежние строки, условия/cases/schema/Storage неизменны;
Auth login/logout отдельно. Новые identities/права/активации/receipt files,
refund для cleanup и production не разрешены этим сценарием. Actual result
фиксируется отдельно; parser tests и предложение QA не означают выполнение.


### CRM-09d — локальная запись оплаты и Student readback выполнены

Frozen source `2c0755c1` после #985 прошёл обычный Admin UI → action → RPC →
Student UI: один QA-транш 1,00 KGS, оплата 0,50, одинаковый остаток 0,50 и
статус частичной оплаты. Actual form time21Sep09:40 сохранён как местный DATE;
ночная граница отдельно проверена pure tests, не фактическим UI.
Ровно +1 obligation/+1 event/+1 evidence/+2 audit; прежние194 audit,
остальные278 таблиц, схема225 и Storage сохранены. Independent effects review
APPROVED a0747bd3, final a2df3c2f. Own sessions/runtime завершены; full282
handoff cce0f273 передан B226 для fresh baseline. Подробности и пределы:
`docs/qa/payment-calendar-date-2026-09-21.md`. Это ограниченная локальная
проверка оплаты, не весь12/1–36 и не production release.


## 2026-09-21 — B3e-2 / 226: локальный editor/save/readback подтверждён

На frozen `6cdacc76` после ROOT09d локально применена226 один раз, затем ordinary
Admin UI выполнил Q1 A2, Q2 B2 и Q3 A3. Ровно +3 revisions/+7 items/+1 empty
optional QA slot/+1 link/+3 audit; прежние строки всех282 tables сохранены.
14 ordinary HTTP reads и Student A/B desktop/mobile пройдены. Own sessions
logout local204, Next33236 остановлен; Storage и Auth identities сохранены.
[Фактический отчёт](platform/b3e2-requirements-editor-qa.md) разделяет executed
proof, сохранённые helper failures и runtime gaps. Независимая сверка результата,
актуальный main, PR review/CI остаются merge-gates; production не разрешён.
Это завершение bounded core-сценария, не всех recovery/concurrency/legacy/native
расширений и не всего плана1–36. Нового scope/API во время QA не добавлено.


### A15e offline implementation227 prepared; actual database/UI work pending

Accepted precode PR986 merged418521f5. Runtime7a54f4e3 from main d02d15b7
adds one closed direct-quote map, post_v2 and STABLE timeline_v2, strict pure
DTOs plus ordinary SSR repositories/actions. Existing171/223/225 and V1 UI,
commands, decoder, parent roots, drafts, messages, read/seen state stay intact.
Direct-target identity is retained in the existing receipts; current quote text
is projected from originals. No cloned body or V2→V1 fallback.

Source checks:16 pure decoder tests PASS (7 new+9 existing), scoped lint and
TypeScript PASS, outer SQL and both PL/pgSQL bodies parse. Fresh-worktree PNG
type-reference setup is documented in the QA note, not a product fix. Current
implementation has not been applied or exercised through Auth/DB/UI. Independent
exact-head review, protected CI and actual226 source/release integration remain.

ROOT retains shared-window authority.227 apply/QA needs a fresh post226 baseline
and separately reviewed bounded packet/GO. Four new posts plus edit/delete of
its own new reply remain the six-command budget; empty mentions on all post/edit
inputs preserve the zero-notification budget. Full catalog deltas/table count
will be enumerated after226. See docs/qa/crm-team-chat-direct-quotes-227-2026-09-21.md.


### A15e local227 apply/API verified; UI remains A15f

After accepted B226 merge28613990 and full RAW release bcb7ed6d, sourceec18763c
integrated current main with all six reviewed runtime/test files unchanged.
Fresh282-table baseline matched that release. Independent final binding review
151fa95d covered the unchanged apply mechanics, bounded QA and own-session
scope=local logout. ROOT conditional authority was satisfied before execution.

A single local CLI apply passed exact additive catalog/ledger checks; all old
282 business tables and old functions/ACL remained unchanged, quote map empty.
Ordinary Admin/Sales/Student QA then passed43 prewrite denials and3 replay
conflicts. Exactly6 effective commands created4 new messages/2 direct maps and
edited/deleted only the new legacy reply. Frozen replay, identical concurrent
requests and current edited/deleted off-page quotes passed. Actual production
DTOs decoded9 receipts,6 V2 pages and2 V1 pages. All prior rows, notifications,
seen/preferences and unrelated data remained unchanged; final283 tables checked.
The three own sessions logged out with204. No browser/app server was started.

Apply receipt0fb6ce37 and QA receipta16cc76d plus full hashes/paths are recorded
in docs/qa/crm-team-chat-direct-quotes-227-2026-09-21.md. Cross-tenant execution
was not claimed because no other existing org was available. No new identity,
role, provider/production action or source/server-action/UI/native acceptance.
Final independent actual-evidence/exact-head review, protected CI/merge and
fresh full RAW release to ROOT990 remain. Only then start A15f UI code, preserving
ROOT's separate mobile-sales presentation ownership. This does not close item15.

### CRM-09e — следующий локальный срез: чек к существующей оплате

Контракт исходного CRM-09 сохраняется. На main `70da1ed9` найден отсутствующий
UI-вход к уже существующему receipt endpoint: после сохранения без файла и
повторного открытия дела чек добавить нельзя. Добавить inline upload к
receiptless payment под прежними write/preview gates; не создавать повторную
оплату, не менять ledger, SQL, Storage policy или финансовые права.

Сначала минимальная реализация и scoped checks; после общей очереди B226/A227
один ordinary Admin upload к сохранённой fictional QA оплате и проверка
сохранности суммы/баланса, metadata, scanner и Storage. Снимки до/после,
неопределённый ответ без автоматического retry, desktop/mobile с Impeccable,
независимое exact-head review и короткий CI. Actual upload, Student download,
production и весь пункт12 до соответствующей квитанции не заявляются.


### CRM-09e — hydration hardening, 2026-09-21

Actual first upload click on source d3fe39b55a12d581f34fc3318369f47e0b5e52dc navigated by native GET to /v3/profile?; no payment-receipts POST occurred. Root receipt first-click-no-effect.json records exact before/after full 283-table, financial and Storage parity. The cause of the missing hydration handler remains unknown; document readiness and native file selection do not prove React hydration.

Before another actual upload, reuse the existing stable useSyncExternalStore client/server snapshot pattern in CasePaymentReceiptUpload: keep file input and submit disabled during SSR/pre-hydration, expose busy state, retain immediate preventDefault and all in-flight/unknown/no-auto-retry guards. No layout, API, payment, Storage or legacy form changes. Scoped lint/typecheck validate source; root owns independent review and one actual UI confirmation round. This hardening is not proof of a successful upload or identification of the hydration root cause.


### CRM-09e — connect existing receipt routes, 2026-09-21

Actual corrected UI hydration passed; its single upload POST returned403 platform_route_not_connected at proxy before the handler. Root verified exact before/after283-table financial/audit/Storage/Auth-session parity; no upload succeeded. Connect only existing payment-receipts/{paymentEventId} and payment-receipt-files/{studentCaseId}/{fileId}/download through isConnectedPlatformApi with exact UUID v1–5 segments matching handlers. Retain ordinary staff-cookie proxy flow, live handler authority/record scope and all Storage checks; no public Student or direct-private bypass. Add positive/negative route-contract coverage. Existing case-contract upload connectivity is a separate finding, excluded from this slice. No UI change or new business operation; actual confirmation remains root-owned.


### CRM-09e — scoped receipt authority dependency229, 2026-09-21

Contract: `docs/platform/payment-receipt-authority-contract-2026-09-21.md`. Actual35a11aa0 upload stopped at service-role table SELECT42501, masked as404; zero successful uploads and root final283-table/financial/Storage/Auth-session parity. ROOT reserves229 afterB228. Before implementation, independently review authenticated exact upload/download target RPCs, delegated principal revalidation before receipt metadata write/replay, strict bounded decoder and403-versus503 behavior. No table grants, financial changes, contract-file expansion or new UI. Existing routes/legacy receipt compatibility remain; no apply/runtime in this precode.


### CRM-09e229 — source implementation, 2026-09-21

Implemented authenticated receipt upload/download target RPCs and a closed scalar decoder; handlers no longer directly SELECT payment_events/payment_receipt_files for receipt operations. Delegated metadata admission locks organization then existing155 profile/membership order and case; explicit156/189 read+write policy precedes historical replay, with full stored principal/metadata comparison. Contract-file handler/functions remain unchanged. Missing/malformed target and infrastructure errors503; explicit42501 becomes403. No UI edits.

Node22 targeted decoder plus existing case-agreement checks41/41 PASS, scoped ESLint/typecheck/diff-check PASS. These are pure/source checks, not SQL/RLS or actual upload acceptance. Existing configured migration boundary invokes Docker/Postgres and was not run under source-only scope; SQL compile/role/revocation/concurrency/replay execution remains pending independent review and coordinated post228 local QA. Zero successful upload claim remains unchanged.


## CRM-02c — вертикальные записи продаж на телефоне (2026-09-21)

Принятый пункт7 и UX-план требуют показывать человека и его суммы вместе на
узком экране. Текущая единственная таблица имеет min-width960px; этот срез
меняет только её presentation в `SalesRegisterView.tsx`. ROOT владеет файлом;
A продолжает chat, B — requirements. Независимую реализацию готовим параллельно
с проверкой #990, без доступа к занятому общему runtime; actual UI и merge
следуют после получения ROOT локального окна. SQL, DTO, формы, права,
фильтры, direction facet, сводка и импорт в этот срез не входят.

Impeccable Operate/adapt: сохранить EVO/Golos и одну SSR-таблицу с единственным
sale-ID для возврата к строке. На узком контейнере строки вертикальны, на широком
сохраняются колонки. Имя, программа, менеджер, дата, годовой месяц, обе суммы с
их независимыми валютами/unknown, уточнение/архив и preview остаются доступными.
Мобильные подписи — настоящий текст; семантику таблицы и focus проверяем в AX.
Без второй копии данных, viewport-JS, новой палитры или финансовых вычислений.

Проверка: scoped lint/typecheck, independent exact-head review и protected CI;
после передачи runtime — ordinary existing Sales read-only desktop/320/390,
контекст фильтра → preview → возврат/anchor, отсутствие нового list overflow.
Использовать реальные имеющиеся строки; недостающие варианты отметить, не
создавать финансовые данные. Один общий visual pass и максимум один fix/confirm.
Merge/source, local UI и managed delivery явно различаются; весь пункт7 этим
срезом не закрывается. Production/providers/финансовые writes не выполняются.

## CRM-02c — локальная приёмка мобильного списка продаж (2026-09-21)

На source `26c8b4c268b628563b5dd5b3226bea47c0866631` ordinary existing Sales
проверил пять сохранённых локальных QA-записей; новых записей и sales writes нет.
При baseline 115 список оставался шириной 960 px на телефоне; candidate сохраняет
таблицу 1120 px при viewport 1440 и вертикальные строки без list overflow:
390→346/346px, 320→286/286px (region/scrollWidth). Все значения и ссылки пяти
строк совпали с baseline; browser AX сохранил таблицу, заголовки и пять строк,
keyboard focus видим. Сентябрьский поиск → preview → «Назад» сохранил query,
year/month, единственный sale-anchor и видимую строку. Impeccable Operate/adapt
подтверждён на этом реальном read-only UI пути; native VoiceOver не запускался.

Все 283 бизнес-таблицы/schema и Storage objects/buckets неизменны; собственная
Auth-сессия восстановлена, сервер/вкладка закрыты. CI source 26c8:
[35566545192](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35566545192),
5 PASS / 3 SKIP. Private evidence: `/private/tmp/evo-sales-mobile-actual-20260921/`
`actual-receipt.json` SHA256 `0c6cd413884449f4ecfca3d3ab41208d3cf9e30f5193d19e491c7f4c086e4626`;
`release-receipt.json` SHA256 `16ece6aa4a6e6ef84cfae0fae9e0e1caf5a119b0c261b41f96e9607e2cd105c4`.
Отдельная таблица сводки с min-width400px не менялась; эти замеры доказывают
ширину списка продаж. Весь пункт 7 и production не объявляются завершёнными.
После этой приёмки добавлена только документация; runtime-файл сохранён побайтно.


## 2026-09-21 — item36: checkpoint после #987/#988/#991

Docs-only на main `82260fdc`: обновлены current fronts execution/A/B и refinement.
#987 direct quotes227, #988 editor226, #991 mobile sale records приняты в source
и пределах локальных receipts; история и ограничения не переписаны. #990/229,
#992 unified feed и #993/228 остаются непринятыми actual блоками. Пункты27/28/31/32
сохраняют прежние границы; весь1–36 не завершён,37–50 отложены. Нового runtime,
DB/Auth/Storage/provider действия или production delivery этот checkpoint не даёт.
Проверка: diff review и git diff --check; независимое exact-head review до merge.

## CRM-02d — компактная сводка выбранных продаж, precode (2026-09-21)

Baseline main `82260fdc2df3b6d370092633cf1ac1c350fe9af6`, после merged #991.
Принятый CRM-02 (§поиск/итоги, строки131–142 исходного UX/admissions-плана)
требует коротких итогов и разделения «Найдено по фильтрам» / «План отдела».
Этот ROOT-срез меняет только section `sales-period-totals` в
`src/components/v3/SalesRegisterView.tsx`; отдельный компонент не нужен.
Параллельные A chat, B admissions и ROOT receipt229 не затрагиваются.

Impeccable Operate + distill/adapt прочитаны с уже загруженным контекстом;
контекст повторно не запускать, craft-floor прочитать непосредственно перед
UI-edit после source GO. DESIGN.md сохраняет Golos/JetBrains Mono и текущие
цвета/отступы: 14px для рабочих подписей/чисел, 12px только для пояснений.
Просмотрены свежие `candidate-{1440,390,320}.png` из
`/private/tmp/evo-sales-mobile-actual-20260921/`; target, globals, ui, AppShell,
layout и DESIGN побайтно совпадают с actual source26c8. Desktop показывает
крупный счётчик и разреженную сводку; мобильные кадры показывают только нижнее
пояснение, верх сводки вне viewport. Источник подтверждает min-width400px,
который не помещается в область286px на320. Полный mobile-before нужен позже;
существующие снимки не объявляются положительной проверкой новой сводки.

Один выбранный вариант: компактная строка «Найдено по фильтрам» с реальным
count обычного размера; контекст архива сохраняется. Вместо min-width400px
таблицы — единый semantic список групп по валюте: видимый код валюты и один
`dl` с подписями «Стоимость» / «Оплачено по записям» и текущими значениями.
На широкой области группы выровнены в компактные строки; на узкой подписи и
суммы переносятся внутри доступной ширины. Один DOM без дублей для mobile,
обрезки значений, новых карточек/аккордеонов, viewport-JS или новой типографики.
Сокращаются большие отступы и размер счётчика, не необходимые данные.

Порядок валют, обе суммы, существующее форматирование и счётчики неизвестных
сохраняются. Валюты не суммируются/пересчитываются, неизвестное не становится
нулём. Пояснение о накопленных суммах и отдельности месячных поступлений
остаётся; заметка неизвестных сохраняет оба count. При пустых/архивных итогах
не добавлять вымышленные нулевые суммы. План отдела получает отдельную подпись
и собственную визуальную группу вне filtered-count/currency группы, без
процента выполнения; прежние условие видимости, значение и fallback сохранены.
**Отдельный remaining:** UI `finance.read.full` и SQL scoped
`sales.register.target.manage` расходятся, поэтому «Не задан» может означать
отсутствие доступа. CSS не исправляет этот authority gap; его не скрываем и
не объявляем закрытым. Здесь нет SQL/DTO/API/permission изменений. Cash section,
фильтры/формы/import, список991/anchors и расположение страницы «Студенты»
остаются побайтно вне изменяемого section. Direction facet — отдельный срез.

Source-проверка: scoped ESLint, Next typegen/tsc, diff-check и Impeccable detector;
CSS-зеркальные тесты не добавлять. После review и передачи runtime ROOT: один
батч actual ordinary Sales/Admin desktop/390/320 на существующих данных, full
before/after summary с измерением section overflow и browser AX association;
сравнить count, currencies, обе суммы, unknown notes, отделённый plan,
месячный/годовой/пустой и архивный контекст без новых fixtures/бизнес-write.
Недоступный existing actor/state отметить, не создавать роли/план ради QA.
Проверить сохранность list991 и filter→preview→back. Максимум один пакет
исправлений и один confirm; source/CI не заменяют actual UI. Precode approval
и source GO предшествуют UI-edit; actual runtime требует отдельного окна.
Ни весь пункт7, ни VoiceOver/native/production этим срезом не закрываются.

CRM-02d source подготовлен после approved precode7b630598: только указанная
область сводки; count, currencies, оба formatter expression, unknown counts
и target gate/fallback сохранены. Scoped ESLint, Next typegen/tsc, diff-check
и Impeccable detector PASS на Node22.23.1; вне этой области файл побайтно
неизменен. Это source-проверка: actual desktop/mobile/AX и сравнение данных
ещё не выполнялись; draft сохраняется до отдельной согласованной приёмки.


## 2026-09-21 — B3f / 228: отдельные загрузка, отправка и проверка документа

#988 MERGED `28613990d`: bounded editor226 QA/CI/review завершены; полныйRAW
release `bcb7ed6d` передан A227, B больше не использует общий runtime.
Root резервирует228 только для следующего single-document B3f; очередь
A227→ROOT990→ROOT991 сохраняется, apply не разрешён.

Source inventory055/043/116/128/226 показал, что общий current/status и прежний
review автоматически связали бы A/B. Принято направление отдельных immutable
program upload/submission/review/download contexts при тех же canonical bytes
и scan/Storage transport. Старые Docs/manual/visa и approved ZIP guards сохраняются.
[Precode228](platform/b3f-program-document-submission-contract.md) фиксирует
approved-current replacement, exact historical-version download, fail-closed
old readers и узкий SQL context-exclusion на legacy replay-входах. Последнее —
явное compatibility amendment для review, не глобальное изменение legacy-процесса.
До кода — независимое exact precode review; следующий полный package B3g отдельно.
Impeccable Operate сохраняет EVO и функции, уточняя реальные saved/submit/review
состояния. Runtime/новые файлы/production/native acceptance не заявлены.

Независимый precode review64d4324e потребовал два уточнения до реализации:
история следует server-proven predecessor-цепочке226 и доступна также для
удалённых требований; прежнее решение не переносится в новую definition.
Old-reader PT409 ограничен публичными entrypoints; общий v2 helper сохраняет
внутреннюю projection для свежего editor/save226 и authorized pending recovery.
Добавлен узкий changed-requirements сценарий; это исправление полноты контракта,
не исполненное runtime-доказательство.

### B3f — исходники и независимое source review

Precode `b81c338c` APPROVED. Реализованы SQL228, web/CRM и iPhone save/submit/
review/history/notification flow. Source reviews проверили отдельно transport,
SQL, native и web/UX; конкретные найденные ошибки исправляются до immutable
integration review. [Отчёт](platform/b3f-program-document-submission-qa.md)
содержит офлайн-проверки, прежние несвязанные source-test failures и предложенные
actual changed-path сценарии. Это не применённая228 и не готовый production flow.
Root сохраняет228 за B, резервирует229 для receipt-пути; актуальное runtime окно
после ROOT990: ROOT991 → B228 → ROOT229. Разрешение на запуск B ещё не передано.


### B3f — локальная проверка сохранения, отправки и решения завершена

На неизменном runtime HEAD `571d65a8645b518c3513d8a9eebe36410f929e8e`
миграция228 применена один раз в согласованной локальной QA-базе. CI
[35567860470](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35567860470)
прошёл: шесть выбранных проверок успешны, две maintenance-проверки пропущены.

Обычный Student/Admin UI подтвердил отдельные Save → Submit → Review: V1 принята
по программе A; новая V2 остаётся черновиком; повторно выбранная V1 получила
отдельное замечание по B. Старое уведомление A ведёт к принятой V1. Три browser
скачивания вернули точные bytes V1, V1 и V2. Общий legacy slot целиком неизменён.
Два ограниченных прохода Impeccable покрыли desktop/mobile web; native iPhone UI
не проверен. [QA-отчёт](platform/b3f-program-document-submission-qa.md) отделяет
исполненный основной сценарий от ещё не выполненных recovery/concurrency,
changed-requirements и legacy-вариантов; весь объём13/17–21 не объявляется готовым.

Итоговая проверка `72d19741efbbc37028ce0e5cb76fa19356e6867349da410207065c6ce82654df`
подтвердила52 новых строки в17 таблицах,16 audit events, два Storage-объекта;
прежние строки всех287 таблиц и прежние Storage-объекты сохранены. После выхода
Auth sessions/refresh tokens вернулись к исходным полным хешам223/238; все три
созданные этим прогоном сессии отсутствуют. Собственные browser/Next/scanner
остановлены; точный Next child exit code неизвестен после прерывания supervisor,
поэтому подтверждены лишь фактическое отсутствие процессов и закрытый порт.

RAW release `/private/tmp/evo-b228-core-ui/release-receipt.json`, SHA256
`f375371369becc30f1f873badb6a45d182580813ad9829f6e017042fdff39b6a`, передаёт
локальное окно `nextOwner: ROOT990` с ledger001–228, полным состоянием и рецептом
сверки. ROOT принял передачу; PR #993 смержен в `f712db2f2b0cdb623f82ea8f5fe048cda7e0d2ee`.
Отдельный docs-only PR фиксирует результат без изменения проверенных исходников;
production, внешние провайдеры, полная финальная E2E и App Store не затронуты.


## 2026-09-21 — CRM-09e actual-path blocker: saved versions without a current pointer

Ordinary local Admin opening the existing B209 Student1 case on source
fcfabafa/schema229 hit the real profile error boundary before any receipt upload.
The authenticated staff document-workspace RPC returned200: both228 saved file
versions are finalized/verified/clean and download-ready, but `is_current` is NULL
because migration113 projects `slot.current_version_id = version.id` while228
intentionally leaves the legacy pointer absent. The strict TypeScript boolean
decoder rejected that legitimate SQL result and crashed the entire case.

Before coding, extend this receipt-path fix narrowly: accept literal NULL only
as `isCurrent:false`; preserve exact keys, rejection of missing/string/numeric
flags, other boolean/security guards and slot current-ID/number consistency.
No new migration, current pointer, approval, download authority or file rewrite.
Add regression coverage for no-current versions and malformed/current-pointer
mismatches, then reopen this same actual case and complete the ordinary receipt
journey. Source229 apply proof remains atfcfabafa with unchanged SQL; subsequent
UI evidence must record its newer runtime head separately, never relabel the apply.


## 2026-09-21 — CRM-09e actual audit-action failure and forward migration230

Actual ordinary Admin upload on e17e1e52/schema229 reached real ClamAV and
Storage (POST200), then PostgreSQL rejected `case.payment_receipt.upload` against
the existing041 `audit_events_action_check`: every dot-separated action segment
permits lowercase letters/digits, not underscores. The handler returned503 and
removed only its new object (DELETE200). Full287-table, financial, audit, Storage,
prefix and Auth-session before/after comparisons are exactly equal; no successful
receipt exists and no retry has been performed.

Before coding, ROOT reserves230 for a forward-only fix of this receipt function's
two internal action literals to canonical `case.payment.receipt.upload`. Preserve
the041 constraint,229 SQL/ledger, all auth/lock/idempotency/body/ACL semantics,
receipt result and financial data. Assert the expected two replacements and exact
function identity; fail on an unexpected predecessor. No contract-file expansion.
Use the canonical action in later actual metadata replay/evidence. The former
action could not persist under the unchanged mandatory audit constraint.

Website receiver PR996 moves its unapplied migration230 to231; B3g package
precode moves231 to232. OnlyROOT applies, in order. Verify230 on the actual local
229 baseline with rollback first, canonicalCLI apply once, preserved full state,
then a separately recorded new ordinary UI attempt. The prior503 remains failure
evidence; never relabel it or rewrite migration229.


## 2026-09-21 — B3g: неизменяемый состав комплекта и отдельное решение EVO

После #993 и его QA-отчёта #997 (`7aad173f`) ROOT принял направление
[precode B3g](platform/b3g-program-package-contract.md) и резервирует 232 для
server/wire части; 231 — website, 230 — исправление аудита платёжного чека ROOT.
Студент отправляет весь exact состав
без предварительного staff одобрения файлов, сотрудник отдельно проверяет
документы и комплект. Starter сохраняет явный смысл стартового комплекта EVO.
Individual228, canonical bytes и история сохраняются; package review фиксирует
точные review IDs. UI CRM/web/iPhone и узкий actual packet идут по одному контракту.
Сейчас только precode: независимое exact-head review до кода; runtime/DDL не начаты,
локальная база остаётся у ROOT990/229. Полный1–36 и production не объявляются готовыми.

Уточнение по UI review: восстановление неподтверждённых package submit/review
доступно отдельно от текущей очереди/редакции, привязано к владельцу и повторяет
точный исходный состав/решение. Scoped QA включает потерю ответа с последующей
перезагрузкой и сменой revision; очистка только по receipt или `not_written`.


## 2026-09-21 — B3g.1: серверный контракт комплекта, offline implementation

После принятого precode #998 (`8b942d506ab575042a1684bdccbd685d566d84fc`)
координатор разрешил первый кодовый блок: миграция 232, атомарная отправка/проверка
комплекта, чтение/история/уведомления, общий TypeScript/Swift codec и восстановление
запроса. UI входит в следующий блок; текущий сохраняет все правила
[контракта B3g](platform/b3g-program-package-contract.md).

В отдельном worktree SQL-агент владеет только новой миграцией и SQL-тестами,
серверный агент — новыми adapters/routes и их тестами, native-агент — новыми
Swift models/pending и codec-тестами. B владеет общим wire, TypeScript codec,
fixtures, pending и документацией. Общие файлы меняются только своим владельцем.
Перед реализацией фиксируется точный JSON/RPC контракт; 1–100 пунктов комплекта
не ограничиваются прежним лимитом 50 отдельных document DTO.

Сейчас разрешены только offline проверки исходников, парсинга и codec; локальное
окно DB/Auth/Storage/browser остаётся у ROOT для 229/230, затем A15f. Миграции
230 ROOT и 231 website не копируются и не меняются из чужих PR. Их интеграция
выполняется явно после слияния; CI может ожидать эти зависимости. До independent
review и узкой реальной проверки функция не объявляется принятой или готовой
в production. Native typecheck также не является UI acceptance.


B3g.1 wire уточнение до review: оба ответа восстановления (`committed` и
`not_written`) содержат requestId и case/application, проверяемые по frozen intent.
Одного operation недостаточно: запоздавшее подтверждение отсутствия записи для
другого запроса не должно очищать pending. SQL, TypeScript и Swift используют
одинаковую корреляцию; бизнес-операции и полномочия не расширяются.


B3g.1 initial offline validation: 73 scope-local Node checks passed (package
codec/pending/actions/SQL source and affected 228 document contracts), TypeScript
noEmit passed, scoped ESLint and diff-check passed. Swift author ran the shared
fixture and pending/recovery checks: 92 passed. SQL author parsed 96 statements
and 19 PL/pgSQL bodies with pglast. These are source/codec checks only; SQL object
resolution, real ordinary-Auth transactions, Storage effects, UI and native screen
behavior remain unverified until a separately coordinated runtime packet. The
source block now goes to independent exact-head review; it does not complete B3g.


B3g.1 independent review at `071dd526` requested two bounded corrections:
use the inherited two-valued Student classification for configurable staff whose
coarse platform role is NULL, and reject U+0000 in package correction reasons
before TypeScript/Swift pending persistence. PostgreSQL JSONB cannot represent
U+0000, so both mutation and recovery would fail before entering the RPC
([PostgreSQL 17](https://www.postgresql.org/docs/17/datatype-json.html)). Other
supported controls and the 5000-scalar limit remain unchanged. Swift also aligns
with TypeScript by rejecting reuse from the same submission. Pending retention,
authorization and request correlation are preserved; these fixes require fresh
scoped checks and exact-head delta review, not new runtime claims.

Bounded-fix validation: 43 TypeScript codec/pending/action checks and 22 SQL
source checks passed; the Swift author ran 101 checks successfully. TypeScript
noEmit, scoped ESLint and diff-check passed; SQL parsing still covers 96 statements
and 19 PL/pgSQL bodies. These fresh checks cover the changed boundaries; the
unchanged 228 document-codec evidence remains from `071dd526`. Actual runtime
validation is still pending coordination.


## 2026-09-21 — CRM-09e: фактическая загрузка и скачивание чека

На runtime `3e83d4958ac25c5c9a457ceb35657c52dcd5f0f3`, local001–230,
проверен обычный Admin-путь: существующая оплата → один чек → скачивание
исходных766 байт. Суммы, даты и прежние данные сохранены; duplicate metadata
replay, шесть scoped target/ACL probes и четыре row-lock barriers прошли.
[QA-отчёт](platform/payment-receipt-local-qa-2026-09-21.md) сохраняет ранние
ошибки, потерянный observer body201 и восстановление результата без reupload.

Текущая собственная Auth-сессия закрыта обычной кнопкой, old223 hashes сохранены;
одна идентифицированная собственная orphan-сессия остаётся без токена. Полная
Auth/refresh-token parity и отзыв прав единственного Admin не заявляются.
Собственные Next/browser/scanner остановлены. Full287 RAW release37e84090…5df5d
передаёт окно A15f; независимое reviewcb628f6f…761ea принято. Это завершение
локального CRM-09e, не всего item12/1–36 и не production.


## 2026-09-21 — CRM-02d: integration after local230

#995 integrates main `e5709f1344b3cb9160d0ba12378c2021a08877d3`. The reviewed
SalesRegisterView bytes remain identical to `9e3baec1`; incoming admissions228
and payment229/230 are accepted main changes, not additional summary scope.
Actual UI remains pending the exclusive A15f handoff. The prepared packet is
`/private/tmp/evo-sales-summary-after230-preparation-20260921/`; its incoming
release and candidate revision must bind to the real values after that handoff.

Scope-local UI acceptance compares baseline/candidate for existing ordinary
Sales and Admin at 1440/390/320px: displayed count, currency groups and values,
unknown notes, department target, semantic association and horizontal clipping.
At most two visual batches. Filters, query/authorization logic, monthly receipts
and sale records are source-identical; do not repeat unrelated month/year/archive
and permission matrices. A single existing-data search/back check is sufficient
if integration exposes a direct concern. No new business fixtures, role changes
or scanner are needed. Preserve the incoming orphan session; close only this
block's sessions and runtime. These observations do not establish production or
complete item7. Direction filtering and target permission ambiguity remain open.


## 2026-09-21 — website enquiry country and university context

Scope: extend the existing same-origin website enquiry receiver so a visitor may
choose `country: "Undecided"` and optionally supply `university: {slug, name}`.
Preserve the original eight required fields and accept omitted/null university
from older forms. Store the bounded visitor-supplied choice in the existing
append-only receipt JSON; display it in the staff profile's existing website
submissions section. This does not associate the lead with an authoritative CRM
university entity or attribute a human case note to a staff member.

- [ ] Forward migration, numbered only after schema-owner coordination: replace
  the intake RPC with one implementation and a final optional JSONB argument;
  preserve service-role-only ingress, all existing guards, phone linking,
  request locking/rate limits, and canonical receipt comparison. Omit the new
  payload key when empty so pre-release request retries remain identical.
- [ ] `Undecided` leaves a new lead's interest direction NULL. Existing lead
  direction/identity/ownership remains unchanged. No invented country mapping.
- [ ] Server validates bounded exact university shape, projects it through the
  existing authorized reader, and renders ordinary escaped text with a clear
  label. Slug is source context, not a URL or claimed catalogue match.
- [ ] Narrow checks: focused lint/type generation/typecheck, contract validation,
  SQL review and independent exact-head review. No fake lead/provider calls,
  no blanket migration/browser suite. Owner will perform the actual submission;
  successful persistence/business acceptance is not claimed before that check.
- [ ] Root release owner handles merge, schema coordination and managed release;
  executor opens a reviewed candidate and does not deploy/apply/arm.

Impeccable context and clarify guidance: keep the current definition-list layout,
show the chosen university alongside country, translate the undecided sentinel
into a short Russian label, and allow long names to wrap. Actual populated CRM
UI proof depends on the owner's submission; static checks cannot replace it.

Schema coordination confirmed before migration implementation: Astra reserves
`231_platform_website_enquiry_context.sql`; ordered apply is 228 → 229 → 230 → 231,
owned by the shared coordinator. No separate migration apply, arm or release.

Implementation/check receipt: [website enquiry context](design/v3/references/2026-09-21-website-enquiry-context.md).
Parser tests, focused lint, Next typegen/typecheck and diff check passed.
No database execution or real enquiry submission is claimed; owner will submit.


Website enquiry coordination update: the coordinator reassigned the unapplied
website migration from 230 to 231 so migration230 can repair the receipt audit
namespace required by the real229 path. Only the filename and this slice's
references change; SQL/runtime behavior and prior validation remain unchanged.
The shared coordinator owns ordered apply 228 → 229 → 230 → 231 and release.


## 2026-09-21 — B3g.1: integration after 229–231 source merges

At coordinator GO, integrate main `b4aed5e348c31fee43fe820179a8e8aade73763d`
(#990 and #996) into the reviewed package source `6635d454`. Preserve all reviewed
232, TypeScript and Swift implementation/test bytes and both additive document
branches. Incoming231 changes only website enquiry RPCs; it adds no package
contract dependency. Existing local checks remain attributed to their original
heads; this integration receives independent exact-head delta review and fresh CI.
Shared runtime remains exclusively A15f; B232 actual QA follows ROOT995 and ROOT231.
No UI implementation, DB/Auth/Storage/browser action or production claim is added.


## 2026-09-21 — B3g.2: package UI implementation admitted

After #999 merged as `47d4a474613e76a1b0d1790922db9fd6bd945831`, ROOT admitted
web/CRM/iPhone implementation under the accepted B3g contract and wire. No new
business policy, RPC or migration is introduced. Worktree `evo-program-package-ui`,
branch `izzhackt/program-package-ui`, starts at that fresh main.

File ownership: web worker owns new applicationPackages components, Student and
staff preparation integration, admissions package queue/detail, package notification
route/policy and web RU/KY strings. Native worker owns iOS package service/model/views,
preparation/notification integration, localization and native validation support.
Parent owns `src/lib/portal/application-package-ui.ts`, its focused pure-contract
tests, plan logs and integration. Workers preserve each other's edits.

Use package readiness's100-item projection directly instead of the old50-item
Documents aggregate; existing individual upload/review/download controls remain.
Queue rows load exact package detail lazily for deadlines/composition/current file
reviews. Historical notifications render their frozen decision separately from newer
package/file reviews. Detached owner-scoped recovery remains available across
revision and queue changes. Impeccable Operate/craft-floor preserves EVO/Golos and
native patterns, RU/KY, explicit selection, readable states and focused actions.

Only source and focused checks are currently admitted. No local DB/Auth/Storage,
browser, simulator or UI runtime before ROOT995 then ROOT231 hands the window to
B232; A15f currently owns it. Later narrow actual-path/visual proof remains required.
This UI source block does not close all20/21, accessibility25 or the entire1–36.


B3g.2 source checkpoint: web and native implementation complete for independent
source review. Added dedicated Student owner recovery access from portal home,
explicit optional-without-file feedback, preserved selection on revision change,
and owner isolation for delayed responses/retries; these implement the accepted
contract without a new RPC or policy. See [implementation and evidence](platform/b3g-package-ui.md).
Checks: 10 pure UI-contract tests, 11 command/presentation tests, 17 Swift
selection/navigation checks, Next typegen, TypeScript, scoped ESLint, full Swift
source typecheck, RU/KY/membership/plutil and diff checks passed. Native input
hashes were verified after the shared disk recovery. Synthetic action ports test
local orchestration only. Authenticated web/native UI, 232 actual-path QA and
production remain unclaimed and held for the coordinator's runtime handoff.


B3g.2 exact-head review of52426ca requested two historical-display corrections.
Both retain frozen notification evidence while separately exposing later package
and current file decisions; no contract/policy/API changes. Added2 codec-backed
Node regressions; native suite now24 checks. Scoped lint/TypeScript and final
69-input Swift typecheck passed. Actual-path QA remains a separate unclaimed gate.

### A15f unified chat UI — decisions recorded before code

A15d225/A15e227 are merged; current base main115b895a. A227 actual local apply/API
passed and full raw window was released to ROOT990. Start A15f source work in an
isolated chat-only worktree while ROOT owns runtime. No migration or database/
Auth/browser/server work belongs to this offline step.

Update docs/EVO_TEAM_CHAT_FLAT_UI_PLAN_2026-09-21.md with the current dependency
state and concrete SSR/V2 timeline, one composer, V1 draft recovery, context/
search/anchor, invalidation and seen integration. Pin a500ms stable body dwell
with visible height at least min(50%body,160px), active visible window, overlay/
search/quote exclusions and bounded1–50 IDs; never advance legacy read_sequence.
V1 changes cannot invent direct quote identity; preserve or hydrate from V2.
Existing unknown operation identities, rights, authored content and dates remain.

DESIGN.md now reflects the already accepted single-feed/direct-quote decision;
EVO/Golos/themes/AppShell are preserved. Reused A15d desktop/mobile captures are
historical incumbent evidence and UI/CSS source remains unchanged since then.
A15g owns density/grouping/channel previews. ROOT retains CaseAgreement and
SalesRegisterView mobile work; B retains portal/requirements/iPhone. No UI
implementation or actual UI acceptance is claimed by this precode commit.


### A15f implementation staged — actual UI acceptance pending

Draft PR#992 now wires the V2 feed/context, shared composer, direct quotes, V1
draft recovery, search/anchor return and bounded sparse-seen client. Accepted
171/223/225/227 contracts are unchanged. Source validation and its limits are
recorded in docs/qa/crm-team-chat-unified-feed-source-2026-09-21.md. The old
public-config test boundary was adapted to the additive reader, and the mute
regression now asserts sparse seen rather than requiring the retired UI read
button. Neither test is actual UI proof. Independent implementation review and
ROOT-allocated actual browser window remain required; item15 is still open.

No shared runtime access in this source step. ROOT provided the current queue
cleanup990 → readonly991 → B228 → ROOT229. The A15f runtime effects will be
bound separately after that window is released. No merge/release is claimed.

Coordination update after source checks: ROOT reports991 merged at82260fdc and
runtime handed to B228, followed by ROOT229. A15f remains source/review-only;
its window is not opened by completion of source validation.


### A15f actual local chat acceptance and released runtime — 2026-09-21

Actual ordinary Sales/Admin UI at e1250b58 passed the bounded five-post,
versioned edit/delete, frozen V1/V2 replay, sparse unread gap/reload, search,
legacy links, >50 history paging and composer journeys. Desktop1440 and320/390
inspection preserved EVO and reachable controls. Full local230/287-table
reconciliation confirmed exact seven commands, four finite seen tuples and all
original rows; own sessions/browser/server closed. ENOSPC recovery is separately
pinned, with final read-only state equality and release01b3c17b…8cb51 to ROOT995.
See docs/qa/crm-team-chat-unified-feed-actual-2026-09-21.md for proof and limits.

This closes A15f's scoped local acceptance, not all item15/first36 or production.
A15g keeps grouping/density/channel previews and the observed follow-up: read
search errors should explain retrieval failure rather than an uncertain write.
Native/IME/screen-reader/moderation/revocation/storage-quota/post-refresh-failure
journeys remain unclaimed. New main47d4a4746 integration preserves chat bytes;
no migration is introduced by this chat PR.


### CRM-02d actual compact summary and current1–36 front —2026-09-21

Ordinary Sales/Admin baseline0fd6952a/candidatef59adb70 at1440/390/320 preserved
count, currency values, unknown notes, target visibility and row links. Mobile
summary no longer horizontally scrolls. Cash positive and universal height
reduction are not claimed. Full local230/287 business state, catalog, finance,
Storage and incoming224 sessions restored; own browser/server stopped. See
`docs/qa/crm-sales-compact-summary-2026-09-21.md`. Mainca7c98ec integration
preserves exact SalesRegisterView bytes; this is reused proof, not a new run.

`docs/EVO_ITEMS_1_36_STATUS_2026-09-21.md` reconciles the accepted original labels
and remaining work, preserving earlier historical checkpoints. Local231 then
applied once with no Auth/submission/business writes; window passed B232.
No production delivery or whole1–36 completion claimed.


### CRM-02e: authorized direction options —2026-09-21 precode

After #995 merge a23490f7, implement accepted item7 direction selector using
separate read-only RPC233. Existing v1/v2 report and writes stay unchanged.
Organization and per-row authority precede DISTINCT; include all authorized
periods/archive states, preserve exact strings/C order, reject overflow above
1000 or unfilterable legacy values instead of silently truncating/normalizing.
Strict DTO and shared500-code-point validator; native GET select retains
unknown current URL values, filters/period/Back/reset. Explicit option error
keeps exact-text input available without pretending empty success.
See docs/EVO_SALES_DIRECTIONS_PLAN_2026-09-21.md for scope, grants and acceptance.
Source-only while B232 owns QA; ROOT coordinates any later local apply.
No production or fixture creation is authorized by this entry.


CRM-02e source implementation: separate RPC233, strict options DTO and shared
500-code-point validator; native select/error/empty/current-URL identity retained.
17 targeted Node tests, scoped lint, normal typecheck and static SQL parse PASS.
Actual local SQL/Auth/UI not run while B232 owns QA. See
`docs/qa/crm-sales-directions-source-2026-09-21.md`; no deployment claim.

## 2026-09-21 — B3g.2 latest-main integration before actual QA

Merge main `a23490f746c9d13398712eed5e26dffd2330760b` into reviewed UI head
`ef61dcce0ce8a5c5c93f8c30a69c8ba7308ee351` before local232 apply and actual
web/CRM verification. Resolve only additive plan-document conflicts, preserving
both parents. Package web/iPhone implementation, tests and migration232 stay
byte-identical to the independently reviewed source. Incoming chat/sales changes
stay intact. Existing source checks retain their exact revisions and limits;
narrow integration review and current CI are required for this new head.
No Auth, Storage, DB migration or user-interface action occurred in this merge.


## 2026-09-21 — B3g.2 scoped fixes from ordinary package UI verification

The authorized local232 Student/staff journey on de4bf800 submitted an actual
package, requested corrections, approved its two files and then approved the
package. It exposed duplicate sibling keys for the review/history components
(which duplicated the staff form after refresh), repeated missing-material copy,
and missing exact Student page allowances for package notifications/recovery.
Fix those three defects together: preserve owner/package/epoch reset identity,
suppress only redundant aggregate missing-material copy, and add the exact
recovery pathname plus the fully anchored package-notification UUID pattern.
Keep ownership checks and all other route denials. Add focused route regressions,
obtain independent delta review and current CI, then inspect the existing actual
notification/recovery and staff detail at desktop/mobile sizes. Do not repeat
submissions, add actors/fixtures, rerun unchanged DB flows, or claim native UI or
production acceptance. Existing actual receipts remain the evidence for writes.


## 2026-09-21 — B item25: portal pending focus, result status and RU/KY metadata

Fresh main c47a8137 contains merged PR1000 and prior PR896 success-focus fixes.
Revalidation confirms three remaining source patterns: LanguageForm and the two
learning answer buttons become natively disabled while pending; ExplainPanel
mounts a populated status region only after the server answer; nine English,
assessment, profession and message routes still export static Russian metadata.
This source-only block preserves the existing EVO layout/typography and uses
Impeccable Operate/harden with craft-floor. Existing success focus stays intact.

Scope: keep pending submit buttons focusable via aria-disabled with synchronous
activation guards; retain native invalid-input disabling and existing attempt,
revision, request-ID and retry semantics. Add a pending guard and error handling
to LanguageForm without changing its guarded language RPC/cookie flow. Mount
one empty polite/atomic result status before each exercise response, announce
only the confirmed short verdict after the existing heading-focus transition,
and leave detailed explanation semantic/non-live. Clear the verdict on the next
exercise; do not announce complete explanation text. Use existing locale/portal
strings for the nine route titles, adding only generic Lesson/Profession RU/KY
labels; retain brand suffix and avoid private-data fetches for metadata.

The current backend, SQL, grading, attempts, profile authorization and native
iPhone code are outside this change. No shared QA/Auth/Storage/browser/Simulator
or production action is authorized by this source block. ROOT owns the shared
window (233 then A234). Scoped existing tests, type/lint and independent exact-
head source review precede a coordinated actual Student keyboard/language/
learning check. Actual screen-reader speech remains unclaimed until exercised;
DOM or source checks do not prove VoiceOver output. Do not reopen PR896 as missing
work or change assessment autosave without a reproduced defect.

Primary behavior references checked 2026-09-21:
- MDN aria-disabled: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-disabled — preserves focusability, requires explicit activation prevention.
- MDN aria-live: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live — pre-existing polite regions expose later short updates.
- W3C status messages: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html — expose action outcomes without unnecessary focus changes.
- Next generateMetadata: https://nextjs.org/docs/app/api-reference/functions/generate-metadata — use the existing server metadata API with request locale.

### CRM-02e local233 acceptance and integration —2026-09-21

Local apply233 at35499c33 passed exact functions/ledger/ACL preservation. Ordinary
Sales/Admin directions are ready-empty, consistent with all five retained QA
sales having no populated direction. The previous v2 report, totals, native GET
and record/back period survive. An observed alignment/accessible-name defect was
corrected in1b903e23 and confirmed at1440/390/320 for both roles in the second
bounded visual pass. Populated selection, other-tenant positive data, overflow,
VoiceOver and production are not claimed. See
`docs/qa/crm-sales-directions-actual-2026-09-21.md`.

Full290 business tables/catalog/effects/Storage and incoming224 sessions/239
refresh rows equal baseline after own logout. Only ordinary Auth user metadata
and six Auth audits changed. Own runtimes closed; released233 window to A234.
Mainc47a8137 package UI is integrated without changing either product scope;
only additive plan appendices conflict. Update the1–36 ledger with completed
B1000 web/CRM package acceptance and prepared A1002/B1003, preserving native gaps.
Remaining item7 work is department-target visibility and import placement, not
an already-correct cash-summary permission rewrite.


### CRM-02f / item7a: atomic management state —2026-09-21 precode

After #1001 mergece0ef573, ROOT implements only the confirmed department-target
state/authority mismatch. New read-only RPC235 returns scoped target/import flags
and the selected department target in one STABLE snapshot. Keep existing
organization grant pairs and the current TS/UI report-read entry requirement;
add that requirement to this new endpoint, without rewriting oldv1/v2 SQL.
No extra finance rights, role changes, writes or target-history repairs.

Target summary/form use the same authoritative result: confirmed denial hides;
unknown stops submission and preserves mounted drafts; allowed empty alone means
“Не задан”. Preserve version/reason/request conflict handling and selected import
File across transient reader failure; existing save/import commands unchanged.
All-year/archive fetch rights only; preview/invalid/record/editor skip this read.
Cash already has correct scoped authority and is not part of this fix. Moving
the import form remains the later7b block. Impeccable Operate applies within
current EVO; inspect historical233 baseline, reread craft-floor beforeUIediting.

Contract: docs/EVO_SALES_MANAGEMENT_STATE_PLAN_2026-09-21.md, independentprecode
approveded9a5f93. Reserve235 behindA234; actualexisting-actor/read-onlyQA after
B1003 releases sharedruntime. No production/fixtures/targetwrites/importsubmit
or newAuthactors. Missing actor/data combinations remain explicitly unclaimed.


CRM-02f source implementation: additive RPC235 and strict management DTO,
new authoritative View gates, preserved disabled target/import drafts on unknown
read. Existing commands, v1/v2 and cash remain unchanged. Eight DTO tests,
scoped lint, typecheck, whitespace and staticSQL parse PASS. Actual local235
and browser acceptance pending shared-window release; no database/Auth or
production use here. See docs/qa/crm-sales-management-source-2026-09-21.md.

### A11 / CRM-07 case-chat queues — decisions before code, 2026-09-21

A15f is merged in #992 / ca7c98ec2. Implement the bounded contract in
[case-chat queue plan](EVO_CASE_CHAT_QUEUE_PLAN_2026-09-21.md): three queues
from existing await_state, additive staff reader v2 with q/filter before the
200-row limit, shared search race guard, current-list invalidation and durable
selected conversation context. Existing v1, commands, rights, drafts and EVO
identity remain. Selected-case title outside the queue uses the existing
authorized full-case snapshot only after chat access; no extra list scan.
Native history replaceState preserves q/queue without remounting the composer.

ROOT reserved 234 for A; ROOT233 must merge first. Source-only work and review
can proceed while B owns local QA. Actual migration/API/browser work requires
ROOT's scheduled window and separately pinned effects. No full item11, shared
runtime or production success is claimed by this precode entry.

#### A11 / CRM-07 first QA correction — 2026-09-21

Local234 first real UI pass at999040d0 found history-restoration and320px
selected-chat defects. Apply the bounded correction in the case-chat queue plan:
URL-owned filter context, fresh authorized history reads and shrinking mobile
layout, retaining draft/attachment and commands/rights. SQL/apply234 unchanged;
three permitted await commands restored none. Independent correction review,
then at most one read-only confirmation batch and full finite-effects closure.

#### A11 / CRM-07 actual local234 result — 2026-09-21

[Actual report](qa/case-chat-queues-actual-2026-09-21.md): SQL234 applied once on
999040d0; ordinary staff/Student boundaries and three await transitions passed.
Actual history/320px defects were corrected and one confirmation batch passed
on37f3d9860. Draft/document card persisted; no messages/file bytes/new actors.
Full290-table/33-Auth-Storage reconciliation passed with exactly one thread,
three await receipts/audits, finalnone; incoming224sessions/239refresh preserved.
Own Auth/browser/server closed. Independent actual/closure review approved;
window released B1003, which waits for merge1002. Final-head review/merge remain
gates; production, broad E2E and unsupported positive QA states unclaimed.

### A15g-1 / item15 — read errors and exact retry, precode 2026-09-21

A11/#1002 merged479dd6788. The next accepted minimum is
[read retry contract](EVO_TEAM_CHAT_READ_RETRY_PLAN_2026-09-21.md): operation-owned
read errors, frozen search/cursor retry, separate background failure ownership,
and terminal late forbidden without changing write protocol or permissions.
A owns TeamChat.tsx, a small client-safe helper and behavior tests. No SQL,
fixtures, density/preview scope or shared runtime until B1003→ROOT235 handoff.
Correct stale current front of A15f plan; retain historical evidence/limits.

## 2026-09-21 — B item25 integration and admitted local234 UI window

After merged PR1002/main `479dd6788b87fc14d4d9e3e809c16e9efff1badd`,
merge that main once into reviewed PR1003/source `622e40e209e8b3ead33ddb0c04d849654110f7a2`.
Resolve only additive plan conflicts, preserving both parents and all product
code. A234 release `bb97645c266ea2fedcfb8ce97d28560313bdf74ff324989421953b1d4050bf90`
transfers the existing local schema001–234 to B1003; do not reapply SQL234.
Independent integration review precedes the finite UI check: existing ordinary
Student, own language RU→KY→RU, affected route titles, pending focus/repeated
activation, at most one existing available lesson draft/start and one answer,
and an existing review item only if present. No completed lessons or fixtures
are created to populate the review bank. Preserve incoming business/Auth/Storage
state except exact ordinary owned effects; capture complete before/final state
and close own browser/Auth/server. Desktop/320px observations are actual visual
evidence; speech is unclaimed unless a screen reader is actually exercised.
No native unlock, production action, installs or full builds. Release the window
with raw state/schema001–234 and exact runtime/config/observer pins to ROOT235.

## 2026-09-21 — B item25 first actual UI correction

The first local234 pass at875ec495 confirmed RU→KY and settled KY→RU:
each double Enter sent one server action, with focus preserved while pending
and after success; nine changed titles matched KY and mobile320 did not overflow.
A fast initial restore before hydration also exposed a real local regression:
the enabled aria-disabled submit button could issue native GET without saving.
A later overlapping test navigation invalidated that attempt's timeout evidence,
but the preceding native GET was preserved and independently reviewed as P2.
Replace only LanguageForm's submit form with a non-submitting container and
type=button/onClick, retaining the same pending ref/transition/error/RPC logic
and named native radio group. Keep normal Enter/Space activation of the button;
do not claim implicit Enter from arbitrary controls. No general hydration layer.
Preserve first-pass evidence, keep the same owned Student session, review the
source delta, then one confirmation batch: before-JS activation cannot navigate,
one ordinary additional RU→KY→RU cycle (profile revision3→7 across both batches),
and at most one lesson start/answer overall. No lesson completion, new login,
fixtures, SQL, providers or native actions. ROOT235 remains next after closure.

## 2026-09-21 — B item25 actual local234 closure

[Actual report](qa/portal-learning-feedback-2026-09-21.md): final source
`f77a457b80d73b3516a0c6018d7899eb1d9635f8` confirms ordinary Enter/Space language
saves, pending focus and one existing lesson start/answer. Four language saves
restore RU; no completed lesson or populated review bank was created. The first
prehydration GET was fixed; the overlapping-driver timeout and failed fully-no-JS
probe remain recorded as limitations. Nine KY route titles were checked on the
byte-identical pre-correction route sources; speech/native/production unclaimed.
Independent offline reconciliation passed 70 checks: 287/290 business tables
unchanged, exact own profile/draft/two receipts, full catalog/ledger unchanged,
224 incoming sessions/239 refresh rows preserved, only own login metadata and
two Auth audits added. Own browser/Auth/server closed. Transfer schema001–234
and immutable private receipts to ROOT235; final-head review/CI and normal PR1003
merge remain required before ROOT integrates main for235. Item25 stays partial.

## 2026-09-21 — B items24/25 profile request feedback precode

ROOT accepted the next bounded web slice after merged1003/main7f444455:
[Profile request feedback](platform/portal-profile-request-feedback.md). Catch
client-side action rejection and use truthful RU/KY unknown-result copy, keeping
the same requestId, pending behavior, confirmed success focus and server/RPC196
contract. Only one component and two dictionary values; no SQL/native/provider.
Independent precode review precedes implementation; source-only work may proceed
while ROOT235 then A1005 own the shared runtime. Actual B validation waits for
its admitted window and permits only a real owned-Next outage with zero business
writes. No positive deletion request, fixtures, new actors or status reset.
Native refresh findings and current KY Home evidence remain separate; no broad
E2E/accessibility/native/production completion claim.

## 2026-09-21 — ROOT item7a local235 closure

[Actual management report](qa/crm-sales-management-actual-2026-09-21.md):
source3616ea179b91b54d000c5cba5284a6cbb77ccb3a integrates main7f444455
without changing the reviewed product files. One local235 apply added two
read-only functions; 290 business and 33 Auth/Storage tables unchanged at apply.
Ordinary Sales/Admin RPC and UI1440/390/320 confirm scoped management visibility,
allowed-empty target, rights-only annual/archive state, invalid date rejection,
and old-v2 body parity. Student/anon/service-role authority denials are actual.
The initial Student QA binding mismatch stopped after one login before RPC;
immutable evidence retained, independently reviewed metadata correction reused
the same captured session for one denial and own logout, without a new login.
Final business/catalog/Storage equality and all224 incoming sessions/239 refresh
rows are exact. Only ordinary Auth metadata/audits changed; three owned logouts
204 and own browser/server closure completed. No target/import writes or fixtures.
Populated target/other-org/custom-grant combinations and refresh/unavailable/revoke
retention remain unverified; no acceptance claim is made for those branches.
The next7b UI block preserves forms and will retain these proof gaps explicitly.
Final-head review/CI/merge are still required; local235 transfers next to A1005.
Production authority and delivery are separate.

## 2026-09-21 — B1006 integrates ROOT235 source only

Merge main `d68ce58711b413f8366c80615456cfbbf22a0772` after #1004 into
reviewed B1006 `a917f332e6410ca6bb3442aeb385a8e7981ee826`. Resolve only
additive launch/decision-log tails, preserving both histories and product code.
ROOT235 release `6d04fe14e3993ee49a7f1635b6f0db3cc5bb57d0a170e8219d154ff81a8172b8`
is assigned to A1005, not a B admission. Prepare only inert file-based observer
inputs while A owns the runtime; future B baseline must be the direct A1005
release with fresh source/config/Docker/query pins. Resolve configured Student
identity against pre-existing users from that admitted state; never copy an
older B actor ID or create a login/actor to force a match. No SQL reapply,
Auth/browser/server call, business write or positive deletion request now.
Independent integration review and current CI precede future B runtime admission.


## 2026-09-21 — A15g-1 / PR1005 actual local235 closure

[Actual read-retry report](qa/crm-team-chat-read-retry-actual-2026-09-21.md):
clean source7d70a71d integrates main d68ce587/#1004 without changing reviewed
f882fedc product code. Existing custom scoped staff, ordinary Auth and real
network offline/online confirm original search retry despite changed unsent
input,50→61 unique search results, context/return,64 history and retained draft;
1440/390/320 have one composer and no document overflow. Initial driver sequencing
STOP and intermediate live-session AMR verifier STOP remain separate; the single
same-session confirmation passed, and unchanged strict final verifier passed
only after own logout/browser/server closure. No additional product correction.

Independent actual/closure review3796fde3 approved full290-table/catalog/effects
parity, zero new seen, restored224 sessions/239 refresh/224 AMR hashes, preserved
8 users/stable fields and old Auth audits; only own sign-in metadata and two
login/logout audit rows differ. No messages/new actors/fixtures/SQL/providers or
production actions. Late forbidden/partial hydration remain source regressions;
pixel anchors, other channels and screen reader/device acceptance are unclaimed.
Final docs-head review/CI/merge remain; immutable candidatea5e7567c is released=false.
ROOT must accept the final release before B1006 binds the local235 environment.
Item15 and all1–36 remain partial. Historical receipts retain their original limits.

## 2026-09-21 — B1006 integrates A1005 and accepts local235 handoff

Integrate main `29e0fb46a8067a6a4f5a9bedce81971aba2f56ff` after #1005.
Only additive log tails conflict; preserve both and the reviewed B1006 product
change. ROOT accepted the direct A1005 release `78b487d7a5c8c81da5c0fef4da071343616d39e42d13cbd6a0618618cb0abe67`
as B1006's sole incoming baseline. Prepare read-only source/config/Docker and
existing configured Student binding. Independent integration and concrete
runtime-packet review precede ordinary Auth, owned browser/server and the two
bounded transport-failure checks. Preserve after-UI observations, then reconcile
strict full state only after ordinary own logout and closure. No positive account
request, SQL, fixtures, provider or production changes. Next shared QA owner is
ROOT7b; item32 remains a separate later admission.

## 2026-09-21 — B1006 actual route STOP; QA closure released to ROOT7b

[Actual report](qa/portal-profile-request-feedback-actual-2026-09-21.md): ordinary
configured Student login on reviewed source08b90ed1 reached /apply/status rather
than /portal. No profile/deletion activation, outage or visual pass was performed;
PR1006 stays draft. Keep source CI35611174459 and its scope separate from actual.
Reviewed narrow cleanup used the same owned session's real application-status
logout, then closed only owned browser/Next and removed own Auth files. Unchanged
strict final0548bab0 plus independent closure review43166e99 prove all290/catalog/
effects and33AuthStorage preserved except own allowed Auth metadata+two audits;
incoming224 sessions/239refresh/224AMR restored. Immutable resource release0f78c26c
hands off to ROOT7b with testOutcomeSTOP and productAcceptancefalse. Preserve
initial guard/closure-probe failures; no fixture/auth/backend edits or new login
are authorized by this outcome. Investigate dispatcher eligibility from existing
captured metadata/source only before proposing the smallest remedy.


## 2026-09-21 — B1006 valid existing Student, outage STOP, strict release ROOT22F

[Actual supplement](qa/portal-profile-request-feedback-actual-2026-09-21.md): the
historical configured alias was a pre209 approval; migration209 already covers
new approvals, so no duplicate migration/backfill/config/grant changes. A reviewed
new packet selected the explicit existing authorized post209 Student in memory.
Clean source5c0da6fa, unchanged product bytes versus reviewed08b90ed1: ordinary
portal login and hydrated profile PASS. Own dev Next shutdown was followed by a
saved chrome-error page/first-outage STOP; exact replacement cause UNKNOWN,
command activation/rejection unproven, no retry/layout/product acceptance.
Reviewed own API logout204 plus cookie cleanup/exact browser close completed
without navigation or Next restart. Strict final88d7a5e9 preserved full290/33
except permitted own Auth metadata and two audits. Resource released to ROOT22F
by d26f3f48; PR1006 remains draft. Preserve both historical STOP packets. Future
browser-offline confirmation is files-only proposal after ROOT22F then A15;
no new UI admission or widened functionality is implied.


## 2026-09-21 — A14a compact staff catalogue, precode

A1005 merged29e0fb46a; its local235 window released to ROOT/B1006.
[Item14 contract](EVO_STAFF_CATALOG_COMPACT_PLAN_2026-09-21.md) independently
approvedca49e8fb on plan8f081b63. Target source33966da1 is byte-identical on
incoming29e0fb46a. A owns staff-only UniversityList, optional compact UniversityPhoto,
a pure program/intake deadline selector+tests, and staff page's shared now.
Keep query/country/level/pagination30/scoped reads and management rights unchanged.
Retain actual photo attribution and existing EVO/Golos. Date selection needs
open/announced source-backed deadline, nonfuture verifiedOn and explicit supported
UTC/GMT/IANA zone (never posix/right or missing-zone fallback); same-day timed
expiry follows existing label semantics. Rank published calendar dates, never
claim earliest absolute instant; keep program/intake/source/time/TZ context.
No start-date substitution, synthetic intake identity, SQL, Student/detail changes,
country facet from30 rows, management redesign, provider writes or new fixtures.
Source checks/review/CI first; actual1440/390/320 and decoded-data comparison await
ROOT's shared-window handoff after B1006→ROOT7b→B32. No fresh staff baseline is
available yet and no source-only result claims UI/production acceptance.


### A14a source implementation — 2026-09-21

Source030d7c2e implements only the five planned files. Staff rows retain real
photo attribution, links/filters/permissions and expose a source-backed calendar
deadline with exact programme/intake context. Explicit zone and local expiry
parity, level selection, no start-date fallback, no synthetic identity; potential
portal and default/large photo paths unchanged. [Source receipt](qa/staff-catalog-compact-source-2026-09-21.md):
10 new temporal checks, typecheck and scoped lint pass. Combined37 checks:35 PASS,
2 existing failures reproduced on clean main29e0fb46 (old draft lacks reviewKind;
old SSR child hits server-only photo resolver). Retain both failures, do not
change unrelated tests or claim full suite/SSR acceptance. No actual UI or shared
QA/Auth/DB/server/browser use; independent exact-head source review/CI next,
then ordinary staff UI/data comparison only after ROOT handoff. Whole item14,
full country facet, management changes and production remain open.
## 2026-09-21 — ROOT item7b import management precode

After accepted #1004 (main d68ce587), implement the already approved
[import placement plan](EVO_SALES_IMPORT_MANAGEMENT_PLAN_2026-09-21.md).
Move the existing import mount out of the daily report into its own internal
mode=import view; preserve a scoped report entry for authorized custom staff
and add an independently scoped Admin Settings entry. Preserve existing forms,
actions, SQL, permission checks and request/File state on router refresh.
Parse and allowlist report context for a safe Back link; record/editor/saved
contexts retain precedence. No new writes, migration, content or import submit.
Impeccable Operate refinement preserves EVO and reduces daily-report noise.
Precode independent review APPROVED (private SHA
274c606ed5adbebed2b260c3c7b5aab585dabe29d8653810b5859991b13a0281).
ROOT source work is isolated; A1005 then B1006 own the shared local runtime.
Actual7b verification waits its coordinated window; populated/custom-role and
refresh-retention scenarios are only claimed when really exercised.

## 2026-09-21 — ROOT item7b source implementation

[Source proof](qa/crm-sales-import-placement-source-2026-09-21.md): existing
import form now mounts only in its own guarded mode; report and Settings keep
scoped links. Safe internal Back retains the report context; explicit editor/row
destinations retain precedence. Forms/actions/SQL/readers are unchanged. Seven
navigation tests, scoped lint and typecheck passed; ordinary UI/Auth/refresh
acceptance remains pending after A1005 and B1006. No import or production write.

## 2026-09-21 — ROOT7b / PR1007 actual local235 closure

[Import placement acceptance](qa/crm-sales-import-placement-actual-2026-09-21.md)
on clean3035e912 confirms scoped Admin/custom-staff entry/denial, context-preserving
Back, annual/archive/invalid contexts, existing record/editor precedence and Admin
Settings entry.1440/390/320 inspected; original importer/actions/SQL unchanged.
No file selection or submission. Two driver STOPs remain; an independently reviewed
finite functional continuation completed remaining branches without another visual
round or login. Sales passed its first batch. Final6fd1ecbd/verifierf2bdbb91 prove
all290 business/catalog/effects and33 Auth/Storage preservation, with only owned
sign-in metadata/four Auth audits. Both logouts204, browsers and owned Next closed.
The launch-binding stop guard and exact-owned-process cleanup are retained.
Final docs review/CI/merge and release to B32 remain; no production authority.


### A14a / PR1008 integration with accepted main e0276ecd — 2026-09-21

PR1007 merged e0276ecd5a7a0488370745d84d9b983334d85f52 after its independent
reviews, CI and bounded local235 acceptance. Integrate that immutable main into
A1008; keep reviewed catalogue product030d7c2e/head3d21b54d byte-identical.
Resolve only additive launch/decision text and current ledger statuses, preserving
both parents' evidence and B1006's unaccepted profile/login boundary. Source
review8b620d9e and CI35611424947 are accepted for3d21; combined source checks
remain35/37 with two reproduced baseline failures. Do not rerun unchanged product
checks or treat them as full PASS. Exact integration review/CI remain required.
ROOT has closed7b and handed the runtime to B32; A catalogue actual waits its
subsequent immutable release. Inert templatev3 corrections02caf8a0 are approved
only as offline preparation; all runtime pins remain null, no actual UI/resources
are used, and no further iteration is planned before a concrete binding/failure.
Country facet, management, full item14 and production remain outside this slice.

## 2026-09-21 — KB31 bounded provenance checkpoint

Record already completed offline candidate reconciliation; no new product code,
runtime, content approval or publication. The admitted31-candidate queue now has
11 with narrow provenance appendices,9 previously reviewed with unresolved claims,
and11 derivatives still pending. These are work groups, not approved articles;
appended candidates can also retain unresolved claims. Original text/frontmatter/
status and source chains were preserved; last batches148/150/152 and151/326 had
independent exact-byte closure48434643/38d705ab. Raw originals and forbidden material
bodies were excluded. Update the knowledge execution/report and1–36 ledger, dating
old operational snapshots and distinguishing local #985 materials from pending
company-download proof. Prose-only validation: diff review and git diff --check.


## 2026-09-21 — ROOT22: sidebar state on client navigation (precode)

Bounded item22 refinement after accepted KB checkpoint #1009 (`06bec2b2`).
Impeccable Operate guidance: preserve the user's navigation context in the existing
EVO shell. Sidebar disclosure state currently resets for every query change because
its React key includes the whole URL. Key it by the already-authorized active
navigation destination, with pathname fallback for an unknown/hidden destination;
retain presentation role and access version as reset boundaries. Keep links, route
guards, groups, mobile onNavigate/onBlur/Escape and visual styling unchanged.

Acceptance covers client Next Link/router transitions within the same destination:
calendar Next month and Back/Forward; sales reset link after the initial native GET
has loaded. A different destination or role/access version retains its reset.
Ordinary GET-form submission, reload/new document and persistent session state are
outside this fix; no localStorage or form interception. Pure navigation tests cover
identity/permission boundaries; scoped lint/typecheck, independent exact-head review
and one bounded ordinary local UI batch at1440/390/320 follow. Actual QA waits B32
then A1008 resource release, using an existing authorized staff account without
business writes or role changes. This slice does not finish all item22 typography,
header or density work and does not authorize production delivery.


## 2026-09-21 — ROOT22 sidebar destination source implementation

[Source proof](qa/crm-sidebar-destination-state-source-2026-09-21.md) records
product d4c7dcdf: key now follows authorized activeId (tagged pathname fallback),
with unchanged role/access-version boundaries. AppShell, visibility/guards,
forms and visual styles are untouched.19 real navigation-builder tests, scoped
lint, typecheck and diff-check passed. This establishes source behavior only;
ordinary calendar Next Link/Back/Forward and1440/390/320 acceptance await the
coordinated window after B32/A1008. Native GET/reload remain outside the guarantee.

## 2026-09-21 — A14a / PR1008: реальный каталог и закрытие local QA

Product b8497ad44cd020f0abf112b92a5b4a7c7d459651 прошёл existing Admin ordinary
Auth и scoped catalogue UI: поиск/страна/уровень/combined/reset/detail/back,
loaded compact photo/caption/author/source/license/focus и1440/390/320 без
horizontal overflow. [Actual-квитанция](qa/staff-catalog-compact-actual-2026-09-21.md).
Первый STOP exact-label select сохранён, одна reviewed confirmation с четырьмя
select[name] заменами прошла; product не менялся. Набор из пяти опубликованных
вузов не покрывает positive future deadline или Next: это открытые data gaps.

Strict final: все290 business tables, catalogue/effects неизменны;33 Auth/Storage
сверены, incoming sessions/refresh/AMR сохранены. Только собственные Auth metadata
и2 login/logout audit. Own logout204, browser/PID77446+77465/group77417/33252
закрыты, собственный captured tokenfile удалён. Release047b2e0c передал QA ROOT22;
B32 STOP не считается product acceptance. Source10/10+types/lint и прежние35/37
baseline результаты переиспользованы. Docs-only main06bec2b2 сохранён вместе с
KB row31 и полными append-only журналами; product retests не требуются.
Финальные independent exact-head review/CI/merge ещё нужны; production не запускался.

## 2026-09-21 — KB31 first-read completion checkpoint

Record the completed bounded first review of the admitted 31-candidate set:
16 candidates have narrow provenance appendices, 15 retain unresolved claims
without an appendix, and none await first review. These are work groups, not
whole-material approvals; unresolved claims also remain in appended materials.
Last batches 146/147 and 153/154/327 passed independent exact-byte closure
4a37d170/36e759a2: original prefixes, frontmatter, status, source chains and
publication manifests were preserved. Retain earlier 11/9/11 history and all
raw/applicant/trash/secret exclusions, including 125/321–325/328. Update only
the knowledge QA report, execution checkpoint and item31 row; no product,
KB or publication writes in this documentation slice. Item31 still needs
specific business decisions and applicable official-source verification;
item32 ordinary company downloads remain unproved by this evidence.
Prose-only validation: diff review and git diff --check; independent exact-head
review and protected CI remain required before merge. No production claim.


### A1008 — финальная интеграция docs-only #1011

Main7be6461de23fe9c8e8a0cd378010d8be03637757 включён с сохранением KB row31
(16/15/0), пяти входящих docs и всех append-only записей. Runtime/source/test
дерево остаётся byte-identical actual b8497ad4; новых product checks не запускали.

## 2026-09-21 — ROOT22 partial UI, strict closure and functional remainder

[Actual report](qa/crm-sidebar-destination-state-actual-2026-09-21.md) records
source32f50df4: first1440 assertions and390 month transitions completed before
the script's open-menu pointer obstruction. One corrected confirmation stopped
on document navigation; its cause remains unknown. Preserve both STOPs and
keep #1010 draft. No product change or third visual/polish round is justified.
Strict final290/33 passed with only own Auth metadata/two audits; own204/browser/
server/port/token closure completed, resource6f6ff7ed passed to B32.

Independent prepared plan93841526/reviewaee13ab1 fills only missing390/320
FUNCTIONAL branches after B32/B1006, without screenshots or1440 repetition.
Observe real Link interception together with URL/period/epoch/document requests;
aria-busy is not hydration proof. No forced/prevented event or native fallback.
Record each stage, one attempt, stop on unexpected outcome. Existing real data
and source guards remain; no fixtures/tasks/roles/providers/production. This
changes the method after observed automation stops, not the acceptance standard:
full relevant UI proof, independent review and CI remain required for merge.

Integrate accepted main d6add883 (#1008) and KB #1011. Both journal conflict
blocks are retained; the two ROOT product files remain byte-identical to32f50df4,
and incoming catalogue product files match main. Reuse unchanged scope checks.

### A15g-2 — последовательности одного автора, precode 2026-09-21

PR #1008 смержен в main d6add88372778758b23686fb0bba6ae74181e15b после
независимого exact-head review beadbefc и CI35623264182. Его actual b8497ad4
и ограничения остаются в существующей квитанции. A начинает следующий
принятый ограниченный блок по [плану группировки](EVO_TEAM_CHAT_MESSAGE_GROUPING_PLAN_2026-09-21.md).
Исходный чат идентичен actual7d70a71d/main29e0fb46; прежние снимки используются
только как визуальная база, не как приёмка нового поведения.

Принятый precode51ded385 и независимое reviewb42dbc42 разрешают presentation-only
helper, два компонента ленты и локальный CSS: соседние видимые строки одного
автора/канала в пределах5минут и одного дня Bishkek, без deleted/sequence gap;
первая строка, highlighted target и server firstUnreadId всегда полные.
Имена сохраняются для screen reader, время/edited/quote/mentions/действия видимы;
16px текст,44px controls, avatar-column, IDs/keys, handlers, ACL, composer,
seen и scroll-anchor механизм сохраняются. BigInt исключает потерю точности.
Никаких DTO/SQL/migration, новых сообщений или previews всех каналов.

До отдельного окна A работает только с исходниками: pure behavior tests,
scope lint/typecheck и прямые feed/read-errors/seen/drafts проверки.
Auth/DB/Storage/browser/server runtime остаётся в очереди B32 → B1006 →
ROOT22F → A15. Actual1440/390/320, anchors/actions/draft и честный учёт
возможного seen требуют будущего согласованного окна; production не заявляется.


### A15g-2 — source готов, actual UI ожидает окна

После precode6a128cbc реализован source05705f7a: pure grouping только видимых
соседних строк, известные highlighted/unread boundaries, сохранённые действия
и screen-reader авторы. 39/39 целевых tests, scope lint и typecheck PASS.
Первый typecheck выявил `1n` при текущем target; `BigInt(1)` исправляет это без
изменения конфигурации. [Source receipt](qa/team-chat-message-grouping-source-2026-09-21.md)
сохраняет оба результата. Никаких Auth/DB/Storage/server/browser действий;
actual UI/anchors/draft, независимое review и merge ещё впереди.


## 2026-09-21 — B32: два Company download и закрытие local QA

Документировать уже выполненные два скачивания существующих опубликованных TXT
ordinary Admin через Company UI: app GET → 307 → Storage 200, сохранённые байты
совпали с оригиналами. Source e0276ecd, scoped parity пяти файлов с main d6add883;
[actual-квитанция](qa/company-material-download-actual-2026-09-21.md) содержит
полные hashes. Strict final290/33 подтвердил только grants2/consumptions2/
receipts4/audits4 и собственный Auth lifecycle, сохранив старые данные/сессии.
Own local logout204 и закрытие ресурсов подтверждены; UI logout не заявляется.
Release50fe4292 передал среду B1006; независимое review2abe1d27 принято.
Исторические STOP и redirect-target net::ERR_ABORTED сохранены без утверждения
о причине сетевого события. Меняются только эта квитанция, текущие intro/row32
ведомости и addendum KB execution; весь пункт32/клиентский AI/production не закрыт.
Никаких runtime/KB/publication изменений в этом срезе. Prose-only: diff review,
git diff --check; отдельные exact-head review и protected CI перед merge.


### A15g-2 / PR1012 — один actual batch и закрытие QA

На source6e401f9c ordinary scoped staff прошёл один existing-data UI batch:
пара15/16, полный первый/header target,3deleted rows, keyboard reply/menu/link,
quote/remove, search/context/Back anchor, prependanchor, unsent draft и
permalink.1440/390/320: nooverflow/onecomposer/body16/timevisible;3снимка
просмотрены вместе, без коррекционного раунда. [Actual receipt](qa/team-chat-message-grouping-actual-2026-09-21.md)
сохраняет foreign/unread/variants gaps и отсутствие numeric old/new density
claim. Это ограниченная technical QA, не весьitem15 или production.

AFTER RAW без intermediateAuthPASS → ownlogout204/browser/33256 closure →
FINAL5f59a5dc/strict verifier9a2e964c PASS: все290business/33AuthStorage,
zero new seen, original sessions/refresh/AMR restored, only2ownAuthaudits.
OwncapturedAuth удалён после finalproof. Release27b0b2d2 передан ROOT для
следующего B1006 admission; автоматический запуск не разрешается.

Mainc42f3963/#1013 интегрирован только в docs с сохранением B32/KB истории;
обе append-only истории сохранены построчно в прежнем порядке. Продукт
побайтно совпадает с actual6e401f9c, старые tests не запускались заново.
Независимое actual/final-head review, CI финального head и merge ещё впереди.


### A1012 — независимая actual/closure приёмка

APPROVED_SCOPED_ACTUAL_AND_CLOSURE831b1f6d принято для actual6e401f9c:
полные parsed before/final290/33, preserved425audits/224sessions/239refresh/
224AMR и2ownAuthaudits, zero newseen, UI assertions/PNG/closure подтверждены.
[Квитанция](qa/team-chat-message-grouping-actual-2026-09-21.md) сохраняет всеgaps.
B1006 получил окно через ROOT; A больше не использует sharedruntime.
Final-head review/CI/merge остаются отдельными; product bytes не менялись.


## 2026-09-21 — A15: общая строка времени и действий сообщения

PR #1012 принят в main `7faa4748c899b58e25d630f6c3942a6dd21ff663`: final review
`0036d57d`, CI35631741403 SUCCESS (5 PASS / 3 ожидаемых SKIP), ordinary squash
exact head88f0479c. Предыдущие actual/gaps сохраняются, production не запускался.

Следующий [двухфайловый контракт](EVO_TEAM_CHAT_SERVICE_ROW_PLAN_2026-09-21.md)
принят до кода: precode83cf1217, независимое APPROVED_PRECODEeeceef77 и разрешение
ROOT на source-only реализацию. В Row переносим единственные time/edited в footer
с прежними Ответить/menu; полный автор остаётся над body, continuation header
целиком srOnly. Новый scoped CSS не меняет shared messageActions/textButton,
44px controls,16px body, права, callbacks, keys, details, grouping и seen.

Причина: повторный time line box у коротких продолжений. Выигрыш остаётся
проверяемой гипотезой; baseline112.1875/136.984375/161.78125px для1440/390/320
сохраняется без выдуманного процента. Разрешены scope lint/typecheck и независимое
source review; actual UI/anchors/draft/ширина нужны позже в отдельном окне ROOT.
Сейчас QA у ROOT22G; Auth/DB/Storage/browser/server не трогаем. Превью всех каналов,
DTO, миграции и весь item15 вне этого PR.


### A15 service row — source готов к независимому review

Контрактbe254e6f → product30f8fa3f: время/edited перенесены к действиям,
повторный авторский header сохраняется через srOnly; Row и scoped CSS,
shared classes/права/DTO/grouping/seen неизменны. Scope ESLint и typecheck PASS
на Node22.23.1; [source-квитанция](qa/team-chat-service-row-source-2026-09-21.md).
Прежние39/39 не повторялись. Actual1440/390/320, anchors/menu/draft и выигрыш
плотности ещё не доказаны. QA остаётся у ROOT22G, runtime не открывался.

## 2026-09-21 — B1006 first browser-offline rejection PASS; resource release ROOT22G

[Actual report](qa/portal-profile-request-feedback-actual-2026-09-21.md): after two
preserved STOPs, ROOT admitted one genuine browser-context offline attempt with
Next kept running, no mocks/route interception/retry/screenshots. This replaces
only the failed verification method, not product semantics. Existing authorized
post209 Student; frozen sourcec4d73455. One Enter produced one matching POST/
requestfailed ERR_INTERNET_DISCONNECTED, RU neutral alert, enabled recovery,
same document/button/epoch and no false success. Discarded the original document
while offline before restoring online; ordinary own Auth API logout204, cookie
cleanup/exact browser close, then own Next36648 stop. Strict final2891910b proves
full290/33 preservation except allowed own Auth metadata/two audits; resource
releaseb18b832e hands off ROOT22G. Retry/Space/KY/layout/positive deletion/native/
VoiceOver/full E2E/production remain unclaimed. Current-main7faa4748 integration
preserves all incoming files and both additive shared-log histories; B product
bytes remain identical to actual c4d. Final exact-head review and protected CI
remain required before ordinary merge; no new QA window or deployment implied.

Independent actual+closure review27e335dd is APPROVED_SCOPED_NEGATIVE_UI_AND_CLOSURE;
this does not claim server-command execution or positive request acceptance.

## 2026-09-21 — ROOT22F partial functional result and main1013 integration

Preserve both main c42f3963 Company-download checkpoint and ROOT22 history.
[Actual report](qa/crm-sidebar-destination-state-actual-2026-09-21.md) adds the
single 34b6bd0b functional attempt: 390 Week/Back/Escape passed; same-sidebar's
10-second waiter stopped because it defaulted month while the bare route defaults
week. This is a proven harness/source mismatch, not a product bug or completed
same-sidebar acceptance. Different destination and 320 were not run; no 1440 repeat,
screenshots or retry. Any corrected inert proposal remains unexecuted preparation.
Strict final 290/33/catalogue/effects and old sessions/refresh/AMR reconciliation
passed; only own Auth metadata/two audits changed. Own API logout 204, browser/token/
process/port closure and actual Ctrl-C exit 1 are retained. Release 11e05efb passed
the environment to A15; product acceptance=false and #1010 remains draft.
Only documentation changes; both product/test files retain 34b6bd0b bytes. Preserve
current main rows 14/32 and update only the sidebar row 22/intro. Diff/marker review
and git diff --check only; exact-head independent review/CI still gate merge.

Corrected remainder script04f53dc1 / independent inert review9f334e2a is prepared
only: bare Calendar expects week;320 selects the real «Месяц» Link before monthly
checks. Passed390 Week/Back/Escape and1440 are excluded. It remains UNBOUND and
unexecuted, queued after A15 and B1006 with fresh source/release/actor binding;
no runtime admission or full item22 acceptance follows from this preparation.


## 2026-09-21 — ROOT22G scoped functional acceptance and main integration

[Actual report](qa/crm-sidebar-destination-state-actual-2026-09-21.md) appends the
single remaining functional pass at f5f8fef2: 390 same/different-destination and 320
Month/next/Back/Forward/Week/Escape/focus/menu passed with trusted client Link,
correct URL/period and unchanged document. No 1440 repeat or new screenshots.
Independent actual/closure review 799f96ff accepts the bounded remainder; earlier
STOPs and their precise limits remain historical, not relabelled successes.
Strict final 290/33/catalogue/effects, original sessions/refresh/AMR and own cleanup
passed; only own Auth sign-in metadata/two audits differ. Logout API 204, closed
browser/server/33254, removed captured Auth and actual Ctrl-C exit 1 are retained.
Release 77a63714 passed to A1014; its pre-review productAcceptance=false is immutable.
The narrow client-navigation function is locally accepted, not the whole item 22,
native GET/reload persistence, other roles, a new visual cycle or production.

Integrate main 8b6259ec (#1012 at 7faa4748; #1006 at 8b6259ec), preserving both journal
histories and current catalogue/KB/download rows. Align current rows 15/24 to those
verified merges without widening grouping or negative-profile evidence; row 22
records this actual result. Four shell/navigation files retain 32f50df4 bytes;
other incoming product files retain main bytes. Documentation diff/marker/parity
review and git diff --check only; no product tests, runtime or production action.
Final exact-head documentation review and protected CI still gate #1010 merge.


## 2026-09-21 — ROOT14 country facet implementation contract

After #1010 merged at59a726b5, implement the bounded [staff country facet](platform/staff-catalog-country-facet.md). ROOT reserves236 after fresh source inventory001–235. The current static ISO menu will use the complete authorized published-country projection for staff only; Student controls, six-country admissions scope, compact rows and existing readers stay intact. One additive staff-only RPC, strict DTO, explicit failure and preserved absent-country deep links. Precode review08c1a108 approved; Impeccable Operate applies. A1014 retains sole shared-QA ownership until strict release; this contract authorizes source work, not concurrent runtime or production. Source/actual/final review and protected CI remain required; known single-country data cannot prove multi-country/pagination positives.


## 2026-09-21 — ROOT14 published-country source implementation

[Source evidence](qa/staff-catalog-country-facet-source-2026-09-21.md) records productf8622d86: additive236 staff-only scoped country RPC, strict complete-facet DTO and staff select wiring. Seven pure tests, scoped lint/typecheck and SQL/PLpgSQL syntax checks passed. The selected missing country remains explicit; no static-list/empty-success fallback masks errors. Existing Student rendering, data and other readers are preserved. Exact-head source review, CI and coordinated local migration/ordinary Auth/UI remain pending; no runtime or production acceptance is inferred.


## 2026-09-21 — ROOT14 source review correction: country reset

Independent source review3f5c74a4 found one P2: the uncontrolled country select can retain CN after a client Link resets the URL. Key only the staff select by committed country; preserve other controls and Student behavior. This implements the existing filter/reset contract, not a new feature. Actual reset remains unverified until the coordinated UI pass; the earlier failed source verdict is retained.

### A1014 — actual принят, строгая передача QA и интеграция main

Exact source2f467e5b прошёл один existing-data UI batch1440/390/320 без коррекций.
Одна строка времени/действий сохраняет44px controls/16px body, AX автора, menu,
quote/draft, search/context/Back, prepend anchor/details identity и permalink.
Та же пара: высоты112.1875→94.796875 /136.984375→119.59375 /161.78125→144.390625px;
каждая −17.390625px, visible6→7/4→5/4→4. [Actual](qa/team-chat-service-row-actual-2026-09-21.md)
сохраняет все отсутствующие варианты, initial readiness STOP и log-parser note.

Raw after → own logout204/browser/server close → finalc9d5e401/strict6cf2902f
PASS:290 business/33AuthStorage, zero seen/Storage,431 старых audits/8 users и
224/239/224 sessions/refresh/AMR сохранены; только2ownAuth audits/metadata.
Own Auth удалён после success, Ctrl-C exit1 записан честно; user33216 не тронут.
Release7ca6c43a передан ROOT_COORDINATOR. Независимое actual/closure reviewa76c16a6
принято. Runtime A закрыт, дополнительного visual pass нет.

Main59a726b после #1006/#1010 интегрирован в4f33577f: chat bytes равны actual,
3 импортированных product files и navigation test равны main; обе append-only
истории сохранены. Sidebar destinationKey не меняет AppShell/chat layout; portal
profile не входит в staff chat flow. Final exact-head review/CI/merge впереди;
весь item15/production этим срезом не закрывается.


### A15 — bounded channel preview reader/DTO до кода, 2026-09-21

После merge #1014 / main24e78024 независимый precode review7a844584 принял
предложение1ee57581. [Контракт](EVO_TEAM_CHAT_CHANNEL_PREVIEWS_PLAN_2026-09-21.md)
разделяет reader/DTO и последующий rail UI. ROOT резервирует237 и разрешает
только первый source блок: additive latestPreview в существующем channels RPC,
strict decoder и pure monotonic snapshot/preview acceptance с protocol tests.
Сохранить authority156, sparse unread225, current signature/grants/STABLE/DEFINER,
index223; latest включает replies/tombstones, body cap240 Unicode characters.
Нет новых таблиц/index/subscriptions/N reads/timers; права/Composer/feed/seen
и UI не меняются. Late search/background metadata не должны воскресить закрытый
канал или старое тело после удаления; null и malformed/failure различаются.

План/journals записаны до кода в isolated izzhackt/team-chat-channel-previews.
Shared QA остаётся ROOT236, затемB1015; apply237/Auth/browser/server/runtime
здесь не разрешены. Source checks и draft PR — ещё не actual acceptance/merge.
Фиктивные actors/messages/grants не разрешены; protected CI, independent review
и отдельный принятый actual packet остаются обязательными до merge. Rail UI
начинается после первого merge; весь15/1–36/production не объявляется готовым.


### A237 — source clarification before decoder hardening

Message id and sequence_id are globally unique in migration141. The strict
channels decoder will also reject repeated latest-message id or sequence across
different channel projections: this is an impossible wire snapshot, not a second
valid copy. Add a meaningful protocol case for this invariant; no SQL/UI scope
change. The first15 protocol cases passed before this addition. Initial local
SQL-parity extractor selected225's earlier seen function; scoping extraction to
team_chat_channels confirms unchanged actor/unread/ACL source. No DB ran.


### A237 — reader/DTO source готов, actual ожидает окна

Source8104e106 реализует bounded latestPreview в237 и strict decode единственного
channels RPC; pure acceptance helper подготовлен для следующего rail UI блока.
[Source evidence](qa/team-chat-channel-previews-source-2026-09-21.md):16/16 protocol
cases, typecheck и targeted lint PASS; exact actor/unread/ACL source225 preserved.
Никакой SQL/Auth/RPC/UI/runtime проверки ещё нет; helper в UI не подключён.
ROOT236/#1016 ещё не в базе main24e78024:001–235,236 не дублируется. До finalCI/
actual237 — интеграция ROOT236 после merge и отдельный handoff послеB1015.
Draft PR/source review впереди; actual/review/protectedCI остаются merge gate.

## 2026-09-21 — B24: precode обратной связи о прочтении уведомлений

После обычного merge #1006 в main8b6259ec выбран один оставшийся web-сценарий:
[локальная ошибка single/bulk mark-read](platform/portal-notification-read-feedback.md).
Исходники и независимый source-разбор подтверждают отсутствие local failure
feedback; runtime здесь не выполнялся. Предложены общая клиентская форма,
RU/KY alert и ручной повтор с сохранением existing actions/RPC/IDs/guard,
неатомарного bulk и остановки на первой ошибке. Public unstable_rethrow для
сохранения framework redirects — явно открытая деталь precode review, с
зафиксированным официальным предупреждением о стабильности. Код не менялся.
ROOT передал QA A1014; B остаётся files-only до отдельного admission.

### B24 — source implementation после принятого precode

Precode0e4317c5 независимо APPROVED_PRECODE49b1f3e2; координатор разрешил
ограниченный source-блок. Наfd7f0900 общая клиентская форма добавляет локальную
RU/KY ошибку и ручной повтор single/bulk/detail, сохраняет server actions/RPC/
IDs/guards и first-error bulk. Public Next16.3.4 unstable_rethrow принят с
задокументированным риском; служебные redirects пробрасываются, новых внутренних
imports нет. Установленный public API:4/4 unit PASS; i18n8/8/source7/7 PASS,
UI wiring18/22 с четырьмя отдельно воспроизведёнными baseline8b6259ec failures.
Scoped lint/TypeScript/diff-check PASS. [Source checkpoint](platform/portal-notification-read-feedback.md)
сохраняет точные ограничения. Actual/QA/source review/CI/merge ещё не заявлены;
shared QA у A1014, следующий слот B не назначен.


### B1015 — source approval и интеграция main59a726b

Независимое APPROVED_SOURCE_ONLYff585096 для1c296e85 принято координатором.
Интегрирован свежий main59a726b (#1010): обе ordered journal histories сохранены,
актуальные строки ведомости приняты без изменений. Все6 B product/test files
побайтно сохраняют sourcefd7f0900; другие incoming main files сохранены.
Никаких новых product edits, тестовых повторов или runtime-действий. Прежние
source checks сохраняют свои ограничения, включая4 baseline UI-contract failures.
Draft #1015 ждёт CI интеграционного head; прежний DIRTY/zero-CI не считается
проверкой. Actual B только после handoff ROOT_COUNTRY236 и отдельного admission.


### B1015 — свежий main24e78024 после параллельного merge #1014

Пока отправлялась интеграция59a726b, A1014 вошёл вmain24e78024. Он также
интегрирован files-only: сохранены актуальные статусы и полные ordered истории
обоих потоков. Входящий код относится только к staff team-chat component/CSS
module; общий Portal/Auth/Next contract не менялся. B product/test bytes всё
ещё равныfd7f0900, без новых исправлений или повторного runtime. Предыдущий
headf0c346cd не получил CI из-за опередившего merge; новый frozen head должен
получить свои checks. Actual B остаётся после ROOT_COUNTRY236handoff.
## 2026-09-21 — ROOT14 country facet actual and main integration

Actual deeaed89 passed one local236 CLI apply and one ordinary Admin/Student
RPC/UI batch1440/390/320. Published CN, absent MY, native GET search/level/combined,
country Link reset and full reset passed. No suspected inherited reset failure
occurred. Own logouts204/browser/server closure and strict final290/33 preserved
all business data and incoming224/239/224 sessions/refresh/AMR; only two own users'
sign-in metadata and four Auth audits differ. [Actual evidence](qa/staff-catalog-country-facet-actual-2026-09-21.md)
records the finite scope, missing datasets and independent review28f1a365.
No production or catalogue write occurred. QA was released to ROOT, then a
separate coordinator handoff assigned B1015 with a fresh binding still required.

Integrate main24e78024 after #1014's accepted final head5f46d6ac and CI35635247615;
retain both journal histories, unchanged country product bytes from deeaed89
and incoming chat files from main. Correct current item14/15/22 and local236
status without rewriting historical receipts. Source checks and unchanged
runtime evidence are reused; integration/docs need diff/parity review and the
protected final PR checks, not another visual cycle. Whole item14/manage,
whole items1–36 and production remain incomplete.


### A237 — интеграция канонической236, source перед повторным exact-head review

ROOT1016 смержен в main9f7dde1d8b040d555af647a2b89628d06d6b921f
2026-09-21T18:33:21Z. Интегрируем этот main в проверенный9fc0785c; все пять
A237 source/test/SQL файлов побайтно сохранены, импортированные файлы ROOT236
равны main. Оба append-only журнала сохраняют записи обоих родителей. Repo
миграции теперь001–237; это не подтверждение применения237 к локальной базе.

Источник и16 protocol cases прежние; повтор локальных product tests не нужен
из-за одной интеграции независимого staff country reader. Проверяем diff,
parity и fresh protected CI. Exact-head review впереди. Shared QA остаётсяB1015;
apply/RPC237 и второй rail UI блок не запускались.


### A237 — local reader/DTO actual принят, ресурс возвращён ROOT

На sourcebb24f35f выполнены один canonical local apply237 и четыре ordinary
Auth/PostgREST probes. Ledger001–236→001–237; изменено только тело существующего
channels(uuid),1191 identities/OID/owner/ACL сохранены. DDL reviewe133a066 принято.
Admin200 дал3 канала,2 latest/1 empty, exact production decoder и независимая
canonical projection совпали. Admin nil-org403, Student403, anonymous401 —
реальные42501 отказы. [Actual-квитанция](qa/team-chat-channel-previews-actual-2026-09-21.md)
сохраняет неподтверждённые custom/inactive/no-scope/foreign-tenant и latest
own-author/reply/tombstone/long-body варианты; UI/native/races не заявлены.

Полный final3610d43f/closure3d267de8 сохранил290 business/33AuthStorage; отличия
только timestamps двух existing users и4 own login/logout audits, zero seen.
Входящие224/239/224 sessions/refresh/AMR сохранены; own logout204 оба, два своих
private Auth captures удалены. Independent RPC/strict-closure review97acb1ae
принято; отдельный ROOT handoff07d28083 передал ресурс ROOT_COORDINATOR. A больше
не выполняет runtime. Старые STOP и подтверждённая ROOT recovery сохранены.

Следующий шаг — интеграция main436865af после #1015 с сохранением обоих журналов
и всех пяти A237 source/test/SQL bytesbb24. Неизменные scoped source/actual
результаты переиспользуются; diff/parity, fresh protected CI и независимый
final-head review обязательны. CI35639431195 наbb24 принят ранее и не заменяет
новый CI. Rail UI начинается после merge #1017; whole15/1–36/production не закрыты.
### B1015 — один offline single-form actual, закрытие и main9f7dde1d

На frozenfa4ad8e8 существующий Student выполнил один Enter в одиночной форме
уведомления с offline только собственного browser context. Единственный matching
POST отказал ERR_INTERNET_DISCONNECTED; RU local alert, pending, восстановление
кнопки/фокуса и неизменное read-state/list/document наблюдались. Retry/positive/
bulk/detail не выполнялись. Своя local Auth logout204, cookies/browser/captures
и Next закрыты; strict final290/33 PASS, zero business/Storage writes.
[Actual](qa/portal-notification-read-feedback-actual-2026-09-21.md) сохраняет
полные SHA и ограничения. Среда передана ROOT_COORDINATOR; independent actual
review `94914f03` принято координатором. Пункты23–24, native, полный E2E и production не закрыты.

После закрытия согласована files-only интеграция main9f7dde1d (#1016/236).
Все6 B product/test files побайтно равныfd7f0900, incoming main code и полные
ordered истории обоих journals сохранены. Строки14/15/22/31/32 ведомости
сохранены изmain; строка24 дополнена узким actual и gaps. Повторного QA или
тестов не было; прежний CI35635859635 относится кfa4ad8e8. Интегрированному
final head ещё нужны независимое review и protected CI перед merge.


### A237 — main436865af интегрирован после actual, final-head gate

Merge0a1cdeb11533d408b56e99bdc1431ea1549dfab1 сохраняет обе полные ordered
nonblank истории родителей41810d1b/436865af. Пять A237 source/test/SQL files
побайтно равны actualbb24; шесть входящих B product/test и две B-документации
равны main. Ведомость обновляет только текущий срез/local237/пункт15, сохраняя
остальные строки main. [Source/integration](qa/team-chat-channel-previews-source-2026-09-21.md)
и [actual](qa/team-chat-channel-previews-actual-2026-09-21.md) различают прежние
source-only этапы и принятое узкое RPC доказательство. Runtime не повторялся.
Fresh protected CI и независимый exact-head review впереди; #1017 пока draft,
rail UI ждёт merge. Production и whole15/1–36 не закрыты.


## 2026-09-21 — Item14 manage search / additive238 precode

Accepted contract: [staff catalogue manage search](platform/staff-catalog-manage-search.md). Base9f7dde1d; ROOT reserves238 after A237. Implement scoped pending-draft literal search and mixed keyset50+1, strict DTO/query/listContext and additive reader first. Preserve legacy readers, commands, publications, permissions, all143 editorial templates and exact retry. UI index/editor remain unchanged until actual incumbent inspection; no SQL/Auth/runtime execution in this checkpoint. Integration of actual237 is required before protected migration checks; no fabricated predecessor. Plan approval is not actual acceptance.


### ROOT238 manage — incumbent inspection and UI implementation, 2026-09-22

Actual source f3871a0537605fd23ff847a2e312291de098a3e1 was inspected once by ordinary local Admin at 1440/390/320. The index has no search; Add is below 143 templates and the batch action dominates. Queue is empty, so draft detail/editor were not inspected. Incumbent receipt SHA256 89c0d3587dd84ade2ad7e09fc57b51cdec86dcb84ee869890e3e64f3a8a82528; strict final290/33 passed after own logout. Intermediate live AMR verifier STOP is retained; no allowlist was changed.

Implement the approved manage contract: one header Add, labelled native GET name search, real238 pending page/count/cursor, independent name filtering of all templates, secondary batch and canonical listContext return links. Preserve forms/actions/template bytes and EVO/Golos. This authorizes source work only; migration238 and post-change UI acceptance remain pending after the current shared QA owner closes.


### ROOT238 manage — real local acceptance, 2026-09-22

Source `4bf6b9dbec8f04fc36db74a1f8547939c84081c6`: one local apply238, ordinary Admin empty/literal RPC reads and Student/anonymous/service/mismatched-organization denials; one ordinary Admin UI batch1440/390/320. Native search of the existing143 templates, template view/context Back, reset, browser history and real Tab passed. All290 business tables and33 Auth/Storage invariants passed strict final after own logout204. Own browser/child process closed and reaped; an initial post-stop socket-bind OSError is retained, with later read-only confirmation of group/listener absence and a free port. No second signal or UI rerun.

[Actual receipt](qa/staff-catalog-manage-search-actual-2026-09-22.md) preserves the exact evidence and remaining zero-pending limitations: no positive draft search, >50/Next, existing editor or writes. This completes the implemented narrow local check, not production, whole item14 or1–36. Product files are unchanged by this documentation checkpoint; final-head review/CI remain required.


## 2026-09-22 — Item22 mobile header spacing, precode

After #1019 merged in43410559, implement [two-class mobile header refinement](platform/crm-mobile-header-spacing.md): top py2 keeps6px focus-ring clearance, actions min-h14/py1 restores old values atmd. Existing EVO identity, both rows, labels,44px controls, permissions/state/handlers and desktop remain. Independent direction reviews c242de8b/ac1da62c accepted. Use the already accepted manage route instead of chat for one narrow actual shell batch, avoiding unrelated seen effects; no exact height saving or text-zoom proof is claimed before execution. No data/API/migration change.
