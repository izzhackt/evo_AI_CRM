# Use Supabase for the companion app

> Status: superseded by ADR 0020; companion-era historical source only.

The Companion WAHA CRM App will use Supabase as its data store and auth foundation because WACRM is already built around Supabase Auth, Row Level Security, storage, migrations, service-role server routes, and Postgres functions. The existing EVO CRM remains on its current database until a separate migration decision is made.
