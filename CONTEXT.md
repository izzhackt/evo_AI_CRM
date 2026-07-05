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

**Identity Source of Truth**:
The system that owns the canonical lead and contact identity for admissions follow-up.
_Avoid_: local source, duplicate identity

**Draft Review**:
An AI-generated suggested reply or next-step note that staff may inspect, without automatic WhatsApp sending.
_Avoid_: autoreply, bot response
