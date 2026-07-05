# Security Notes

This repository must not store live credentials or raw customer exports.

Before pushing changes:

- Run a secret scan over the full tree.
- Keep `.env` files out of git.
- Redact amoCRM, WAHA, WhatsApp, Gemini, and infrastructure credentials from documentation.
- Remove local throwaway scripts that embed tokens, API keys, or raw media payloads.

If credentials are accidentally committed, treat them as compromised and rotate them before continuing.
