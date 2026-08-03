import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const resolver = fileURLToPath(
  new URL('../scripts/resolve-postgres-test-image.sh', import.meta.url)
)
const authorizationHarness = fileURLToPath(
  new URL('../scripts/test-postgres-authorization.sh', import.meta.url)
)
const digest =
  'sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453'
const ecr = `public.ecr.aws/supabase/postgres@${digest}`
const ghcr = `ghcr.io/supabase/postgres@${digest}`
const dockerHub = `supabase/postgres@${digest}`

function makeFakeDocker(t) {
  const directory = mkdtempSync(join(tmpdir(), 'evo-postgres-image-resolver-'))
  const executable = join(directory, 'docker')
  const log = join(directory, 'docker.log')

  writeFileSync(log, '')
  writeFileSync(
    executable,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
if [[ "$1" == "image" && "$2" == "inspect" ]]; then
  [[ "\${FAKE_DOCKER_CACHED:-}" == "$3" ]]
  exit
fi
if [[ "$1" == "pull" ]]; then
  if [[ "\${FAKE_DOCKER_PULL_SUCCESS:-}" == "$2" ]]; then
    echo "pulled $2" >&2
    exit 0
  fi
  echo "toomanyrequests: Rate exceeded for $2" >&2
  exit 1
fi
exit 64
`
  )
  chmodSync(executable, 0o755)
  t.after(() => rmSync(directory, { recursive: true, force: true }))

  return { executable, log }
}

function runResolver(t, overrides = {}) {
  const fake = makeFakeDocker(t)
  const env = {
    ...process.env,
    DOCKER_BIN: fake.executable,
    FAKE_DOCKER_LOG: fake.log,
    ...overrides,
  }
  if (overrides.POSTGRES_TEST_IMAGE === undefined) {
    delete env.POSTGRES_TEST_IMAGE
  }

  const result = spawnSync('bash', [resolver], {
    encoding: 'utf8',
    env,
  })
  const calls = readFileSync(fake.log, 'utf8').trim().split('\n').filter(Boolean)

  return { ...result, calls }
}

test('falls back from rate-limited ECR to the same pinned GHCR index', (t) => {
  const result = runResolver(t, {
    FAKE_DOCKER_PULL_SUCCESS: ghcr,
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), ghcr)
  assert.deepEqual(result.calls, [
    `image inspect ${ecr}`,
    `pull ${ecr}`,
    `image inspect ${ghcr}`,
    `pull ${ghcr}`,
  ])
  assert.match(result.stderr, /toomanyrequests: Rate exceeded/)
  assert.ok(!result.calls.includes(`image inspect ${dockerHub}`))
  assert.ok(!result.calls.includes(`pull ${dockerHub}`))
})

test('uses a cached explicit override without consulting fallback registries', (t) => {
  const override = 'registry.example.invalid/evo/postgres@sha256:test-only'
  const result = runResolver(t, {
    POSTGRES_TEST_IMAGE: override,
    FAKE_DOCKER_CACHED: override,
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), override)
  assert.deepEqual(result.calls, [`image inspect ${override}`])
})

test('fails closed after one bounded attempt against each pinned mirror', (t) => {
  const result = runResolver(t)

  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.deepEqual(result.calls, [
    `image inspect ${ecr}`,
    `pull ${ecr}`,
    `image inspect ${ghcr}`,
    `pull ${ghcr}`,
    `image inspect ${dockerHub}`,
    `pull ${dockerHub}`,
  ])
  assert.match(result.stderr, /Unable to pull pinned Supabase Postgres 17\.6\.1\.143/)
})

test('rejects an explicitly empty image override', (t) => {
  const result = runResolver(t, {
    POSTGRES_TEST_IMAGE: '',
  })

  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.deepEqual(result.calls, [])
  assert.match(result.stderr, /POSTGRES_TEST_IMAGE must not be empty/)
})

test('authorization harness keeps cold Postgres readiness bounded by wall time', () => {
  const source = readFileSync(authorizationHarness, 'utf8')

  assert.match(source, /EVO_POSTGRES_HEALTH_TIMEOUT_SECONDS:-300/)
  assert.match(source, /health_timeout_seconds < 60 \|\| health_timeout_seconds > 600/)
  assert.match(source, /health_deadline=\$\(\(SECONDS \+ health_timeout_seconds\)\)/)
  assert.match(source, /while \(\( SECONDS < health_deadline \)\)/)
  assert.match(source, /deadline_runner.*run-command-with-deadline\.mjs/)
  assert.match(source, /120000 docker run/)
  assert.match(source, /--network none/)
  assert.match(source, /15000 docker inspect/)
  assert.match(source, /15000 docker logs --tail 120/)
  assert.match(source, /30000 docker rm -f/)
  assert.doesNotMatch(source, /for _ in \$\(seq 1 60\)/)
})
