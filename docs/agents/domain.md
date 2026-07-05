# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This repo uses a single-context layout.

Read these files when they exist:

- `CONTEXT.md` at the repo root.
- `docs/adr/` for architectural decisions that touch the area being changed.

If these files do not exist, proceed silently. Do not flag their absence or create them upfront unless the active task is to model the domain or record an architectural decision.

## Use the glossary's vocabulary

When output names a domain concept, use the term as defined in `CONTEXT.md`.

If the concept is not in the glossary yet, either avoid inventing new vocabulary or note it as a gap for future domain-modeling work.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding it.
