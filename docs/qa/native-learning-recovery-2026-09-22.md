# Native learning recovery — 22 September 2026

Status: PRECODE; implementation and real changed-path validation pending.
Base: b4fc3f91d71a28916307abae554d057e343f138e.

The bounded source review found: assessment exit can acknowledge an older
pending snapshot while newer visible answers remain dirty; assessment failed
reload is retried as a write; lesson failed reload leaves a no-op Retry.

Contract: failed reads retry reads only; uncertain writes retain their frozen
request identity and payload. No silent draft overwrite on failed recovery.
Only explicit successful read adopts saved state. Save and Exit checks the
latest visible answers after any successful write/replay before dismissal.
Existing server authority, version checks, copy, design and native logout stay
unchanged. No mocks or new business fixtures.

Validation will use the ordinary Swift app and existing local Student lesson
and assessment records after ROOT assigns the exclusive QA window. This file
will distinguish source checks from actual execution. No native/runtime proof
is claimed by the precode contract.
