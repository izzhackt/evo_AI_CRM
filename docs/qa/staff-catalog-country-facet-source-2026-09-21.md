# Staff country facet — source checks, 21 September 2026

Product revision `f8622d868afa7a083edd0e981f01c957a8c47b99` follows the
[precode contract](../platform/staff-catalog-country-facet.md), committed before
implementation at `2b2f076a`. This is source evidence, not a database apply or UI
acceptance receipt.

Migration236 adds one scoped staff-only country projection. It selects each
institution's latest published content before distinct countries, excludes
Students explicitly while retaining custom staff, and rejects malformed codes.
The small DTO is validated against the actor organization and complete sorted
two-letter domain. Staff rendering requires this data; Student select behavior,
existing row/deadline/photo components and page filters are preserved. An absent
selected country stays visible with an explicit unavailable-publication label.

Checks on Node22.23.1:

- Seven pure parser/option tests passed. Cases cover tenant mismatch, strict
  envelope/types/order/uniqueness, all676 possible two-letter codes, empty data,
  copying input and preserving an absent selected country. These examples are
  not database fixtures, publications or actual UI proof.
- Scoped ESLint and `tsc --noEmit --incremental false` passed (exit0, empty logs).
- SQL and PL/pgSQL parsed with existing pglast7.7; six statements, one function.
  This proves syntax only. `git diff --check` passed.

Private test log SHA256:
`e96608361b42b9b43249222278cd5ab611e0eaae9861a5ae885e6942ec424ded`.
Each empty lint/typecheck log has SHA256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
SQL SHA256 `9fc14519ff7ed200bc360bef19eb6ee290e93f92149e13615e9289291c66ccdd`;
function body SHA256 `9db066dbfc656d366b962dcabf1952fdc93bc987cea93864819b025cbeec20cc`.

Independent exact-head source review, protected CI, coordinated local236 apply,
ordinary Auth/RPC/UI, and strict resource/data reconciliation remain required.
No production action, catalogue mutation or new QA actor was performed. Known
five-CN-card data cannot establish multiple-country or more-than30 behavior.
Impeccable Operate/refinement used the accepted #1008 desktop/mobile images and
unchanged incumbent styles; current runtime/visual acceptance is not claimed.
