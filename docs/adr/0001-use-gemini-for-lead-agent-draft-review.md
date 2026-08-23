# Use Gemini for lead-agent draft review

> Status: source-only under ADR 0020. Human-reviewed AI and no-send safety are
> retained; the exact provider and separate Lead Agent replacement are not
> current implementation authority.

The first live receive-only rollout needs AI draft review, but not automatic WhatsApp sending. We will replace the EVO lead-agent's Anthropic-only drafting path with Gemini 3.5 Flash via the current Google Gen AI Python SDK so the rollout proves the chosen provider before production operation, while keeping outbound WhatsApp disabled until a later approval.
