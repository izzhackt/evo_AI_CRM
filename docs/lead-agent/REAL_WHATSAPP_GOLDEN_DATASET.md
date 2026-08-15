# Real WhatsApp Golden Dataset

Issue: #194

The current Lead Agent prompts are safety and qualification baselines. They do
not yet prove human-quality consultative selling. This lane derives a Top-50
intent inventory from the real protected EVO WhatsApp archive before any sales
prompt is tuned.

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

## Golden approval

Every candidate begins as `owner_review_required`. For each one, the owner must
approve the generalized client question, desired answer, allowed knowledge and
freshness rule, discovery objective, at most two qualification questions, one
natural next step, forbidden claims and handoff conditions.

Only approved cases enter a sealed baseline-versus-candidate evaluation. The
response runner must not receive desired answers, and held-out cases must not be
used for prompt tuning.
