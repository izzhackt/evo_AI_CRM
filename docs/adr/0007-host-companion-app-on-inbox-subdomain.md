# Host companion app on inbox subdomain

> Status: superseded by ADR 0020; companion-era historical source only.

The Companion WAHA CRM App will be hosted at `inbox.evoadmissions.com` instead of under the current CRM domain as a path. A subdomain keeps the separate Next/Supabase app, auth session, Caddy route, and deployment lifecycle independent from `crm.evoadmissions.com`.
