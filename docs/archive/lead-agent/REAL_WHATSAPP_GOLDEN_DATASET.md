# Real WhatsApp Consultative-Sales Evaluation Set

Issue: #194

The Top-50 inventory is real protected WhatsApp coverage for prompt evaluation.
It is not a library of canned replies. Human-quality consultative selling is
judged against the shared rubric in `CONSULTATIVE_SALES_EVALUATION_RU.md` using
the context that was actually available in each conversation.

## Private discovery

```bash
mkdir -p .evo-private-eval/top50
chmod 0700 .evo-private-eval .evo-private-eval/top50
node scripts/lead_eval/extract-real-whatsapp-intents.mjs \
  --archive '/absolute/protected/archive/Сырые данные/Чаты' \
  --output "$PWD/.evo-private-eval/top50/candidates.json"
```

Only real inbound text from direct chats is eligible. Raw messages, names,
phones, email addresses, URLs, chat IDs, provider IDs and media never enter the
report. Generalized questions come from the reviewed intent catalog, not from
customer quotations. Counts are multi-label discovery signals, not evidence
that a historical claim or staff answer is correct.

## Evaluation approval

Every catalog entry begins as `owner_review_required`. The owner approves the
generalized intent and question plus its eligibility for evaluation. Each
evaluation run supplies an independently reviewed, de-identified context bundle
with known memory, allowed knowledge, stage, missing facts and handoff boundary.
There is deliberately no fixed desired answer.

Only approved cases enter a sealed baseline-versus-candidate evaluation. The
response runner receives conversation inputs, not grader notes or scores, and
held-out cases must not be used for prompt tuning. Staff-reviewed production
drafts become candidate learning material only after owner review; they never
modify the prompt automatically.
