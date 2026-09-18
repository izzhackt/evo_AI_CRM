-- Retired unused reservation; intentionally no schema or business changes.
-- The parallel Student-signup draft originally used172, but was never merged
-- or applied to production. That feature must use176 or later when approved.
--173–175 are already applied. Keep their immutable identities and the existing
-- exact contiguous-ledger contract without importing the unrelated draft.
-- This file is not evidence of Student signup or any business feature delivery.
BEGIN;
COMMIT;
