# EVO Admissions CRM

EVO Admissions CRM coordinates admissions leads, student operations, and
operator follow-up for EVO Admissions. This glossary pins down rollout and
identity language used across the current CRM/companion runtimes and the target
unified platform.

The target contract is
[`docs/EVO_PLATFORM_LONG_RUN_PLAN.md`](docs/EVO_PLATFORM_LONG_RUN_PLAN.md) and
the superseding architecture decision is
[`docs/adr/0014-unified-evo-platform-target-architecture.md`](docs/adr/0014-unified-evo-platform-target-architecture.md).
Companion-era terms below remain as honest descriptions of the runtime that
exists before controlled migration; they are not the target architecture.

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
The EVO CRM staff interface where operators inspect admissions conversations, lead state, and follow-up context.
_Avoid_: dashboard, admin panel

**Companion WAHA CRM App**:
A separate EVO-owned WhatsApp CRM surface that may share deployment and context with EVO Admissions CRM, but does not replace the Operator UI until a later explicit decision.
_Avoid_: replacement CRM, new main CRM, forked demo

**Companion Data Store**:
The Supabase project used by the Companion WAHA CRM App for auth, shadow records, messages, files, AI settings, and knowledge-base data.
_Avoid_: EVO CRM database, temporary clone DB

**Managed Companion Data Store**:
The Supabase Cloud project used by the companion app, while the Next app and WAHA run on `hermes-vps`.
_Avoid_: self-hosted Supabase on first launch, local database

**Companion Inbox Domain**:
The public hostname for the Companion WAHA CRM App: `inbox.evoadmissions.com`.
_Avoid_: CRM path, demo URL

**Companion WAHA Session**:
The single first-launch WAHA session used by the Companion WAHA CRM App: `evo-inbox`.
_Avoid_: multi-session launch, primary CRM session

**Companion AI Assistant**:
The Companion WAHA CRM App's current AI reply system for draft replies,
legacy configurable auto-reply surfaces, handoff, and knowledge-base grounding.
The target platform does not retain automatic customer replies.
_Avoid_: lead-agent, external bot brain

**Identity Source of Truth**:
amoCRM, which owns the canonical contact, lead, responsible sales manager, and
sales stage for admissions follow-up.
_Avoid_: local source, duplicate identity

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
The target staff workspace and Student Portal backed by one logical platform
data model. A dedicated Supabase production project owns EVO operational data,
while local/development, persistent staging, and supported preview environments
remain physically isolated. The existing split CRM, Inbox, and Lead Agent
runtimes remain current-state facts until a controlled cutover proves the
replacement.
_Avoid_: renamed companion app, shared production-and-test database

**Platform Business Role**:
One of `admin`, `sales`, `curator`, `finance`, or `client/student`. There is no
separate `visa` business role; `/visa` remains a module managed by the assigned
Curator (and Admin where authorized).
_Avoid_: prototype persona, shared administrator login

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
unlinked/broken-link/ownerless non-Admin access fail closed. This is
containment, not proof of EVO Inbox, WAHA, amoCRM or unified-history
integration.
_Avoid_: unified Inbox, provider proof, canonical conversation ownership

**Unified Platform Data Store**:
The target dedicated Supabase production project for EVO-owned operational
records, with RLS and audit controls. It does not become authoritative for
amoCRM-owned contact, lead, responsible sales manager, or sales stage.
_Avoid_: companion-only database, canonical sales CRM

**Unified WAHA Session**:
The target single private production WAHA session `evo-inbox`, representing one
WhatsApp account and one webhook owner. The existing sessions are not changed
or retired until controlled cutover evidence exists.
_Avoid_: public WAHA port, multi-session production target

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
A passport, education record, medical form, bank statement, criminal-record certificate, or other file that must not be collected through an ordinary chat or committed to Git.
_Avoid_: knowledge-base content, public brochure
