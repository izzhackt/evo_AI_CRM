# P8B Candidate Manifest Runbook

This runbook creates repository and local-build evidence only. It does not read
production, contact a customer, mutate a provider, deploy an image or enable a
Platform runtime flag.

## Preconditions

Use a clean branch checkout at the exact reviewed candidate commit. The base
must be the exact accepted `origin/main` commit. On macOS, verify the only
permitted container runtime before any build:

```bash
orb status
test "$(docker context show)" = 'orbstack'
```

Stop if OrbStack is not running or the context is not exactly `orbstack`.

## Build once

Set the full candidate commit and immutable third-party image input required by
the production Compose file. Retain complete build output beneath the repository
evidence root, with both exact commits in every log header:

```bash
export EVO_RELEASE_REVISION='<full-candidate-sha>'
export EVO_P8_BASE_COMMIT='<full-origin-main-sha>'
export EVO_RELEASE_VERSION='<candidate-name>'
export EVO_IMAGE_SOURCE='https://github.com/izzhackt/evo_AI_CRM'
export EVO_P8_BUILD_EVIDENCE="$PWD/.evo-release-evidence/p8b-input-$EVO_RELEASE_REVISION"
mkdir -p "$EVO_P8_BUILD_EVIDENCE"
chmod 0700 "$PWD/.evo-release-evidence" "$EVO_P8_BUILD_EVIDENCE"

printf 'base_commit=%s\ncandidate_commit=%s\n' "$EVO_P8_BASE_COMMIT" "$EVO_RELEASE_REVISION" \
  > "$EVO_P8_BUILD_EVIDENCE/build-crm.log"
docker buildx build --platform linux/amd64 --load \
  --build-arg "EVO_IMAGE_SOURCE=$EVO_IMAGE_SOURCE" \
  --build-arg "EVO_IMAGE_REVISION=$EVO_RELEASE_REVISION" \
  --build-arg "EVO_IMAGE_VERSION=$EVO_RELEASE_VERSION" \
  --tag "evo-crm:$EVO_RELEASE_REVISION-linux-amd64" . \
  >> "$EVO_P8_BUILD_EVIDENCE/build-crm.log" 2>&1
printf 'Image evo-crm:%s-linux-amd64 Built\n' "$EVO_RELEASE_REVISION" \
  >> "$EVO_P8_BUILD_EVIDENCE/build-crm.log"
printf 'exit_code=0\n' >> "$EVO_P8_BUILD_EVIDENCE/build-crm.log"

printf 'base_commit=%s\ncandidate_commit=%s\n' "$EVO_P8_BASE_COMMIT" "$EVO_RELEASE_REVISION" \
  > "$EVO_P8_BUILD_EVIDENCE/build-inbox.log"
docker buildx build --platform linux/amd64 --load \
  --build-arg "NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg "NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  --build-arg "NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL" \
  --build-arg "EVO_IMAGE_SOURCE=$EVO_IMAGE_SOURCE" \
  --build-arg "EVO_IMAGE_REVISION=$EVO_RELEASE_REVISION" \
  --build-arg "EVO_IMAGE_VERSION=$EVO_RELEASE_VERSION" \
  --tag "evo-inbox:$EVO_RELEASE_REVISION-linux-amd64" agent-lead2-inbox \
  >> "$EVO_P8_BUILD_EVIDENCE/build-inbox.log" 2>&1
printf 'Image evo-inbox:%s-linux-amd64 Built\n' "$EVO_RELEASE_REVISION" \
  >> "$EVO_P8_BUILD_EVIDENCE/build-inbox.log"
printf 'exit_code=0\n' >> "$EVO_P8_BUILD_EVIDENCE/build-inbox.log"

printf 'base_commit=%s\ncandidate_commit=%s\n' "$EVO_P8_BASE_COMMIT" "$EVO_RELEASE_REVISION" \
  > "$EVO_P8_BUILD_EVIDENCE/build-lead-agent.log"
docker buildx build --platform linux/amd64 --load \
  --build-arg "EVO_IMAGE_SOURCE=$EVO_IMAGE_SOURCE" \
  --build-arg "EVO_IMAGE_REVISION=$EVO_RELEASE_REVISION" \
  --build-arg "EVO_IMAGE_VERSION=$EVO_RELEASE_VERSION" \
  --tag "evo-lead-agent:$EVO_RELEASE_REVISION-linux-amd64" evo-lead-agent \
  >> "$EVO_P8_BUILD_EVIDENCE/build-lead-agent.log" 2>&1
printf 'Image evo-lead-agent:%s-linux-amd64 Built\n' "$EVO_RELEASE_REVISION" \
  >> "$EVO_P8_BUILD_EVIDENCE/build-lead-agent.log"
printf 'exit_code=0\n' >> "$EVO_P8_BUILD_EVIDENCE/build-lead-agent.log"
chmod 0600 "$EVO_P8_BUILD_EVIDENCE"/*
```

The P8B2 generator runs real `docker image inspect` against
`evo-crm:$EVO_RELEASE_REVISION-linux-amd64`,
`evo-inbox:$EVO_RELEASE_REVISION-linux-amd64` and
`evo-lead-agent:$EVO_RELEASE_REVISION-linux-amd64`. Each image ID must be a full
content digest, each OCI `org.opencontainers.image.revision` label must equal
the candidate commit, and the inspect result must be exact `Os=linux`,
`Architecture=amd64`, `Variant=""`. The retained output records the inspected
ID, platform, tag, revision
and a per-image build record containing the exact successful Compose marker and
SHA-256 of its corresponding build log. A pre-existing image without that exact
retained marker fails. Do not supply digest JSON and do not rebuild after
generation; a rebuild is a new candidate.

## Validation input

Create a validation JSON array. `evidence_path` must refer to separately retained
redacted output under `.evo-release-evidence/`. Both the record and the evidence
content must carry the exact base and candidate commits. The manifest stores
only its SHA-256:

```json
[
  {
    "base_commit": "<full-origin-main-sha>",
    "candidate_commit": "<full-candidate-sha>",
    "name": "candidate manifest tests",
    "command": "node --test tests/p8-candidate-manifest.test.mjs",
    "exit_code": 0,
    "test_count": 4,
    "evidence_path": "/absolute/repo/.evo-release-evidence/.../redacted-command-output.txt"
  }
]
```

The evidence file and command metadata are rejected if they contain a Supabase
key or token, a JWT, a credential assignment or an email address.
The validations file and every retained evidence file must be inside the repo
evidence root, have mode `0600`, and contain exact `command=` and `exit_code=`
records. All evidence directories must have mode `0700`.

## Generate

Use an explicit UTC timestamp so identical inputs produce identical output:

```bash
npm run p8:candidate -- \
  --base "$EVO_P8_BASE_COMMIT" \
  --commit "$EVO_RELEASE_REVISION" \
  --release-control '<exact-current-main-sha>' \
  --source-root '/absolute/clean/detached/source-worktree' \
  --timestamp '<ISO-8601-UTC-timestamp>' \
  --build-evidence-dir "$EVO_P8_BUILD_EVIDENCE" \
  --validations '/absolute/repo/.evo-release-evidence/.../validations.json' \
  --output-dir ".evo-release-evidence/$EVO_RELEASE_REVISION"
```

Run the command from the clean exact release-control checkout. `--source-root`
must be a separate clean detached checkout at the frozen application commit;
the generator binds both Git identities and its own SHA-256. Build, validation
and output paths must all be beneath the source checkout's
`.evo-release-evidence/` directory, and the output directory must not already
exist. It is ignored by Git and contains mode `0600` JSON evidence,
`evidence-index.json`, and `candidate-manifest.json`. Candidate manifest schema
version 2 records the closed target platform; `image-identity.json` is closed by
[p8-image-identity.schema.json](../schemas/p8-image-identity.schema.json). The command fails closed
on a dirty checkout, a different `HEAD`, a migration range other than contiguous
`001-072`, a missing reviewed configuration file, a non-OrbStack Docker context,
a missing or mislabeled candidate image, an unbound/unsafe retained log, or an
existing output directory. It also records required runtime setting names,
presence in safe example files, and owning service only; values are never
included.

The schemas are [p8-candidate-manifest.schema.json](../schemas/p8-candidate-manifest.schema.json)
and [p8-evidence-index.schema.json](../schemas/p8-evidence-index.schema.json).
