# ADR 0017: Separate Student Profile document automation from EVO Platform

- Status: accepted
- Date: 2026-08-05
- Refines: ADR 0014, ADR 0015 and ADR 0016
- Supersedes as current authority: PR #119 and the BW8 Student Profile
  document-intelligence lane

PR #119 remains immutable repository history. Its in-repository automation
scope is no longer an active implementation decision.

## Context

PR #119 placed Student Profile document reading, extraction, profile autofill
and profile-form export inside `evo_AI_CRM`. The owner subsequently confirmed
that this automation is a separate small system outside EVO Platform.

EVO Platform still needs its ordinary admissions document lifecycle: versioned
country/program checklists, private PDF/JPG/PNG objects, document versions,
integrity and malware evidence, Curator/Admin review, correction/resubmission
history, audited access and separate Storage backup. Removing that lifecycle
would conflict with the accepted Platform and Student Portal contract.

## Decision

1. Student Profile document reading, extracted-fact confirmation, profile
   autofill and profile-form DOCX/PDF export belong to a separate system outside
   this repository.
2. EVO Platform keeps ordinary admissions document metadata, checklist slots,
   private Storage objects, versions, review/rework and audited access.
3. The separate system is not a Platform runtime dependency. No automatic
   import, export, shared database, shared Storage bucket or data exchange is
   implied by this decision.
4. Any future integration requires a separate plan amendment covering explicit
   data mapping, purpose and consent/privacy rules, authentication and
   authorization, failure handling, validation and acceptance evidence.
5. PR #118's P4B amoCRM mapping selection/approval contract is restored as the
   next implementation lane after this amendment is controller-merged and
   exact-main CI is green. It must recheck migration ownership on fresh main;
   with the current contiguous `001-058` history, `059` is only the expected
   next-free number, not a reservation.
6. This ADR authorizes no application code, database migration, provider call,
   managed Supabase action, production mutation or customer/student-data use.

## Consequences

- The active Platform plan and TZ no longer contain BW8 extraction, autofill,
  scanner/provider or profile-export requirements.
- The ordinary Platform Documents and Student Portal document experience
  remains in scope and continues to use private Storage plus RLS.
- PRs #120, #122 and #124 remain reverted by PRs #127, #126 and #125.
- Historical PR #119 text remains available through Git and the append-only
  decision log, while this ADR and its plan amendment are the current authority.

## Rejected alternatives

### Revert PR #119 without a forward decision

Rejected because it would obscure the accepted change history and would not
state the boundary between normal Platform documents and the separate
automation system.

### Keep BW8 as an inactive Platform backlog item

Rejected because it would continue to imply that EVO Platform owns the
automation. A future integration or transfer of scope needs an explicit new
decision.
