# EVO Admissions Platform Overview

Audience: EVO Admissions team members and new operators.

Communication job: by the end, teammates should understand where to work, where
each fact belongs, and how CRM, Inbox, Lead Agent, amoCRM, Supabase, and WAHA fit
together.

## Narrative

1. EVO is one admissions operation supported by three product runtimes.
2. The CRM owns the operator/student workflow; Inbox owns WhatsApp work; Lead
   Agent supports safe automation.
3. Each data category has one authority, so copies do not compete.
4. The student journey remains visible from inquiry through enrollment.
5. GitHub `main` is the intended code/documentation truth, while production is a
   deployed result tied to a commit.
6. Team members start from the root README, follow onboarding, and use GitHub
   Issues for changing work status.

## Verified Constraints For The Deck

- Canonical CRM and Inbox DNS records were absent on 2026-07-12; fallback login
  URLs responded successfully.
- Real end-to-end WhatsApp production proof issues remain open.
- amoCRM owns contact/lead identity and sales state.
- Supabase owns EVO Inbox application data and shadow identifiers.
- Private bank/legal source documents are excluded from the deck.
