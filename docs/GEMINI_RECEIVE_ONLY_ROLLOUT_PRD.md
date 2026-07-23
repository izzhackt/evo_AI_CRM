# Gemini Receive-Only WhatsApp Rollout PRD

## Problem Statement

EVO Admissions has a CRM and lead-agent path for WhatsApp, amoCRM, and operator follow-up, but the production path has not yet been proven with real credentials and a real WhatsApp session. The next release must prove the live inbound path without risking accidental replies to real leads.

The first live rollout must also use Gemini 3.5 Flash for draft review instead of Anthropic, so staff can inspect AI-generated guidance before any outbound automation is considered.

## Solution

Deliver a launch-control implementation that makes the EVO lead-agent use Gemini 3.5 Flash for draft review, keeps WhatsApp outbound disabled, and proves one controlled real inbound WhatsApp message end-to-end on the production VPS.

The receive-only rollout succeeds when a dedicated EVO test WhatsApp number receives one controlled inbound message, the lead-agent resolves or creates a clearly marked amoCRM test contact and test lead, the CRM receives signed shadow-state sync, the Operator UI shows the conversation and draft-review state, and no WhatsApp reply is sent.

## User Stories

1. As an EVO operator, I want a dedicated test WhatsApp number for rollout, so that personal and primary admissions numbers are not exposed during validation.
2. As an EVO operator, I want the first live rollout to be receive-only, so that no accidental WhatsApp replies are sent.
3. As an EVO operator, I want inbound WhatsApp messages to enter the lead-agent through WAHA, so that the production message transport is proven.
4. As an EVO operator, I want the lead-agent to resolve or create amoCRM identity before CRM sync, so that amoCRM remains the identity source of truth.
5. As an EVO operator, I want rollout-created amoCRM records clearly marked as test data, so that cleanup and review are unambiguous.
6. As an EVO operator, I want the CRM to receive signed internal sync from the lead-agent, so that local CRM state cannot be mutated by unauthenticated public callers.
7. As an EVO operator, I want the Operator UI to show the inbound conversation linked to the resolved amoCRM lead, so that staff can inspect the live path.
8. As an EVO operator, I want Gemini 3.5 Flash to generate draft review output, so that staff can inspect AI guidance without sending it.
9. As an EVO operator, I want outbound WhatsApp disabled throughout first rollout, so that draft quality and integration wiring can be validated separately from customer-facing automation.
10. As an EVO operator, I want preflight checks to name missing WAHA, amoCRM, CRM sync, Gemini, or admin credentials, so that rollout cannot proceed on fake success.
11. As an EVO operator, I want readiness checks to distinguish receive-only readiness from outbound readiness, so that safe proof does not require enabling sending.
12. As an EVO operator, I want the server deployment docs to name the exact environment files and settings, so that the live VPS setup is repeatable.
13. As an EVO operator, I want every rollout step to produce real evidence, so that completion is based on observed provider behavior rather than local assumptions.
14. As an EVO operator, I want the implementation split into reviewable slices, so that launch-control can review and merge each piece safely.

## Implementation Decisions

- Use the current Google Gen AI Python SDK for Gemini API access. Official SDK docs identify `GEMINI_API_KEY` as the default environment variable and show `client.models.generate_content` with `gemini-3.5-flash`.
- Replace Anthropic as the EVO lead-agent draft provider. Do not merge the unrelated remote Kant/Bitrix workspace into the EVO product path.
- Keep the lead-agent decision seam centered on draft decision generation: the service should still return the existing agent decision shape so downstream amoCRM and CRM sync behavior remains narrow.
- Add provider configuration and readiness/preflight reporting for Gemini. Missing Gemini configuration must be explicit.
- Keep `EVO_AGENT_OUTBOUND_ENABLED=false` mandatory for the first live rollout.
- Treat `EVO_AGENT_AUTOREPLY_ENABLED=true` as allowed only for internal draft review, not for sending. If the implementation cannot safely separate draft generation from sending, add that separation before rollout.
- Preserve amoCRM as the identity source of truth.
- Use a dedicated EVO test WhatsApp number for first rollout.
- Use a real marked amoCRM test contact and test lead for proof.
- Run the first proof on `hermes-vps` under `/opt/evo-crm`, because local execution cannot prove private Docker DNS, Caddy network wiring, server env files, persisted WAHA session state, or real provider credentials.

## Testing Decisions

- Test external behavior at the highest useful seams:
  - Lead-agent draft decision generation returns the existing decision shape with Gemini-backed output.
  - Lead-agent readiness/preflight reports Gemini configuration accurately.
  - Receive-only message processing records inbound state, resolves amoCRM identity, syncs CRM shadow state, and does not send WhatsApp.
  - Parent CRM signed internal sync accepts lead-agent message/session-status payloads and rejects invalid or unsigned payloads.
  - Operator UI exposes enough state to verify inbound conversation and draft review.
- Existing lead-agent Python tests are the prior art for service, readiness, CLI, and webhook behavior.
- Existing parent `npm run scenarios` is the prior art for end-to-end CRM truthfulness checks.
- Live rollout validation must use real WAHA, amoCRM, CRM sync, Gemini, and production server paths. If credentials or services are missing, the block is not complete.

## Out of Scope

- Automatic outbound WhatsApp sending.
- Main admissions WhatsApp number migration.
- Using a personal WhatsApp number except as an explicitly approved emergency fallback.
- Replacing amoCRM as identity source of truth.
- Merging the remote Kant/Bitrix Gemini workspace into the EVO code path.
- Full public launch or sales-team migration.
- External website copy changes.

## Further Notes

- Launch-control applies: one block per PR, real validation per block, independent reviewer approval before merge, and no completion claim without live evidence.
- The first live rollout stops on receive-only proof. Outbound automation requires a later PRD or explicit approval.
