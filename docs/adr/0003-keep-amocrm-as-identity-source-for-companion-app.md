# Keep amoCRM as identity source for the companion app

> Status: superseded by ADR 0020; companion-era historical source only.

The Companion WAHA CRM App will treat amoCRM as the identity source of truth from day one. It may store local shadow records for inbox speed, message history, draft review, and operator workflow, but canonical contact and lead identity must be resolved or created in amoCRM before the app presents a lead as real.
