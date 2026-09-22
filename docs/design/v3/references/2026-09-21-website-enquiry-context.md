# Website enquiry context — 21 September 2026

Candidate source change; no migration, production release, lead submission or
business acceptance performed by this slice. The owner will test real submission.

## Contract

The eight existing required JSON fields are unchanged. `country` additionally
accepts the exact literal `Undecided`. Optional `university` may be omitted, null,
or exactly `{slug, name}`: slug is 1–120 lowercase ASCII letters/digits separated
by single hyphens; name is nonempty after trim, at most 300 JavaScript code units,
without ASCII controls. Unknown fields remain invalid. Unicode display names
are allowed. These are visitor-supplied values, not verified catalogue IDs.

Receipt JSON stores the university only when present, including it in the same
request UUID comparison. Null and omitted university keep the exact old JSON
shape, so an old request retried after the update does not become a conflict.
`Undecided` maps to NULL interest direction on a new lead. Existing lead direction,
client identity, owner and stage remain untouched. The existing authorized reader
returns `university` as an object or null; old receipts render normally.

Staff see “Пока не определился” and the optional “Выбранный университет” in the
existing “Заявки с сайта” section. React renders the choice as escaped plain text,
with wrapping; it is neither a URL nor a staff-authored case note. Impeccable
context and clarify guidance preserve the existing definition-list layout and
put the new fact beside country without extra narration.

## Coordinated migration and rollout

Astra reserved `231_platform_website_enquiry_context.sql`. Only the existing
schema/release coordinator applies the ordered chain 228 → 229 → 230 → 231 and releases
the shared CRM candidate. Website publishing follows the compatible CRM receiver.

Migration231 atomically drops the old ten-argument RPC and creates one function
with final `p_university JSONB DEFAULT NULL`, explicitly restricting EXECUTE to
service_role and reloading PostgREST's schema cache. It preserves old calls that
omit the new named argument; there is no overload, duplicate writer or wrapper.
No table/column, staff identity or permissions are added. The read RPC keeps its
existing authority checks. Rolling back the app remains compatible with this
additive data contract; migration231 and new receipts must not be removed.

[PostgreSQL default arguments](https://www.postgresql.org/docs/current/sql-createfunction.html)
apply when an argument is omitted; changing an input signature requires a new
function rather than CREATE OR REPLACE. [PostgREST RPC documentation](https://docs.postgrest.org/en/v12/references/api/functions.html)
explains named JSON arguments and schema-cache refresh after function changes.

## Narrow validation

At the implementation candidate, Node22.23.1:

- `npm ci --ignore-scripts --no-audit --no-fund`: passed.
- `node --experimental-strip-types --test tests/website-enquiry-contract.test.mjs`:
  2 tests passed, executing the real parser and country set. No personal payload,
  HTTP submission, stubbed response or database write is involved.
- Focused ESLint for the four changed TypeScript/TSX files: passed.
- `next typegen` and `tsc --noEmit`: passed.
- Impeccable detector on WebsiteLeadSubmissions: zero findings.
- `git diff --check`: passed. SQL reviewed against migration170, preserving the
  existing ingress, locks, rate limits, contact linking and read authority.

These checks do not prove SQL execution, the managed PostgREST default-argument
path, successful persistence or populated CRM UI. The user declines agent-led
business submission and will perform it personally. The coordinator owns the
migration/rollout check; an independent exact-head reviewer must approve first.
No full schema replay, broad browser suite or fake lead was used.


Coordination update: the original 230 reservation was reassigned to 231 before
apply; 230 is required for the coordinator's receipt audit namespace repair.
The SQL hash remains
`d2cdcc54faa4f9514a148e3736977df2dbcfa7076252d5be2a0b385ad3a72eb3`.
Earlier implementation checks/review refer to
`d7a7d1d7457783c97b2e1792f730464c07b25494` and remain valid only for the unchanged
runtime/SQL body. The rename and documentation need a separate narrow review;
no product checks are rerun for this filename-only change.
