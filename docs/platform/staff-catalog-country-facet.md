# Staff catalogue: countries with published universities

Item 14, bounded continuation after #1008 and #1010. Base main `59a726b5`.
The current country select uses the full static ISO list; this is an irrelevant
options problem, not a first-page truncation bug. The accepted UX plan requires
countries from the available published catalogue.

## Contract before implementation

- Migration 236 is reserved by ROOT after fresh contiguous source inventory
  001–235. Add only `platform.staff_university_catalog_countries(uuid)`; do not
  change tables, publication data, old RPCs, permissions or default privileges.
- Return `{organizationId,countries}` from the complete latest published version
  per institution, using the same institution-and-organization join as migration
  148. Then derive distinct canonical publication country codes, ordered with C
  collation. Ignore page/search/level filters; include no drafts or registry-only
  countries. Malformed published country data fails explicitly.
- Use a STABLE SECURITY DEFINER with empty search_path, qualified names, explicit
  current-actor organization equality, Student exclusion and scoped
  `catalog.read` permission. Custom staff with null coarse role remain eligible.
  Revoke PUBLIC/anon/service privileges and grant EXECUTE only to authenticated;
  inner authority still denies Students. No new grants or Admin-only shortcut.
- Validate the small DTO strictly: exact keys, matching organization, unique
  ordered uppercase two-letter codes, at most 676. Keep the existing publication
  validator's domain; do not introduce a narrower ISO restriction.
- Read page and facet through the ordinary staff server client. A failed facet
  uses the existing unavailable state; it is not an empty catalogue or an ISO
  fallback. Empty successful data remains a valid empty result.
- Staff rendering requires the facet explicitly. The shared Student branch
  keeps its existing select. Preserve the native labelled select, 44px controls,
  EVO styles, existing rows/photos/deadlines and all search/level/pagination
  semantics. A selected country absent from the facet stays visibly selected
  with “нет опубликованных карточек”; never silently reset its deep link.
- Impeccable Operate/refinement applies to the incumbent #1008 screen. Saved
  desktop/mobile evidence and current source agree; no layout, typography or
  branding replacement is proposed.

## Verification and limits

Focused parser/option tests cover tenant mismatch, invalid/duplicate/unsorted
codes, exact keys, bounded/empty input and preserving an unavailable selection.
Scoped lint/typecheck and independent source review precede local execution.
Use the coordinated existing QA database only: one additive migration through
the pinned CLI, unchanged old ledger/functions/ACL and all 290 business/33
Auth-Storage projections. No fixtures, accounts, catalogue publications or
permission changes. Production application is not authorized here.

Then use ordinary existing Auth for the read path and permitted denial probes,
and one combined 1440/390/320 UI batch for the actual select, empty selected
country, search/level/reset and existing cards. At most one reviewed correction.
Known QA data has five CN cards: multi-country, more-than-30 and missing-role
positive datasets must remain gaps if unavailable. Source logic is not relabelled
as a live result. Close owned resources and strictly reconcile before handoff.

This does not complete all item 14: management search, draft pagination and Add
placement are a separate accepted proposal. It does not expand document
preparation beyond the six owner-approved countries or redesign the portal.

## References checked 21 September 2026

[PostgreSQL 17 CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html)
documents STABLE, definer privileges and safe search_path/EXECUTE handling.
[Supabase database functions](https://supabase.com/docs/guides/database/functions)
supports explicit empty search_path and controlled EXECUTE for the existing
protected reader pattern. These sources do not replace the tenant/staff checks.

Independent precode approval: `08c1a1082a3477aa78e5e2aa2100ff41dde2e8261cfb925385845c1ff9fa21ad`
for proposal `d8bf2a20ca7c21d9d4087bd62ed0bf410bca5e57395fc1a75a68d01bb40ad7f1`.

Source review found that React's uncontrolled select does not apply a changed
defaultValue on client Link reset when its options remain. Key only the staff
country select by the committed country filter, so reset reflects the URL while
unrelated controls and the Student branch retain their identity. Real reset
acceptance remains part of the planned UI pass.

## Local acceptance checkpoint

The single local236 apply and ordinary Admin/Student RPC/UI run on `deeaed89`
passed, including country-only and combined resets at the recorded widths.
See the [actual receipt](../qa/staff-catalog-country-facet-actual-2026-09-21.md)
for strict closure, independent review and the missing-data limits. This does
not accept management work, the entire item14, or production delivery.
