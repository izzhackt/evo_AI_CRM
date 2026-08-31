# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three fixed staff roles inside EVO Admissions, an education-agency team placing
students into universities. There is no self-serve signup and no customer-facing
account: every user is a colleague.

- **Director / Admin** — the functional superset. Sees every module and can
  preview the exact Sales or Admissions interface to support or audit either.
- **Sales Manager** — owns a lead from first contact to the contract and first
  payment, then hands it off. Cannot cross the handoff boundary.
- **Admissions Manager** — receives handed-off cases and runs the operational
  work: tasks, documents, university applications, visa milestones, finance
  stop/release. Cannot do Sales work before handoff.

Confirmed usage scene: **desktop-first, mobile occasional.** Managers work at a
desk for most of the day; the phone is for checking something between meetings.
Density and scanability are designed for desktop. Mobile must stay genuinely
usable — it is not a defensive afterthought — but it is the secondary surface.

## Product Purpose

One internal product with one access surface, one UI, one role model and one
workflow, covering the complete admissions journey:

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

- One root Next.js application; App Router; three fixed roles enforced on the
  server, not in the client.
- PostgreSQL is the only V2 business authority. No fixture, demo-seed, mock
  provider, dual-read or fallback repository is permitted in the active path.
- The login surface is a two-field local development gate that states plainly
  that it is not production authentication.
- Deferred modules (`/dashboard`, `/calls`, `/chat`, `/notifications`,
  `/reports`, `/portal`) fail closed rather than showing partial UI.
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
- No verified provider acceptance exists for AI, WhatsApp or CRM sync. Future
  work must not present any of them as verified.

## Product Principles

1. **Truthful state over reassuring state.** The interface says what is actually
   true of the server right now — not configured, unverified, blocked, denied,
   rejected — and never dresses one condition as another.
2. **The role boundary is the product.** What a role cannot do should not be
   offered to it, and the boundary should be legible rather than punitive.
3. **The record must survive the conversation.** Evidence, gates and events are
   first-class, because the case outlives whoever is looking at it today.
4. **Density in service of the task.** This is a tool people are inside all day;
   scanability and consistency outrank expression.
5. **The tool disappears into the work.** Familiarity is a feature here. Brand
   lives in precise details, not in decoration.

## Accessibility & Inclusion

- WCAG 2.2 AA is a release criterion, not polish: keyboard operability, visible
  focus, semantic headings, descriptive document titles, contrast, reflow and
  target size are gated in CI via `npm run test:a11y` and the frontend contracts.
- Locales: **Russian is the working language; English is the secondary surface.**
  Kyrgyz (`ky`) is confirmed vestigial — existing strings stay, but new copy is
  not required to ship a Kyrgyz translation, and Kyrgyz completeness must not
  block work.
