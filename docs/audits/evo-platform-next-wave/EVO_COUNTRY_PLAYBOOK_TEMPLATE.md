# EVO Country Playbook Template

Status: draft template for managed staff review. It is not an approved country instruction and contains no current country facts.

Purpose: give every country team one common, versioned structure that can be consumed by Curators and, after approval, by the internal OZO Assistant. The template follows the useful structure of the China employee document while separating stable operating steps from facts that change.

## 1. Required metadata

```yaml
artifact_kind: evo_country_operational_playbook
playbook_key: country.<iso_country_code>.default
country: <country name>
country_code: <ISO 3166-1 alpha-2>
version: <positive integer>
status: draft # draft | reviewed | approved | retired
audience: internal
owner_role: curator
reviewer_role: <curator_lead | business_process_owner | legal | finance>
reviewed_by: <membership reference, never a personal credential>
reviewed_at: <timestamp or null>
effective_from: <date or null>
next_review_at: <date or null>
supersedes_version: <positive integer or null>
source_revision: <content sha256 or controlled revision>
```

Publication rules:

- Only `approved` content may be used as operational knowledge.
- Approval is per immutable version. Editing creates a new draft version.
- An existing case keeps its applied version until an authorized audited rebase.
- Retirement prevents new use but does not erase historical case evidence.
- A general playbook never overrides a case-specific official request from a university or government body.

## 2. Scope and operating boundary

Fill in:

- education levels and routes covered;
- applicant citizenship/residency routes covered;
- intakes covered;
- services owned by EVO;
- actions owned by the university, scholarship body, consulate, migration authority, insurer or other provider;
- explicit exclusions;
- role ownership before and after OP to OZO handoff.

Mandatory statement:

> The playbook supports the Curator. Admission, scholarship and visa decisions are external outcomes. The Curator and assistant must not guarantee them. AI observations and drafts never replace employee review or an authorized Platform action.

## 3. Source register

Use one record per source:

```yaml
- source_id: <stable opaque key>
  authority: government | embassy_or_consulate | university | scholarship_body | signed_agreement | owner_director | partner | historical_evo
  title: <public-safe title>
  url_or_repository_ref: <canonical public URL or controlled repository revision>
  source_revision: <publication date, page revision or sha256>
  checked_at: <timestamp>
  checked_by_role: <role>
  applies_to: <country/route/intake/university/program/citizenship>
  valid_until: <timestamp or null>
  review_status: pending | reviewed | rejected | retired
  notes: <no student PII>
```

Authority order:

1. latest EVO owner/director decision for EVO's own service;
2. signed agreement for its legal scope;
3. current official government, embassy/consulate, university or scholarship source;
4. newest active EVO operational document;
5. latest confirmed partner communication;
6. legacy presentation, chat or draft.

Lower-authority evidence must not silently override a higher-authority source. Conflicts remain visible until reviewed.

## 4. Fact status and freshness

Every material fact has these fields:

```yaml
fact_key: <stable key>
statement: <bounded statement>
fact_type: stable_process | mutable_external | case_specific | evo_internal
verification_status: official_verified | evo_approved | verification_required | conflicting | expired
source_ids: [<source_id>]
checked_at: <timestamp or null>
valid_until: <timestamp or null>
verification_trigger: <before recommendation | before payment | before submission | before travel | on provider request>
```

Treat these as mutable by default:

- intake and application deadline;
- seat/program availability;
- tuition, application fee, deposit, scholarship and living cost;
- exchange rate;
- document list, translation/legalization/apostille rule;
- visa category, form, appointment route, consular jurisdiction and fee;
- financial threshold, insurance and medical rule;
- processing time;
- entry, registration and residence-permit rule;
- housing availability and price;
- provider contact, portal and submission channel.

If a mutable fact has no current official source, write `verification_required`; do not fill the gap from an old message or presentation.

## 5. OP to OZO handoff prerequisites

Record only confirmed Platform fields:

- contract/handoff evidence and its status;
- assigned Curator;
- applicant and decision-participant roles;
- approved country/level/program direction/intake assumptions;
- language and academic summary;
- budget band, never an invented exact budget;
- approved commercial promises and unresolved questions;
- next action, owner and due date;
- finance stop factor/status without exposing sensitive transaction details;
- consent and preferred communication language.

Missing information remains missing. Chat text alone does not confirm a contract, payment, deadline or promise.

## 6. Common 12-stage lifecycle

Use one shared OZO lifecycle; country rules are overlays, not separate pipelines.

For every stage complete the same card:

```yaml
stage_key: <stable key>
title: <human title>
entry_conditions: [<verified state>]
curator_tasks: [<what employee does>]
student_tasks: [<what student does>]
required_case_fields: [<typed field>]
required_documents: [<requirement key; required | conditional | not_applicable>]
evidence_to_complete: [<evidence type>]
allowed_case_statuses: [not_started, in_progress, waiting_student, waiting_provider, ready_for_review, completed, blocked]
next_action_rule: <owner + due date source>
message_template_keys: [<template key>]
mutable_fact_keys: [<fact key>]
portal_visibility: <safe student-facing projection>
assistant_allowed: [summarize, find_missing, draft_message, propose_task]
assistant_forbidden: [decide, send, submit, approve, pay]
```

### Stage 1: Consultation and route confirmation

Capture level, program direction, country/region, intake, language, academic readiness, budget band and decision participants. Output is a reviewed route assumption, not a guarantee or final university selection.

### Stage 2: Case-specific document checklist

Instantiate approved requirement slots for the selected route. A generic list is only preliminary; university/program/scholarship/visa-specific requirements take precedence.

### Stage 3: Institution and program shortlist

Use only approved catalog entries and current availability evidence. Record comparison criteria and the student's approved choice.

### Stage 4: Translation, notarization and legalization

Record which document requires which action, source of that rule, responsible person and evidence. Never assume one rule covers all institutions.

### Stage 5: Application preparation and submission

Separate `ready`, `submitted` and `provider_acknowledged`. Submission requires employee confirmation and evidence; AI cannot submit.

### Stage 6: Preliminary or conditional response

Explain what the received provider document actually means and what conditions remain. Store the document privately and record human verification.

### Stage 7: Final admission decision

Record the provider's evidence and verified applicant/program/intake details. Admission is not inferred from an optimistic message.

### Stage 8: University/provider payments

Keep university/provider invoice separate from EVO service fee. Only Finance/Admin confirms Platform payment evidence.

### Stage 9: Visa or study-permit preparation

Instantiate the current official checklist for the applicant's jurisdiction and route. Record appointment/submission/provider decision separately.

### Stage 10: Pre-departure preparation

Verify housing, travel, insurance, entry rules and the first-days plan immediately before travel.

### Stage 11: Arrival and local formalities

Use current official/university instructions for registration, medical checks, residence formalities and campus onboarding. Record completion evidence.

### Stage 12: Adaptation and ongoing support

Record support scope, renewal dates, academic/immigration reminders and the next responsible owner. Do not imply unlimited or undefined service.

## 7. Independent workstream statuses

Do not compress the whole case into one country stage.

| Workstream | Minimum states |
| --- | --- |
| Application | draft, preparing, ready, submitted, provider_review, offer, rejected, withdrawn, enrolled |
| Document slot | missing, uploaded, in_review, correction_required, approved, superseded |
| Visa | not_required, not_started, docs, appointment, submitted, approved, rejected, closed |
| Task | open, in_progress, waiting, completed, cancelled |
| Finance | obligation_open, evidence_pending, confirmed, overdue, disputed, refunded |
| Housing/insurance/travel | not_started, researching, selected, booked_or_issued, verified, not_applicable |

Use the actual repository enums and typed domain actions during implementation. This template must not create a second runtime status system.

## 8. Document requirement register

For each requirement:

```yaml
requirement_key: <stable key>
title: <human title>
applies_when: <country/level/program/university/scholarship/visa condition>
requirement_status: required | conditional | not_applicable
acceptable_file_types: <Platform policy>
validation_owner: curator | university | government_authority
review_checks: [readable, complete, names_match, dates_valid, translation, certification, case_specific_rule]
source_ids: [<source_id>]
verification_status: <fact status>
student_instruction: <safe text>
correction_template_key: <key>
```

File presence is never validation. Preserve document versions and review history; use private Storage only.

## 9. Staff-reviewed message templates

Templates must use typed placeholders and never embed mutable values as permanent prose.

Minimum template keys:

- `handoff.introduction`;
- `documents.initial_checklist`;
- `documents.correction_required`;
- `shortlist.ready_for_review`;
- `application.submitted`;
- `provider.additional_request`;
- `pre_admission.received`;
- `admission.received`;
- `invoice.received`;
- `visa.checklist_ready`;
- `visa.submitted`;
- `predeparture.checklist`;
- `arrival.first_days`;
- `support.periodic_checkin`.

Each template contains:

```yaml
template_key: <key>
language: ru | en
required_placeholders: [student_display_name, next_action, responsible_owner]
optional_placeholders: [institution, program, intake, verified_deadline, verified_amount]
source_fact_keys: [<fact key>]
requires_staff_review: true
send_authority: false
```

Never say "I submitted", "payment confirmed", "visa approved" or another completed action unless the matching Platform evidence already exists.

## 10. OZO Assistant behavior for this playbook

Allowed:

- summarize the pinned playbook and case;
- cite approved sources;
- show missing fields/evidence;
- draft a checklist/message;
- propose one typed next action for employee review;
- create a `knowledge_verification` proposal for stale facts.

Not allowed:

- change the applied playbook version;
- use an unapproved draft as fact;
- retrieve client-audience text instead of internal operational guidance;
- decide or execute a document/application/visa/payment action;
- contact a student, provider or government body.

## 11. Staff review checklist before approval

- [ ] Scope and applicant jurisdiction are explicit.
- [ ] Every mutable fact has a source, checked date and verification trigger.
- [ ] Official and EVO-internal claims are separated.
- [ ] University/provider fees are separate from EVO fees.
- [ ] Generic and case-specific document requirements are separated.
- [ ] Twelve lifecycle stages have entry, task, evidence and next action.
- [ ] Application/document/visa/finance/housing/insurance/travel statuses remain independent.
- [ ] Message templates use placeholders and require staff review.
- [ ] No admission, scholarship or visa guarantee exists.
- [ ] No student PII, credential, private chat or raw document content exists.
- [ ] Country lead and Business Process Owner approved the immutable version.

## 12. Minimum employee handoff package for a new country

Ask the country Curator to provide:

1. current job/role instruction and service boundary;
2. full route from handoff to arrival/adaptation;
3. case-specific document groups and how they are checked;
4. university/application/visa status meanings and required evidence;
5. staff message templates by stage;
6. current official sources and last-checked dates;
7. mutable-fact list and who rechecks it;
8. operational channels/partners without credentials or student PII;
9. open questions and known conflicts.

The employee material is a source for managed review, not automatic truth or automatic publication.
