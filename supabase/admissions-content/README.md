# China and Malaysia Admissions content

Candidate production content, not fixtures. Publication is gated by independent
review, migration137/138 validation and the normal release process. JSON presence
or passing content tests is not a deployed workflow or proof of a real application.

## Authority and sources

The source of truth is each original JSON file. The owner-supplied China and
Malaysia regulations were read through their existing private rendered copies,
including process, partner/language, message and housing tables. Original DOCX
SHA-256 values, relevant pages and source limitations are recorded in `sources`.
Unsigned approval fields are not represented as formal approval. Original files,
contact names, communication-group details and private housing examples stay out
of Git and the seed.

The governing implementation contract is
[admissions-playbook-implementation.md](../../docs/design/v3/admissions-playbook-implementation.md),
with the owner decisions in
[student-admissions-run-plan.md](../../docs/design/v3/student-admissions-run-plan.md).
These are original editorial adaptations for EVO, not verbatim third-party
message banks. Official pages are references for case-specific checks, not a
redistributed legal guide or a claim that every rule remains current indefinitely.
Public source availability and the relevant distinctions were checked 2026-09-09.

Important adaptations:

- Sales handoff is the entry point; the three existing `u6.*` tasks are not cloned.
- Seven canonical stage keys remain unchanged. Each JSON contains stage guidance,
  exit criteria and cautions; migration137 enforces the actual business gates.
- Primary application drives case progression; alternatives stay independent.
- Receiving the package is different from actual university submission.
- CN pre-admission is not final enrolment or permission to travel.
- MY referral, submission partner and university are different roles. The
  source's interchangeable “LOE” wording is corrected: use university Letter of
  Offer; the separate Letter of Eligibility in EMGS is not a universal synonym.
- MY EMGS/eVAL, entry visa, MDAC and Student Pass are separate checks. Source
  disagreement about the medical deadline is preserved as requiring clarification,
  not resolved by automatically choosing the later deadline.
- Current offer/invoice and official case-specific requirements govern fees,
  documents and dates. No blanket percentages, deposits, visa-on-arrival promise,
  review duration or automatic travel-purchase timing is imported.
- Confirmed arrival completes EVO Admissions; MY medical, registration and
  endorsement remain pending until separately evidenced. This common MY endpoint
  is the documented recommendation for owner post-edit, not completion of legal
  immigration obligations. Recurring study check-ins are not included.
- There is no Sheets sync, auto-send, partner login or staff assessment access.

## Content contract

Each file is `{ direction, version, title, content }`. Only `CN/MY` version `1.0.0`
is owned by this seed. The immutable private table is
`platform_private.admissions_playbook_versions` from migration137; inserts provide
`direction`, `version`, `title`, `content`, leaving `id` and `published_at` to the DB.

`content` has exactly `stages`, `tasks`, `messages`, `sources`, `limitations`:

- Stage: `key`, `title`, `summary`, `checklist[]`, `exitCriteria[]`, `cautions[]`.
- Task: stable `key`, `stageKey`, `title`, `priority`, `studentVisible: false`.
  No guessed deadlines, recipients or completed statuses. Existing task commands
  and the playbook binding supply the source key, assignee and idempotency.
- Message: `id`, `stageKey`, `title`, `audience`, `locale`, `whenToUse`, `body`,
  `placeholders: [{ key, label }]`, `sourceIds[]`. CN has 14, MY has 17 templates.
- Source: `id`, `title`, `kind`, `sourceVersion`, `reviewedOn`, `scope`; official
  sources also have `url`, owner regulation sources have the original `sha256`.

Message bodies use named `{{student_name}}` placeholders. Every referenced key
has exactly one Russian input label; there are no unlabeled or implicit fields.
The UI must require unresolved values to be filled or edited out, check the
final text again, and show **Скопировано**, never **Отправлено**. A template never
attaches a file, obtains permissions to disclose data, sends a provider request,
or changes a case status. The operator chooses the real recipient, allowed data
and language. University templates are EN; student/referral templates default RU.

Task counts are CN 12 and MY 13. They continue document, application, decision,
visa and travel work after existing intake/route starter tasks. Completing an
instruction task does not automatically mark its underlying documents, payments,
visa or arrival as verified.

## Reproduction and checks

Use the repository's Node22 runtime. These commands perform no network, database,
provider or production writes:

```sh
node scripts/generate-admissions-playbook-seed.mjs --check
node scripts/test-admissions-playbook-content.mjs
```

After editing these still-unapplied candidates, mechanically regenerate only 138:

```sh
node scripts/generate-admissions-playbook-seed.mjs --write
```

The generator validates exact shapes, canonical/unique IDs, placeholder equality,
source provenance and official HTTPS hosts, then emits deterministic insert-only
SQL with JSON checksums and escaped literals. Tests include negative mutations,
operational coverage and exact generated-byte/EOF checks. They do not establish
psychometric validity, current immigration eligibility, RLS, browser acceptance or
deployment. The isolated database/real UI gates belong to the application run.

Never rewrite an applied 138 or edit migration 136 while changing Admissions
content. Publish a new content version through a forward migration; never update
an immutable published row or silently rebind existing cases.
