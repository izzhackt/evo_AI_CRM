# Versioned Student assessment content

This folder is a **server/migration input**, not a frontend import. Personal
attempts and result snapshots live in the canonical Supabase model. Never import
either complete JSON file into client components or return `gradingRules` from a
public content route. Migration 136 inserts both instruments into
`platform_private.student_assessment_versions` defined by migration 135.

## Content and provenance

- `english-v1.json`: 36 original EVO multiple-choice items, 12 grammar, 12
  vocabulary and 12 reading; the three reading passages are original instructional
  fiction. Every key includes a Russian explanation. This is candidate production
  content, not a fixture or a copied exam bank; publication is gated by independent
  review and the deployment process.
- `orvis-v1.json`: all 92 original ORVIS item IDs, English source phrases and
  eight original scale assignments. Russian EVO translation keeps foreign role
  references explicit. The original items/key are public domain; this Russian
  adaptation has not been psychometrically validated or piloted with EVO clients.
- Sixteen profession cards cover two editorial suggestions per scale. They
  adapt occupational descriptions/tasks from O*NET® 31.0; study directions,
  exploratory exercises and career paths are EVO suggestions, not licensing
  requirements or guaranteed career progression. Card attribution, source,
  version and CC BY 4.0 link must remain visible with the result.

Primary sources checked on 2026-09-09:

- [Official ORVIS items and key](https://ipip.ori.org/newORVISKey.htm).
- [IPIP public-domain permission](https://ipip.ori.org/newPermission.htm).
- [Original ORVIS study](https://projects.ori.org/lrg/PDFs_papers/Pozzebon_etal_2009_ORVIS_JPA.pdf),
  especially the five-point like/dislike response format. This does not validate
  the EVO translation.
- [O*NET 31.0 database](https://www.onetcenter.org/database.html) and
  [content license](https://www.onetcenter.org/license_db.html). Each card links
  its exact occupational profile. The cards do not reuse the separately licensed
  O*NET Interest Profiler questions.

## Interpretation boundary

English scores describe this quiz only: basic 0–17, developing 18–27, strong
28–36, with factual `/36` and `/12` counts and Russian limitations. These are
editorial bands, not CEFR or population norms. No listening, speaking or writing
score is inferred. The blueprint records granular skills and author-estimated
difficulty; individual skills have too few observations for a confident
strength/weakness diagnosis. Show the evidence and explanations instead.

ORVIS uses direct options `"1"` through `"5"`. The eight item counts are
12/13/13/14/10/10/10/10; display means rather than comparing raw sums. Missing
answers are not minimum-interest answers. Interest is not ability or diagnosis;
occupation links are editorial, not a validated ORVIS-to-O*NET crosswalk.

## Generation and checks

Use repository Node 22:

```bash
node scripts/generate-student-assessment-seed.mjs --check
node scripts/test-student-assessment-content.mjs
node scripts/test-student-assessment-content.mjs --verify-source
```

The default generator prints deterministic SQL; `--write` regenerates the
unapplied migration 136 mechanically. `--check` compares the SQL and source hashes
byte for byte. Once 136 is applied, **do not edit these published v1 files or
regenerate that migration**: create a new instrument version and forward migration.
There is no `ON CONFLICT DO NOTHING` to hide mismatched content and no update of
existing instrument versions.

The network check fetches the real public IPIP page and verifies every original
phrase, ID and scale. A source outage or incomplete parse fails clearly. Offline
checks use the actual checked-in content, not mocked results; neither proves
psychometric validity or that the Student portal works end-to-end.

Before release: independent language/content review of English keys and Russian
ORVIS, plus real Auth/RLS/browser validation under the run plan. This content
author must not act as the independent reviewer of these new files.
