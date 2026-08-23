# EVO Platform final frontend audit

> **Status:** historical frontend evidence from 2026-07-24. Product, role,
> ownership and rollout claims are superseded in conflict by #376 and ADR 0020;
> this audit does not prove the current U0-U14 target or live providers.

- Audit date: 2026-07-24
- Application: root Next.js EVO Admissions CRM
- Scope: unified staff workspace and Student Portal frontend
- Verdict: **frontend complete within the current repository contracts**

The original Claude Design archive has been converted from a strong visual
reference into a connected, responsive application. The result uses the real
root routes, current authentication and role checks, current local read models
and honest integration states. It does not replace server behavior with a
detached prototype.

## What is complete

- One coherent staff workspace covering dashboard, sales, Lead 360, Student
  360, applications, documents, visa, finance, tasks, calls, WhatsApp, team
  chat, notifications, reports and settings.
- A real Student Portal covering progress, next action, documents,
  applications, visa, payments, messages, notifications, team and
  profile/security.
- Responsive staff desktop/tablet layouts, urgent staff mobile actions and a
  mobile-first five-slot Student Portal navigation with an accessible
  `Ещё` dialog for the remaining sections.
- Role-aware navigation and server-enforced access-denied behavior.
- Loading, empty, validation, error, blocked, read-only and unavailable
  integration states on the current critical paths.
- Exact stored WhatsApp delivery-state vocabulary:
  received/sent/delivered/read/failed/unknown, without inferring provider
  success.
- Prepared AI as a clearly labelled deterministic draft for operator review.
  Automatic customer replies remain disabled.
- Visible form labels, consistent focus indicators, meaningful progress text,
  live-region feedback and accessible native dialogs with focus entry/return.

## Product truth preserved

- amoCRM remains canonical for lead/contact identity and the sales stage.
- The operational admissions stage remains separate from the sales stage.
- `/whatsapp` identifies its real source as local CRM `wa_*` shadow tables. It
  does not claim to read EVO Inbox Supabase data.
- A provider badge is not treated as evidence that amoCRM, WAHA, Anthropic,
  telephony, email or storage is live.
- Prepared AI content is not described as a live Anthropic result.
- No automatic WhatsApp reply path was added.

## Visual verification

Reference and current screenshots were inspected together at the same
responsive viewport. The combined comparison sheets are committed beside the
current captures. Files `01–09` are real PNG images whose pixel dimensions
match the viewport dimensions declared in their filenames.

| Surface | Current evidence | Reference/current comparison |
|---|---|---|
| Staff dashboard, 1440 × 1024 | [`01-dashboard-desktop-1440x1024.png`](implementation-screenshots/final-audit/01-dashboard-desktop-1440x1024.png) | [`10-compare-dashboard-desktop.jpg`](implementation-screenshots/final-audit/10-compare-dashboard-desktop.jpg) |
| Staff dashboard, 834 × 1194 | [`02-dashboard-tablet-834x1194.png`](implementation-screenshots/final-audit/02-dashboard-tablet-834x1194.png) | [`11-compare-dashboard-tablet.jpg`](implementation-screenshots/final-audit/11-compare-dashboard-tablet.jpg) |
| WhatsApp detail, 1440 × 1024 | [`04-whatsapp-detail-desktop-1440x1024.png`](implementation-screenshots/final-audit/04-whatsapp-detail-desktop-1440x1024.png) | [`12-compare-whatsapp-desktop.jpg`](implementation-screenshots/final-audit/12-compare-whatsapp-desktop.jpg) |
| WhatsApp detail, 390 × 844 | [`05-whatsapp-detail-mobile-390x844.png`](implementation-screenshots/final-audit/05-whatsapp-detail-mobile-390x844.png) | [`13-compare-whatsapp-mobile.jpg`](implementation-screenshots/final-audit/13-compare-whatsapp-mobile.jpg) |
| Student Portal, 1440 × 1024 | [`06-student-portal-desktop-1440x1024.png`](implementation-screenshots/final-audit/06-student-portal-desktop-1440x1024.png) | [`14-compare-portal-desktop.jpg`](implementation-screenshots/final-audit/14-compare-portal-desktop.jpg) |
| Student Portal, 390 × 844 | [`07-student-portal-home-mobile-390x844.png`](implementation-screenshots/final-audit/07-student-portal-home-mobile-390x844.png) | [`15-compare-portal-mobile.jpg`](implementation-screenshots/final-audit/15-compare-portal-mobile.jpg) |
| Student Portal `Ещё` dialog | [`08-student-portal-more-mobile-390x844.png`](implementation-screenshots/final-audit/08-student-portal-more-mobile-390x844.png) | current-state interaction evidence |
| Prepared AI drawer | [`09-prepared-ai-drawer-desktop-1440x1024.png`](implementation-screenshots/final-audit/09-prepared-ai-drawer-desktop-1440x1024.png) | current-state interaction evidence |

The current implementation is intentionally not a pixel-for-pixel copy of
prototype demo numbers or unsupported provider claims. It keeps the accepted
EVO visual language while using current repository data and truthful system
states.

## Automated validation

All commands ran with the repository-required Node 22 runtime.

| Check | Result |
|---|---|
| Prepared AI state regression | 2/2 pass |
| ESLint | pass |
| TypeScript `tsc --noEmit` | pass |
| Next.js production build | pass; 38 routes generated/verified |
| Business scenario evaluation | 39/39 pass |
| Full Playwright suite | 48 pass, 16 intentional project/viewport skips, 0 fail |
| Automated WCAG A/AA scan | pass on core staff and portal routes, WhatsApp detail, open AI drawer and open portal navigation dialog at desktop/mobile |
| Node security tests | 22/22 pass |
| Postgres authorization policies | pass, including expected denied-operation assertions |
| `npm audit --audit-level=moderate` | 0 vulnerabilities |

The browser suite verifies route authorization, primary mutations, responsive
overflow, mobile navigation, native-dialog focus entry/return and Escape
handling, exact WhatsApp status mapping, interactive dialog contrast and
blocked provider states.

## Not represented as proven

- A real outbound WhatsApp message and real WAHA acknowledgement.
- Live amoCRM OAuth/synchronization in this isolated preview.
- Live Anthropic generation.
- A bridge from the root `/whatsapp` route to EVO Inbox Supabase.
- Binary document upload storage.
- A payment gateway.
- Live offline/reconnecting or synchronization-conflict telemetry.
- A management-approved admin invitation lifecycle.
- Production deployment.

Those are integration or product-policy tasks, not unfinished visual states.
They remain visible as unavailable, unverified or intentionally unsupported
where the user needs that information.

## Accessibility limit

Automated WCAG checks and keyboard/browser scenarios passed. Native dialogs,
labels, focus entry/return and visible focus were also inspected in the current
in-app browser. A manual VoiceOver, NVDA or other screen-reader session was not
performed and is not claimed.

## Handoff

Use the clean linked repository together with:

1. [`CLAUDE_DESIGN_MASTER_PROMPT.md`](CLAUDE_DESIGN_MASTER_PROMPT.md)
2. [`COMPLETION_CHECKLIST.md`](COMPLETION_CHECKLIST.md)
3. [`SOURCE_BRIEF_IT_TZ.md`](SOURCE_BRIEF_IT_TZ.md)
4. this audit and the current browser evidence

Claude Design must continue in the existing root application. It must not
create another detached prototype, widen permissions, fake providers or
redesign the database as part of a frontend pass.
