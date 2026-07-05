# Let companion app resolve amoCRM identity

The Companion WAHA CRM App will resolve or create amoCRM contacts and leads itself from day one. The first scope is narrow: match by phone, create missing contact or lead when needed, store `amo_contact_id` and `amo_lead_id` on Supabase shadow records, and avoid mirroring the whole amoCRM pipeline locally.
