# Existing-payment receipt: local QA, 2026-09-21

The ordinary staff path now attaches a receipt to an existing payment and opens
that receipt from the payment history. It does not create or change a payment,
refund, obligation, financial evidence, amount, or payment date.

Runtime evidence belongs to `3e83d4958ac25c5c9a457ceb35657c52dcd5f0f3`, with
local migrations 001–230. Subsequent planning and QA documentation changes do
not relabel that runtime evidence. Production was not changed.

## Actual result

- An ordinary local Admin uploaded the retained, explicitly authorized technical
  PDF from the existing payment row. The real scanner, private Storage and
  metadata write ran. The Next server recorded HTTP 201.
- The response observer failed before retaining the HTTP body. Success was
  recovered from the single intended request, server log and exactly one new
  receipt row, one `case.payment.receipt.upload` audit and one Storage object.
  The response body is not claimed as captured; there was no second upload.
- The original 2,020-byte log prefix is retained independently and matches its
  previously recorded hash. Later log appends do not replace this evidence.
- After restoring the same owned browser authentication state, an ordinary click
  on “Чек” returned 307 and downloaded 766 bytes. SHA-256 matched the original
  artifact: `54087f0b573ffd9b749f47401edfe8bf449e50daeeab7065cb0feec683521812`.
  No signed URL or direct Storage request was used to bypass the UI.
- Full comparison of 287 business tables preserved all prior rows and financial
  data. Only the expected receipt and audit tables changed; Storage objects and
  prefix bookkeeping were checked separately.
- Impeccable refinement kept the existing EVO layout. The final 1440px desktop
  and 390px mobile captures show one “Чек” link and no repeat upload form for the
  payment. Mobile document width is 390px, without horizontal overflow.

## Focused safeguards and limits

Six rollback SQL probes passed: exact Admin upload/download targets, and direct
anon/service-role denial for both readers. These are SQL principal/ACL checks,
not six ordinary Auth journeys; Student, other staff, foreign tenant and refund
branches were not exercised by this packet.

Replaying the actual stored metadata/request returned its existing result without
another receipt or audit. A changed byte size produced `40001`. Four independent
organization/profile/membership/case row locks each blocked replay with `55P03`;
after release, replay returned the exact stored result. Full state, catalog and
captured effects remained unchanged after rollback. This proves the tested lock
barriers, not a committed revocation race or whole-upload idempotency.

The uploader is the only active system Admin in this QA organization. Inactive
uploader testing was not executed: the last-admin safeguard was preserved and no
new identity was created. Other conflict variants and complete SQL branch
coverage remain unverified.

The current owned Admin session was logged out through the normal CRM button.
All 223 earlier session-row hashes are preserved. One identified session from an
earlier failed browser observer remains because its token was lost; no global
logout or direct Auth deletion was used. Auth users and identities remain eight
each, with count-only evidence. Full Auth row and refresh-token parity are not
claimed. Owned Next, browser processes and scanner are stopped; their ports are
closed. The local runtime is released to A15f with the complete 001–230 snapshot.

## Fixes discovered on the real path

The retained negative evidence covers unhydrated native GET, receipt-route proxy
403, a service-table SELECT denial incorrectly surfaced as 404, legitimate NULL
`is_current` values breaking the case decoder, and the invalid audit action
rejected after a Storage upload. That last failure removed only its new object
and left full observed state unchanged.

The resulting changes use narrow authenticated target readers, strict DTO
decoding and current delegated-principal checks for metadata and replay. Literal
NULL becomes `isCurrent: false` without weakening other decoder checks. Forward
230 changes two audit-action literals while retaining migration 229, the audit
constraint, function metadata and grants. Contract-file routes stay outside this
change; their separate gaps are not claimed as fixed.

## Private evidence references

Raw rows, cookies, signed queries and credentials are not committed. These are
local receipts, not durable production receipts or new runs at a later head.

| Evidence | Local receipt | SHA-256 |
| --- | --- | --- |
| Apply 230 | `/private/tmp/evo-crm09e-230-packet-20260921/apply-output/apply-receipt.json` | `5ccf7dde36cac9779e9226c902d8b36c669e05483b45133c62c58f9ef770a494` |
| Correlated upload 201 | `/private/tmp/evo-crm09e-230-ui-3e83d495/recovered-upload-receipt.json` | `fba3e9a668bdb03d11475adb9698c29d14af7f643e79ed90395b7118b3f3ea9e` |
| Upload reconciliation | `/private/tmp/evo-crm09e-230-ui-3e83d495/upload-reconciliation.json` | `5af783aabd47360d267edbcb1f9f97c93a21cd473f29aa107c44c70ee4f793b7` |
| Browser download | `/private/tmp/evo-crm09e-230-ui-3e83d495/download-success.json` | `5bf1f7ef179c0fb9f9cec45cdcdab1274f87d595f6e23bdfaa7dd6da41d1d160` |
| Six target probes | `/private/tmp/evo-crm09e-230-packet-20260921/target-output-v2/receipt.json` | `4a7ddb5f98a535a3f6fd79227d6cd8a8a1e95a7ac4ac65e61ea2380cf4463e76` |
| Metadata replay | `/private/tmp/evo-crm09e-230-packet-20260921/replay-output/receipt.json` | `a399ea19df5041000a565455aac932940aef30c3d18bdf690c020de3af6183af` |
| Four row locks | `/private/tmp/evo-crm09e-230-packet-20260921/revocation-draft/locks-output/PASS.json` | `9e3d39a5b20b7aa77730145cd2c3c6bbe18fdcc87618290fdbfa54919240f6eb` |
| Runtime release | `/private/tmp/evo-crm09e-230-ui-3e83d495/release-receipt.json` | `37e840905100a03d102749844c3a5a97d5bef60b5c3002bbd0d557bc7475df5d` |

This completes the bounded local existing-payment receipt journey in CRM-09e.
It does not complete item 12, all accepted items 1–36, native acceptance, broad
final E2E, provider checks, App Store work or production delivery.
