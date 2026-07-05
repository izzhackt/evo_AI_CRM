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
