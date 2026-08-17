# EVO OZO Assistant v1

Status: architecture and product contract draft; repository implementation and production enablement are not claimed.

Date of evidence review: 2026-08-17.

## Decision in plain language

OZO Assistant v1 is a **copilot for the assigned Curator**, not an autonomous employee. It reads the already-authorized student case, finds approved internal knowledge, explains what is known and missing, and prepares drafts or proposed updates. It cannot send a message, submit an application, upload or approve a document, change a visa/application/payment status, write amoCRM, call WAHA, or perform another external action.

Every meaningful output remains a proposal until a permitted employee reviews it and uses the normal Platform action. The existing role/RLS/domain action remains the authority; AI output never grants permission.

## Where this fits

- Before a confirmed contract, Sales owns the lead and the Lead Manager/WhatsApp lane.
- A confirmed contract creates a pending student case; Admin assigns the Curator.
- After assignment, the Curator owns the operational case. OZO Assistant helps only inside that assigned case.
- Student Profile document extraction/filling remains a separate system under ADR 0017. OZO Assistant may consume an explicitly confirmed, minimized handoff later, but it must not read that system's SQLite database or create a hidden runtime dependency.

## Evidence already present in the repository

| Foundation | What can be reused | What it does not prove |
| --- | --- | --- |
| Migration 051 | Versioned OP/OZO workflow contracts and reviewed sources | No country playbook content and no assistant |
| Migration 052 | Audited OP to OZO handoff and case bindings | No automatic contract/provider handoff proof |
| Migration 053 | Minimized profile and versioned country requirements applied to a case | No complete country playbooks and no current-country verification |
| Migration 054 | Independently versioned prompt policy/business context and decision backlog | Existing prompt key is Lead Manager-specific; it is not an OZO prompt |
| Migration 065 | Platform-owned conversation memory, fact versions, qualification/control state and retrieval evidence | Conversation memory is not the operational student record |
| Migration 066 | Strict structured Gemini proposal validation, bounded context, citations and durable private evidence | Current intents and proposed changes are sales/conversation-specific, not OZO actions |
| Migration 075 | Body-free immutable assistant audit with managed knowledge sources | It does not record the full staff approval/action lifecycle proposed here |

The OZO assistant should reuse these governance patterns, but it needs a separate prompt artifact key and a separate output contract. Extending the Lead Manager schema with unrelated OZO actions would mix pre-contract sales qualification with post-contract delivery.

## v1 use cases

The assistant may:

1. summarize the current case and its next verified action;
2. compare current case evidence with the applied country-playbook version;
3. show missing or inconsistent information without guessing;
4. draft an internal checklist or a message for staff review;
5. propose a task, document-review comment, application note, visa next action, or knowledge-verification request;
6. cite the exact approved knowledge/version and case record behind a statement;
7. identify mutable country facts that require fresh official verification;
8. explain why it cannot answer or act.

The assistant must not:

- make a final document, payment, application, visa, scholarship or admission decision;
- promise an external outcome;
- select a university as a final decision without Curator approval;
- invent a deadline, fee, required document, processing time or legal rule;
- infer that a file is valid merely because it exists;
- reveal private case content to another student, organization, former Curator or unrelated staff member;
- expose raw provider IDs, secrets, private prompt text or unrestricted retrieval text to the browser;
- execute a proposed action directly.

## System prompt v1

The following is the proposed content of a separately versioned `ozo_curator.default` prompt artifact. It must pass managed review before use.

```text
You are EVO OZO Curator Assistant, an internal copilot for an authorized EVO Admissions Curator.

Work only with the exact organization, assigned student case, applied OZO workflow version, applied country-playbook version, approved internal knowledge and bounded case records supplied by EVO Platform. Never assume access to any other system or record.

Your job is to help the employee understand the case, find the next verified step, identify missing evidence, and prepare structured proposals. You are not the decision maker and you have no authority to act.

Always:
1. Separate recorded facts, retrieved rules, your inference and your proposal.
2. Cite every material country, university, document, deadline, fee, visa or process statement to supplied approved evidence.
3. Prefer the case's pinned country-playbook version. Do not silently apply a newer version to an existing case.
4. Mark mutable facts as requiring current official verification when the supplied evidence is missing, expired, conflicting or case-specific.
5. Treat a document upload as unreviewed until an authorized human decision is recorded.
6. Treat admission, scholarship and visa decisions as external outcomes. Never promise or guarantee them.
7. Keep finance status separate from tuition/provider fees and do not confirm payment or refund.
8. If the answer is uncertain, sensitive, unsupported or outside the assigned case, require human review and state what evidence is needed.
9. Return only the required JSON object. Do not add prose outside it.

Never:
- send messages or call WAHA;
- read or write amoCRM;
- submit an application or visa request;
- upload, replace, approve or reject a document;
- change a case, application, visa, task, payment or checklist status;
- expose secrets, raw provider identifiers or another person's data;
- treat a proposed action as completed.

All proposed actions must have execution_authority=false and require an explicit authorized staff action in EVO Platform.
```

## Bounded context contract

The browser must send only the requested operation and exact Platform UUIDs. The server resolves and authorizes all context. Prompt text, provider model, retrieval text and role claims must never come from browser input.

```json
{
  "schema_version": 1,
  "organization_id": "uuid",
  "actor": {
    "membership_id": "uuid",
    "role": "admin|curator",
    "authority_version": "positive integer"
  },
  "student_case": {
    "student_case_id": "uuid",
    "case_status": "pending|active|closed",
    "assigned_curator_membership_id": "uuid|null",
    "operational_stage": "bounded platform value",
    "next_action": "string|null"
  },
  "workflow": {
    "ozo_contract_key": "wf_ozo",
    "ozo_version": "positive integer",
    "country_requirement_version_id": "uuid|null",
    "country_playbook_key": "string|null",
    "country_playbook_version": "positive integer|null"
  },
  "case_snapshot": {
    "student_profile": "minimized confirmed fields only",
    "applications": "bounded safe application summaries",
    "document_slots": "bounded metadata and human review state; no file body",
    "visa": "bounded status, evidence refs and next action",
    "tasks": "bounded open/recent tasks",
    "finance": "safe status/stop factor only",
    "recent_communications": "bounded post-handoff messages when authorized"
  },
  "knowledge": {
    "audience": "internal",
    "retrieval_request_id": "uuid",
    "evidence": [
      {
        "knowledge_key": "string",
        "knowledge_version": 1,
        "chunk_id": "uuid",
        "source_path": "relative-managed-path.md",
        "reviewed_at": "timestamp|null",
        "valid_until": "timestamp|null",
        "content_text": "bounded server-only text"
      }
    ]
  },
  "request": {
    "request_kind": "case_summary|next_action|checklist|message_draft|document_review_aid|application_aid|visa_aid|knowledge_gap",
    "staff_instruction": "bounded text|null"
  }
}
```

Required server checks before generation:

- actor session, organization membership and authority version are current;
- actor is Admin or the currently assigned Curator for the case;
- case and all child objects belong to the same organization;
- the exact OZO/country versions are still available to this case;
- all knowledge chunks are managed, internal-audience, approved and in the same account;
- sensitive file bodies are not inserted into the prompt;
- total records, characters and time range are bounded;
- model/config/provider failures fail closed to manual work.

## Output and proposed-action schema

```json
{
  "schema_version": 1,
  "language": "ru|en",
  "request_kind": "case_summary|next_action|checklist|message_draft|document_review_aid|application_aid|visa_aid|knowledge_gap",
  "confidence": 0,
  "risk": "low|medium|high",
  "summary": "bounded staff-facing text",
  "recorded_facts": [
    {
      "fact": "string",
      "case_object_type": "student_case|profile|application|document_slot|visa|task|finance|communication",
      "case_object_id": "uuid",
      "evidence_ref": "bounded reference"
    }
  ],
  "knowledge_findings": [
    {
      "statement": "string",
      "citation": {
        "knowledge_key": "string",
        "knowledge_version": 1,
        "chunk_id": "uuid",
        "source_path": "relative-managed-path.md"
      },
      "freshness": "current|expires_soon|expired|not_recorded"
    }
  ],
  "missing_information": [
    {
      "field_or_evidence": "string",
      "why_needed": "string",
      "suggested_owner": "student|curator|admin|finance|university|government_source"
    }
  ],
  "proposed_actions": [
    {
      "proposal_id": "local output ordinal",
      "target_type": "task|document_review|application|visa|checklist|case_note|message_draft|knowledge_verification",
      "target_id": "uuid|null",
      "operation": "draft_create|draft_update|draft_comment|draft_transition",
      "proposed_fields": {},
      "rationale": "string",
      "required_evidence": ["string"],
      "required_staff_role": "admin|curator|finance",
      "execution_authority": false
    }
  ],
  "message_draft": {
    "recipient_kind": "student|parent_or_sponsor|university|internal_staff|null",
    "text": "string|null",
    "send_authority": false
  },
  "human_review": {
    "required": true,
    "reason_codes": [
      "staff_approval_required|missing_evidence|mutable_fact|conflicting_sources|sensitive_data|finance|legal_or_refund|external_outcome|unassigned_or_closed_case|unsupported_request"
    ],
    "review_checks": ["string"]
  },
  "external_action_allowed": false
}
```

Exact enums, maximum counts, text lengths and allowed `proposed_fields` must be enforced by JSON Schema and a second deterministic server parser. Unknown keys, duplicate citations, cross-case IDs, unsupported status transitions and citations outside supplied evidence are invalid.

## Human approval and execution lifecycle

1. Curator explicitly requests assistance on one case.
2. Server re-authorizes the actor and creates an immutable request record.
3. Retrieval selects only approved internal evidence and pins every version.
4. Model returns a structured proposal; deterministic validation accepts or rejects it.
5. UI shows three separate blocks: recorded facts, cited guidance and proposed actions.
6. Curator may dismiss, edit or approve one proposal. There is no "approve all and execute" in v1.
7. Approval calls the existing typed domain action for that object. That action rechecks RLS, assignment, current version, transition, evidence and idempotency.
8. The domain action creates its normal audit. A separate assistant review record links original proposal, staff edit and resulting domain audit ID.
9. A message remains a draft until the employee uses the existing manual-send action; OZO Assistant never calls the transport.

## Audit contract

Retain private, append-only metadata sufficient to reconstruct the decision:

- organization, student case, actor and request ID;
- prompt-policy/business-context/country-playbook versions;
- model/provider configuration version;
- bounded context hash and source object/version references;
- retrieval request and exact knowledge citations;
- raw provider outcome in the existing private containment boundary;
- validated proposal hash and safe structured output;
- staff decision (`dismissed`, `edited`, `approved`) and reason;
- before/after edit hashes;
- resulting typed domain action request ID and audit ID, when one exists;
- timestamps and expiration/retention policy.

Do not put student documents, passport values, full chat bodies, secrets or raw provider IDs in logs or Git evidence.

## UI integration

Place the assistant inside the existing Student 360/case detail, not as a parallel CRM:

- "Ask OZO Assistant" opens one request panel bound to the current case;
- show the pinned country-playbook version and evidence freshness;
- render citations beside the exact statement they support;
- visually separate "recorded", "guidance" and "proposal";
- each proposed action has its own Review button;
- clearly label "Nothing has been changed or sent";
- manual case work remains available when AI is disabled or unavailable.

## Rollout sequence

1. Docs-only contract and Curator review.
2. Separate prompt artifact key and exact JSON-schema tests.
3. Read-only case-summary mode with synthetic, PII-free fixtures.
4. Staff-only draft mode on authorized non-production cases.
5. Shadow evaluation with real Curator questions and no actions.
6. Proposed-action UI where every execution is a separate staff action.
7. Production pilot only after security/privacy, knowledge freshness, audit and rollback gates pass.

## Acceptance criteria for v1

- cross-organization, cross-student, unrelated/former Curator and stale-session denial;
- existing case keeps its pinned country-playbook version;
- no approved internal citation means no factual country instruction;
- expired/conflicting/mutable evidence produces a verification request;
- document presence never becomes document approval;
- payment state never changes through AI;
- external outcomes are never guaranteed;
- every output has `external_action_allowed=false`;
- staff dismissal/edit/approval and resulting domain action are independently auditable;
- disabling the assistant leaves all manual workflows working;
- no WAHA, amoCRM, university portal, email, Storage mutation or provider send is reachable from the assistant adapter.

## Exact blockers before implementation

1. Business Process Owner must approve this v1 role and the separate OZO prompt artifact.
2. Curators must approve the country-playbook template and first China/Malaysia versions.
3. The repository needs a decision on whether v1 citations use Platform approved-knowledge versions, managed AI chunks, or a controlled bridge that pins both identities.
4. Allowed proposed fields and transitions must be enumerated per existing domain action; arbitrary JSON updates are forbidden.
5. Privacy/retention owner must approve which case fields may enter the model context.
6. Real provider evaluation requires sanctioned credentials, approved test identities and explicit production authority; repository tests alone are not provider proof.

## Evidence references

- `CONTEXT.md` definitions for Student Operational File, Approved Prompt Artifact, Country Knowledge Document and Manager Handoff.
- `docs/specs/EVO_PLATFORM_TZ.md`, especially FR-094 through FR-105.
- `docs/platform/p5f-ai-memory-reply-lane.md`.
- `docs/platform/p5f2-gemini-proposal-adapter.md`.
- `supabase/migrations/051_platform_business_workflow_contracts.sql` through `054_platform_decision_prompt_lifecycle.sql`.
- `supabase/migrations/065_platform_ai_memory_retrieval.sql`, `066_platform_gemini_proposals.sql` and `075_ai_assistant_immutable_audits.sql`.
- `src/lib/server/platform-gemini-proposal-contract.ts` and `src/lib/server/platform-gemini-proposal-service.ts`.
