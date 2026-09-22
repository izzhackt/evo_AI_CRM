# Release admission diagnostics — 22 September 2026

Precode contract, base24e0a2eb. Upstream35739918216 passed; release35739964383
failed its first Secretless build admission before checkout/build/deploy.
Every logged static input matches the required guards. The remaining branch is
the public GitHub main-ref request, JSON parsing or object identity check; the
old generic error conceals which. Exact HTTP cause on that runner is unknown.
A separate Mac request returned403 with public API rate-limit exhaustion; it is
not evidence of the runner's IP/response. Existing0aceda06 remains accepted,
healthy/restart0/pending absent; ROOT disarmed after the failed workflow.

Smallest change: add bounded stage and HTTP status to the existing fail-closed
messages in the inline exact-main admission steps. Preserve every comparison,
identity check, timeout, redirect rejection, arm/actor guard and first-step
secretless boundary. No credentials, tokens, response body or exception message
will be logged; no retry/fallback/bypass or new permissions. Build/deploy and
manual main admission have the same opaque read boundary, so diagnose all three.

Validation: inspect the exact generated inline programs, syntax check them and
run existing scope-local static release contracts. Do not create new mock HTTP
fixtures. After independent review and protected CI, one fresh managed run on
new main will exercise the actual GitHub request and keep the failure visible
if it recurs. This is a changed diagnostic path, not an unaltered retry reported
as proof that the original cause was repaired. No migration repeats are needed.

Official references checked22September:
[GitHub get a reference](https://docs.github.com/en/rest/git/refs#get-a-reference),
[REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
