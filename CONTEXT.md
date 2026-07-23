# EVO Admissions CRM

EVO Admissions CRM coordinates admissions leads, student operations, and operator follow-up for EVO Admissions. This glossary pins down rollout and identity language used across the CRM and lead-agent work.

## Language

**First Live Rollout**:
The first production proof that one controlled real inbound WhatsApp message can travel through the admissions lead path and become visible to staff. It is not a full automation launch.
_Avoid_: launch, go-live, full rollout

**Receive-Only Rollout**:
A rollout mode where inbound messages may be captured, resolved, and shown to staff, but the system must not send WhatsApp replies.
_Avoid_: passive mode, demo mode

**Dedicated Test Number**:
An EVO-owned WhatsApp number used to prove the live message path without exposing a personal or primary admissions number.
_Avoid_: personal number, main number

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
The Companion WAHA CRM App's own AI reply system for draft replies, optional auto-replies, handoff, and knowledge-base grounding.
_Avoid_: lead-agent, external bot brain

**Identity Source of Truth**:
The system that owns the canonical lead and contact identity for admissions follow-up.
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
A Companion AI Assistant mode where staff can generate and edit suggested replies, but the system must not send automatic WhatsApp replies.
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
The post-agreement EVO CRM record used to manage the applicant's admissions delivery, including applications, documents, visa work, payments, tasks, and support.
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
An owner-approved, separately versioned body of country-specific services, prices, routes, requirements, and handoff guidance used by EVO Inbox retrieval.
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

**Manager Handoff**:
The deliberate transfer from AI-assisted qualification to a responsible EVO employee when the answer is missing, case-specific, sensitive, exceptional, or ready for consultation or application.
_Avoid_: failed reply, silent abandonment

**Sensitive Applicant Document**:
A passport, education record, medical form, bank statement, criminal-record certificate, or other file that must not be collected through an ordinary chat or committed to Git.
_Avoid_: knowledge-base content, public brochure
