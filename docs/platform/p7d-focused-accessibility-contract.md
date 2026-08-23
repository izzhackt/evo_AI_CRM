# P7D focused accessibility and small-launch contract

Status: historical source under #376/ADR 0020. U11/U12 may reuse focused
accessibility evidence only after current-slice review; this is not an active
release gate.

Version date: 2026-08-14 (Asia/Bishkek)

Plan Block-ID: `EVO-P7D-FOCUSED-ACCESSIBILITY-2026-08-14`

Issue: #167

## Owner decision

The owner does not require a large capacity stress test before the initial
small launch. The former 2,000-active-student, 100-concurrent-session test and
temporary managed load-test project are deferred, not passed. P7D now closes
only the focused accessibility gate needed to prepare the real P8 release
candidate.

## Small-launch operating envelope

The initial operating envelope is an observation and monitoring boundary, not
an SLO, SLA or proven capacity result:

- no more than 10 staff accounts in routine use;
- no more than 200 active students;
- normally no more than 20 simultaneous users;
- approximately 1,000 message records per day;
- approximately 100 document uploads per day.

The merged P7B private readiness, metrics and alerting remain the operational
guard. Reopen formal capacity testing before a campaign or planned growth past
any envelope value, after a compute/topology change, or immediately when real
readiness, connection, queue, error or latency evidence shows pressure.

Supabase Micro provider limits are useful infrastructure facts, not proof that
application queries meet a latency target. No P7D document may translate those
limits into a Platform capacity claim.

## Deferred capacity work

- Do not create a temporary managed staging or load-test project under P7D.
- Do not run high-volume traffic against production.
- Do not invent a default k6 profile, error budget, latency target or SLO.
- Do not mark DEC-010 capacity/SLO work complete.
- Keep any future k6 harness and managed load execution behind a fresh owner
  decision, cost confirmation, isolated target and provider-side-effect fence.

## Automated accessibility boundary

The existing Playwright/Axe suite remains a repository regression gate. It may
run against the repository's accepted browser path, but that result alone is
not a live-release or WCAG-conformance claim. Do not expand it into an
exhaustive page/browser matrix in this slice.

Before the real release decision, run the existing suite on the exact release
candidate and record the commit, command, browser version, exit status and
violations. Any serious finding blocks release until fixed and rechecked.

## Human review matrix

The owner is the approved focused human reviewer. The available matrix is:

- macOS Chrome: keyboard-only navigation at 100% and 200% zoom;
- macOS Safari with VoiceOver: critical form, heading, control, status and
  dialog announcements;
- iPhone Safari in portrait: critical Student Portal workflows;
- Android Chrome in portrait: critical Student Portal workflows.

The review runs on the exact real release candidate, not the old production
application. It covers only critical launch workflows:

1. staff login and landing page;
2. open a student and inspect documents, application, visa and payment state;
3. open WhatsApp/messages and operate the primary reply/draft dialog without a
   provider send;
4. Student Portal login, home, documents, messages, notifications and payments;
5. keyboard focus order and visible focus for primary actions;
6. VoiceOver names, roles, status changes, errors and dialog focus;
7. mobile navigation, readable text and controls without hidden or clipped
   critical actions.

Record pass, blocked or not-applicable for each item, with device/browser/AT
versions and timestamp. Do not capture customer data, credentials or private
messages in screenshots or reports.

## Release severity

Fix before release when a verified issue:

- prevents login or completion of a critical workflow;
- prevents keyboard access to a critical control;
- loses or traps focus;
- makes a critical form/control/status unintelligible to VoiceOver;
- hides or clips a critical mobile action;
- exposes data to the wrong role or weakens security/privacy.

Record lesser cosmetic, non-critical copy, or secondary-route improvements as
follow-up issues. This focused review does not claim formal WCAG conformance.

## Sequence and acceptance

1. Merge this docs-only amendment after independent review and green exact-head
   CI.
2. P8 may prepare the real release candidate with high-load capacity explicitly
   deferred and unproved.
3. Run the existing automated accessibility gate on that exact candidate.
4. Guide the owner through the focused human matrix.
5. Fix and recheck launch-blocking findings. Record non-blocking findings.
6. A production release still requires P8 real-service evidence and explicit
   action-time authorization. This contract authorizes no deployment, provider
   send/write, customer-data access or billed project.

P7D focused accessibility is accepted only after steps 3-5 have real candidate
evidence. Merging this contract alone does not complete P7D.

## Official basis

- W3C WCAG 2.2 conformance requires automated and human evaluation:
  <https://www.w3.org/WAI/WCAG22/Understanding/conformance.html>
- Supabase compute and connection limits:
  <https://supabase.com/docs/guides/platform/compute-and-disk>
- Grafana k6 thresholds remain the future formal capacity gate:
  <https://grafana.com/docs/k6/latest/using-k6/thresholds/>
