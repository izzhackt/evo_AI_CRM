# Public API (`/api/v1`)

EVO Inbox keeps the public API surface narrow for first launch. API keys may be
used for retained read/supporting integration paths, but outbound WhatsApp sends
and broadcast automation are disabled until later WAHA slices prove the manual
operator workflow.

## API Keys

Every request authenticates with an API key:

```http
Authorization: Bearer evoinbox_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keys are account-scoped and are created in **Settings -> API keys**. The full key
is shown once; the app stores only a SHA-256 hash.

First-launch createable scopes:

| Scope | Purpose |
| --- | --- |
| `messages:read` | Read messages and delivery status |
| `contacts:read` | List and read contacts |
| `contacts:write` | Create and update contacts |
| `conversations:read` | List and read conversations |
| `webhooks:manage` | Register and manage outbound event webhooks |

The historical WACRM scopes `messages:send` and `broadcasts:send` are not
createable in EVO Inbox first launch.

## Disabled Routes

The following first-launch-disabled route families return HTTP `410` with
`error: "first_launch_disabled"`:

- `POST /api/v1/messages`
- `/api/v1/broadcasts`
- `/api/whatsapp/send`
- `/api/whatsapp/broadcast`
- `/api/whatsapp/config`
- `/api/whatsapp/templates/*`
- `/api/automations/*`
- `/api/flows/*`

This is intentional product pruning. It is not a missing credential state and
does not prove WAHA, Meta, Supabase, amoCRM, AI provider, DNS, Caddy, or VPS
success.
