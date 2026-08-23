# P8B3 Portable Linux/AMD64 Image Identity Contract

Date: 2026-08-15
Issue: #205
Status: historical implementation source under #376/ADR 0020; not active
Block-ID: `EVO-P8B3-PORTABLE-IMAGE-IDENTITY-2026-08-15`

## Problem

P8D2 stopped safely because P8B2 froze each local OCI image-index digest while
`docker image save --platform=linux/amd64` exported the platform manifest that
the Hermes daemon loaded. An OCI index and its referenced AMD64 manifest are
different content-addressed objects and therefore have different valid digests.
The archive bytes and platform selection were correct; the comparison contract
used the wrong identity level.

## Scope

P8B3 creates a new portable evidence root from the three retained real P8B2
images. It does not rebuild, retag, run or publish an image and does not touch
Hermes, providers, customer data or the retained P8B2/P8D2 evidence.

Exact inputs remain source commit `0505143657858e710acdd5029f1cc77c5524083e`,
target `linux/amd64` with empty variant, and the three exact P8B2 tags. Their
OCI index digests remain immutable historical identities.

## Closed portable artifact

The generator requires OrbStack Running and Docker context exactly `orbstack`.
It creates a new mode-`0700` evidence directory and, for each exact tag:

1. binds the Docker OCI-index descriptor, source label, revision and tag;
2. creates one mode-`0600` archive with
   `docker image save --platform=linux/amd64 --output`;
3. hashes the entire archive;
4. requires exactly one archive descriptor for `linux/amd64`, empty variant and
   OCI image-manifest media type;
5. recomputes the referenced raw manifest blob digest;
6. verifies its config and every ordered layer blob digest and byte size;
7. writes closed `portable-image-identity.json` records binding service, tag,
   source commit, index digest, platform-manifest digest, config, layers,
   archive name/hash/size/mode and exact platform;
8. writes a closed collection index covering exactly the three archives and
   portable identity, with files `0600`, no symlinks and no extras.

The expected real platform-manifest digests are CRM `sha256:b965ac5c41d4e8bddc6d6bb7baaa7bcec101af4083b8ca861f9e9904cec9eafd`,
Inbox `sha256:e15c5e07b4232e39622616cb76ed84e1e5b6a7c9145728a42a7701a3238e6b92`,
and Lead Agent `sha256:572d01c6f2a0824e56607f41d4376e927ccdf41c5218c6dd65930f95cd6593cd`.

Reject missing/extra descriptors, alternate platforms, unsafe tar entries,
digest/size/tag/revision/source drift, symlinks, existing output, wrong modes or
unexpected files. No fallback identity or index-to-manifest substitution exists.

## Real validation

Run against the three retained real P8B2 OrbStack images and validate the
closed schema. Compare the generated platform-manifest digests with the
retained P8D2 transfer/load evidence and a fresh read-only Hermes image inspect;
all three must agree. The stopped P8D2 attempt already performed the real
cross-daemon load, so P8B3 must not mutate or reload Hermes merely to repeat it.
No provider credential, network call, customer data, mock image or synthetic
archive is permitted.

Repository gates include parser/schema/source checks, Node 22 lint/typecheck/
build, independent exact-head review, four green PR jobs, merge and exact-main
green CI. Retain the ignored real root mode `0700`, files `0600`, and bind its
collection-index hash in the PR body.

## Next boundary

P8B3 grants no Hermes mutation. A new P8D3 contract must use a new release
identity, bind P8B3 evidence, compare loaded IDs with platform-manifest digests,
retain the P8D2 failure and request fresh owner approval at action time.

Official basis: [Docker save](https://docs.docker.com/reference/cli/docker/image/save/),
[Docker load](https://docs.docker.com/reference/cli/docker/image/load/),
[OCI image spec](https://github.com/opencontainers/image-spec/blob/main/spec.md),
and [OCI descriptors](https://github.com/opencontainers/image-spec/blob/main/descriptor.md).
