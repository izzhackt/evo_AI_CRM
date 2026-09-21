# Published countries in the staff catalogue — local acceptance

21 September 2026. Actual source: `deeaed8911e5531b70c515e9d07659a9665e7067`.
This accepts the bounded [country-filter contract](../platform/staff-catalog-country-facet.md),
not the whole catalogue plan or production delivery.

Migration236 was applied once through the pinned local Supabase CLI. It added
the reviewed function and ledger entry, preserving all existing functions/ACLs,
290 business tables and 33 Auth/Storage projections. The DDL receipt remains
historical (`released:false`); resource release happened separately after UI.

The ordinary existing Admin received `200` and `countries:["CN"]` from the new
reader. An explicitly mismatched nil organization received `403`; anonymous
and service callers received `401`/`403`; the existing active post209 Student
received `403` with SQLSTATE `42501`. A nil organization is not a populated
cross-tenant test. No users, grants or catalogue fixtures were created.

One browser batch at 1440, 390 and 320 px passed:

- The selector contained only the current published country, plus “All”.
- Country-only CN selection and Link reset restored the actual current value.
- A MY deep link retained the selected country with “нет опубликованных карточек”,
  returned no cards, and reset correctly.
- Native GET search, level and combined filters returned the existing expected
  rows; the combined reset cleared all three current controls and restored all
  five cards. The suspected inherited reset failure did not occur in this run.
- Real Tab moved from the country select to level after initial programmatic
  focus. All four controls were 44 px high; document and scroll widths matched.

Impeccable Operate/refinement preserved EVO typography, layout and controls.
ROOT inspected all three saved screenshots from that same batch; no correction
or second capture was needed. Native select-popup keyboard operation, accessible
names and screen-reader behavior are not claimed by these checks.

Both actors logged out with scope=local and status204. The owned browser closed;
the owned Next process and child ended, port33260 closed, and the tool exit was0.
The user's existing port33216 was untouched. Captured Auth files were removed
after successful scoped cleanup. Final state/catalogue/effects matched before:
all290 business tables were unchanged; all33 Auth/Storage tables reconciled,
with only the two actors' sign-in metadata and four own login/logout audit rows
permitted to differ. Incoming224 sessions,239 refresh tokens and224 AMR rows
were preserved exactly. This is not blanket Auth-metadata equality.

Independent actual/closure review: `28f1a3651066fc7fe373254409903ef1335229e4d7bf1a61d6efeec62f3e567a`.
Independent DDL review: `9da3a9de4c8daae269c278f31517cb5fa730d236ba10418de1d204268dee6576`.
Earlier source P2 and inert locator-review corrections remain in their receipts;
they preceded this actual run and are not hidden retries.

| Evidence | SHA256 |
|---|---|
| Actual apply236 | `5f8337fae6b4de53cf6291308e7d59ac900a14cf6b85f13599cda95bf088c1f5` |
| UI before | `d8dec7148d58c065e146c008c7a7d4c6daf57be2eb6dbc494da2756ff87081cb` |
| UI batch | `a6412237b6e3f6e477cff28ba613e39d5502fece0f7b947ca8a2a1632f0dce78` |
| Final observer | `08b2474e8f03782b4c32299a2b6e576a546a3bdef7448dc9b7f1efce3a77965d` |
| Strict reconciliation | `cb516e89c0c1efb4cf5193d3852478b5909a22d9213d3633bbcbbc5768fb4218` |
| Resource release to ROOT | `a0d565d469f73e77e10144415c8422f3d54ef23f0b947b7afdd31f10c6efbabc` |

Only five CN cards existed. Multiple-country and more-than30 positive data,
custom-staff positive access and a populated other organization remain gaps.
Management, publication, card/photo/detail reacceptance and production were
outside this pass. Existing #1008 evidence keeps its own revision and limits.
Final integration/document review and protected PR checks remain separate.
