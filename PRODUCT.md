# Product

## Current UX scope — owner decision 2026-09-20

The owner has expanded task-based UX analysis and refinement to all CRM, product
web (desktop/mobile) and iPhone surfaces. Preserve existing brand and capabilities;
CRM may receive substantial workflow/layout improvements. Follow the additive
[UX plan](docs/EVO_UX_REFINEMENT_PLAN_2026-09-20.md) together with the current
CRM/admissions functional contract. Older portal-only scope below is historical
for that plan and does not exclude this new staff work. Dedicated page agents
are authorized; production mutations and release are not implied.

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

EVO Admissions serves independent prospective students, EVO clients and the
staff team that supports them. The owner approved this audience expansion on
2026-09-19, replacing the previous staff-only restriction on self-serve signup
and customer-facing accounts.

- **Independent prospective student** — completes the mandatory questionnaire,
  creates an account only at its final step, and waits for staff approval.
  After approval, uses shared university/program discovery, English preparation
  and career-interest features with a personal profile and saved progress.
- **EVO client** — receives all the same shared features plus their authorized
  case, curator, documents, tasks and communication. Team invitations and later
  service enrollment lead into the same product; an existing user keeps their
  account, saved choices and learning progress when accompaniment is added.

Staff continue to work through the CRM with three staff roles:

- **Director / Admin** — the functional superset. Sees every module and can
  preview the exact Sales or Admissions interface to support or audit either.
- **Sales Manager** — owns a lead from first contact to the contract and first
  payment, then hands it off. Cannot cross the handoff boundary.
- **Admissions Manager** — receives handed-off cases and runs the operational
  work: tasks, documents, university applications, visa milestones, finance
  stop/release. Cannot do Sales work before handoff.

Confirmed staff usage scene: **desktop-first, mobile occasional.** Managers work at a
desk for most of the day; the phone is for checking something between meetings.
Density and scanability are designed for desktop. Mobile must stay genuinely
usable — it is not a defensive afterthought — but it is the secondary surface.

### Approved portal delivery and access — updated 2026-09-19

Develop the complete desktop-first web portal and the complete iPhone app in
parallel, sharing one account and the same data and authorization contracts.
This later owner decision supersedes the sequential web-then-iPhone order
recorded in PR #859. Both surfaces cover discovery, preparation and full client
accompaniment, including documents, tasks and communication.

The owner-selected app name is **EVO admissions**, using the original EVO logo.
The web portal remains at `https://app.evoadmissions.com`; staff continue at
`https://crm.evoadmissions.com`. Parallel delivery does not create another
production dataset or a replacement portal domain.

Every new student, including a new invitee, follows questionnaire → account
creation → staff approval → portal. Before approval, show only the application
status and necessary account/support actions; neither a separate signup nor a
guest catalog bypasses this gate. Approval grants shared portal access, while
client accompaniment requires its own authorization. Preserve existing approved
accounts and their data rather than making them register again.

The current implementation scope is the student portal and its necessary CRM
connections. Staff continue in the existing CRM; a separate staff redesign is
not part of this portal plan. Fable chooses and implements a full portal UX/UI
redesign within the EVO brand, with concise, useful frontend copy and no AI-style
explanatory filler. See the [full web + iPhone plan](docs/EVO_PORTAL_WEB_IPHONE_PLAN_2026-09-19.md).

This is an approved product direction, not a claim that independent self-serve
access, lesson-based learning or an iPhone client is already implemented or
released. The linked plan defines implementation scope; Fable selects and records
the mobile technology. Commercial terms are not a prerequisite for this work.
Existing authentication, organization/case access
and Student-private assessment boundaries remain in force during implementation.
See the current scope entry in [the launch plan](docs/EVO_LAUNCH_PLAN.md) and
its decision record in [PLAN_CHANGES](docs/PLAN_CHANGES.md).

## Product Purpose

One product with role-scoped staff CRM and Student Portal surfaces sharing the
same business records. Independent students and EVO clients share the discovery
and preparation features; client accompaniment adds the staff-supported case
workflow:

`Sales pipeline → Lead 360 and qualification → contract and first-payment gate →
audited handoff → Student 360 → tasks / documents / applications / visa /
finance stop or release → WhatsApp with a human-reviewed AI draft`

Success is that a manager completes the next real step without leaving the tool,
and that the record of what happened is trustworthy afterwards.

## Positioning

The mechanism a neighbouring CRM cannot truthfully copy is **the audited handoff
with an enforced commercial gate**. Sales cannot pass a case to Admissions until
contract and first-payment evidence exist; the handoff writes an append-only
business event linking that evidence to the resulting Student Case. Roles are
fixed and enforced server-side, not configurable permissions.

PostgreSQL is the single business authority. External providers are explicitly
subordinate to it: AI drafts are advisory and human-reviewed, WhatsApp sending
requires an explicit staff action over final reviewed text, and CRM sync is a
server-authorised integration rather than a second source of truth.

## Operating Context

- Work happens alongside WhatsApp conversations with students and their parents,
  university portals, and document collection (passports, diplomas, language
  certificates, nostrification).
- Cases are long-lived: a lead can take months to become an enrolled student,
  crossing the Sales/Admissions boundary once.
- The team is small enough that the same person is often both the last human who
  spoke to a student and the one operating the record.
- Provider availability is a real, visible operating condition: the interface has
  to state truthfully when AI, WhatsApp or CRM sync is not configured, configured
  but unverified, or actively blocked. Staff act on that disclosure.

## Capabilities and Constraints

- One root Next.js application; App Router; three staff roles and separate
  Student authority enforced on the server, not in the client. Public signup
  does not grant staff access or access to another student's case or results.
- Managed Supabase Postgres is the only production-successor business
  authority. No fixture, demo-seed, mock provider, dual-read or fallback
  repository is permitted in the active path.
- Staff enter through Supabase Auth. Every protected request is checked against
  the live staff profile, organization membership, role bundle and access
  version before the server accepts it; there is no local development-gate
  fallback.
- Unavailable or unauthorized modules fail closed. Public self-serve access is
  an approved target; it must be implemented with its own scoped authority
  rather than bypassing the existing portal checks.
- Business events are append-only; the database rejects mutation of the audit log.
- Terminology in the product is deliberately mixed-language: Russian labels with
  retained English domain terms (Student 360, Lead 360, Student Case, handoff,
  WhatsApp, amoCRM). This is how the team actually speaks; it is not a
  translation gap.

## Brand Commitments

- Name: EVO Admissions. Wordmark is "EVO" plus a dot plus "ADMISSIONS".
- Brand fill: EVO red `#d70217`. Confirmed binding; it stays the brand fill.
- Typefaces in use: Golos Text (UI) and JetBrains Mono (identifiers, timestamps,
  measurements).
- Both light and dark themes ship and are equally supported.

## Evidence on Hand

- Real local PostgreSQL V2 contract (six Drizzle migrations, contract version 4)
  with the full canonical schema.
- A working end-to-end staff journey against real records.
- No production customer data is available for design work, and none may be
  fabricated to stand in for it.
- Provider acceptance was performed and passed. On 30 August 2026, one bounded
  acceptance -- resumed across preserved state and completed on exact main
  `f87bd37f` -- exercised the real path end to end: Gemini produced one proposal
  that stopped at a durable `review_required` checkpoint before any outbound
  mutation; a person edited the draft and explicitly confirmed the send; WAHA
  delivered exactly one message, addressed to the WAHA session's own self
  identity, whose final observed ACK was `READ`; one amoCRM sync completed as
  seven idempotent operations yielding one validation contact with its lead and
  note, each read back and correlated to its PostgreSQL binding; and an exact replay produced zero duplicates.
- Read that paragraph literally. Nothing was sent to a customer and no real CRM
  record was created: the target was the connected session's own number and the
  entities were clearly marked validation objects. The run proves the path, not
  a delivery to anyone.
- Recorded in issue #467, whose closing comment is the evidence; the run's own
  artefacts are deliberately stored outside Git and the disposable database was
  destroyed afterwards, so the detail cannot be re-derived from this repository.
  `f87bd37f` is an ancestor of current main, and the server-side Gemini, WAHA
  and amoCRM modules, the schema, the migrations and the API routes have not
  changed since -- the UI panels above them have.
- That acceptance is historical, not continuous. It proves the code path works
  against real providers; it does not prove that credentials are present and
  working in any given environment right now. Design and preview environments
  routinely run with no provider configuration at all, and the interface is
  expected to say "not configured" there. Read a live provider claim only from
  the running environment's own state, never from this document.

## Product Principles

1. **Truthful state over reassuring state.** The interface says what is actually
   true of the server right now — not configured, unverified, blocked, denied,
   rejected — and never dresses one condition as another.
2. **The role boundary is the product.** What a role cannot do should not be
   offered to it, and the boundary should be legible rather than punitive.
3. **The record must survive the conversation.** Evidence, gates and events are
   first-class, because the case outlives whoever is looking at it today.
4. **Density in service of the task.** Staff work in the CRM all day;
   scanability and consistency guide the staff workspace.
5. **The tool disappears into the work.** Familiarity is a feature here. Brand
   lives in precise details, not in decoration.

## Accessibility & Inclusion

- WCAG 2.2 AA is a release criterion, not polish: keyboard operability, visible
  focus, semantic headings, descriptive document titles, contrast, reflow and
  target size are gated in CI via `npm run test:a11y` and the frontend contracts.
- Portal locales: **Russian and Kyrgyz (`ru`, `ky`)**, complete across the agreed
  web and iPhone scope. English is learning content, not a third portal UI locale.
  This owner decision supersedes the former optional-Kyrgyz rule for the portal.
- Staff CRM locale scope remains unchanged: Russian is the working language,
  English the secondary surface; this portal plan does not relocalize the CRM.

## Approved Admin knowledge workplace — 2026-09-19

The CRM knowledge library is Admin-only across pages, search, APIs and export. Pages, files and nested folders share a file-manager interface. It includes autosave with conflict protection, versions, trash/restore, source-preserving import and portable export. Existing staff case-document and reply-snippet rights remain unchanged.

CRM «Клиентская база» projects actual client cases and their existing documents/chat/history without a second client identity or independently editable file copy. Local general client-AI knowledge instead belongs in internal topics with preserved approval/provenance. SOPS protects secret records separately; no raw material or personal dossier is implicitly published to AI.

The owner requested migration and sorting of all four local source roots, retaining originals as an archive. CRM becomes the workplace after real read/edit/download/export and inventory reconciliation. These are acceptance criteria, not a completion claim. See [the full contract](docs/EVO_CRM_KNOWLEDGE_BASE_PLAN_2026-09-19.md).
