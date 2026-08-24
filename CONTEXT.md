# EVO Admissions CRM

EVO Admissions CRM coordinates admissions leads, student operations, and
operator follow-up for EVO Admissions. This glossary pins down rollout and
identity language used across the current CRM/companion runtimes and the target
unified platform.

The target contract is
[`docs/EVO_PLATFORM_LONG_RUN_PLAN.md`](docs/EVO_PLATFORM_LONG_RUN_PLAN.md) and
the current architecture/execution decision is
[`ADR 0020`](docs/adr/0020-unify-evo-v1-on-canonical-supabase.md), under parent
issue #376 and U0-U14. The 2026-08-24 entry in
[`docs/PLAN_CHANGES.md`](docs/PLAN_CHANGES.md) records the superseding owner
decision: EVO is one product with one entry point, one staff UI, one role
model, one cross-module workflow, and one canonical Supabase foundation.
U0/#377 and U1/#378 are merged. U2/#379 is the sole current
repository/disposable-local execution slice and establishes the canonical EVO
client and lead model plus its bounded connected read path; U3/#380 and later
slices have not started. The active U2 contract is recorded in
[`docs/platform/u2-canonical-client-lead.md`](docs/platform/u2-canonical-client-lead.md),
and the completed U1 authority/evidence boundary remains in
[`docs/platform/u1-unified-staff-access.md`](docs/platform/u1-unified-staff-access.md).
Lead Agent, CRM, and Inbox name internal capabilities or current deployment
contours; they are not separate target products, user applications, or data
authorities. ADR 0018 remains historical current-state evidence only; ADR 0019
is superseded where it authorizes autonomous replies or canonical amoCRM
context. The canonical Supabase schema/migration mechanics remain refined by
[`docs/adr/0015-establish-canonical-supabase-schema-and-migration-boundary.md`](docs/adr/0015-establish-canonical-supabase-schema-and-migration-boundary.md).
Companion-era terms below remain as honest descriptions of separate runtimes
that may still exist before a separately authorized cutover. They are migration
inputs to retire, not target architecture, permanent compatibility contracts,
or a second source of truth.

## Language

**First Live Rollout**:
The first production proof that one controlled real inbound WhatsApp message can travel through the admissions lead path and become visible to staff. It is not a full automation launch.
_Avoid_: launch, go-live, full rollout

**Receive-Only Rollout**:
A rollout mode where inbound messages may be captured, resolved, and shown to staff, but the system must not send WhatsApp replies.
_Avoid_: passive mode, demo mode

**Dedicated Test Number**:
An EVO-controlled sanitized sender number used to prove the live message path
into the single production `evo-inbox` number without exposing a personal,
customer, or primary admissions sender. It is not a second production WAHA
session.
_Avoid_: personal number, customer number, second production WAHA session

**Test Lead**:
A controlled canonical EVO lead used for authorized acceptance and clearly
marked so staff can identify it as test data. A linked amoCRM identifier may be
read or imported, but stage one does not create or update an amoCRM record.
_Avoid_: fake lead, mock lead

**Operator UI**:
The single EVO Platform staff interface where operators inspect admissions
conversations, admissions state, and follow-up context across internal modules.
_Avoid_: dashboard, admin panel

**Companion WAHA CRM App**:
Historical name for the separately deployed Inbox runtime. Its useful messaging
capabilities move behind the unified EVO UI and role model; the runtime is not
a separately marketed, separately entered, or permanent target application.
_Avoid_: second product, permanent companion, parallel operator UI

**Companion Data Store**:
Historical Supabase model used by the separately deployed Inbox runtime. It is
not a second target authority and must not receive new dual-write or fallback
behavior; accepted Platform data lives in the canonical Platform schemas.
_Avoid_: second operational authority, compatibility database

**Managed Companion Data Store**:
Historical name for the managed Supabase project used during the companion
phase. The target uses the one approved Platform Supabase project for Postgres,
Auth, Storage, and appropriate Realtime/Edge Function capabilities.
_Avoid_: second Platform project, self-hosted replacement, local database

**Companion Inbox Domain**:
The historical public hostname `inbox.evoadmissions.com`. It is a cutover and
retirement concern, not a permanent second product entry point; staff target the
single EVO Platform entry and unified UI.
_Avoid_: permanent second login, independent product domain

**Companion WAHA Session**:
The single first-launch WAHA session used by the Companion WAHA CRM App: `evo-inbox`.
_Avoid_: multi-session launch, primary CRM session

**Companion AI Assistant**:
The Companion WAHA CRM App's current AI reply system for draft replies,
legacy configurable auto-reply surfaces, handoff, and knowledge-base grounding.
It is companion-era context, not authority for the Platform's gated autonomous
inbound-reply lane.
_Avoid_: lead-agent, external bot brain

**Identity Source of Truth**:
EVO/Supabase, which owns the canonical client, lead, responsible staff, stage,
next action and deadline. amoCRM is a temporary read/import adapter and
migration source; its identifiers remain provenance, not operational authority.
SQLite, mocks, inferred identity, hardcoded IDs and silent fallback remain
prohibited.
_Avoid_: amoCRM master record, duplicate identity, second product CRM

**Shadow Record**:
A historical term for a local copy of external fields. New EVO work stores a
canonical Supabase record plus explicit external identifiers and provenance;
it does not create a permanently synchronized shadow authority.
_Avoid_: canonical external copy, dual-write record

**Companion amoCRM Resolution**:
Historical companion behavior that found or created amoCRM identity before
local persistence. It is superseded by canonical EVO identity resolution and
stage-one read/import-only amoCRM access.
_Avoid_: current identity contract, pipeline mirror

**Draft Review**:
An AI-generated suggested reply or next-step note that staff may inspect, without automatic WhatsApp sending.
_Avoid_: autoreply, bot response

**Draft-Only AI Mode**:
A mode where AI may generate a suggested reply, but a staff member must review,
edit if needed, and explicitly accept or reject it. The receive-only stage does
not send the accepted draft. AI never owns a consequential state change.
_Avoid_: passive bot, silent auto-reply, send authorization

**Rolling 24-Hour Service Window**:
Historical transport-policy term retained for evidence review. It grants no
send authority under #376; the first live stage is receive-only.
_Avoid_: campaign window, follow-up permission, current send authorization

**Bounded Autonomous Inbound Reply**:
A superseded ADR 0019 concept. AI is advisory and human-reviewed under ADR
0020; no autonomous WhatsApp reply is authorized.
_Avoid_: current capability, bot campaign, model-direct send

**Deterministic EVO Send Gate**:
Historical repository evidence for a disabled send path. It grants no current
runtime or rollout authority; any later external-write stage needs a new owner
decision and rollback contract.
_Avoid_: current send authority, model approval, prompt-only safety

**Autonomy Pause**:
A historical state from the superseded autonomous-reply lane. The active v1
contract has no autonomy to resume.
_Avoid_: current workflow control, silent resume

**Media-Only Inbound**:
A valid inbound customer event with media but no usable text. It must be
persisted, projected for the Operator UI and handed to a person; missing text is
not a reason to terminally consume it. Autonomous media understanding requires a
separate approval.
_Avoid_: empty message, ignored webhook, successful no-op

**Read-Mostly amoCRM Adapter**:
The temporary bounded adapter that reads/imports verified external contact,
lead, responsible-user and stage values plus permitted references. EVO records
their provenance and remains canonical. The adapter performs no provider write,
inferred mapping, name-based identity match or silent fallback.
_Avoid_: permanent synchronization, stage writer, external identity authority

**Companion First Launch Surface**:
Historical separate-product scope. Useful messaging capability may be rebuilt
inside the unified UI only through U3/U9; manual send is not part of stage one.
_Avoid_: current product surface, broadcast launch

**Companion Production Proof**:
Historical proof contract superseded by U12. Current acceptance uses the one
EVO product, canonical Supabase identity and receive-only WhatsApp, with no
amoCRM write and no manual or automatic reply.
_Avoid_: current acceptance, outbound proof

**Full EVO Inbox Redesign**:
The redesign of all retained Companion WAHA CRM App surfaces around EVO admissions work, rather than a light rename of WACRM.
_Avoid_: light rebrand, template skin

**Unified EVO Platform**:
The one EVO Admissions product: a single entry point and accepted UI shell for
staff and the Student Portal, one Supabase Auth/RBAC organization model, one
cross-module workflow, and one logical operational data model. CRM/admissions,
Inbox/communications, and Lead Agent/orchestration are modules inside this
product. One dedicated Supabase production project supplies canonical Postgres,
Auth, private Storage, and appropriate Realtime and Edge Functions; isolated
local, staging, and preview environments remain physically separate. WAHA,
amoCRM, and approved AI providers are boundary adapters. Current separate
runtimes may remain only until a controlled cutover proves the unified path;
they do not justify SQLite reintroduction, dual reads/writes, fallback UI, or
permanent compatibility layers.
_Avoid_: renamed companion app, three products, dual backend, shared production-and-test database

**Platform Business Role**:
For the first pilot, one of `sales`, the existing canonical admissions role
(human-facing Admissions Manager), or `admin` (Director/Admin). Sensitive
capabilities such as contract and first-payment confirmation are explicit
individual permissions. Finance remains an internal module rather than a staff
role; Student Portal identity follows in a later approved milestone. `/visa`
remains a module, not a separate role.
_Avoid_: five-role first pilot, shared administrator login, job-title permission

**Admin Assignment**:
The Admin-only action that assigns or reassigns a student's Curator. It requires
a reason and an audit record containing the previous and new assignment.
Only Admin may invite or block staff accounts.
_Avoid_: client profile update, silent reassignment

**Sales-to-Curator Handoff**:
The accountable transfer after EVO records both a confirmed contract and the
first mandatory payment. The handoff creates or updates one Student Case,
preserves provenance, assigns Admissions ownership and creates starter work.
A Director/Admin override requires a reason and immutable audit evidence.
_Avoid_: chat-inferred gate, copied conversation, amoCRM-stage-only handoff

**Root WhatsApp Interim Scope**:
Historical containment rule for the root CRM's existing SQLite `wa_*`
shadow surface before unified communications. Admin sees all. Responsible Sales
has full access to a linked lead or pending case; after handoff that Sales user
sees only a safe case summary. The assigned Curator has full access to the
active/closed case conversation. Unrelated staff, Finance, Student and
unlinked/indirect-case/conflicting-link/broken-link/ownerless non-Admin access
fail closed. Lead-only Sales access requires both the conversation and lead to
have no case link. Because this temporary rule reads the local shadow
`leads.manager_id`, Sales cannot select or change that ownership field: a
Sales-created local lead is forced to the authenticated Sales user, a Sales
profile update preserves its existing owner and applies only to an already
owned lead, and only Admin may select or reassign the temporary local owner to
an active Sales account.
This is containment, not proof of EVO Inbox, WAHA, amoCRM or unified-history
integration. It must not be extended into a compatibility layer; the unified
Supabase communications module replaces this contour through a separately
authorized cutover.
_Avoid_: unified Inbox, provider proof, canonical conversation ownership

**Unified Frontend Contract**:
The accepted Claude Design root frontend shipped in PRs #64, #71 and #72. It is
the sole product UI contract for the Platform path. Platform work must wire this
UI through repository/session seams rather than replace it or introduce a
parallel or fallback Inbox-derived UI.
_Avoid_: second operator UI, replacement prototype, dual frontend

**Unified Platform Data Store**:
The target dedicated Supabase foundation for canonical EVO operational records,
including client, lead, stage, responsible staff, next action and deadline,
with RLS and audit controls. Active legacy data is migrated once with provenance
and reconciliation. SQLite runtime restoration, dual-read, dual-write and
compatibility bridges remain prohibited.
_Avoid_: companion-only database, external canonical CRM, SQLite fallback

**Canonical Supabase Migration Source**:
The root `supabase/` directory established by P2A as the only repository
authority for the byte-identical legacy 001–039 chain and every later Platform
migration. The old companion path becomes a pointer, never a second writable
copy. Merged migrations are immutable; corrections use a new number.
_Avoid_: duplicated migration tree, edited applied migration

**Platform Schema Boundary**:
`platform` is the canonical browser-exposed Platform schema with explicit
grants and RLS on every table. `platform_private` is backend-only and absent
from the Data API. Historical `public` Inbox objects may remain only as frozen
migration history until an authorized retirement migration removes them; no new
Platform behavior, dual-write, fallback, or compatibility contract may depend
on them. Browser actors also have no direct queue-internal access.
_Avoid_: new Platform tables in public, browser-accessible private helpers, legacy-schema fallback

**Legacy Inbox Role**:
One of the companion-era `owner`, `admin`, `agent`, or `viewer` roles. It has
no implicit mapping to a Platform Business Role. A legacy signup may create
legacy Inbox account/profile rows but does not create Platform organization
membership or business authority.
_Avoid_: automatic role migration, signup-implies-Platform-access

**Thin Messaging Slice**:
A historical pre-#376 sequence. The current first product slices are U1-U4:
one login/roles, canonical client/lead and receive-only communications inside
the unified Sales workflow. Manual or autonomous send is not included.
_Avoid_: current execution block, duplicate CRM, autonomous outbound

**P5A WAHA Ingress**:
The merged receive-only boundary that verifies signed WAHA events, persists raw
evidence before processing and enqueues pointer-only durable work. It is disabled
by default and is repository evidence, not real-provider proof.
_Avoid_: projected conversation, AI reply, provider cutover

**P5B WAHA Receive/Project Worker**:
The not-yet-merged private worker that claims verified inbound WAHA work and
projects operator-visible conversation/message state. It does not call Gemini or
send through WAHA. Valid media-only input must project and hand off rather than
be terminally consumed.
_Avoid_: autonomous-send worker, merged capability, provider proof

**Unified WAHA Session**:
The target single private production WAHA session `evo-inbox`, representing one
WhatsApp account and one webhook owner. The existing sessions are not changed
or retired until controlled cutover evidence exists. Forward runtime code,
new signed Lead Agent evidence and current health may accept only `evo-inbox`;
an old `crm_primary` value may survive only as unchanged historical provider
provenance. It is never an alias, fallback or second current session. A real
cutover must inspect per-session and global WAHA webhooks and prove
`session.status=WORKING` for `evo-inbox` before transferring ownership.
_Avoid_: public WAHA port, multi-session production target, session alias

**Manual-Send WAHA Runtime Binding**:
Historical repository configuration used by the private
manual-send worker: exact session `evo-inbox`, exact private WAHA endpoint and
a Supabase Vault secret reference resolved only by a service-role RPC. It
replaces the live worker's legacy SQLite settings read. Migration 081 adds the
supported service-only provision and non-secret configuration-status RPCs;
the operator CLIs use only those boundaries and never contact WAHA. This is
repository and disposable-local proof until an authorized operator provisions
the real Vault binding and separately verifies the provider without a customer
send. A `ready` configuration result proves the stored binding and secret hash,
not WAHA connectivity or message delivery. Stage one does not activate or use
this binding to send.
_Avoid_: current send authority, SQLite fallback, provider proof

**Admissions Inquiry**:
The pre-contract request from a prospective student or decision-making family member that still needs qualification and a next action.
_Avoid_: student file, confirmed client, application

**Admissions Lead**:
The canonical EVO/Supabase record that links an Admissions Inquiry to one
client, responsible staff member, stage, next action, deadline, provenance and
optional external identifiers.
_Avoid_: applicant file, amoCRM master record, local Inbox deal

**Applicant**:
The person seeking admission to a school, university, language course, Foundation, bachelor, master, or doctoral program.
_Avoid_: lead, payer, parent

**Student Operational File**:
The post-agreement platform record used to manage the applicant's admissions
delivery, including multiple university applications, documents, Curator-owned
visa work, payments, tasks, and support. The normal handoff requires confirmed
contract and first mandatory payment, then assigns Admissions ownership and
starter work. Student Portal follows in a later milestone.
_Avoid_: lead, WhatsApp conversation, amoCRM deal

**Decision Participant**:
A parent, guardian, sponsor, or other person who materially participates in the applicant's choice, consent, or payment.
_Avoid_: applicant, contact owner

**Admissions Consultation**:
The structured conversation that clarifies the applicant's profile, destination, program, intake, language, academic standing, budget, documents, and next action.
_Avoid_: sales pitch, guaranteed assessment

**Admissions Route**:
The agreed country, level, language pathway, program direction, intake, and funding approach used to plan an applicant's case.
_Avoid_: generic recommendation, single lead stage

**Intake**:
The defined period when a program begins and for which an applicant submits an application.
_Avoid_: deadline, application date

**University Application**:
One applicant's attempt to enter one specific university and program for a specific intake, with its own deadline, status, evidence, and result.
_Avoid_: student file, sales lead

**Approved Catalog Institution**:
A university or college whose normalized identity and source revision passed validation and explicit administrative review before staff may select it in an application.
_Avoid_: source row, unreviewed recommendation, guaranteed destination

**Catalog Import Batch**:
A bounded set of institution candidates tied to one reviewed source revision that must be staged, validated, and explicitly approved or rejected as a unit.
_Avoid_: live connector, direct catalog write, automatic publication

**Catalog Import Candidate**:
A typed, non-customer staging record for one proposed university or college, carrying opaque row provenance and validation results but no approved status of its own.
_Avoid_: approved institution, student application, raw source payload

**Platform Contract Draft**:
An immutable, versioned plain-text proposal generated from an approved template
and typed Platform fields resolved by the database for one authorized student
case. Approval records staff review and does not make the artifact a signed
legal contract or prove PDF/DOCX, e-signature, delivery, or customer acceptance.
_Avoid_: signed contract, provider document, chat-generated promise

**Post-Contract Operational Report**:
An immutable versioned snapshot of the delivered, open and blocked service
items for one active or closed student case, including evidence, owner and next
action where required. It reports EVO work without claiming an external
admission, scholarship or visa outcome.
_Avoid_: sales stage, guaranteed result, mutable checklist

**Decision Backlog Entry**:
A versioned question-and-answer record that remains unresolved until an explicit answer is supported by reviewed source or evidence. Reopening or retiring the decision creates a new effective version rather than changing its history.
_Avoid_: free-form note, silent default, answer inferred from chat

**Approved Prompt Artifact**:
A reviewed version of either the Lead Manager system instructions or EVO business context that may be pinned to an AI draft request. It is separate from approved country knowledge and customer messages.
_Avoid_: provider configuration, unreviewed prompt, customer transcript

**Country Knowledge Document**:
A reviewed, approved, and separately versioned body of country-specific
services, prices, routes, requirements, and handoff guidance used for retrieval.
Material containing an external-outcome guarantee is not approved knowledge.
_Avoid_: system prompt, unreviewed notes, customer transcript

**Owner-Approved Business Claim**:
A service, price, process, or promise that the responsible EVO owner has explicitly accepted for operational use, even when broader governance work remains open.
_Avoid_: externally verified fact, AI inference

**EVO Service Fee**:
The amount charged by EVO Admissions for the approved scope of consultation and admissions support.
_Avoid_: tuition, provider fee, total study budget

**Third-Party Study Cost**:
A payment to a university, government, insurer, translator, airline, landlord, or other provider that must remain separate from the EVO Service Fee.
_Avoid_: EVO revenue, package price

**External Outcome**:
An admission, scholarship, or visa decision made by a university, scholarship body, consulate, migration authority, or other outside organization.
_Avoid_: internal task result, CRM stage

EVO may commit to completing its own contracted services and obligations, but
must not guarantee admission, scholarship, visa, or another external decision.

**Manager Handoff**:
The deliberate transfer from AI-assisted qualification to a responsible EVO employee when the answer is missing, case-specific, sensitive, exceptional, or ready for consultation or application.
_Avoid_: failed reply, silent abandonment

**Sensitive Applicant Document**:
A passport, education record, medical form, bank statement, criminal-record certificate, or other personal case file whose archive metadata may be classified but whose contents must not be extracted into an AI knowledge base.
_Avoid_: knowledge-base content, public brochure

**EVO Business Message**:
An email or other communication whose substance concerns EVO services, applicants, universities, partners, employees, operations, or decisions and may contain candidate business knowledge.
_Avoid_: every account message, automatically approved knowledge

**Restricted Account Message**:
A personal message, spam item, login or password-reset message, security code, payment credential, or unrelated automated notification that must remain outside the AI knowledge bases.
_Avoid_: irrelevant knowledge, safe training data

**Uncertain Message**:
A message whose business relevance or sensitivity cannot be determined confidently and therefore requires human review before any knowledge is extracted from it.
_Avoid_: automatically approved message, harmless message

**Knowledge Candidate**:
An extracted business statement about EVO, admissions, countries, universities, partners, services, costs, processes, responsibilities, or recurring client questions that has not yet been approved as current knowledge.
_Avoid_: approved fact, raw message, personal case file

**Anonymized Case Pattern**:
A reusable lesson derived from an individual applicant case after names, contact details, identifiers, documents, and other personal data have been removed.
_Avoid_: client profile, redacted document copy

**Routine Knowledge Approval**:
An agent decision that promotes clear, non-sensitive, well-sourced, and non-conflicting business knowledge without waiting for separate owner confirmation.
_Avoid_: automatic approval of every extraction, owner-only approval

**Escalated Knowledge Decision**:
A decision reserved for the user or EVO director because sources conflict, confidence is low, or the claim affects legal terms, prices, guarantees, refunds, credentials, or personal data.
_Avoid_: routine review, agent guess

**Excluded Trash Content**:
Any file located in an exported Google Drive or Gmail trash folder; it remains preserved in the raw archive but is outside knowledge analysis regardless of apparent business relevance.
_Avoid_: historical knowledge source, lower-priority candidate

**Business Attachment**:
An email attachment containing EVO operational, contractual, university, country, service, process, or partner information that is eligible for knowledge analysis under the same sensitivity rules as other sources.
_Avoid_: every attachment, applicant document

**Duplicate Source File**:
Two or more source files with identical content confirmed by SHA-256; they represent one analysis item while retaining every source location in provenance.
_Avoid_: same filename, repeated knowledge

**Internal Employee Profile**:
An employee's name, work role, responsibility area, and work contact information used by staff and the internal AI without including private, financial, credential, or unrelated correspondence data.
_Avoid_: personnel file, public biography

**Public Team Profile**:
An employee name, photograph, role, and biography explicitly permitted for the client knowledge base or public website.
_Avoid_: internal employee profile, inferred consent

**Knowledge Authority Order**:
The precedence used to resolve competing claims: latest user or EVO director confirmation, applicable signed agreement, current official external source, newest active EVO document, latest confirmed email or WhatsApp agreement, then legacy Notion or draft material.
_Avoid_: newest file wins, all sources are equal
