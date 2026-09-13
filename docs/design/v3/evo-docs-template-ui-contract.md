# D4 — университетские бланки в существующем интерфейсе

2026-09-14. Pre-code contract, not an implemented/released workflow.
Extends [D4](evo-docs-university-packages-contract.md), [registry](evo-docs-template-registry-contract.md)
and [DESIGN.md](../../../DESIGN.md). Root owns UI/actions/V3 source adapters;
the ingress lane owns166 and its public typed session/HTTP contracts.

## Working surface

Visual thesis: quiet EVO white workspace, generous separation, one red primary
action, Russian utility labels and the existing shell/logo. No dashboard mosaic.
Content: university context → saved templates → selected version → next action;
details/history expand only on request. Interaction: clear pending/save feedback,
controlled form state retained on failure, native disclosure and focus return;
no decorative motion, and reduced-motion behavior follows existing tokens.

Staff university detail links to `/v3/universities/[id]/forms`. The selected
`template` and `version` are URL parameters; direct navigation, Back and refresh
must retain context. Manager listing includes unpublished/processing drafts so
an interruption cannot hide work. This is not a separate university catalogue.
Student catalogue and private student assessments receive none of these DTOs.

## Steps and authority

1. Create a named template attached to the exact existing catalogue identity.
2. Upload a version with its source/date. Browser declares file hash/size/MIME;
   these are not proof. Session reserve precedes raw-byte POST to the ingress
   source route. Actual ClamAV/native inspection/private Storage verify bytes.
3. Select confirmed-profile field sources for inspected DOCX paragraphs or human
   PDF rectangles. Show Russian field labels, not database keys. Manual fields
   remain explicit; signature/consent/photo are never fabricated.
4. Save a new mapping, review that exact mapping and explicitly publish it.
   Existing publication is retained until the exact replacement is approved.
   Archive requires explicit confirmation and preserves history.

Every action resolves the current actor and requires live organization-scoped
`catalog.import.manage`, denies role-preview, validates exact fields and rechecks
the SQL authority. Reads distinguish forbidden/unavailable from an empty list.
The UI never accepts or constructs service claims, object paths, receipt hashes,
inspector image identities or scan success. Versions and expected revisions use
the existing registry DTO; no parallel status/schema dictionary.

## Upload and recovery

DOCX/PDF ≤20MiB, one frozen File per submission. Send raw bytes with exact MIME,
`Idempotency-Key` and quoted decimal `If-Match`; same-origin credentials. Separate
intent UUIDs for reserve, upload, cancel and explicit reconciliation. Preserve an
uncertain intent and its metadata; changing a file is a new version, never an
overwrite. Unknown/202 is processing or needs reconciliation, not success.
Use the safe status endpoint with a bounded poll while processing; stop on
terminal state, page exit or deadline. Cold resume reads persisted status.
Cancel/reconcile are explicit commands; no hidden retry of uploaded bytes.

Only verified sources may be opened via the authenticated source route. PDF
source viewing is not filled-form/layout acceptance. DOCX download is not an
in-browser layout proof. The full run still requires a safe usable mapping
preview, generated-file rendering, all-page/glyph inspection and packages.

## Evidence and limits

Focused actual React controls: labelled inputs, keyboard, preserved draft,
disabled repeated submission, safe pending/error/unknown wording, exact intent
reuse. Action tests cover malformed/duplicate fields and authority/receipt
binding; synthetic unit transport is explicitly not real persistence evidence.
Integrated proof must exercise real local Auth,166,ClamAV,native image,private
Storage and browser create → upload → reload → mapping → review → publication.
Use synthetic non-personal source files only. Actual managed schema/bucket,
release, client documents/Gemini and complete D4 are not authorized by a UI test.
