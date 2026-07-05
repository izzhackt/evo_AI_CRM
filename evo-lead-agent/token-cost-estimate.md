# Token Cost Estimate: EVO Lead Agent

Status: rough planning estimate

Default model is configurable with `EVO_AGENT_GEMINI_MODEL`. The current rollout
default is `gemini-3.5-flash`.

## Per Inbound Message

Estimated prompt:

- system prompt: 350-600 tokens;
- latest message: 20-200 tokens;
- recent history: 200-1,500 tokens;
- amo/context summary: 100-600 tokens.

Estimated output:

- decision JSON: 150-500 tokens.

Typical total:

- low-context chat: 700-1,200 input tokens, 200-350 output tokens;
- longer chat: 2,000-3,000 input tokens, 250-600 output tokens.

## Cost Controls

- Autoreply is disabled by default.
- Outbound is separately disabled by default.
- History is capped to the latest 20 local messages.
- WhatsApp reply text is capped by `EVO_AGENT_MAX_REPLY_CHARS`.
- Handoff is preferred over repeated long reasoning when the request is risky or
  lacks approved knowledge.
