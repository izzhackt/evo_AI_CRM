# EVO Platform Independent Design Review Closure

Date: 2026-07-25

Scope: the 13 implementation-ready findings in the owner-provided
`EVO Review Handoff.dc.html`, reviewed against the merged root application.
This is a frontend polish closure, not a rebuild and not proof of a live
provider integration.

## Outcome

| Finding | Result | Verified behavior |
| --- | --- | --- |
| F1 | Closed | Normal outgoing WhatsApp messages use `#131519` in light mode and `#25292f` in dark mode. Failed delivery remains the danger treatment. |
| F2 | Closed | Visa uses the plane icon; Applications keeps the file-check icon. |
| F3 | Closed with accessibility refinement | At 834px the navigation is a labeled 220px sidebar. The first tooltip implementation was removed after independent review found a touch-discoverability and WCAG 1.4.13 risk. |
| F4 | Closed | The unselected Inbox explains how to open a dialog and repeats the manual-send boundary. |
| F5 | Closed | The duplicate dashboard attention eyebrow was removed. |
| F6 | Closed | Positive counts are ordered before zero counts. The all-zero state says `Всё под контролем` and explains that no urgent work is present. |
| F7 | Closed | One amoCRM unverified block is shown only when lead ID, contact ID and last-sync evidence are incomplete. Optional AI-agent state no longer controls amoCRM verification. |
| F8 | Closed | Mobile uses a collapsed native source disclosure; two seeded messages fit in the initial 390 × 844 conversation viewport. |
| F9 | Closed | Student 360 calls its anchors `Разделы дела студента`; add-application, document, task and payment forms start collapsed in native disclosures. |
| F10 | Closed | The visible composer label is `Ответ в WhatsApp`; placeholder is `Напишите ответ…`. |
| F11 | Closed | Allowed role cells use the shared check icon with an accessible text equivalent; denied cells use an explicit em dash. |
| F12 | Closed | The portal right rail uses only the current actionable document, unpaid payment and active application deadline. Empty provider facts are not invented. |
| F13 | Closed without code change | Portal system updates contain no emoji. The only reviewed celebration emoji is employee-authored staff chat content, so removing it would change business-authored text rather than system UI. |

## Visual comparison ledger

1. WhatsApp outbound changed from brand red to dark ink, preserving red for
   failures and the primary Send action.
2. The Inbox empty area changed from a bare icon/title to a centered,
   instructional state with the exact approved Russian copy.
3. The 834px staff navigation changed from an icon-only rail to persistent
   labels after the accessibility review.
4. Mobile communications source truth changed from a large banner to a native
   collapsed disclosure without hiding the first two messages.
5. The portal desktop right rail now uses real document, payment and
   application records rather than leaving a large empty lower zone.
6. Student 360 add forms remain reachable but no longer dominate the initial
   scan of the record.

Current evidence:

- [WhatsApp desktop, dark outbound](implementation-screenshots/communications-admin/01-whatsapp-desktop-1440.png)
- [Staff tablet, persistent navigation labels](implementation-screenshots/communications-admin/02-tasks-calendar-tablet-834.png)
- [WhatsApp desktop empty state](implementation-screenshots/communications-admin/08-whatsapp-empty-state-desktop-1440.png)
- [WhatsApp mobile conversation](implementation-screenshots/communications-admin/09-whatsapp-conversation-mobile-390.png)
- [Portal desktop case rail](implementation-screenshots/portal/overview-desktop-1440x1024.png)

## Verification

- Node runtime: 22.23.1.
- ESLint: passed.
- TypeScript and generated Next route types: passed.
- Next.js production build: passed, 38 application pages generated.
- Unit tests: 2 passed.
- Business scenarios: 39 passed.
- Node security tests: 22 passed.
- PostgreSQL authorization suite: passed; its expected permission-denied
  probes remained denied.
- Complete Playwright suite: 62 passed, 24 intentionally skipped for
  non-applicable viewport projects.
- Automated WCAG A/AA checks passed for the representative staff and portal
  routes in both configured Playwright projects.
- In-app browser review covered login, dashboard, Inbox empty/conversation,
  Student 360, roles and Student Portal.
- Two independent read-only reviewers checked correctness/product truth and
  accessibility. Their amoCRM, reversible-test-data and touch-navigation
  findings were fixed and re-tested.
- Production dependency audit: 0 vulnerabilities with `--omit=dev`.

## Honest residual boundaries

- No real WhatsApp message was sent.
- amoCRM, WAHA, storage, payment and other provider readiness was not
  reclassified from configuration or local records.
- AI remains draft-only; every customer send remains a deliberate operator
  action.
- No production deployment, database migration or provider mutation was made.
- The full npm audit still reports the newly disclosed
  `brace-expansion`/`minimatch` issue inside development-only ESLint plugin
  packages. Current upstream plugins still require the incompatible legacy
  callable API, so a forced override would break or silently weaken linting.
  The production dependency graph is clean; this dev-tool advisory remains
  tracked until the Next ESLint bundle publishes a compatible fix.
- Automated accessibility checks do not replace a real screen-reader,
  forced-colors or physical touch-device session.
