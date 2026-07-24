# IT brief: automation platform for EVO Admissions

- Source: owner-supplied `TZ_Platforma_avtomatizacii_OZO.docx`
- Source reviewed: 2026-07-24
- Status: **first-iteration business context, not an approved architecture**
- Interpretation rule: use the needs and workflows below as product input.
  Resolve conflicts in favor of the repository's current code, ADRs, security
  rules, data-ownership documents and explicit owner decisions.

## Plain-language intent

The proposed platform is a shared working hub for EVO Admissions. It should
reduce routine work around student onboarding, payments, document collection,
document review, progress tracking and communication while keeping existing CRM
data connected.

The document describes four viewpoints:

- **Student:** uploads documents, corrects issues and tracks progress.
- **Admissions specialist (ОЗО):** reviews documents, communicates with the
  student and advances operational work.
- **Sales (ОП):** initiates the student workflow, follows financial
  obligations and resolves stop factors.
- **Administrator:** controls access, rules, analytics and the audit trail.

These are business viewpoints, not permission names. The production role model
remains the one implemented by the root application.

## Requested workflows

### Financial control

When a student reaches a payment-dependent step, the platform should show the
current financial state. A confirmed payment permits the next action; a debt or
pending payment produces a clear blocked state and tells the student whom to
contact. When the authoritative system confirms payment, the block should be
eligible for removal.

The original brief assumes that the existing CRM owns this status. That is a
business assumption to validate, not permission to invent a payment value,
webhook or real-time integration in the frontend.

### Document upload and review

The student chooses a required document slot and uploads a file. The desired
future flow includes an automated quality/type check, followed by specialist
review. A rejected or correction-required document must show a reason and a
clear resubmission path. The specialist needs a queue, filters, document
preview, approve/reject/correction actions and optional AI observations.

AI observations are decision support only. They must not silently approve,
reject or submit a document.

### Creating and activating a student workflow

Sales starts the workflow from the existing lead/customer context. Contact,
program and ownership data should be reused instead of copied manually. The
student receives access only when approved business conditions are satisfied,
and the responsible employee sees any blocking condition.

The frontend must not create a second canonical lead identity. amoCRM remains
the source of truth for lead/contact identity and sales stage.

## Requested product areas

### Student Portal

- visual progress through the student journey;
- next action and clear blocked state;
- notifications and status updates;
- checklist of required documents;
- upload, correction and resubmission;
- visible statuses such as uploaded, under review, accepted and rejected.

### Admissions workspace

- work queue ordered by operational priority;
- filters for new uploads, corrections and ready-to-submit cases;
- document review and common correction/rejection reasons;
- optional AI hints tied to the actual file;
- financial indicator without claiming unverified payment data.

### Administration

- employee access and role assignment;
- configurable document requirements as a future business capability;
- immutable audit history for sensitive decisions and access;
- operational metrics such as processing time, correction cycles and students
  by stage.

### Sales workspace

- create/start a student workflow from canonical CRM data;
- payment-state monitoring;
- history of activation, blocking and unblocking decisions;
- reminders for unresolved financial stop factors.

## Non-functional expectations

- authenticated access and role-based visibility;
- secure document transport and storage;
- audit of document access and decisions;
- explicit stop-factor handling and responsible owner;
- scalable work queues;
- no hidden automation that changes a student, sales or document decision
  without a traceable human or authoritative-system event.

## Corrections applied by the current repository

- “CRM” is not a single undifferentiated owner: amoCRM owns lead/contact
  identity and sales stage, while the EVO application owns operational
  workspaces and documented shadow/read models.
- Sales stage and student operational stage are separate concepts.
- AI customer communication is draft-only and requires manual review/send.
- A UI state is not proof that WAHA, amoCRM, Supabase, AI, email, telephony or a
  webhook is connected.
- Payment gating, document AI validation, configurable rules and real-time
  synchronization require separately approved backend contracts. The frontend
  may represent only states supported by current data, or label a future state
  explicitly as a concept.
