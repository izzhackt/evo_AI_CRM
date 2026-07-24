# Claude Design master prompt — EVO Admissions Platform

Use the linked local folder as the only working repository. Work directly in
the existing application and complete the **entire production-quality
frontend**, not a slide deck, design exploration, wireframe set, isolated
showcase, or another static HTML prototype.

The linked repository already contains a substantial connected frontend.
Treat it as the baseline: inspect it, preserve working routes and permissions,
and finish or refine any remaining gaps in place. Do not create a sibling
repository, a second frontend app, a replacement prototype folder or a ZIP-only
deliverable.

Do not stop after research, an audit, a plan, a visual direction, or a few
representative screens. Continue autonomously until the full staff workspace
and student portal are coherent, responsive, accessible, connected through
working navigation and interactions, and ready for engineering review.

## Outcome

Create one friendly, modern EVO Admissions platform in which:

- every employee sees only the areas allowed by the existing role model;
- the team can understand leads, students, tasks, documents, applications,
  visa work, finance, communications and operational risk from one coherent
  interface;
- students have a clear personal portal with progress, next actions,
  documents, applications, visa, payments, messages, notifications, their EVO
  team and profile/security;
- important states always explain what happened, who owns the next action and
  how the user can continue.

The interface language should be natural Russian by default and preserve the
existing language support. Use realistic EVO Admissions content from the
repository; do not use generic SaaS lorem ipsum.

## Read before changing the frontend

Start by reading these sources in this order:

1. `AGENTS.md` and `CONTEXT.md`
2. `docs/design/evo-platform/IMPLEMENTATION_PLAN.md`
3. `docs/design/evo-platform/COMPLETION_CHECKLIST.md`
4. `docs/design/evo-platform/SOURCE_BRIEF_IT_TZ.md`
5. `docs/platform/system-overview.md`
6. `docs/platform/data-ownership.md`
7. `docs/business/evo-business-context.md`
8. `docs/business/admissions-process.md`
9. `docs/business/sales-playbook.md`
10. `docs/company/brand/evo-admissions-logobook.pdf`
11. the relevant decisions in `docs/adr/`
12. the existing routes, components, styles, tests and screenshots under
    `src/`, `tests/e2e/` and `docs/design/evo-platform/`

The supplied IT brief is useful business context, but it may contain incorrect
technical assumptions. Repository code, data-ownership documents, ADRs,
security rules and explicit owner decisions have higher authority.

## Product truth that must remain visible

- amoCRM remains the canonical source for lead/contact identity and sales
  stage.
- The student's operational admissions stage is separate from the sales stage.
- The root EVO application is the unified staff-facing workspace.
- EVO Inbox is the communications/UX foundation, but the current root
  `/whatsapp` route must describe the data it actually reads; it must not claim
  to be live EVO Inbox Supabase data unless that bridge truly exists.
- AI customer replies are **draft-only**. A staff member reviews, edits and
  manually sends them. Do not add or imply automatic replies.
- Do not imply that amoCRM, WAHA, Supabase, AI, telephony, email or any other
  provider is connected merely because a card or badge exists.
- Preserve the implemented roles and server-side access rules. Do not invent a
  new role or widen access to match a design persona.
- Do not create a second source of truth for leads, students, sales stages,
  payments or documents.

## Complete frontend scope

Finish all relevant views and their connected states:

### Staff workspace

- authentication and access-denied/read-only states;
- role-relevant command center;
- sales funnel and list;
- Lead 360;
- unified WhatsApp Inbox with conversation history, AI draft review and manual
  send;
- team chat/updates;
- students list and Student 360;
- admissions strategy;
- applications list and detail;
- documents queue, review, correction, decision and history;
- visa queue and detail;
- finance overview and detail;
- tasks, calendar, calls and meetings;
- notifications;
- reports and useful drill-downs;
- administration, users, roles, integrations, readiness and audit.

### Student Portal

- mobile authentication;
- overview, progress and next action;
- documents, upload, correction and resubmission;
- applications and decisions;
- visa;
- payments;
- messages and notifications;
- My EVO Team;
- profile and security;
- a genuine desktop layout, not a stretched phone frame.

### Shared system states

Connect states to real routes/components instead of showing them only in a
design catalogue:

- loading and skeleton;
- empty and no-results;
- success and validation;
- system error and recovery;
- no access, read-only and approval required;
- integration missing, configured but unverified, unavailable or blocked;
- sync pending, failed or conflict only when current data can distinguish them;
- duplicate warning where the current product has supporting data;
- blocked state with reason, owner and next action;
- document correction, rejection and upload failure;
- payment overdue, blocked and resolved only when supported by current data;
- message sending, sent, delivered, read, failed and unknown only when the
  stored status supports that distinction.

If current data cannot truthfully support a state, do not fabricate successful
behavior. Use an honest unavailable/future-state explanation and leave the
backend contract unchanged.

## Experience and visual quality

Use the committed EVO logobook and the strongest existing platform patterns as
the design authority. Refine the current implementation into one consistent
design system covering typography, color, spacing, layout, radius, borders,
elevation, motion, navigation, forms, tables, kanban, status, drawers, dialogs,
feedback, Inbox, documents, timeline, notifications and audit.

The result should feel calm, trustworthy and operationally clear—not like a
generic template. Prioritize hierarchy, readable density, obvious next actions,
plain-language status copy and strong mobile behavior.

Required viewports:

- staff desktop: `1440 × 1024`;
- staff tablet: `834 × 1194`;
- urgent staff mobile flows: `390 × 844`;
- student mobile: `390 × 844`;
- student desktop: `1440 × 1024`.

No page-level horizontal overflow is acceptable. Staff mobile must preserve
usable Inbox, task and notification actions. Every Student Portal destination
must remain reachable on mobile.

## Interaction and accessibility

Primary navigation, tabs, filters, rows, forms, overlays and the key end-to-end
flows must actually work. Use native semantic controls, durable field labels,
visible keyboard focus, named landmarks, accessible dialogs, keyboard/Escape
behavior, focus entry/return and meaningful live announcements for asynchronous
updates. Respect reduced-motion preferences.

Do not fake visible assets with emoji, ASCII art, improvised drawings or
placeholder boxes. Reuse committed brand assets and the existing icon system.

## Boundaries

- Focus on the frontend and frontend-facing tests/documentation.
- Do not redesign databases, merge Supabase projects, delete Lead Agent,
  change provider configuration, expose private services, change production
  secrets, deploy, or send real messages.
- Do not replace working authentication, permissions, server reads or guarded
  actions with frontend-only mocks.
- Preserve useful existing work. Improve or complete it rather than rebuilding
  the application blindly.
- Make product/design decisions yourself when the repository already provides
  enough context. Ask only when a choice would change business ownership,
  permissions, compliance or source-of-truth rules.

## Completion contract

Before reporting completion:

1. Check every applicable line in
   `docs/design/evo-platform/COMPLETION_CHECKLIST.md` against the real
   application.
2. Verify the complete product at all required viewports.
3. Exercise keyboard navigation, dialogs, mobile navigation and the primary
   connected flows.
4. Run the repository's frontend quality checks and browser tests.
5. Capture current browser evidence for the final implementation.
6. Clearly separate:
   - completed frontend behavior;
   - simulated/demo data;
   - missing backend/provider integrations;
   - decisions that still require EVO management.

Return a working, cohesive frontend in the linked repository. Do not return
only recommendations or screenshots.
