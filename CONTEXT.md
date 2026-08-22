# EVO Admissions CRM

EVO Admissions CRM coordinates admissions leads, student operations, and
operator follow-up for EVO Admissions. This glossary pins down rollout and
identity language used across the current CRM/companion runtimes and the target
unified platform.

The target contract is
[`docs/EVO_PLATFORM_LONG_RUN_PLAN.md`](docs/EVO_PLATFORM_LONG_RUN_PLAN.md) and
the current execution-order decision is
[`docs/adr/0019-gate-autonomous-inbound-replies-and-resume-read-only-amocrm.md`](docs/adr/0019-gate-autonomous-inbound-replies-and-resume-read-only-amocrm.md).
The 2026-08-22 all-in-one decision in
[`docs/PLAN_CHANGES.md`](docs/PLAN_CHANGES.md) is the latest target-architecture
authority: EVO is one product with one entry point, one staff UI, one role
model, one cross-module workflow, and one Supabase-native operational backend.
Lead Agent, CRM, and Inbox name internal capabilities or current deployment
contours; they are not separate target products, user applications, or data
authorities. ADR 0018 remains current-state authority only for safely operating
and retiring the retained/frozen Lead Agent and rollback path; it does not
preserve them as target product boundaries.
The target architecture remains
[`docs/adr/0014-unified-evo-platform-target-architecture.md`](docs/adr/0014-unified-evo-platform-target-architecture.md),
as superseded by that all-in-one decision.
Its canonical Supabase schema/migration boundary is refined by
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
A real amoCRM lead created or resolved during rollout validation and clearly marked so staff can identify it as test data.
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
amoCRM, which owns the canonical contact, lead, responsible sales manager, and
sales stage for admissions follow-up. ADR 0019 resumes only a bounded read-mostly
adapter for those values and references to sales tasks, calls/recordings and chat
records. The unified Platform remains the internal operational source for its
own workflow, messaging, audit and applicant state. Missing verified account
mapping fails closed; SQLite, mocks, inferred identity, hardcoded IDs and
silent fallback remain prohibited.
_Avoid_: local source, duplicate identity, second product CRM

**Shadow Record**:
A local record that mirrors selected amoCRM identity or workflow fields for fast operator use, while amoCRM remains authoritative.
_Avoid_: local lead, duplicate contact

**Companion amoCRM Resolution**:
The companion app's narrow responsibility to find or create the amoCRM contact and lead for a WhatsApp sender before storing local shadow identity.
_Avoid_: pipeline mirror, local-only lead

**Draft Review**:
An AI-generated suggested reply or next-step note that staff may inspect, without automatic WhatsApp sending.
_Avoid_: autoreply, bot response

**Draft-Only AI Mode**:
A mode where AI may generate a suggested reply, but a staff member must review,
edit if needed, and deliberately send it. The target supports Russian or
English according to the last customer message; uncertain language detection
requires manual language selection or human handoff.
_Avoid_: passive bot, silent auto-reply

**Rolling 24-Hour Service Window**:
The WhatsApp customer-service window opened or refreshed by a customer inbound
message in the same conversation. The bounded autonomous lane may send only an
inbound-triggered reply while this window remains open.
_Avoid_: campaign window, follow-up permission, permanent opt-in

**Bounded Autonomous Inbound Reply**:
A reply proposed by Gemini and approved by deterministic EVO gates for the exact
triggering inbound message inside the Rolling 24-Hour Service Window. It excludes
cold outbound, broadcast, campaign, autonomous follow-up/re-engagement and
out-of-window free-form sends.
_Avoid_: bot campaign, autonomous outbound, model-direct send

**Deterministic EVO Send Gate**:
The server-side policy decision that records every input and verdict and alone
may queue an autonomous reply. Gemini proposes content and qualification facts;
it does not authorize or perform transport.
_Avoid_: model approval, prompt-only safety, WAHA policy

**Autonomy Pause**:
A durable conversation state created immediately by any staff outbound message
or explicit takeover. Only an authorized staff actor may resume autonomy, with
actor, reason and time audited.
_Avoid_: temporary model hint, reconnect reset, silent resume

**Media-Only Inbound**:
A valid inbound customer event with media but no usable text. It must be
persisted, projected for the Operator UI and handed to a person; missing text is
not a reason to terminally consume it. Autonomous media understanding requires a
separate approval.
_Avoid_: empty message, ignored webhook, successful no-op

**Read-Mostly amoCRM Adapter**:
The bounded adapter that reads verified canonical contact, lead, responsible
sales manager and stage plus task, call/recording and chat-record references.
It performs no provider write, inferred mapping, name-based identity match or
silent fallback.
_Avoid_: bidirectional sync, stage writer, local identity authority

**Companion First Launch Surface**:
The first usable surface of the companion app: manual WhatsApp inbox, contacts, optional pipeline context, AI draft, knowledge base, WAHA receive/send, and amoCRM identity resolution.
_Avoid_: broadcast launch, automation launch

**Companion Production Proof**:
The first real validation that inbound WhatsApp reaches EVO Inbox, amoCRM identity is resolved or created, AI draft works, and an operator can send one manual WAHA reply while auto-reply remains disabled.
_Avoid_: receive-only proof, auto-reply proof

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
One of `admin`, `sales`, `curator`, `finance`, or `student`. “Client/Student”
is the user-facing label for `student`; the current root `client` identifier is
legacy and is not imported or mapped into Platform without a later explicit
scoped decision. There is no separate `visa` business role; `/visa` remains a
module managed by the assigned Curator (and Admin where authorized).
_Avoid_: prototype persona, shared administrator login, implicit client mapping

**Admin Assignment**:
The Admin-only action that assigns or reassigns a student's Curator. It requires
a reason and an audit record containing the previous and new assignment.
Only Admin may invite or block staff accounts.
_Avoid_: client profile update, silent reassignment

**Sales-to-Curator Handoff**:
The accountable transfer after the signed-contract condition is confirmed
through the account-specific amoCRM pipeline/status mapping and Admin assigns a
Curator. Sales owns the queue and conversation before contract; the assigned
Curator owns them after handoff. Conversation history remains unified, while
Sales sees only the permitted non-sensitive summary after handoff.
_Avoid_: copied conversation, operational status replacing amoCRM sales stage

**Root WhatsApp Interim Scope**:
The temporary authorization rule for the root CRM's existing SQLite `wa_*`
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
The target dedicated Supabase production project for EVO-owned operational
records, with RLS and audit controls. It does not become authoritative for
amoCRM-owned contact, lead, responsible sales manager, or sales stage.
It is greenfield: no legacy SQLite data import, no legacy account import, no
root-auth migration, and no dual-read or dual-write bridge.
_Avoid_: companion-only database, canonical sales CRM

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
The first bounded Platform product slice behind the unified frontend:
conversation list/thread, necessary contact/student context, WAHA receive/send,
ACK/delivery, AI draft, staff manual send, approved knowledge, durable memory,
audit and minimal health/settings. ADR 0019 adds only the gated Bounded
Autonomous Inbound Reply. It excludes generic CRM dashboards, pipelines, deals,
lead management, broadcasts, flows, campaigns and unrelated analytics.
_Avoid_: duplicate CRM, broad Inbox parity, autonomous outbound

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
or retired until controlled cutover evidence exists.
_Avoid_: public WAHA port, multi-session production target

**Manual-Send WAHA Runtime Binding**:
The canonical organization-scoped Platform configuration used by the private
manual-send worker: exact session `evo-inbox`, exact private WAHA endpoint and
a Supabase Vault secret reference resolved only by a service-role RPC. It
replaces the live worker's legacy SQLite settings read; it is repository and
disposable-local proof until an authorized operator provisions the real Vault
binding and verifies the provider without a customer send.
_Avoid_: SQLite fallback, dual-read/write, hard-coded retired session, provider proof

**Admissions Inquiry**:
The pre-contract request from a prospective student or decision-making family member that still needs qualification and a next action.
_Avoid_: student file, confirmed client, application

**Admissions Lead**:
The amoCRM sales record that links an Admissions Inquiry to its canonical contact, owner, and sales stage.
_Avoid_: applicant file, local Inbox deal

**Applicant**:
The person seeking admission to a school, university, language course, Foundation, bachelor, master, or doctoral program.
_Avoid_: lead, payer, parent

**Student Operational File**:
The post-agreement platform record used to manage the applicant's admissions
delivery, including multiple university applications, documents, Curator-owned
visa work, payments, tasks, and support. A confirmed contract creates a pending
case; Student Portal access activates only after Admin assigns the Curator.
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
